import { NextRequest, NextResponse } from "next/server";
import { hasUserSubscription, listCircuitInventory, seedCircuitInventory } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await seedCircuitInventory();
    const [inventory, subscribed] = await Promise.all([
      listCircuitInventory(),
      hasUserSubscription(session.userId)
    ]);

    return NextResponse.json({
      subscribed,
      inventory: inventory.map((item) => ({
        ...item,
        locked: !subscribed
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load inventory", detail: String(error) }, { status: 500 });
  }
}
