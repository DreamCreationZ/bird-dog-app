import { fetchTournamentHtml } from "../lib/http-client.mjs";

function cleanText(input) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? cleanText(match[1]) : "PBR Tournament";
}

function readId(url, hint) {
  const match = url.match(/[?&](event|id)=(\d+)/i);
  if (match) return `pbr-${match[2]}`;
  return `pbr-${hint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function parseDate(html) {
  const match = html.match(/(\b\w+\s+\d{1,2},\s+\d{4}\b)/);
  if (!match) return new Date().toISOString().slice(0, 10);
  const d = new Date(match[1]);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function parseGames(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const games = [];

  for (const row of rows) {
    const cols = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanText(m[1]));
    if (cols.length < 4) continue;

    const timeCol = cols.find((c) => /\d{1,2}:\d{2}\s?(am|pm)/i.test(c));
    const matchupCol = cols.find((c) => /vs/i.test(c));
    if (!timeCol || !matchupCol) continue;

    const fieldCol = cols.find((c) => /field/i.test(c)) || "Field TBD";
    const [homeTeam, awayTeam] = matchupCol.split(/\s+vs\s+/i).map((v) => v.trim());

    games.push({
      id: `pbr-game-${games.length + 1}`,
      field: fieldCol,
      fieldLocation: { x: games.length + 1, y: games.length + 2 },
      startTime: new Date(`${new Date().toISOString().slice(0, 10)} ${timeCol}`).toISOString(),
      homeTeam: homeTeam || "Team A",
      awayTeam: awayTeam || "Team B",
      players: []
    });
  }

  return games.slice(0, 30);
}

function parsePlayers(html) {
  const linkMatches = [...html.matchAll(/<a[^>]*href=["'][^"']*(\/player\/|Player)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const players = [];

  for (const [, , label] of linkMatches) {
    const name = cleanText(label);
    if (!name || name.length < 3) continue;
    players.push({
      id: `pbr-player-${players.length + 1}`,
      name,
      school: "Unknown",
      position: "",
      mustSee: false
    });
  }

  return players.slice(0, 120);
}

function attachPlayersToGames(games, players) {
  if (!games.length) return [];
  if (!players.length) return games;

  const chunkSize = Math.max(1, Math.floor(players.length / games.length));
  return games.map((game, idx) => {
    const start = idx * chunkSize;
    const end = idx === games.length - 1 ? players.length : start + chunkSize;
    return { ...game, players: players.slice(start, end) };
  });
}

export async function scrapePbrTournament(hint) {
  const { target, html } = await fetchTournamentHtml("PBR", hint);
  const name = readTitle(html);
  const id = readId(target, hint);
  const date = parseDate(html);
  const games = parseGames(html);
  const players = parsePlayers(html);

  return {
    tournament: {
      id,
      name,
      city: "Unknown",
      date,
      games: attachPlayersToGames(games, players)
    },
    rawSourceUrl: target
  };
}
