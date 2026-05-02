import { NextRequest, NextResponse } from "next/server";
import { cleanupPastCoachSchedules, listCoachSchedules, upsertCoachSchedule } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

function domainFromEmail(email: string | null | undefined) {
  const clean = String(email || "").trim().toLowerCase();
  const at = clean.indexOf("@");
  if (at < 0) return "";
  return clean.slice(at + 1);
}

function maskEmail(email: string | null | undefined) {
  const clean = String(email || "").trim().toLowerCase();
  const [name, domain] = clean.split("@");
  if (!name || !domain) return "";
  if (name.length <= 2) return `${name.slice(0, 1)}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function sameDomain(a: string | null | undefined, b: string | null | undefined) {
  const da = domainFromEmail(a);
  const db = domainFromEmail(b);
  return Boolean(da) && da === db;
}

function sameDomainSchedulesOnly(
  viewerEmail: string,
  viewerUserId: string,
  schedules: Awaited<ReturnType<typeof listCoachSchedules>>
) {
  return schedules.filter((item) => {
    if (item.user_id === viewerUserId) return true;
    return sameDomain(viewerEmail, item.coach_email);
  }).map((item) => ({
    ...item,
    coach_email: item.coach_email || maskEmail(item.coach_email)
  }));
}

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await cleanupPastCoachSchedules(session.orgId);
    const schedules = await listCoachSchedules(session.orgId);
    return NextResponse.json({ schedules: sameDomainSchedulesOnly(session.email, session.userId, schedules) });
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
    return NextResponse.json({ ok: true, schedules: sameDomainSchedulesOnly(session.email, session.userId, schedules) });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save schedule", detail: String(error) }, { status: 500 });
  }
}
