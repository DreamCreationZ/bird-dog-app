import { supabaseRequest } from "./lib/supabase-rest.mjs";
import { scrapePgTournament } from "./scrapers/pg.mjs";
import { scrapePbrTournament } from "./scrapers/pbr.mjs";

const POLL_SECONDS = Number(process.env.HARVEST_WORKER_POLL_SECONDS || 15);
const AUTO_SYNC_ENABLED = String(process.env.HARVEST_AUTO_SYNC_ENABLED || "true").toLowerCase() !== "false";
const AUTO_SYNC_INTERVAL_SECONDS = Math.max(
  60,
  Number(process.env.HARVEST_AUTO_SYNC_INTERVAL_SECONDS || 300)
);
const AUTO_SYNC_MAX_JOBS_PER_CYCLE = Math.max(
  1,
  Number(process.env.HARVEST_AUTO_SYNC_MAX_JOBS_PER_CYCLE || 60)
);
const AUTO_SYNC_FAILURE_RETRY_SECONDS = Math.max(
  POLL_SECONDS,
  Number(process.env.HARVEST_AUTO_SYNC_FAILURE_RETRY_SECONDS || 120)
);
const AUTO_SYNC_SCOPE = String(process.env.HARVEST_AUTO_SYNC_SCOPE || "all").trim().toLowerCase();

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const AUTO_SYNC_COMPANIES = new Set(
  parseCsv(process.env.HARVEST_AUTO_SYNC_COMPANIES || "PG")
    .map((value) => value.toUpperCase())
    .filter((value) => value === "PG" || value === "PBR")
);

const AUTO_SYNC_FREE_SLUGS = new Set(
  parseCsv(process.env.HARVEST_AUTO_SYNC_FREE_SLUGS || "2025-pg-16u-wwba-national-championship")
);

let nextAutoSyncAt = 0;

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

function inventoryHarvestHint(inventory) {
  if (inventory.company === "PG") {
    if (
      inventory.slug === "2025-pg-16u-wwba-national-championship"
      || inventory.slug === "2026-pg-16u-wwba-national-championship"
    ) {
      return "https://www.perfectgame.org/events/TournamentTeams.aspx?event=99733";
    }
    return `https://www.perfectgame.org/search.aspx?search=${encodeURIComponent(inventory.name)}`;
  }
  return inventory.name;
}

async function listInventoryForAutoSync() {
  const rows = await supabaseRequest("circuit_inventory", {
    query: {
      select: "slug,name,company",
      order: "name.asc",
      limit: "500"
    }
  }).catch(() => []);

  return Array.isArray(rows)
    ? rows
        .map((row) => ({
          slug: String(row.slug || "").trim(),
          name: String(row.name || "").trim(),
          company: String(row.company || "").trim().toUpperCase()
        }))
        .filter((row) => row.slug && row.name && (row.company === "PG" || row.company === "PBR"))
    : [];
}

async function listOrgIdsForAutoSync() {
  const [users, unlocks, harvested] = await Promise.all([
    supabaseRequest("scout_users", {
      query: {
        select: "org_id",
        order: "created_at.desc",
        limit: "5000"
      }
    }).catch(() => []),
    supabaseRequest("org_tournament_unlocks", {
      query: {
        select: "org_id",
        order: "created_at.desc",
        limit: "5000"
      }
    }).catch(() => []),
    supabaseRequest("harvested_tournaments", {
      query: {
        select: "org_id",
        order: "updated_at.desc",
        limit: "5000"
      }
    }).catch(() => [])
  ]);

  const out = new Set();
  for (const source of [users, unlocks, harvested]) {
    if (!Array.isArray(source)) continue;
    for (const row of source) {
      const orgId = String(row?.org_id || "").trim();
      if (orgId) out.add(orgId);
    }
  }

  return Array.from(out);
}

async function listOrgUnlockSlugs(orgId) {
  const rows = await supabaseRequest("org_tournament_unlocks", {
    query: {
      org_id: `eq.${orgId}`,
      select: "inventory_slug"
    }
  }).catch(() => []);
  if (!Array.isArray(rows)) return new Set();
  return new Set(
    rows
      .map((row) => String(row.inventory_slug || "").trim())
      .filter(Boolean)
  );
}

function syncKey(company, hint) {
  return `${company}::${hint}`;
}

async function listRecentOrgJobs(orgId) {
  const rows = await supabaseRequest("harvest_jobs", {
    query: {
      org_id: `eq.${orgId}`,
      select: "company,tournament_hint,status,created_at,finished_at",
      order: "created_at.desc",
      limit: "800"
    }
  }).catch(() => []);

  const activeKeys = new Set();
  const latestByKey = new Map();

  if (!Array.isArray(rows)) {
    return { activeKeys, latestByKey };
  }

  for (const row of rows) {
    const company = String(row?.company || "").trim().toUpperCase();
    const hint = String(row?.tournament_hint || "").trim();
    if (!company || !hint) continue;
    const key = syncKey(company, hint);
    if (!latestByKey.has(key)) {
      latestByKey.set(key, row);
    }
    const status = String(row?.status || "").trim().toLowerCase();
    if (status === "queued" || status === "running") {
      activeKeys.add(key);
    }
  }

  return { activeKeys, latestByKey };
}

function shouldQueueByRecency(latestJob, nowMs) {
  if (!latestJob) return true;
  const status = String(latestJob.status || "").toLowerCase();
  const referenceTime = latestJob.finished_at || latestJob.created_at;
  const ageMs = Math.max(0, nowMs - new Date(referenceTime).getTime());
  if (Number.isNaN(ageMs)) return true;

  if (status === "failed") {
    return ageMs >= AUTO_SYNC_FAILURE_RETRY_SECONDS * 1000;
  }

  return ageMs >= AUTO_SYNC_INTERVAL_SECONDS * 1000;
}

async function createAutoSyncJob(orgId, company, tournamentHint) {
  const rows = await supabaseRequest("harvest_jobs", {
    method: "POST",
    body: [
      {
        org_id: orgId,
        company,
        tournament_hint: tournamentHint,
        status: "queued",
        created_by: "system:auto-sync"
      }
    ],
    prefer: "return=representation"
  });
  return rows?.[0] || null;
}

function shouldSyncInventoryForOrg(item, unlockedSet) {
  if (AUTO_SYNC_SCOPE !== "unlocked") return true;
  return unlockedSet.has(item.slug) || AUTO_SYNC_FREE_SLUGS.has(item.slug);
}

async function enqueueAutoSyncJobs() {
  if (!AUTO_SYNC_ENABLED) return 0;

  const [inventory, orgIds] = await Promise.all([
    listInventoryForAutoSync(),
    listOrgIdsForAutoSync()
  ]);

  const filteredInventory = inventory.filter((item) => AUTO_SYNC_COMPANIES.has(item.company));
  if (!filteredInventory.length || !orgIds.length) {
    return 0;
  }

  let queuedCount = 0;
  const nowMs = Date.now();

  for (const orgId of orgIds) {
    if (queuedCount >= AUTO_SYNC_MAX_JOBS_PER_CYCLE) break;

    const [{ activeKeys, latestByKey }, unlockedSet] = await Promise.all([
      listRecentOrgJobs(orgId),
      AUTO_SYNC_SCOPE === "unlocked" ? listOrgUnlockSlugs(orgId) : Promise.resolve(new Set())
    ]);

    for (const item of filteredInventory) {
      if (queuedCount >= AUTO_SYNC_MAX_JOBS_PER_CYCLE) break;
      if (!shouldSyncInventoryForOrg(item, unlockedSet)) continue;

      const hint = inventoryHarvestHint(item);
      const key = syncKey(item.company, hint);
      if (activeKeys.has(key)) continue;
      if (!shouldQueueByRecency(latestByKey.get(key), nowMs)) continue;

      try {
        await createAutoSyncJob(orgId, item.company, hint);
        queuedCount += 1;
        activeKeys.add(key);
        latestByKey.set(key, {
          status: "queued",
          created_at: new Date().toISOString(),
          finished_at: null
        });
      } catch (error) {
        console.error(`[auto-sync] failed to queue ${item.company} ${item.slug} for org ${orgId}:`, error);
      }
    }
  }

  return queuedCount;
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

  await supabaseRequest("harvested_rosters", {
    method: "DELETE",
    query: {
      org_id: `eq.${orgId}`,
      tournament_id: `eq.${tournamentId}`
    },
    prefer: "return=minimal"
  }).catch(() => undefined);

  await supabaseRequest("harvested_games", {
    method: "DELETE",
    query: {
      org_id: `eq.${orgId}`,
      tournament_id: `eq.${tournamentId}`
    },
    prefer: "return=minimal"
  }).catch(() => undefined);

  await supabaseRequest("harvested_participating_teams", {
    method: "DELETE",
    query: {
      org_id: `eq.${orgId}`,
      tournament_id: `eq.${tournamentId}`
    },
    prefer: "return=minimal"
  }).catch(() => undefined);

  if (Array.isArray(tournament.teams) && tournament.teams.length) {
    await supabaseRequest("harvested_participating_teams", {
      method: "POST",
      query: { on_conflict: "org_id,tournament_id,external_id" },
      body: tournament.teams.map((team) => ({
        org_id: orgId,
        tournament_id: tournamentId,
        external_id: team.id,
        name: team.name,
        hometown: team.from || "",
        record: team.record || null
      })),
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }

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
  console.log(
    `Bird Dog harvest worker started (poll=${POLL_SECONDS}s, autoSync=${AUTO_SYNC_ENABLED ? "on" : "off"}, autoSyncInterval=${AUTO_SYNC_INTERVAL_SECONDS}s, scope=${AUTO_SYNC_SCOPE})`
  );

  while (true) {
    try {
      const now = Date.now();
      if (AUTO_SYNC_ENABLED && now >= nextAutoSyncAt) {
        const queued = await enqueueAutoSyncJobs();
        if (queued > 0) {
          console.log(`[auto-sync] queued ${queued} job(s)`);
        }
        nextAutoSyncAt = now + AUTO_SYNC_INTERVAL_SECONDS * 1000;
      }

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
