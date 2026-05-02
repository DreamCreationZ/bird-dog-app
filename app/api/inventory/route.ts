import { NextRequest, NextResponse } from "next/server";
import { listCircuitInventory, listOrgUnlocks, seedCircuitInventory } from "@/lib/birddog/repository";
import { INVENTORY_SEED, inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { bestGroupedEventMatch, fetchPgGroupedEvents } from "@/lib/birddog/pgGroupedEvents";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

const FALLBACK_UNLOCK_COOKIE = "bird_dog_fallback_unlocks";

function fallbackUnlockedSlugs(req: NextRequest) {
  const raw = req.cookies.get(FALLBACK_UNLOCK_COOKIE)?.value || "";
  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return new Set(values);
}

function fallbackInventory(previewUnlockAll: boolean, unlockedSet: Set<string>) {
  return INVENTORY_SEED.map((item) => {
    const isArchive = isFreeTournamentAccess({
      slug: item.slug,
      name: item.name,
      displayDate: item.displayDate || ""
    });
    return {
      id: item.slug,
      slug: item.slug,
      name: item.name,
      season: item.season,
      company: item.company,
      locked: previewUnlockAll ? false : (isArchive ? false : !unlockedSet.has(item.slug)),
      isArchive,
      harvestHint: inventoryHarvestHint(item),
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

  const previewUnlockAll =
    process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true"
    && process.env.NODE_ENV !== "production";
  const cookieUnlockedSet = fallbackUnlockedSlugs(req);

  try {
    const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!hasSupabaseConfig) {
      return NextResponse.json({
        subscribed: previewUnlockAll || cookieUnlockedSet.size > 0,
        fallback: true,
        source: "seed_inventory",
        inventory: fallbackInventory(previewUnlockAll, cookieUnlockedSet)
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
        subscribed: previewUnlockAll || cookieUnlockedSet.size > 0,
        fallback: true,
        warning: "Inventory table was empty. Showing seeded tournaments.",
        inventory: fallbackInventory(previewUnlockAll, cookieUnlockedSet)
      });
    }
    const unlockedSet = new Set([...unlockedSlugs, ...cookieUnlockedSet]);

    return NextResponse.json({
      subscribed: previewUnlockAll || unlockedSet.size > 0,
      inventory: inventory.map((item) => {
        const match = item.company === "PG" ? bestGroupedEventMatch(item.name, groupedEvents) : null;
        const seedMeta = seedMetaBySlug.get(item.slug);
        const displayDate = match?.dateLabel || seedMeta?.displayDate || "";
        const isArchive = isFreeTournamentAccess({ slug: item.slug, name: item.name, displayDate });
        return {
          ...item,
          locked: previewUnlockAll ? false : (isArchive ? false : !unlockedSet.has(item.slug)),
          isArchive,
          harvestHint: inventoryHarvestHint(item),
          displayDate,
          displayTeams: match?.teamsLabel || seedMeta?.displayTeams || "",
          displayCity: match?.city || seedMeta?.displayCity || ""
        };
      })
    });
  } catch (error) {
    const detail = String(error || "");
    const missingConfig = detail.includes("Missing environment variable: SUPABASE_URL")
      || detail.includes("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
    if (missingConfig) {
      return NextResponse.json({
        subscribed: previewUnlockAll || cookieUnlockedSet.size > 0,
        fallback: true,
        source: "seed_inventory",
        inventory: fallbackInventory(previewUnlockAll, cookieUnlockedSet)
      });
    }
    return NextResponse.json({
      subscribed: previewUnlockAll || cookieUnlockedSet.size > 0,
      fallback: true,
      warning: "Failed to read inventory from database. Showing seeded tournaments.",
      detail,
      inventory: fallbackInventory(previewUnlockAll, cookieUnlockedSet)
    });
  }
}
