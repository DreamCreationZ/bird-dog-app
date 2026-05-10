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

function applyLivePbrInventory(baseInventory: InventoryItem[], livePbr: InventoryItem[]) {
  if (!livePbr.length) return baseInventory;
  const withoutPbr = baseInventory.filter((item) => item.company !== "PBR");
  return [...withoutPbr, ...livePbr];
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

  const nextPg = livePg.length ? livePg.map((item) => mapLiveItem(item, basePg)) : basePg;
  const nextPbr = livePbr.length ? livePbr.map((item) => mapLiveItem(item, basePbr)) : basePbr;

  const staticOther = baseInventory.filter((item) => item.company !== "PG" && item.company !== "PBR");
  return [...staticOther, ...nextPg, ...nextPbr];
}

async function buildFallbackInventory() {
  const base = INVENTORY_SEED.map((item) => ({
    slug: item.slug,
    name: item.name,
    season: item.season,
    company: item.company,
    displayDate: item.displayDate || "",
    displayTeams: item.displayTeams || "",
    displayCity: item.displayCity || ""
  })) as InventoryItem[];

  try {
    const livePg = await fetchPgTournamentCatalog().then((result) => result.items as InventoryItem[]);
    const livePbr = await fetchPbrTournamentCatalog().then((result) => result.items);
    return applyLiveInventory(base, livePg, livePbr);
  } catch {
    return base;
  }
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
  const fallbackBaseInventory = await buildFallbackInventory();

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
    await seedCircuitInventory();
    const groupedEvents = await fetchPgGroupedEvents("23065").catch(() => []);
    const [inventory, unlockedSlugs] = await Promise.all([
      listCircuitInventory(),
      listOrgUnlocks(session.orgId)
    ]);
    if (!inventory.length) {
      return NextResponse.json({
        subscribed: forceUnlocked || cookieUnlockedSet.size > 0,
        fallback: true,
        warning: "Inventory table was empty. Showing seeded tournaments.",
        inventory: mapInventoryForResponse(fallbackBaseInventory, forceUnlocked, cookieUnlockedSet)
      });
    }
    const [livePg, livePbr] = await Promise.all([
      fetchPgTournamentCatalog().then((result) => result.items as InventoryItem[]).catch(() => []),
      fetchPbrTournamentCatalog().then((result) => result.items).catch(() => [])
    ]);
    const mergedInventory = applyLiveInventory(inventory as InventoryItem[], livePg, livePbr);
    const unlockedSet = new Set([...unlockedSlugs, ...cookieUnlockedSet]);

    return NextResponse.json({
      subscribed: forceUnlocked || unlockedSet.size > 0,
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
