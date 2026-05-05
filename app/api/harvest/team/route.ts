import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listOrgUnlocks } from "@/lib/birddog/repository";
import { resolvePgTeamUrl, scrapePgTeamLive } from "@/lib/birddog/pgScraper";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function teamMatches(candidate: string, target: string) {
  const a = normalize(candidate);
  const b = normalize(target);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function hasDetailedRosterColumns(
  roster: Array<{
    height?: string;
    weight?: string;
    batsThrows?: string;
    grad?: string;
    hometown?: string;
    rank?: string;
    commitment?: string;
  }>
) {
  return roster.some((row) =>
    Boolean(
      row.height
      || row.weight
      || row.batsThrows
      || row.grad
      || row.hometown
      || row.rank
      || row.commitment
    )
  );
}

function rosterMergeKey(row: { no?: string; name?: string }) {
  const no = String(row.no || "").trim();
  const name = normalize(String(row.name || ""));
  return `${no}|${name}`;
}

async function resolveTeamUrl(input: {
  teamId: string;
  teamUrl: string;
  teamName: string;
  eventId: string;
}) {
  let url = input.teamUrl;
  if (!url && /^pg-team-\d+$/i.test(input.teamId)) {
    const teamNum = input.teamId.replace(/^pg-team-/i, "");
    url = `https://www.perfectgame.org/Events/Tournaments/Teams/Default.aspx?team=${teamNum}`;
  }
  if (!url && input.teamName && input.eventId) {
    url = await resolvePgTeamUrl(input.teamName, input.eventId);
  }
  return url;
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
  const searchOnly = body?.searchOnly === true || String(body?.searchOnly || "") === "true";

  if (!inventorySlug) {
    return NextResponse.json({ error: "inventorySlug is required" }, { status: 400 });
  }

  const previewUnlockAll = process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";
  const isAdminUser = Boolean(session.isAdmin) || isPrivilegedAdminEmail(String(session.email || ""));
  const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const unlocked: string[] = await listOrgUnlocks(session.orgId).catch(() => []);
  const seedMeta = INVENTORY_SEED.find((item) => item.slug === inventorySlug);
  const displayDate = seedMeta?.displayDate || "";
  const archiveCandidates = [seedMeta?.name, inventorySlug, tournamentId, teamName].filter(Boolean) as string[];
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

  try {
    const dataMode = (process.env.BIRD_DOG_DATA_MODE || "imported").toLowerCase();
    const allowLiveScrape = process.env.BIRD_DOG_ALLOW_PG_LIVE_SCRAPE === "true";

    if (dataMode !== "live" || !allowLiveScrape) {
      const tournament = tournamentId
        ? (hasSupabaseConfig ? await getHarvestedTournament(session.orgId, tournamentId).catch(() => null) : null)
        : null;

      const targetTeamName = teamName
        || tournament?.teams?.find((team) => team.id === teamId)?.name
        || "";

      if (tournament && targetTeamName) {
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

        const rosterMap = new Map<string, {
          no: string;
          name: string;
          position: string;
          height: string;
          weight: string;
          batsThrows: string;
          grad: string;
          school: string;
          hometown: string;
          rank: string;
          commitment: string;
        }>();
        teamGames.forEach((game) => {
          game.players.forEach((player) => {
            if (!rosterMap.has(player.id)) {
              rosterMap.set(player.id, {
                no: "",
                name: player.name,
                position: player.position || "",
                height: "",
                weight: "",
                batsThrows: "",
                grad: "",
                school: player.school || "",
                hometown: "",
                rank: "",
                commitment: ""
              });
            }
          });
        });

        const importedRoster = Array.from(rosterMap.values());
        const importedReady = schedule.length && importedRoster.length;
        const importedDetailed = hasDetailedRosterColumns(importedRoster);

        if (searchOnly && importedRoster.length) {
          return NextResponse.json({
            ok: true,
            source: "imported_search_fast",
            schedule,
            roster: importedRoster,
            teamUrl: ""
          });
        }

        const shouldEnrichFromLive = !importedReady || !importedDetailed;
        if (shouldEnrichFromLive) {
          const fallbackTeamUrl = await resolveTeamUrl({ teamId, teamUrl, teamName: targetTeamName || teamName, eventId });
          if (fallbackTeamUrl) {
            const live = await scrapePgTeamLive(fallbackTeamUrl, {
              teamName: targetTeamName || teamName,
              eventId,
              fastMode: true
            });
            if (live.schedule.length || live.roster.length) {
              const mergedRosterMap = new Map<string, {
                no: string;
                name: string;
                position: string;
                height?: string;
                weight?: string;
                batsThrows?: string;
                grad?: string;
                school: string;
                hometown?: string;
                rank?: string;
                commitment?: string;
              }>(
                importedRoster.map((row) => [rosterMergeKey(row), row])
              );
              for (const liveRow of live.roster) {
                const key = rosterMergeKey(liveRow);
                const existing = mergedRosterMap.get(key);
                mergedRosterMap.set(key, {
                  no: liveRow.no || existing?.no || "",
                  name: liveRow.name || existing?.name || "",
                  position: liveRow.position || existing?.position || "",
                  height: liveRow.height || existing?.height || "",
                  weight: liveRow.weight || existing?.weight || "",
                  batsThrows: liveRow.batsThrows || existing?.batsThrows || "",
                  grad: liveRow.grad || existing?.grad || "",
                  school: liveRow.school || existing?.school || "",
                  hometown: liveRow.hometown || existing?.hometown || "",
                  rank: liveRow.rank || existing?.rank || "",
                  commitment: liveRow.commitment || existing?.commitment || ""
                });
              }
              return NextResponse.json({
                ok: true,
                source: importedReady ? "imported_plus_pg_live" : "pg_live_fallback",
                schedule: live.schedule.length ? live.schedule : schedule,
                roster: Array.from(mergedRosterMap.values()),
                teamUrl: fallbackTeamUrl
              });
            }
          }
        }

        if (importedReady) {
          return NextResponse.json({
            ok: true,
            source: "imported_dataset",
            schedule,
            roster: importedRoster,
            teamUrl: ""
          });
        }
      }

      const fallbackTeamUrl = await resolveTeamUrl({ teamId, teamUrl, teamName: targetTeamName || teamName, eventId });
      if (fallbackTeamUrl) {
        const live = await scrapePgTeamLive(fallbackTeamUrl, {
          teamName: targetTeamName || teamName,
          eventId,
          fastMode: true
        });
        if (live.schedule.length || live.roster.length) {
          return NextResponse.json({ ok: true, source: "pg_live_fallback", ...live, teamUrl: fallbackTeamUrl });
        }
      }

      if (!tournament) {
        return NextResponse.json({ error: "Tournament not found in imported dataset." }, { status: 404 });
      }

      return NextResponse.json({
        ok: true,
        source: "imported_dataset",
        schedule: [],
        roster: [],
        teamUrl: fallbackTeamUrl || ""
      });
    }

    teamUrl = await resolveTeamUrl({ teamId, teamUrl, teamName, eventId });
    if (!teamUrl) {
      return NextResponse.json({ error: "Team URL could not be resolved." }, { status: 404 });
    }
    const data = await scrapePgTeamLive(teamUrl, { teamName, eventId, fastMode: searchOnly });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load team details", detail: String(error) }, { status: 500 });
  }
}
