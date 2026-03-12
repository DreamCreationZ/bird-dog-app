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
  return match ? cleanText(match[1]) : "Perfect Game Tournament";
}

function readEventId(url, fallbackHint) {
  const match = url.match(/[?&]event=(\d+)/i);
  if (match) return `pg-${match[1]}`;
  return `pg-${fallbackHint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function parseDate(html) {
  const dateMatch = html.match(/(\b\w+\s+\d{1,2},\s+\d{4}\b)/);
  if (!dateMatch) return new Date().toISOString().slice(0, 10);
  const date = new Date(dateMatch[1]);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function parseGames(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const games = [];

  for (const row of rows) {
    const cols = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanText(m[1]));
    if (cols.length < 4) continue;

    const text = cols.join(" | ").toLowerCase();
    if (!text.includes("vs") && !text.includes("field") && !text.includes(":") && !text.includes("am") && !text.includes("pm")) continue;

    const timeCol = cols.find((c) => /\d{1,2}:\d{2}\s?(am|pm)/i.test(c)) || cols[0];
    const fieldCol = cols.find((c) => /field/i.test(c)) || cols[1] || "Field TBD";
    const matchup = cols.find((c) => /vs/i.test(c)) || cols[2] || "Team A vs Team B";

    const [homeTeam, awayTeam] = matchup.split(/\s+vs\s+/i).map((v) => v.trim());

    games.push({
      id: `pg-game-${games.length + 1}`,
      field: fieldCol,
      fieldLocation: { x: games.length + 1, y: games.length + 1 },
      startTime: new Date(`${new Date().toISOString().slice(0, 10)} ${timeCol}`).toISOString(),
      homeTeam: homeTeam || "Team A",
      awayTeam: awayTeam || "Team B",
      players: []
    });
  }

  return games.slice(0, 30);
}

function parsePlayers(html) {
  const playerLinks = [...html.matchAll(/<a[^>]*href=["'][^"']*(PlayerProfile|playerprofile)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  if (!playerLinks.length) return [];

  const players = [];
  for (const [, , label] of playerLinks) {
    const name = cleanText(label);
    if (!name || name.length < 3) continue;
    players.push({
      id: `pg-player-${players.length + 1}`,
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
  return games.map((game, index) => {
    const start = index * chunkSize;
    const end = index === games.length - 1 ? players.length : start + chunkSize;
    return { ...game, players: players.slice(start, end) };
  });
}

export async function scrapePgTournament(hint) {
  const { target, html } = await fetchTournamentHtml("PG", hint);
  const name = readTitle(html);
  const id = readEventId(target, hint);
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
