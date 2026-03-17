import { NextRequest, NextResponse } from "next/server";
import { listCircuitInventory, listOrgUnlocks, seedCircuitInventory } from "@/lib/birddog/repository";
import { INVENTORY_SEED, inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { bestGroupedEventMatch, fetchPgGroupedEvents } from "@/lib/birddog/pgGroupedEvents";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

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
    const unlockedSet = new Set(unlockedSlugs);

    return NextResponse.json({
      subscribed: previewUnlockAll || unlockedSet.size > 0,
      inventory: inventory.map((item) => {
        const match = item.company === "PG" ? bestGroupedEventMatch(item.name, groupedEvents) : null;
        const seedMeta = seedMetaBySlug.get(item.slug);
        return {
          ...item,
          locked: previewUnlockAll ? false : !unlockedSet.has(item.slug),
          harvestHint: inventoryHarvestHint(item),
          displayDate: match?.dateLabel || seedMeta?.displayDate || "",
          displayTeams: match?.teamsLabel || seedMeta?.displayTeams || "",
          displayCity: match?.city || seedMeta?.displayCity || ""
        };
      })
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load inventory", detail: String(error) }, { status: 500 });
  }
}
