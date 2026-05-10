import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listOrgUnlocks } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { Tournament } from "@/lib/birddog/types";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";

const SNAPSHOT_TTL_MS = 60_000;
const tournamentSnapshotCache = new Map<string, { savedAt: number; tournament: Tournament | null }>();

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function teamMatches(candidate: string, target: string) {
  const a = normalize(candidate);
  const b = normalize(target);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function cacheKey(orgId: string, tournamentId: string) {
  return `${orgId}:${tournamentId}`;
}

async function loadTournamentCached(orgId: string, tournamentId: string) {
  const key = cacheKey(orgId, tournamentId);
  const cached = tournamentSnapshotCache.get(key);
  if (cached && Date.now() - cached.savedAt < SNAPSHOT_TTL_MS) {
    return cached.tournament;
  }
  const tournament = await getHarvestedTournament(orgId, tournamentId).catch(() => null);
  tournamentSnapshotCache.set(key, { savedAt: Date.now(), tournament });
  return tournament;
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const inventorySlug = String(body?.inventorySlug || "").trim();
  const tournamentId = String(body?.tournamentId || "").trim();

  if (!inventorySlug) {
    return NextResponse.json({ error: "inventorySlug is required" }, { status: 400 });
  }
  if (!tournamentId) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  const previewUnlockAll = process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";
  const isAdminUser = Boolean(session.isAdmin) || isPrivilegedAdminEmail(String(session.email || ""));
  const unlocked: string[] = await listOrgUnlocks(session.orgId).catch(() => []);
  const seedMeta = INVENTORY_SEED.find((item) => item.slug === inventorySlug);
  const displayDate = seedMeta?.displayDate || "";
  const archiveCandidates = [seedMeta?.name, inventorySlug, tournamentId].filter(Boolean) as string[];
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

  const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!hasSupabaseConfig) {
    return NextResponse.json({ ok: true, source: "no_db", rows: [] });
  }

  const tournament = await loadTournamentCached(session.orgId, tournamentId);
  if (!tournament) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  const rows: Array<{
    playerId: string;
    name: string;
    hometown: string;
    teamId: string;
    teamName: string;
  }> = [];

  for (const team of tournament.teams || []) {
    const teamId = String(team.id || "").trim();
    const teamName = String(team.name || "").trim();
    if (!teamId || !teamName) continue;

    const teamGames = (tournament.games || []).filter((game) =>
      teamMatches(game.homeTeam || "", teamName) || teamMatches(game.awayTeam || "", teamName)
    );
    const playerMap = new Map<string, { playerId: string; name: string }>();
    teamGames.forEach((game) => {
      game.players.forEach((player) => {
        const name = String(player.name || "").trim();
        if (!name) return;
        const key = normalize(name);
        if (!key || playerMap.has(key)) return;
        playerMap.set(key, {
          playerId: String(player.id || `smart:${teamId}:${key}`),
          name
        });
      });
    });

    playerMap.forEach((player) => {
      rows.push({
        playerId: player.playerId,
        name: player.name,
        hometown: String(team.from || ""),
        teamId,
        teamName
      });
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name) || a.teamName.localeCompare(b.teamName));
  return NextResponse.json({ ok: true, source: "tournament_snapshot", rows: rows.slice(0, 5000) });
}
