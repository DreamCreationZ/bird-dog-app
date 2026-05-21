import { NextRequest, NextResponse } from "next/server";
import { createHarvestJob, listHarvestJobs, listOrgUnlocks } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";

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
    const unlocked = await listOrgUnlocks(session.orgId);
    const seedMeta = INVENTORY_SEED.find((item) => item.slug === inventorySlug);
    const displayDate = seedMeta?.displayDate || "";
    const archiveCandidates = [seedMeta?.name, tournamentHint, inventorySlug].filter(Boolean) as string[];
    const isArchive = archiveCandidates.some((name) =>
      isFreeTournamentAccess({
        slug: inventorySlug,
        name,
        displayDate
      })
    );
    if (!previewUnlockAll && !isAdminUser && !isArchive && !unlocked.includes(inventorySlug)) {
      return NextResponse.json({ error: "Tournament is locked for your organization." }, { status: 402 });
    }

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
