import { supabaseRequest } from "./lib/supabase-rest.mjs";
import { scrapePgTournament } from "./scrapers/pg.mjs";
import { scrapePbrTournament } from "./scrapers/pbr.mjs";

const POLL_SECONDS = Number(process.env.HARVEST_WORKER_POLL_SECONDS || 15);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nextQueuedJob() {
  const rows = await supabaseRequest("harvest_jobs", {
    query: {
      select: "id,org_id,company,tournament_hint,status,created_by,created_at",
      status: "eq.queued",
      order: "created_at.asc",
      limit: "1"
    }
  });
  return rows?.[0] || null;
}

async function claimJob(jobId) {
  const rows = await supabaseRequest("harvest_jobs", {
    method: "PATCH",
    query: {
      id: `eq.${jobId}`,
      status: "eq.queued",
      select: "id,org_id,company,tournament_hint"
    },
    body: {
      status: "running",
      started_at: new Date().toISOString(),
      worker_error: null
    },
    prefer: "return=representation"
  });

  return rows?.[0] || null;
}

async function finishJob(jobId, status, errorMessage = null) {
  await supabaseRequest("harvest_jobs", {
    method: "PATCH",
    query: {
      id: `eq.${jobId}`
    },
    body: {
      status,
      finished_at: new Date().toISOString(),
      worker_error: errorMessage
    },
    prefer: "return=minimal"
  });
}

async function upsertTournament(orgId, company, tournament) {
  const tournamentRows = await supabaseRequest("harvested_tournaments", {
    method: "POST",
    query: { on_conflict: "org_id,company,external_id" },
    body: [
      {
        org_id: orgId,
        company,
        external_id: tournament.id,
        name: tournament.name,
        city: tournament.city,
        event_date: tournament.date
      }
    ],
    prefer: "resolution=merge-duplicates,return=representation"
  });

  const tournamentId = tournamentRows[0].id;

  if (Array.isArray(tournament.games) && tournament.games.length) {
    const gameRows = await supabaseRequest("harvested_games", {
      method: "POST",
      query: { on_conflict: "org_id,tournament_id,external_id" },
      body: tournament.games.map((game) => ({
        org_id: orgId,
        tournament_id: tournamentId,
        external_id: game.id,
        field_name: game.field,
        field_x: game.fieldLocation?.x ?? 0,
        field_y: game.fieldLocation?.y ?? 0,
        start_time: game.startTime,
        home_team: game.homeTeam,
        away_team: game.awayTeam
      })),
      prefer: "resolution=merge-duplicates,return=representation"
    });

    const allPlayers = tournament.games.flatMap((game) => game.players || []);
    const dedupPlayers = Array.from(new Map(allPlayers.map((player) => [player.id, player])).values());

    const playerRows = dedupPlayers.length
      ? await supabaseRequest("harvested_players", {
          method: "POST",
          query: { on_conflict: "org_id,external_id" },
          body: dedupPlayers.map((player) => ({
            org_id: orgId,
            external_id: player.id,
            name: player.name,
            school: player.school || "",
            position: player.position || "",
            must_see: Boolean(player.mustSee)
          })),
          prefer: "resolution=merge-duplicates,return=representation"
        })
      : [];

    const gameByExternal = new Map(gameRows.map((row) => [row.external_id, row.id]));
    const playerByExternal = new Map(playerRows.map((row) => [row.external_id, row.id]));

    const rosterRows = tournament.games.flatMap((game) => {
      const gameId = gameByExternal.get(game.id);
      if (!gameId) return [];
      return (game.players || [])
        .map((player) => playerByExternal.get(player.id))
        .filter(Boolean)
        .map((playerId) => ({
          org_id: orgId,
          tournament_id: tournamentId,
          game_id: gameId,
          player_id: playerId
        }));
    });

    if (rosterRows.length) {
      await supabaseRequest("harvested_rosters", {
        method: "POST",
        query: { on_conflict: "org_id,game_id,player_id" },
        body: rosterRows,
        prefer: "resolution=merge-duplicates,return=minimal"
      });
    }
  }

  return tournamentId;
}

async function scrapeAndIngest(job) {
  if (job.company === "PG") {
    return scrapePgTournament(job.tournament_hint);
  }
  return scrapePbrTournament(job.tournament_hint);
}

async function processOneJob() {
  const queued = await nextQueuedJob();
  if (!queued) return false;

  const job = await claimJob(queued.id);
  if (!job) return false;

  try {
    const result = await scrapeAndIngest(job);
    await upsertTournament(job.org_id, job.company, result.tournament);
    await finishJob(job.id, "completed", null);
    console.log(`Completed job ${job.id} (${job.company})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishJob(job.id, "failed", message);
    console.error(`Failed job ${job.id}: ${message}`);
  }

  return true;
}

async function runForever() {
  console.log("Bird Dog harvest worker started");
  while (true) {
    try {
      const handled = await processOneJob();
      if (!handled) {
        await sleep(POLL_SECONDS * 1000);
      }
    } catch (error) {
      console.error("Worker loop error:", error);
      await sleep(POLL_SECONDS * 1000);
    }
  }
}

runForever();
