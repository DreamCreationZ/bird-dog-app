import { NextRequest, NextResponse } from "next/server";
import { listCircuitInventory, listOrgUnlocks, seedCircuitInventory } from "@/lib/birddog/repository";
import { INVENTORY_SEED, inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { bestGroupedEventMatch, fetchPgGroupedEvents } from "@/lib/birddog/pgGroupedEvents";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";
import { fetchPbrTournamentCatalog } from "@/lib/birddog/pbrTournamentCatalog";
import { fetchPgTournamentCatalog } from "@/lib/birddog/pgTournamentCatalog";

const FALLBACK_UNLOCK_COOKIE = "bird_dog_fallback_unlocks";
const LIVE_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type LiveCatalogCache = {
  fetchedAt: number;
  pg: InventoryItem[];
  pbr: InventoryItem[];
};

function getLiveCatalogCache() {
  const g = globalThis as unknown as { __BIRD_DOG_LIVE_CATALOG_CACHE__?: LiveCatalogCache };
  if (!g.__BIRD_DOG_LIVE_CATALOG_CACHE__) {
    g.__BIRD_DOG_LIVE_CATALOG_CACHE__ = {
      fetchedAt: 0,
      pg: [],
      pbr: []
    };
  }
  return g.__BIRD_DOG_LIVE_CATALOG_CACHE__;
}

function fallbackUnlockedSlugs(req: NextRequest) {
  const raw = req.cookies.get(FALLBACK_UNLOCK_COOKIE)?.value || "";
  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return new Set(values);
}

type InventoryItem = {
  id?: string;
  slug: string;
  name: string;
  season: "summer" | "fall";
  company: "PG" | "PBR";
  displayDate?: string;
  displayTeams?: string;
  displayCity?: string;
  harvestHint?: string;
};

function withTimeoutFallback<T>(task: Promise<T>, timeoutMs: number, fallback: T) {
  let settled = false;
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);
    task
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function normalizeInventoryName(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function inventoryNamesMatch(left: string, right: string) {
  const a = normalizeInventoryName(left);
  const b = normalizeInventoryName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function applyLiveInventory(
  baseInventory: InventoryItem[],
  livePg: InventoryItem[],
  livePbr: InventoryItem[]
) {
  const basePg = baseInventory.filter((item) => item.company === "PG");
  const basePbr = baseInventory.filter((item) => item.company === "PBR");

  const mapLiveItem = (item: InventoryItem, baseRows: InventoryItem[]) => {
    const match = baseRows.find((row) => inventoryNamesMatch(row.name, item.name));
    if (!match) return item;
    return {
      ...item,
      slug: match.slug,
      season: match.season || item.season
    };
  };

  const mergeLiveWithBase = (liveRows: InventoryItem[], baseRows: InventoryItem[]) => {
    if (!liveRows.length) return baseRows;
    const mappedLive = liveRows.map((item) => mapLiveItem(item, baseRows));
    const liveBySlug = new Set(mappedLive.map((item) => item.slug));
    const fallbackBase = baseRows.filter((baseItem) => {
      if (liveBySlug.has(baseItem.slug)) return false;
      return !mappedLive.some((liveItem) => inventoryNamesMatch(liveItem.name, baseItem.name));
    });
    return [...mappedLive, ...fallbackBase];
  };

  const nextPg = mergeLiveWithBase(livePg, basePg);
  const nextPbr = mergeLiveWithBase(livePbr, basePbr);

  const staticOther = baseInventory.filter((item) => item.company !== "PG" && item.company !== "PBR");
  return [...staticOther, ...nextPg, ...nextPbr];
}

function buildFallbackInventory() {
  const base = INVENTORY_SEED.map((item) => ({
    slug: item.slug,
    name: item.name,
    season: item.season,
    company: item.company,
    displayDate: item.displayDate || "",
    displayTeams: item.displayTeams || "",
    displayCity: item.displayCity || ""
  })) as InventoryItem[];
  return base;
}

function isSeedOnlyInventory(items: InventoryItem[]) {
  if (!items.length) return true;
  const seedSlugs = new Set(INVENTORY_SEED.map((item) => item.slug));
  const hasLiveSlug = items.some((item) => item.slug.startsWith("pg-live-") || item.slug.startsWith("pbr-live-"));
  if (hasLiveSlug) return false;
  return items.every((item) => seedSlugs.has(item.slug));
}

function mapInventoryForResponse(
  inventory: InventoryItem[],
  previewUnlockAll: boolean,
  unlockedSet: Set<string>
) {
  return inventory.map((item) => {
    const isArchive = isFreeTournamentAccess({
      slug: item.slug,
      name: item.name,
      displayDate: item.displayDate || ""
    });
    const isLivePg = item.company === "PG" && item.slug.startsWith("pg-live-");
    const isLivePbr = item.company === "PBR" && item.slug.startsWith("pbr-live-");
    return {
      id: item.slug,
      slug: item.slug,
      name: item.name,
      season: item.season,
      company: item.company,
      locked: previewUnlockAll ? false : (isArchive ? false : (isLivePg || isLivePbr ? false : !unlockedSet.has(item.slug))),
      isArchive,
      harvestHint: item.harvestHint || inventoryHarvestHint(item),
      displayDate: item.displayDate || "",
      displayTeams: item.displayTeams || "",
      displayCity: item.displayCity || ""
    };
  });
}

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdminUser = Boolean(session.isAdmin) || isPrivilegedAdminEmail(String(session.email || ""));
  const previewUnlockAll =
    process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true"
    && process.env.NODE_ENV !== "production";
  const forceUnlocked = previewUnlockAll || isAdminUser;
  const cookieUnlockedSet = fallbackUnlockedSlugs(req);
  const fallbackBaseInventory = buildFallbackInventory();

  try {
    const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!hasSupabaseConfig) {
      return NextResponse.json({
        subscribed: forceUnlocked || cookieUnlockedSet.size > 0,
        fallback: true,
        source: "seed_inventory",
        inventory: mapInventoryForResponse(fallbackBaseInventory, forceUnlocked, cookieUnlockedSet)
      });
    }
    const seedMetaBySlug = new Map(INVENTORY_SEED.map((item) => [item.slug, item]));
    await withTimeoutFallback(seedCircuitInventory(), 3500, null);
    const groupedEvents = await withTimeoutFallback(
      fetchPgGroupedEvents("23065").catch(() => []),
      4500,
      [] as Awaited<ReturnType<typeof fetchPgGroupedEvents>>
    );
    const [inventory, unlockedSlugs] = await Promise.all([
      withTimeoutFallback(
        listCircuitInventory(),
        8000,
        [] as Awaited<ReturnType<typeof listCircuitInventory>>
      ),
      withTimeoutFallback(
        listOrgUnlocks(session.orgId),
        5000,
        [] as string[]
      )
    ]);
    if (!inventory.length) {
      return NextResponse.json({
        subscribed: forceUnlocked || cookieUnlockedSet.size > 0,
        fallback: true,
        warning: "Inventory table was empty. Showing seeded tournaments.",
        inventory: mapInventoryForResponse(fallbackBaseInventory, forceUnlocked, cookieUnlockedSet)
      });
    }
    const liveCatalogCache = getLiveCatalogCache();
    const hasFreshLiveCache =
      Date.now() - liveCatalogCache.fetchedAt < LIVE_CATALOG_CACHE_TTL_MS
      && (liveCatalogCache.pg.length > 0 || liveCatalogCache.pbr.length > 0);

    let livePg = hasFreshLiveCache ? liveCatalogCache.pg : [];
    let livePbr = hasFreshLiveCache ? liveCatalogCache.pbr : [];
    if (!hasFreshLiveCache) {
      const [nextLivePg, nextLivePbr] = await Promise.all([
        withTimeoutFallback(
          fetchPgTournamentCatalog().then((result) => result.items as InventoryItem[]),
          7000,
          liveCatalogCache.pg
        ),
        withTimeoutFallback(
          fetchPbrTournamentCatalog().then((result) => result.items as InventoryItem[]),
          7000,
          liveCatalogCache.pbr
        )
      ]);
      livePg = nextLivePg;
      livePbr = nextLivePbr;
      if (livePg.length > 0 || livePbr.length > 0) {
        liveCatalogCache.fetchedAt = Date.now();
        liveCatalogCache.pg = livePg;
        liveCatalogCache.pbr = livePbr;
      }
    }

    let mergedInventory = applyLiveInventory(inventory as InventoryItem[], livePg, livePbr);
    if (!livePg.length && !livePbr.length && isSeedOnlyInventory(mergedInventory)) {
      // Avoid flashing stale seeded tournaments as if they were current live events.
      mergedInventory = [];
    }
    const unlockedSet = new Set([...unlockedSlugs, ...cookieUnlockedSet]);

    return NextResponse.json({
      subscribed: forceUnlocked || unlockedSet.size > 0,
      warning: mergedInventory.length
        ? undefined
        : "Live tournament sync is still warming up. Please refresh in a few seconds.",
      inventory: mergedInventory.map((item) => {
        const match = item.company === "PG" ? bestGroupedEventMatch(item.name, groupedEvents) : null;
        const seedMeta = seedMetaBySlug.get(item.slug);
        const displayDate = item.displayDate || match?.dateLabel || seedMeta?.displayDate || "";
        const isArchive = isFreeTournamentAccess({ slug: item.slug, name: item.name, displayDate });
        const isLivePg = item.company === "PG" && item.slug.startsWith("pg-live-");
        const isLivePbr = item.company === "PBR" && item.slug.startsWith("pbr-live-");
        return {
          ...item,
          locked: forceUnlocked ? false : (isArchive ? false : (isLivePg || isLivePbr ? false : !unlockedSet.has(item.slug))),
          isArchive,
          harvestHint: item.harvestHint || inventoryHarvestHint(item),
          displayDate,
          displayTeams: item.displayTeams || match?.teamsLabel || seedMeta?.displayTeams || "",
          displayCity: item.displayCity || match?.city || seedMeta?.displayCity || ""
        };
      })
    });
  } catch (error) {
    const detail = String(error || "");
    const missingConfig = detail.includes("Missing environment variable: SUPABASE_URL")
      || detail.includes("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
    if (missingConfig) {
      return NextResponse.json({
        subscribed: forceUnlocked || cookieUnlockedSet.size > 0,
        fallback: true,
        source: "seed_inventory",
        inventory: mapInventoryForResponse(fallbackBaseInventory, forceUnlocked, cookieUnlockedSet)
      });
    }
    return NextResponse.json({
      subscribed: forceUnlocked || cookieUnlockedSet.size > 0,
      fallback: true,
      warning: "Failed to read inventory from database. Showing seeded tournaments.",
      detail,
      inventory: mapInventoryForResponse(fallbackBaseInventory, forceUnlocked, cookieUnlockedSet)
    });
  }
}
