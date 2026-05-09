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

function safeIso(value, fallbackIso) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallbackIso : parsed.toISOString();
}

function readTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? cleanText(match[1]) : "PBR Tournament";
}

function readId(url, hint) {
  const queryMatch = url.match(/[?&](event|id)=([a-z0-9-]+)/i);
  if (queryMatch) return `pbr-${queryMatch[2]}`;
  const pathMatch = url.match(/\/(?:event|events|tournament|tournaments)\/([a-z0-9-]+)/i);
  if (pathMatch) return `pbr-${pathMatch[1]}`;
  return `pbr-${hint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function parseDate(html) {
  const monthDate = html.match(/(\b\w+\s+\d{1,2},\s+\d{4}\b)/);
  if (monthDate) {
    const d = new Date(monthDate[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const numericDate = html.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
  if (numericDate) {
    const d = new Date(numericDate[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function parseCity(html) {
  const patterns = [
    /(?:Location|City)\s*:\s*<\/[^>]+>\s*<[^>]*>([^<]+)/i,
    /\b([A-Za-z .'-]+,\s*[A-Z]{2})\b/
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const value = cleanText(match[1] || "");
      if (value && !/usa|united states/i.test(value)) return value;
    }
  }
  return "Unknown";
}

function toAbsolutePbrUrl(href) {
  const value = String(href || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://www.prepbaseballreport.com${value.startsWith("/") ? "" : "/"}${value}`;
}

function findFirstEventUrl(html) {
  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const eventHref = links.find((href) => {
    const value = href.toLowerCase();
    if (value.startsWith("mailto:") || value.startsWith("tel:") || value.startsWith("javascript:")) return false;
    if (value.includes("/search")) return false;
    if (value.includes("/login") || value.includes("/register") || value.includes("/account")) return false;
    return value.includes("/event/") || value.includes("/events/") || value.includes("/tournament/") || value.includes("/tournaments/");
  });
  return eventHref ? toAbsolutePbrUrl(eventHref) : null;
}

function normalizeTeamName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/\((\d+-\d+(-\d+)?)\)/g, "")
    .trim();
}

function parseGames(html, date) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const games = [];
  const fallbackIso = `${date}T09:00:00.000Z`;
  const seen = new Set();

  for (const row of rows) {
    const cols = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanText(m[1]));
    if (cols.length < 4) continue;

    const timeCol = cols.find((c) => /\d{1,2}:\d{2}\s?(am|pm)/i.test(c))
      || cols.find((c) => /\d{1,2}:\d{2}/i.test(c));
    const matchupCol = cols.find((c) => /\b(vs|v)\b/i.test(c));
    if (!timeCol || !matchupCol) continue;

    const fieldCol = cols.find((c) => /field|park|complex|stadium/i.test(c)) || "Field TBD";
    const [homeTeamRaw, awayTeamRaw] = matchupCol.split(/\s+(?:vs|v)\.?\s+/i).map((v) => v.trim());
    const homeTeam = normalizeTeamName(homeTeamRaw);
    const awayTeam = normalizeTeamName(awayTeamRaw);
    if (!homeTeam || !awayTeam) continue;

    const dedupeKey = `${homeTeam.toLowerCase()}::${awayTeam.toLowerCase()}::${timeCol.toLowerCase()}::${fieldCol.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    games.push({
      id: `pbr-game-${games.length + 1}`,
      field: fieldCol,
      fieldLocation: { x: games.length + 1, y: games.length + 2 },
      startTime: safeIso(`${date} ${timeCol}`, fallbackIso),
      homeTeam,
      awayTeam,
      players: []
    });
  }

  return games.slice(0, 80);
}

function parsePlayers(html) {
  const linkMatches = [...html.matchAll(/<a[^>]*href=["'][^"']*(\/player\/|player-profile|\/players\/|Player)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const players = [];
  const seen = new Set();

  for (const [, , label] of linkMatches) {
    const name = cleanText(label);
    if (!name || name.length < 3) continue;
    const low = name.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
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

function parseParticipatingTeams(html, games) {
  const teams = [];
  const seen = new Set();
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);

  for (const row of rows) {
    const link = row.match(/<a[^>]*href=["']([^"']*(?:\/team\/|\/teams\/|teamId=)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const href = toAbsolutePbrUrl(link[1]);
    const name = normalizeTeamName(cleanText(link[2]));
    if (!name || name.length < 3) continue;
    const idMatch = href.match(/(?:teamId=|\/team\/|\/teams\/)([a-z0-9-]+)/i);
    const id = idMatch ? `pbr-team-${idMatch[1]}` : `pbr-team-${teams.length + 1}`;
    const cols = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanText(m[1]));
    const from = cols.find((c) => /, [A-Z]{2}\b/.test(c)) || "-";
    const record = cols.find((c) => /^\d+\s*-\s*\d+(?:\s*-\s*\d+)?$/.test(c)) || "";
    const key = `${id}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    teams.push({ id, name, from, record, href });
  }

  if (teams.length) return teams;

  const derivedNames = new Set();
  for (const game of games) {
    if (game.homeTeam) derivedNames.add(game.homeTeam);
    if (game.awayTeam) derivedNames.add(game.awayTeam);
  }
  return Array.from(derivedNames)
    .slice(0, 300)
    .map((name, idx) => ({
      id: `pbr-team-${idx + 1}`,
      name,
      from: "-",
      record: ""
    }));
}

function gamesFromTeams(teams, date) {
  const out = [];
  const fallbackIso = `${date}T09:00:00.000Z`;
  for (let i = 0; i < teams.length; i += 2) {
    const home = teams[i];
    const away = teams[i + 1];
    if (!home || !away) continue;
    const hour = 9 + (out.length % 8);
    out.push({
      id: `pbr-team-game-${out.length + 1}`,
      field: `Field ${out.length + 1}`,
      fieldLocation: { x: out.length + 1, y: out.length + 2 },
      startTime: safeIso(`${date}T${String(hour).padStart(2, "0")}:00:00Z`, fallbackIso),
      homeTeam: home.name,
      awayTeam: away.name,
      players: []
    });
  }
  return out;
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
  const firstFetch = await fetchTournamentHtml("PBR", hint);
  let target = firstFetch.target;
  let html = firstFetch.html;

  if (!/\/(?:event|events|tournament|tournaments)\//i.test(target) && !/[?&](event|id)=/i.test(target)) {
    const discovered = findFirstEventUrl(html);
    if (discovered) {
      const secondFetch = await fetchTournamentHtml("PBR", discovered);
      target = secondFetch.target;
      html = secondFetch.html;
    }
  }

  const name = readTitle(html);
  const id = readId(target, hint);
  const date = parseDate(html);
  const parsedGames = parseGames(html, date);
  const players = parsePlayers(html);
  const teams = parseParticipatingTeams(html, parsedGames);
  const games = parsedGames.length ? parsedGames : gamesFromTeams(teams, date);

  return {
    tournament: {
      id,
      name,
      city: parseCity(html),
      date,
      games: attachPlayersToGames(games, players),
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        from: team.from,
        record: team.record || ""
      }))
    },
    rawSourceUrl: target
  };
}
