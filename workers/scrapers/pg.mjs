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

function numericEventId(url) {
  const match = url.match(/[?&]event=(\d+)/i);
  return match ? match[1] : "";
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

function findFirstEventUrl(html) {
  const link = html.match(/href=["']([^"']*TournamentTeams\.aspx\?event=\d+)["']/i);
  if (!link) return null;
  const href = link[1];
  if (/^https?:\/\//i.test(href)) return href;
  return `https://www.perfectgame.org${href.startsWith("/") ? "" : "/"}${href}`;
}

function parseParticipatingTeams(html) {
  const teams = [];
  const blockedTokens = [
    "sign in",
    "create account",
    "valid email format",
    "forgot password",
    "not a member yet",
    "players",
    "teams",
    "events"
  ];
  const looksLikeFromCell = (value) => /^[A-Za-z .'-]+,\s*[A-Z]{2}$/.test(value.trim());
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  for (const row of rows) {
    const colsRaw = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
    const cols = colsRaw.map((cell) => cleanText(cell));
    if (cols.length < 3) continue;
    const teamIndex = cols.findIndex((c) => /(u|prime|tigers|scout|baseball|club|elite|stars|sparks|lions|heat|hawks|national|mafia|prospects)/i.test(c));
    const teamCol = teamIndex >= 0 ? cols[teamIndex] : "";
    if (!teamCol) continue;
    const fromCol = cols[cols.length - 1];
    if (!fromCol || /^from$/i.test(fromCol)) continue;
    const loweredRow = `${teamCol} ${fromCol}`.toLowerCase();
    if (blockedTokens.some((token) => loweredRow.includes(token))) continue;
    if (!looksLikeFromCell(fromCol)) continue;
    const normalized = teamCol.replace(/\(\d+-\d+-\d+.*?\)/g, "").trim();
    const record = (teamCol.match(/\(([^)]+)\)/)?.[1] || "").trim();
    const hrefMatch = colsRaw[teamIndex >= 0 ? teamIndex : 0]?.match(/href=["']([^"']+)["']/i);
    const href = hrefMatch?.[1]
      ? (hrefMatch[1].startsWith("http")
        ? hrefMatch[1]
        : `https://www.perfectgame.org${hrefMatch[1].startsWith("/") ? "" : "/"}${hrefMatch[1]}`)
      : null;
    if (!normalized || normalized.length < 3) continue;
    if (!teams.find((t) => t.name === normalized && t.from === fromCol)) {
      teams.push({
        id: `pg-team-${teams.length + 1}`,
        name: normalized,
        from: fromCol,
        record,
        href
      });
    }
  }
  return teams.slice(0, 80);
}

function gamesFromTeams(teams, date) {
  const out = [];
  for (let i = 0; i < teams.length; i += 2) {
    const home = teams[i];
    const away = teams[i + 1];
    if (!home || !away) continue;
    const hour = 9 + (out.length % 8);
    out.push({
      id: `pg-team-game-${out.length + 1}`,
      field: `Field ${out.length + 1}`,
      fieldLocation: { x: out.length + 1, y: out.length + 1 },
      startTime: new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`).toISOString(),
      homeTeam: home.name,
      awayTeam: away.name,
      players: []
    });
  }
  return out;
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

function parseRosterFromTeamHtml(html, teamName, offset = 0) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const players = [];
  for (const row of rows) {
    const links = [...row.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => cleanText(m[1]));
    if (!links.length) continue;
    const name = links[0];
    if (!name || name.length < 4 || /visit team page/i.test(name)) continue;
    const rowText = cleanText(row);
    const position = (rowText.match(/\b(RHP|LHP|SS|CF|OF|C|1B|2B|3B|INF|MIF|P)\b/i)?.[1] || "").toUpperCase();
    players.push({
      id: `pg-team-player-${offset + players.length + 1}`,
      name,
      school: teamName,
      position,
      mustSee: false
    });
  }
  return players.slice(0, 60);
}

async function enrichPlayersFromTeamPages(teams) {
  const out = [];
  const limited = teams.slice(0, 8);
  for (let i = 0; i < limited.length; i += 1) {
    const team = limited[i];
    if (!team.href) continue;
    try {
      const { html } = await fetchTournamentHtml("PG", team.href);
      out.push(...parseRosterFromTeamHtml(html, team.name, i * 80));
    } catch {
      // Continue when a team page fails to load.
    }
  }
  return out;
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
  const firstFetch = await fetchTournamentHtml("PG", hint);
  let target = firstFetch.target;
  let html = firstFetch.html;

  if (!/[?&]event=\d+/i.test(target)) {
    const discovered = findFirstEventUrl(html);
    if (discovered) {
      const secondFetch = await fetchTournamentHtml("PG", discovered);
      target = secondFetch.target;
      html = secondFetch.html;
    }
  }

  const name = readTitle(html);
  const id = readEventId(target, hint);
  const date = parseDate(html);
  const parsedGames = parseGames(html);
  const teams = parseParticipatingTeams(html);
  const pagePlayers = parsePlayers(html);
  const teamPlayers = await enrichPlayersFromTeamPages(teams);
  const players = teamPlayers.length ? teamPlayers : pagePlayers;
  let games = parsedGames.length ? parsedGames : [];

  if (!games.length) {
    const eventNum = numericEventId(target);
    if (eventNum) {
      try {
        const scheduleUrl = `https://www.perfectgame.org/events/TournamentSchedule.aspx?event=${eventNum}`;
        const scheduleFetch = await fetchTournamentHtml("PG", scheduleUrl);
        games = parseGames(scheduleFetch.html);
      } catch {
        // fall back to team-paired pseudo games below
      }
    }
  }

  const teamGames = teams.length ? gamesFromTeams(teams, date) : [];
  games = games.length ? games : teamGames;

  return {
    tournament: {
      id,
      name,
      city: "Unknown",
      date,
      games: attachPlayersToGames(games, players),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        from: t.from,
        record: t.record
      }))
    },
    rawSourceUrl: target
  };
}
