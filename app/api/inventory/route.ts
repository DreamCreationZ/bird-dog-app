import { NextRequest, NextResponse } from "next/server";
import { listCircuitInventory, listOrgUnlocks, seedCircuitInventory } from "@/lib/birddog/repository";
import { INVENTORY_SEED, inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { bestGroupedEventMatch, fetchPgGroupedEvents } from "@/lib/birddog/pgGroupedEvents";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

function fallbackInventory(previewUnlockAll: boolean) {
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
      locked: previewUnlockAll ? false : !isArchive,
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

  try {
    const previewUnlockAll = process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";
    const seedMetaBySlug = new Map(INVENTORY_SEED.map((item) => [item.slug, item]));
    await seedCircuitInventory();
    const groupedEvents = await fetchPgGroupedEvents("23065").catch(() => []);
    const [inventory, unlockedSlugs] = await Promise.all([
      listCircuitInventory(),
      listOrgUnlocks(session.orgId)
    ]);
    if (!inventory.length) {
      return NextResponse.json({
        subscribed: false,
        fallback: true,
        warning: "Inventory table was empty. Showing seeded tournaments.",
        inventory: fallbackInventory(previewUnlockAll)
      });
    }
    const unlockedSet = new Set(unlockedSlugs);

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
    return NextResponse.json({
      subscribed: false,
      fallback: true,
      warning: "Failed to read inventory from database. Showing seeded tournaments.",
      detail: String(error),
      inventory: fallbackInventory(process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true")
    });
  }
}
