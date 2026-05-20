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
const LIVE_CATALOG_CACHE_TTL_MS = 45 * 1000;
const LAST_GOOD_INVENTORY_TTL_MS = 30 * 60 * 1000;

type LiveCatalogCache = {
  fetchedAt: number;
  pg: InventoryItem[];
  pbr: InventoryItem[];
};

type LastGoodInventoryCache = {
  savedAt: number;
  inventory: InventoryItem[];
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

function getLastGoodInventoryCache() {
  const g = globalThis as unknown as { __BIRD_DOG_LAST_GOOD_INVENTORY_CACHE__?: LastGoodInventoryCache };
  if (!g.__BIRD_DOG_LAST_GOOD_INVENTORY_CACHE__) {
    g.__BIRD_DOG_LAST_GOOD_INVENTORY_CACHE__ = {
      savedAt: 0,
      inventory: []
    };
  }
  return g.__BIRD_DOG_LAST_GOOD_INVENTORY_CACHE__;
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

function monthTokenToIndex(token: string) {
  const key = String(token || "").trim().slice(0, 3).toLowerCase();
  const map: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11
  };
  return map[key] ?? null;
}

function parseDisplayDateStartMs(displayDate: string, fallbackYear: number) {
  const raw = String(displayDate || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const usDate = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usDate) {
    const month = Number(usDate[1]);
    const day = Number(usDate[2]);
    const year = Number(usDate[3]);
    return new Date(year, month - 1, day, 9, 0, 0, 0).getTime();
  }

  const monthDayRange = raw.match(/^([A-Za-z]+)\s*(\d{1,2})\s*-\s*([A-Za-z]+)?\s*(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (monthDayRange) {
    const monthIdx = monthTokenToIndex(monthDayRange[1]);
    const day = Number(monthDayRange[2]);
    const explicitYear = monthDayRange[5] ? Number(monthDayRange[5]) : fallbackYear;
    if (monthIdx != null && Number.isFinite(day)) {
      return new Date(explicitYear, monthIdx, day, 9, 0, 0, 0).getTime();
    }
  }

  const monthDay = raw.match(/^([A-Za-z]+)\s*(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (monthDay) {
    const monthIdx = monthTokenToIndex(monthDay[1]);
    const day = Number(monthDay[2]);
    const year = monthDay[3] ? Number(monthDay[3]) : fallbackYear;
    if (monthIdx != null && Number.isFinite(day)) {
      return new Date(year, monthIdx, day, 9, 0, 0, 0).getTime();
    }
  }

  const monthOnly = raw.match(/^([A-Za-z]+)(?:\s*-\s*[A-Za-z]+)?(?:\s+(\d{4}))?$/);
  if (monthOnly) {
    const monthIdx = monthTokenToIndex(monthOnly[1]);
    const year = monthOnly[2] ? Number(monthOnly[2]) : fallbackYear;
    if (monthIdx != null && Number.isFinite(year)) {
      return new Date(year, monthIdx, 1, 9, 0, 0, 0).getTime();
    }
  }

  return null;
}

function inventoryFallbackYear(item: InventoryItem) {
  const fromDate = String(item.displayDate || "").match(/\b(20\d{2})\b/)?.[1];
  if (fromDate) return Number(fromDate);
  const fromName = String(item.name || "").match(/\b(20\d{2})\b/)?.[1];
  if (fromName) return Number(fromName);
  return new Date().getFullYear();
}

function inventoryRowScore(item: InventoryItem) {
  let score = 0;
  if (String(item.displayDate || "").trim()) score += 4;
  if (String(item.displayTeams || "").trim()) score += 3;
  if (String(item.displayCity || "").trim()) score += 2;
  if (String(item.harvestHint || "").trim()) score += 1;
  if (item.slug.startsWith("pg-live-") || item.slug.startsWith("pbr-live-")) score += 1;
  return score;
}

function normalizeSortAndDedupeInventory(items: InventoryItem[]) {
  const deduped = new Map<string, InventoryItem>();
  for (const item of items) {
    const key = `${item.company}:${normalizeInventoryName(item.name)}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }
    if (inventoryRowScore(item) > inventoryRowScore(existing)) {
      deduped.set(key, item);
    }
  }
  return Array.from(deduped.values()).sort((a, b) => {
    const aStart = parseDisplayDateStartMs(String(a.displayDate || ""), inventoryFallbackYear(a)) ?? Number.MAX_SAFE_INTEGER;
    const bStart = parseDisplayDateStartMs(String(b.displayDate || ""), inventoryFallbackYear(b)) ?? Number.MAX_SAFE_INTEGER;
    if (aStart !== bStart) return aStart - bStart;
    return a.name.localeCompare(b.name);
  });
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

  // PG should mirror live website catalog when available.
  const nextPg = livePg.length ? livePg : basePg;
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
  const normalizedInventory = normalizeSortAndDedupeInventory(inventory);
  return normalizedInventory.map((item) => {
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
    const groupedEventsPromise = withTimeoutFallback(
      fetchPgGroupedEvents("23065").catch(() => []),
      1500,
      [] as Awaited<ReturnType<typeof fetchPgGroupedEvents>>
    );
    await withTimeoutFallback(seedCircuitInventory(), 1500, null);
    const [inventory, unlockedSlugs, groupedEvents] = await Promise.all([
      withTimeoutFallback(
        listCircuitInventory(),
        4000,
        [] as Awaited<ReturnType<typeof listCircuitInventory>>
      ),
      withTimeoutFallback(
        listOrgUnlocks(session.orgId),
        3000,
        [] as string[]
      ),
      groupedEventsPromise
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
    const hasFreshPbrCache =
      Date.now() - liveCatalogCache.fetchedAt < LIVE_CATALOG_CACHE_TTL_MS
      && liveCatalogCache.pbr.length > 0;

    // Force-refresh PG catalog each request so dashboard stays aligned with website.
    const [nextLivePg, nextLivePbr] = await Promise.all([
      withTimeoutFallback(
        fetchPgTournamentCatalog(true).then((result) => result.items as InventoryItem[]),
        9000,
        liveCatalogCache.pg
      ),
      hasFreshPbrCache
        ? Promise.resolve(liveCatalogCache.pbr)
        : withTimeoutFallback(
          fetchPbrTournamentCatalog().then((result) => result.items as InventoryItem[]),
          3000,
          liveCatalogCache.pbr
        )
    ]);

    const livePg = nextLivePg;
    const livePbr = nextLivePbr;
    if (livePg.length > 0 || livePbr.length > 0) {
      liveCatalogCache.fetchedAt = Date.now();
      liveCatalogCache.pg = livePg;
      liveCatalogCache.pbr = livePbr;
    }

    let mergedInventory = applyLiveInventory(inventory as InventoryItem[], livePg, livePbr);
    const lastGoodInventory = getLastGoodInventoryCache();
    const hasFreshLastGood =
      lastGoodInventory.inventory.length > 0
      && Date.now() - lastGoodInventory.savedAt < LAST_GOOD_INVENTORY_TTL_MS;
    if (!livePg.length && !livePbr.length && isSeedOnlyInventory(mergedInventory)) {
      // Avoid flashing stale seeded tournaments as if they were current live events.
      mergedInventory = hasFreshLastGood ? lastGoodInventory.inventory : [];
    }
    mergedInventory = normalizeSortAndDedupeInventory(mergedInventory);
    if (mergedInventory.length) {
      lastGoodInventory.savedAt = Date.now();
      lastGoodInventory.inventory = mergedInventory;
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
    const lastGoodInventory = getLastGoodInventoryCache();
    const hasFreshLastGood =
      lastGoodInventory.inventory.length > 0
      && Date.now() - lastGoodInventory.savedAt < LAST_GOOD_INVENTORY_TTL_MS;
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
      warning: hasFreshLastGood
        ? "Live sync failed briefly. Showing last successful tournament snapshot."
        : "Failed to read inventory from database. Showing seeded tournaments.",
      detail,
      inventory: hasFreshLastGood
        ? mapInventoryForResponse(lastGoodInventory.inventory, forceUnlocked, cookieUnlockedSet)
        : mapInventoryForResponse(fallbackBaseInventory, forceUnlocked, cookieUnlockedSet)
    });
  }
}
