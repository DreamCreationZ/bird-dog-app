import { DataProvider, Game, PulseEvent, ScoutNote, Tournament } from "@/lib/birddog/types";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { supabaseRequest } from "@/lib/birddog/supabaseRest";

export type HarvestJob = {
  id: string;
  org_id: string;
  company: "PG" | "PBR";
  tournament_hint: string;
  status: "queued" | "running" | "completed" | "failed";
  created_by: string;
  created_at: string;
};

export type InventoryRecord = {
  id: string;
  slug: string;
  name: string;
  season: "summer" | "fall";
  company: DataProvider;
};

type TournamentRow = {
  id: string;
  org_id: string;
  company: DataProvider;
  external_id: string;
  name: string;
  city: string | null;
  event_date: string;
};

type GameRow = {
  id: string;
  org_id: string;
  tournament_id: string;
  external_id: string;
  field_name: string;
  field_x: number | null;
  field_y: number | null;
  start_time: string;
  home_team: string;
  away_team: string;
};

type PlayerRow = {
  id: string;
  org_id: string;
  external_id: string;
  name: string;
  school: string | null;
  position: string | null;
  must_see: boolean | null;
};

type RosterRow = {
  game_id: string;
  player_id: string;
};

function toTournamentRow(tournament: Tournament, orgId: string, company: DataProvider) {
  return {
    org_id: orgId,
    company,
    external_id: tournament.id,
    name: tournament.name,
    city: tournament.city,
    event_date: tournament.date
  };
}

function toGameRows(tournamentId: string, orgId: string, games: Game[]) {
  return games.map((game) => ({
    org_id: orgId,
    tournament_id: tournamentId,
    external_id: game.id,
    field_name: game.field,
    field_x: game.fieldLocation?.x ?? 0,
    field_y: game.fieldLocation?.y ?? 0,
    start_time: game.startTime,
    home_team: game.homeTeam,
    away_team: game.awayTeam
  }));
}

export async function upsertScoutUser(input: {
  userId: string;
  orgId: string;
  name: string;
  email: string;
}) {
  await supabaseRequest("scout_users", {
    method: "POST",
    body: [
      {
        id: input.userId,
        org_id: input.orgId,
        name: input.name,
        email: input.email
      }
    ],
    prefer: "resolution=merge-duplicates,return=minimal"
  });
}

export async function seedCircuitInventory() {
  const payload = INVENTORY_SEED.map((item) => ({
    slug: item.slug,
    name: item.name,
    season: item.season,
    company: item.company
  }));

  const keep = payload.map((item) => `"${item.slug}"`).join(",");
  if (keep) {
    await supabaseRequest("circuit_inventory", {
      method: "DELETE",
      query: {
        slug: `not.in.(${keep})`
      },
      prefer: "return=minimal"
    });
  }

  await supabaseRequest("circuit_inventory", {
    method: "POST",
    query: { on_conflict: "slug" },
    body: payload,
    prefer: "resolution=merge-duplicates,return=minimal"
  });
}

export async function listCircuitInventory(): Promise<InventoryRecord[]> {
  const rows = (await supabaseRequest("circuit_inventory", {
    query: {
      select: "id,slug,name,season,company",
      order: "season.asc,name.asc"
    }
  })) as InventoryRecord[];

  return rows;
}

export async function listOrgUnlocks(orgId: string): Promise<string[]> {
  const rows = (await supabaseRequest("org_tournament_unlocks", {
    query: {
      org_id: `eq.${orgId}`,
      select: "inventory_slug"
    }
  })) as Array<{ inventory_slug: string }>;
  return rows.map((row) => row.inventory_slug);
}

export async function hasOrgSubscription(orgId: string): Promise<boolean> {
  const rows = (await supabaseRequest("org_tournament_unlocks", {
    query: {
      org_id: `eq.${orgId}`,
      select: "id",
      limit: "1"
    }
  })) as Array<{ id: string }>;
  return rows.length > 0;
}

export async function unlockTournamentForOrg(input: {
  orgId: string;
  userId: string;
  inventorySlug: string;
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  amountCents: number;
}) {
  const existing = (await supabaseRequest("org_tournament_unlocks", {
    query: {
      org_id: `eq.${input.orgId}`,
      inventory_slug: `eq.${input.inventorySlug}`,
      select: "id",
      limit: "1"
    }
  })) as Array<{ id: string }>;
  if (existing.length) return;

  await supabaseRequest("org_tournament_unlocks", {
    method: "POST",
    body: [{
      org_id: input.orgId,
      user_id: input.userId,
      inventory_slug: input.inventorySlug,
      stripe_session_id: input.stripeSessionId,
      stripe_payment_intent_id: input.stripePaymentIntentId,
      amount_cents: input.amountCents
    }],
    prefer: "resolution=merge-duplicates,return=minimal"
  });
}

export type CoachSchedule = {
  id: string;
  org_id: string;
  user_id: string;
  coach_name: string;
  flight_source: string | null;
  flight_destination: string | null;
  flight_arrival_time: string | null;
  hotel_name: string | null;
  notes: string | null;
  desired_players: Array<{
    playerId: string;
    name: string;
    team: string;
  }>;
  generated_plan: Array<{
    at: string;
    title: string;
    detail: string;
  }>;
  created_at: string;
  updated_at: string;
};

export async function upsertCoachSchedule(input: {
  orgId: string;
  userId: string;
  coachName: string;
  flightSource?: string;
  flightDestination?: string;
  flightArrivalTime?: string;
  hotelName?: string;
  notes?: string;
  desiredPlayers?: Array<{
    playerId: string;
    name: string;
    team: string;
  }>;
  generatedPlan?: Array<{
    at: string;
    title: string;
    detail: string;
  }>;
}) {
  await supabaseRequest("coach_schedules", {
    method: "POST",
    query: { on_conflict: "user_id" },
    body: [{
      org_id: input.orgId,
      user_id: input.userId,
      coach_name: input.coachName,
      flight_source: input.flightSource || null,
      flight_destination: input.flightDestination || null,
      flight_arrival_time: input.flightArrivalTime || null,
      hotel_name: input.hotelName || null,
      notes: input.notes || null,
      desired_players: input.desiredPlayers || [],
      generated_plan: input.generatedPlan || []
    }],
    prefer: "resolution=merge-duplicates,return=minimal"
  });
}

export async function listCoachSchedules(orgId: string): Promise<CoachSchedule[]> {
  const rows = (await supabaseRequest("coach_schedules", {
    query: {
      org_id: `eq.${orgId}`,
      select: "id,org_id,user_id,coach_name,flight_source,flight_destination,flight_arrival_time,hotel_name,notes,desired_players,generated_plan,created_at,updated_at",
      order: "updated_at.desc"
    }
  })) as CoachSchedule[];
  return rows;
}

export async function insertSyncBatch(input: {
  orgId: string;
  userId: string;
  notes: ScoutNote[];
  pulses: PulseEvent[];
}) {
  const noteRows = input.notes.map((n) => ({
    id: n.id,
    org_id: input.orgId,
    user_id: input.userId,
    game_id: n.gameId,
    player_id: n.playerId || null,
    transcript: n.transcript,
    audio_url: n.audioUrl || null,
    observed_at: n.createdAt
  }));

  const pulseRows = input.pulses.map((p) => ({
    id: p.id,
    org_id: input.orgId,
    user_id: input.userId,
    game_id: p.gameId,
    message: p.message,
    observed_at: p.createdAt
  }));

  if (noteRows.length) {
    await supabaseRequest("scout_notes", {
      method: "POST",
      body: noteRows,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }

  if (pulseRows.length) {
    await supabaseRequest("pulse_events", {
      method: "POST",
      body: pulseRows,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }

  return {
    acceptedNoteIds: noteRows.map((n) => n.id),
    acceptedPulseIds: pulseRows.map((p) => p.id)
  };
}

export async function createHarvestJob(input: {
  orgId: string;
  userId: string;
  company: "PG" | "PBR";
  tournamentHint: string;
}) {
  const rows = await supabaseRequest("harvest_jobs", {
    method: "POST",
    body: [
      {
        org_id: input.orgId,
        company: input.company,
        tournament_hint: input.tournamentHint,
        status: "queued",
        created_by: input.userId
      }
    ],
    prefer: "return=representation"
  });

  return (rows as HarvestJob[])[0];
}

export async function listHarvestJobs(orgId: string, limit = 20) {
  const rows = await supabaseRequest("harvest_jobs", {
    query: {
      org_id: `eq.${orgId}`,
      select: "id,org_id,company,tournament_hint,status,created_by,created_at",
      order: "created_at.desc",
      limit: String(limit)
    }
  });

  return rows as HarvestJob[];
}

export async function listHarvestCompanies(orgId: string): Promise<DataProvider[]> {
  const rows = (await supabaseRequest("harvested_tournaments", {
    query: {
      org_id: `eq.${orgId}`,
      select: "company",
      order: "created_at.desc",
      limit: "500"
    }
  })) as Array<{ company: DataProvider }>;

  return Array.from(new Set(rows.map((row) => row.company)));
}

export async function listHarvestedTournaments(orgId: string, company: DataProvider): Promise<Tournament[]> {
  const rows = (await supabaseRequest("harvested_tournaments", {
    query: {
      org_id: `eq.${orgId}`,
      company: `eq.${company}`,
      select: "id,name,city,event_date",
      order: "event_date.asc"
    }
  })) as Array<{ id: string; name: string; city: string | null; event_date: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city || "",
    date: row.event_date,
    games: []
  }));
}

export async function getHarvestedTournament(orgId: string, tournamentId: string): Promise<Tournament | null> {
  const tournamentRows = (await supabaseRequest("harvested_tournaments", {
    query: {
      org_id: `eq.${orgId}`,
      id: `eq.${tournamentId}`,
      select: "id,name,city,event_date",
      limit: "1"
    }
  })) as Array<{ id: string; name: string; city: string | null; event_date: string }>;

  const tournament = tournamentRows[0];
  if (!tournament) return null;

  const games = (await supabaseRequest("harvested_games", {
    query: {
      org_id: `eq.${orgId}`,
      tournament_id: `eq.${tournamentId}`,
      select: "id,field_name,field_x,field_y,start_time,home_team,away_team",
      order: "start_time.asc"
    }
  })) as Array<{
    id: string;
    field_name: string;
    field_x: number | null;
    field_y: number | null;
    start_time: string;
    home_team: string;
    away_team: string;
  }>;

  const rosters = (await supabaseRequest("harvested_rosters", {
    query: {
      org_id: `eq.${orgId}`,
      tournament_id: `eq.${tournamentId}`,
      select: "game_id,player_id"
    }
  })) as RosterRow[];

  const teams = (await supabaseRequest("harvested_participating_teams", {
    query: {
      org_id: `eq.${orgId}`,
      tournament_id: `eq.${tournamentId}`,
      select: "id,external_id,name,hometown,record",
      order: "name.asc"
    }
  }).catch(() => [])) as Array<{
    id: string;
    external_id: string;
    name: string;
    hometown: string | null;
    record: string | null;
  }>;

  const playerIds = Array.from(new Set(rosters.map((row) => row.player_id)));
  let playersById = new Map<string, PlayerRow>();

  if (playerIds.length) {
    const players = (await supabaseRequest("harvested_players", {
      query: {
        org_id: `eq.${orgId}`,
        id: `in.(${playerIds.join(",")})`,
        select: "id,name,school,position,must_see,external_id,org_id"
      }
    })) as PlayerRow[];
    playersById = new Map(players.map((player) => [player.id, player]));
  }

  return {
    id: tournament.id,
    name: tournament.name,
    city: tournament.city || "",
    date: tournament.event_date,
    games: games.map((game) => {
      const rosterPlayers = rosters
        .filter((row) => row.game_id === game.id)
        .map((row) => playersById.get(row.player_id))
        .filter((player): player is PlayerRow => Boolean(player))
        .map((player) => ({
          id: player.id,
          name: player.name,
          school: player.school || "",
          position: player.position || "",
          mustSee: Boolean(player.must_see)
        }));

      return {
        id: game.id,
        field: game.field_name,
        fieldLocation: { x: game.field_x || 0, y: game.field_y || 0 },
        startTime: game.start_time,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        players: rosterPlayers
      };
    }),
    teams: teams.map((team) => ({
      id: team.external_id || team.id,
      name: team.name,
      from: team.hometown || "",
      record: team.record || ""
    }))
  };
}

export async function upsertHarvestedTournament(input: {
  orgId: string;
  company: DataProvider;
  tournament: Tournament;
}) {
  const insertedTournaments = (await supabaseRequest("harvested_tournaments", {
    method: "POST",
    query: { on_conflict: "org_id,company,external_id" },
    body: [toTournamentRow(input.tournament, input.orgId, input.company)],
    prefer: "resolution=merge-duplicates,return=representation"
  })) as TournamentRow[];

  const tournamentId = insertedTournaments[0].id;
  const gamesPayload = toGameRows(tournamentId, input.orgId, input.tournament.games);

  const insertedGames = gamesPayload.length
    ? ((await supabaseRequest("harvested_games", {
        method: "POST",
        query: { on_conflict: "org_id,tournament_id,external_id" },
        body: gamesPayload,
        prefer: "resolution=merge-duplicates,return=representation"
      })) as GameRow[])
    : [];

  const allPlayers = input.tournament.games.flatMap((game) => game.players);
  const dedupPlayers = Array.from(new Map(allPlayers.map((player) => [player.id, player])).values());

  const playerPayload = dedupPlayers.map((player) => ({
    org_id: input.orgId,
    external_id: player.id,
    name: player.name,
    school: player.school,
    position: player.position,
    must_see: Boolean(player.mustSee)
  }));

  const insertedPlayers = playerPayload.length
    ? ((await supabaseRequest("harvested_players", {
        method: "POST",
        query: { on_conflict: "org_id,external_id" },
        body: playerPayload,
        prefer: "resolution=merge-duplicates,return=representation"
      })) as PlayerRow[])
    : [];

  const playersByExternal = new Map(insertedPlayers.map((player) => [player.external_id, player.id]));
  const gamesByExternal = new Map(insertedGames.map((game) => [game.external_id, game.id]));

  const rosterPayload = input.tournament.games.flatMap((game) => {
    const gameId = gamesByExternal.get(game.id);
    if (!gameId) return [];
    return game.players
      .map((player) => playersByExternal.get(player.id))
      .filter((playerId): playerId is string => Boolean(playerId))
      .map((playerId) => ({
        org_id: input.orgId,
        tournament_id: tournamentId,
        game_id: gameId,
        player_id: playerId
      }));
  });

  if (rosterPayload.length) {
    await supabaseRequest("harvested_rosters", {
      method: "POST",
      query: { on_conflict: "org_id,game_id,player_id" },
      body: rosterPayload,
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  }

  return tournamentId;
}
