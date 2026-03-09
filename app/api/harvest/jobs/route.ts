import { NextRequest, NextResponse } from "next/server";
import { createHarvestJob, listHarvestJobs } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const jobs = await listHarvestJobs(session.orgId);
    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load jobs", detail: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const company = body?.company === "PBR" ? "PBR" : "PG";
  const tournamentHint = String(body?.tournamentHint || "").trim();

  if (!tournamentHint) {
    return NextResponse.json({ error: "tournamentHint is required" }, { status: 400 });
  }

  try {
    const job = await createHarvestJob({
      orgId: session.orgId,
      userId: session.userId,
      company,
      tournamentHint
    });

    return NextResponse.json({ ok: true, job }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create harvest job", detail: String(error) }, { status: 500 });
  }
}
