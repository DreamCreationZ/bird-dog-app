import { NextRequest, NextResponse } from "next/server";
import { listCircuitInventory, listOrgUnlocks, seedCircuitInventory } from "@/lib/birddog/repository";
import { inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const previewUnlockAll = process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";
    await seedCircuitInventory();
    const [inventory, unlockedSlugs] = await Promise.all([
      listCircuitInventory(),
      listOrgUnlocks(session.orgId)
    ]);
    const unlockedSet = new Set(unlockedSlugs);

    return NextResponse.json({
      subscribed: previewUnlockAll || unlockedSet.size > 0,
      inventory: inventory.map((item) => ({
        ...item,
        locked: previewUnlockAll ? false : !unlockedSet.has(item.slug),
        harvestHint: inventoryHarvestHint(item)
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load inventory", detail: String(error) }, { status: 500 });
  }
}
