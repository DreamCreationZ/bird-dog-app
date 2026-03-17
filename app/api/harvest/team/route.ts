import { NextRequest, NextResponse } from "next/server";
import { listOrgUnlocks } from "@/lib/birddog/repository";
import { resolvePgTeamUrl, scrapePgTeamLive } from "@/lib/birddog/pgScraper";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const inventorySlug = String(body?.inventorySlug || "").trim();
  const teamId = String(body?.teamId || "").trim();
  let teamUrl = String(body?.teamUrl || "").trim();
  const teamName = String(body?.teamName || "").trim();
  const eventId = String(body?.eventId || "").trim();

  if (!inventorySlug) {
    return NextResponse.json({ error: "inventorySlug is required" }, { status: 400 });
  }

  const previewUnlockAll = process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";
  const unlocked: string[] = await listOrgUnlocks(session.orgId).catch(() => []);
  if (!previewUnlockAll && !unlocked.includes(inventorySlug)) {
    return NextResponse.json({ error: "Tournament is locked for your organization." }, { status: 402 });
  }

  try {
    if (!teamUrl && /^pg-team-\d+$/i.test(teamId)) {
      const teamNum = teamId.replace(/^pg-team-/i, "");
      teamUrl = `https://www.perfectgame.org/Events/Tournaments/Teams/Default.aspx?team=${teamNum}`;
    }
    if (!teamUrl && teamName && eventId) {
      teamUrl = await resolvePgTeamUrl(teamName, eventId);
    }
    if (!teamUrl) {
      return NextResponse.json({ error: "Team URL could not be resolved." }, { status: 404 });
    }
    const data = await scrapePgTeamLive(teamUrl, { teamName, eventId });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load team details", detail: String(error) }, { status: 500 });
  }
}
