import { Tournament } from "@/lib/birddog/types";

function cleanText(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readTitle(html: string) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? cleanText(match[1]) : "Perfect Game Tournament";
}

function readEventId(url: string, fallbackHint: string) {
  const match = url.match(/[?&]event=(\d+)/i);
  if (match) return `pg-${match[1]}`;
  return `pg-${fallbackHint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function numericEventId(url: string) {
  const match = url.match(/[?&]event=(\d+)/i);
  return match ? match[1] : "";
}

function parseDate(html: string) {
  const dateMatch = html.match(/(\b\w+\s+\d{1,2},\s+\d{4}\b)/);
  if (!dateMatch) return new Date().toISOString().slice(0, 10);
  const date = new Date(dateMatch[1]);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function parseGames(html: string) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const games: Tournament["games"] = [];

  for (const row of rows) {
    const cols = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanText(m[1]));
    if (cols.length < 4) continue;

    const text = cols.join(" | ").toLowerCase();
    if (!text.includes("vs") && !text.includes("field") && !text.includes(":") && !text.includes("am") && !text.includes("pm")) continue;

    const timeCol = cols.find((c) => /\d{1,2}:\d{2}\s?(am|pm)/i.test(c)) || cols[0];
    const fieldCol = cols.find((c) => /field/i.test(c)) || cols[1] || "Field TBD";
    const matchup = cols.find((c) => /vs/i.test(c)) || cols[2] || "Team A vs Team B";

    const [homeTeam, awayTeam] = matchup.split(/\s+vs\s+/i).map((v) => v.trim());
    const baseDate = new Date().toISOString().slice(0, 10);
    const parsedStart = new Date(`${baseDate} ${timeCol}`);

    games.push({
      id: `pg-game-${games.length + 1}`,
      field: fieldCol,
      fieldLocation: { x: games.length + 1, y: games.length + 1 },
      startTime: Number.isNaN(parsedStart.getTime()) ? new Date().toISOString() : parsedStart.toISOString(),
      homeTeam: homeTeam || "Team A",
      awayTeam: awayTeam || "Team B",
      players: []
    });
  }

  return games.slice(0, 40);
}

function findFirstEventUrl(html: string) {
  const link = html.match(/href=["']([^"']*TournamentTeams\.aspx\?event=\d+)["']/i);
  if (!link) return null;
  const href = link[1];
  if (/^https?:\/\//i.test(href)) return href;
  return `https://www.perfectgame.org${href.startsWith("/") ? "" : "/"}${href}`;
}

function parseParticipatingTeams(html: string) {
  const teams: NonNullable<Tournament["teams"]> = [];
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
  const looksLikeFromCell = (value: string) => /^[A-Za-z .'-]+,\s*[A-Z]{2}$/.test(value.trim());
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
    if (!normalized || normalized.length < 3) continue;
    if (!teams.find((t) => t.name === normalized && t.from === fromCol)) {
      teams.push({
        id: `pg-team-${teams.length + 1}`,
        name: normalized,
        from: fromCol,
        record
      });
    }
  }
  return teams.slice(0, 120);
}

function gamesFromTeams(teams: NonNullable<Tournament["teams"]>, date: string): Tournament["games"] {
  const out: Tournament["games"] = [];
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

async function fetchHtml(target: string) {
  const response = await fetch(target, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-cache"
    },
    cache: "no-store"
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`PG fetch failed (${response.status})`);
  }
  return { html, target };
}

function targetFromHint(hint: string) {
  if (/^https?:\/\//i.test(hint)) return hint;
  const encoded = encodeURIComponent(hint);
  return `https://www.perfectgame.org/search.aspx?search=${encoded}`;
}

export async function scrapePgTournamentLive(hint: string): Promise<Tournament> {
  const initial = await fetchHtml(targetFromHint(hint));
  let html = initial.html;
  let target = initial.target;

  if (!/[?&]event=\d+/i.test(target)) {
    const discovered = findFirstEventUrl(html);
    if (discovered) {
      const detail = await fetchHtml(discovered);
      html = detail.html;
      target = detail.target;
    }
  }

  const name = readTitle(html);
  const id = readEventId(target, hint);
  const date = parseDate(html);
  let games = parseGames(html);
  const teams = parseParticipatingTeams(html);

  if (!games.length) {
    const eventNum = numericEventId(target);
    if (eventNum) {
      const scheduleUrl = `https://www.perfectgame.org/events/TournamentSchedule.aspx?event=${eventNum}`;
      const schedule = await fetchHtml(scheduleUrl).catch(() => null);
      if (schedule) {
        games = parseGames(schedule.html);
      }
    }
  }

  if (!games.length && teams.length) {
    games = gamesFromTeams(teams, date);
  }

  return {
    id,
    name,
    city: "Unknown",
    date,
    games,
    teams
  };
}
