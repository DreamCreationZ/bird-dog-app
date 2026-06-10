import { NextRequest, NextResponse } from "next/server";
import { createHarvestJob, listHarvestJobs, listOrgUnlocks } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";
import { isTournamentUnlockBlockedEmail } from "@/lib/birddog/tournamentAccessPolicy";

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T | null> {
  let settled = false;
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    task
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

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
  const inventorySlug = String(body?.inventorySlug || "").trim();

  if (!tournamentHint || !inventorySlug) {
    return NextResponse.json({ error: "tournamentHint and inventorySlug are required" }, { status: 400 });
  }

  try {
    const previewUnlockAll =
      process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true"
      && process.env.NODE_ENV !== "production";
    const isAdminUser = Boolean(session.isAdmin) || isPrivilegedAdminEmail(String(session.email || ""));
    const isBlockedUnlockEmail = !isAdminUser && isTournamentUnlockBlockedEmail(session.email);
    const unlockedResult = await withTimeout(listOrgUnlocks(session.orgId), 3500);
    const unlocked = Array.isArray(unlockedResult) ? unlockedResult : [];
    if (isBlockedUnlockEmail) {
      return NextResponse.json({
        error: "Tournament access is locked for Gmail accounts. Sign in with your university domain email."
      }, { status: 402 });
    }
    if (!previewUnlockAll && !isAdminUser && !unlocked.includes(inventorySlug)) {
      return NextResponse.json({ error: "Tournament is locked for your organization domain." }, { status: 402 });
    }

    const job = await withTimeout(createHarvestJob({
      orgId: session.orgId,
      userId: session.userId,
      company,
      tournamentHint
    }), 8000);

    if (!job) {
      return NextResponse.json({
        ok: true,
        degraded: true,
        warning: "Queue datastore is temporarily unavailable. Open still supports live tournament load.",
        job: {
          id: `degraded-${Date.now()}`,
          org_id: session.orgId,
          company,
          tournament_hint: tournamentHint,
          status: "queued_degraded",
          created_by: session.userId,
          created_at: new Date().toISOString()
        }
      }, { status: 201 });
    }

    return NextResponse.json({ ok: true, job }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create harvest job", detail: String(error) }, { status: 500 });
  }
}
