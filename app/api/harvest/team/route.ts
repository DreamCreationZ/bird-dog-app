import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listOrgUnlocks } from "@/lib/birddog/repository";
import { resolvePgTeamUrl, scrapePgTeamLive } from "@/lib/birddog/pgScraper";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function teamMatches(candidate: string, target: string) {
  const a = normalize(candidate);
  const b = normalize(target);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

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
  const tournamentId = String(body?.tournamentId || "").trim();

  if (!inventorySlug) {
    return NextResponse.json({ error: "inventorySlug is required" }, { status: 400 });
  }

  const previewUnlockAll = process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";
  const unlocked: string[] = await listOrgUnlocks(session.orgId).catch(() => []);
  if (!previewUnlockAll && !unlocked.includes(inventorySlug)) {
    return NextResponse.json({ error: "Tournament is locked for your organization." }, { status: 402 });
  }

  try {
    const dataMode = (process.env.BIRD_DOG_DATA_MODE || "imported").toLowerCase();
    const allowLiveScrape = process.env.BIRD_DOG_ALLOW_PG_LIVE_SCRAPE === "true";

    if (dataMode !== "live" || !allowLiveScrape) {
      if (!tournamentId) {
        return NextResponse.json({ error: "tournamentId is required in imported mode." }, { status: 400 });
      }
      const tournament = await getHarvestedTournament(session.orgId, tournamentId);
      if (!tournament) {
        return NextResponse.json({ error: "Tournament not found in imported dataset." }, { status: 404 });
      }

      const targetTeamName = teamName
        || tournament.teams?.find((team) => team.id === teamId)?.name
        || "";

      if (!targetTeamName) {
        return NextResponse.json({ error: "Unable to resolve target team." }, { status: 404 });
      }

      const teamGames = tournament.games
        .filter((game) => teamMatches(game.homeTeam, targetTeamName) || teamMatches(game.awayTeam, targetTeamName))
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      const schedule = teamGames.map((game, index) => ({
        gameNo: String(index + 1),
        date: new Date(game.startTime).toLocaleDateString("en-US"),
        time: new Date(game.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        field: game.field,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam
      }));

      const rosterMap = new Map<string, { no: string; name: string; position: string; school: string }>();
      teamGames.forEach((game) => {
        game.players.forEach((player) => {
          if (!rosterMap.has(player.id)) {
            rosterMap.set(player.id, {
              no: "",
              name: player.name,
              position: player.position || "",
              school: player.school || ""
            });
          }
        });
      });

      return NextResponse.json({
        ok: true,
        source: "imported_dataset",
        schedule,
        roster: Array.from(rosterMap.values()),
        teamUrl: ""
      });
    }

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
