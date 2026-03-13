import { NextRequest, NextResponse } from "next/server";
import { cleanupPastCoachSchedules, listCoachSchedules, upsertCoachSchedule } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await cleanupPastCoachSchedules(session.orgId);
    const schedules = await listCoachSchedules(session.orgId);
    return NextResponse.json({ schedules });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load schedules", detail: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  try {
    await cleanupPastCoachSchedules(session.orgId);
    await upsertCoachSchedule({
      orgId: session.orgId,
      userId: session.userId,
      coachName: session.name,
      flightSource: body?.flightSource,
      flightDestination: body?.flightDestination,
      flightArrivalTime: body?.flightArrivalTime,
      hotelName: body?.hotelName,
      notes: body?.notes,
      desiredPlayers: Array.isArray(body?.desiredPlayers) ? body.desiredPlayers : [],
      generatedPlan: Array.isArray(body?.generatedPlan) ? body.generatedPlan : []
    });

    const schedules = await listCoachSchedules(session.orgId);
    return NextResponse.json({ ok: true, schedules });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save schedule", detail: String(error) }, { status: 500 });
  }
}
