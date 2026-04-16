import { NextRequest, NextResponse } from "next/server";
import { listCoachLiveLocations, upsertCoachLiveLocation } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const locations = await listCoachLiveLocations(session.orgId);
    return NextResponse.json({ locations });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to load coach live locations.",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const accuracyMetersRaw = Number(body?.accuracyMeters);
  const accuracyMeters = Number.isFinite(accuracyMetersRaw) ? accuracyMetersRaw : null;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "Valid latitude and longitude are required." }, { status: 400 });
  }

  try {
    await upsertCoachLiveLocation({
      orgId: session.orgId,
      userId: session.userId,
      coachName: session.name,
      latitude,
      longitude,
      accuracyMeters
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to save coach live location.",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
