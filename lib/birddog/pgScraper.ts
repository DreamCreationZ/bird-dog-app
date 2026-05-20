import { Tournament } from "@/lib/birddog/types";

type ParsedTeam = {
  id: string;
  name: string;
  from: string;
  record?: string;
  href?: string | null;
};

export type PgTeamScheduleRow = {
  gameNo: string;
  date: string;
  time: string;
  field: string;
  homeTeam: string;
  awayTeam: string;
};

export type PgTeamRosterRow = {
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
};

type EventScoreboardRow = {
  gameNo: string;
  field: string;
  homeTeam: string;
  awayTeam: string;
  recapUrl: string;
};

type ParsedTeamScheduleRow = PgTeamScheduleRow & {
  recapUrl?: string;
};

const defaultUserAgents = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
];

let proxyIndex = 0;
let uaIndex = 0;

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

function cleanCellWithBreaks(input: string) {
  const marker = "__PG_BREAK__";
  return cleanText(input.replace(/<br\s*\/?>/gi, marker))
    .replace(new RegExp(marker, "g"), "\n");
}

function splitCellLines(input: string) {
  return cleanCellWithBreaks(input)
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseInlinePosition(nameOrNameWithPos: string) {
  const value = nameOrNameWithPos.trim();
  const inlinePos = value.match(
    /^(.*?)(?:\s+)((?:RHP|LHP|SS|CF|RF|LF|OF|C|1B|2B|3B|INF|MIF|P|UT|DH)(?:[\s,\/]+(?:RHP|LHP|SS|CF|RF|LF|OF|C|1B|2B|3B|INF|MIF|P|UT|DH))*)$/i
  );
  if (!inlinePos) return { name: value, position: "" };
  return {
    name: inlinePos[1].trim(),
    position: inlinePos[2].replace(/\s+/g, " ").trim()
  };
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
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const games: Tournament["games"] = [];

  for (const row of rows) {
    const cols = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanText(m[1]));
    if (cols.length < 4) continue;

    const text = cols.join(" | ").toLowerCase();
    if (blockedTokens.some((token) => text.includes(token))) continue;
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

function toAbsolutePgUrl(href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  return `https://www.perfectgame.org${href.startsWith("/") ? "" : "/"}${href}`;
}

function normalizeTeamPageUrl(url: string) {
  const teamMatch = url.match(/[?&]team=(\d+)/i);
  if (!teamMatch) return url;
  return `https://www.perfectgame.org/Events/Tournaments/Teams/Default.aspx?team=${teamMatch[1]}`;
}

function normalizeTeam(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function teamNameMatches(a: string, b: string) {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function findFirstEventUrl(html: string) {
  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const eventHref = links.find((href) =>
    /TournamentTeams\.aspx\?event=\d+/i.test(href)
    || /TournamentSchedule\.aspx\?event=\d+/i.test(href)
    || /events\/default\.aspx\?event=\d+/i.test(href)
  );
  if (!eventHref) return null;
  return toAbsolutePgUrl(eventHref);
}

function getParticipatingTeamsTableHtml(html: string) {
  const sectionMatch = html.match(/participating teams[\s\S]{0,5000}?<table[^>]*>([\s\S]*?)<\/table>/i);
  if (sectionMatch) return sectionMatch[1];
  const fallbackTable = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  return fallbackTable ? fallbackTable[1] : html;
}

function parseParticipatingTeams(html: string) {
  const teams: ParsedTeam[] = [];
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
  const tableHtml = getParticipatingTeamsTableHtml(html);
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  for (const row of rows) {
    const linkMatch = row.match(/id=["'][^"']*_hlTeams["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      || row.match(/href=["']([^"']*Tournaments\/Teams\/Default\.aspx\?team=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const href = toAbsolutePgUrl(linkMatch[1]);
    const teamLabel = cleanText(linkMatch[2]);
    if (!teamLabel || /^team$/i.test(teamLabel)) continue;

    const fromCol = cleanText(row.match(/id=["'][^"']*_lblCity["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const loweredRow = `${teamLabel} ${fromCol}`.toLowerCase();
    if (blockedTokens.some((token) => loweredRow.includes(token))) continue;

    const normalized = teamLabel.replace(/\(\d+-\d+-\d+.*?\)/g, "").trim();
    const record = cleanText(row.match(/id=["'][^"']*_lblwlt["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "")
      .replace(/^\(|\)$/g, "")
      .trim();
    if (!normalized || normalized.length < 3) continue;

    const teamNum = href ? (href.match(/[?&]team=(\d+)/i)?.[1] || "") : "";
    const externalId = teamNum ? `pg-team-${teamNum}` : `pg-team-${teams.length + 1}`;

    const dedupeKey = `${externalId}:${normalized.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    teams.push({
      id: externalId,
      name: normalized,
      from: fromCol || "-",
      record,
      href
    });
  }
  return teams;
}

function mergeParsedTeams(primary: ParsedTeam[], fallback: ParsedTeam[]) {
  const byKey = new Map<string, ParsedTeam>();
  const makeKey = (team: ParsedTeam) => {
    const hrefTeamNum = team.href?.match(/[?&]team=(\d+)/i)?.[1] || "";
    const idKey = (team.id || "").toLowerCase();
    const hrefKey = hrefTeamNum ? `team-${hrefTeamNum}` : "";
    const nameKey = normalizeTeam(team.name);
    return idKey || hrefKey || nameKey;
  };

  const push = (team: ParsedTeam) => {
    const key = makeKey(team);
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, team);
      return;
    }
    byKey.set(key, {
      id: team.id || existing.id,
      name: team.name || existing.name,
      from: team.from || existing.from,
      record: team.record || existing.record,
      href: team.href || existing.href
    });
  };

  primary.forEach(push);
  fallback.forEach(push);
  return Array.from(byKey.values());
}

function gamesFromTeams(teams: ParsedTeam[], date: string): Tournament["games"] {
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
  const raw = process.env.RESIDENTIAL_PROXY_TEMPLATE_URLS || "";
  const proxies = raw.split(",").map((item) => item.trim()).filter(Boolean);
  const template = proxies.length ? proxies[proxyIndex % proxies.length] : null;
  if (template) proxyIndex += 1;
  const url = template ? template.replace("{url}", encodeURIComponent(target)) : target;

  const customUa = process.env.SCRAPER_USER_AGENTS
    ? process.env.SCRAPER_USER_AGENTS.split("||").map((item) => item.trim()).filter(Boolean)
    : defaultUserAgents;
  const ua = (customUa.length ? customUa : defaultUserAgents)[uaIndex % (customUa.length ? customUa.length : defaultUserAgents.length)];
  uaIndex += 1;

  const response = await fetch(url, {
    headers: {
      "User-Agent": ua,
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

function parseRosterFromTeamHtml(html: string, teamName: string, offset = 0) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const players: Tournament["games"][number]["players"] = [];
  for (const row of rows) {
    const links = [...row.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => cleanText(m[1]));
    if (!links.length) continue;
    const name = links[0];
    if (!name || name.length < 4 || /visit team page/i.test(name)) continue;
    const rowText = cleanText(row);
    const position = (rowText.match(/\b(RHP|LHP|SS|CF|OF|C|1B|2B|3B|INF|MIF|P)\b/i)?.[1] || "").toUpperCase();
    if (/sign in|create account|forgot password/i.test(name.toLowerCase())) continue;
    players.push({
      id: `pg-team-player-${offset + players.length + 1}`,
      name,
      school: teamName,
      position,
      mustSee: false
    });
  }
  return players.slice(0, 80);
}

async function enrichPlayersFromTeamPages(teams: ParsedTeam[]) {
  const out: Tournament["games"][number]["players"] = [];
  const limited = teams.slice(0, 20);
  for (let i = 0; i < limited.length; i += 1) {
    const team = limited[i];
    if (!team.href) continue;
    try {
      const { html } = await fetchHtml(team.href);
      out.push(...parseRosterFromTeamHtml(html, team.name, i * 100));
    } catch {
      // Continue when a team page fails to load.
    }
  }
  return out;
}

function attachPlayersToGamesByTeam(games: Tournament["games"], players: Tournament["games"][number]["players"]) {
  if (!games.length || !players.length) return games;
  return games.map((game) => {
    const assigned = players.filter((p) => p.school === game.homeTeam || p.school === game.awayTeam);
    if (assigned.length) {
      return { ...game, players: assigned };
    }
    return game;
  });
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
  const eventNum = numericEventId(target);
  let games = parseGames(html);
  let teams = parseParticipatingTeams(html);

  // TournamentSchedule page often does not include the full participating-team table.
  // Pull TournamentTeams explicitly and merge to guarantee complete team list.
  if (eventNum) {
    const teamsUrl = `https://www.perfectgame.org/events/TournamentTeams.aspx?event=${eventNum}`;
    const teamsPage = await fetchHtml(teamsUrl).catch(() => null);
    if (teamsPage) {
      const teamsFromDedicatedPage = parseParticipatingTeams(teamsPage.html);
      if (teamsFromDedicatedPage.length) {
        teams = teams.length
          ? mergeParsedTeams(teamsFromDedicatedPage, teams)
          : teamsFromDedicatedPage;
      }
    }
  }

  const teamPlayers = await enrichPlayersFromTeamPages(teams);

  if (!games.length) {
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
  games = attachPlayersToGamesByTeam(games, teamPlayers);

  return {
    id,
    name,
    city: "Unknown",
    date,
    games,
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      from: team.from,
      record: team.record,
      href: team.href || undefined
    }))
  };
}

function parseTeamScheduleFromHtml(html: string): ParsedTeamScheduleRow[] {
  const out: ParsedTeamScheduleRow[] = [];
  const blocks = html.split(/(?=Gm#\s*\d+)/gi).slice(0, 80);

  for (const block of blocks) {
    const gm = block.match(/Gm#\s*(\d+)/i)?.[1] || "";
    if (!gm) continue;
    const date = block.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/i)?.[1] || "";
    const time = block.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/i)?.[1] || "";
    const field = cleanText(block.match(/(?:Field\s+\d+\s*@\s*|Baseball\s*@\s*)([^<\n]+)/i)?.[0] || "");
    const teamNames = [...block.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => cleanText(m[1]))
      .filter((name) =>
        name
        && name.length > 2
        && !/visit team page|game recap|probable pitchers|diamondkast|final/i.test(name)
      );
    const uniqueTeams: string[] = [];
    for (const name of teamNames) {
      if (!uniqueTeams.includes(name)) uniqueTeams.push(name);
      if (uniqueTeams.length >= 2) break;
    }

    const recapUrl = block.match(/href=["']([^"']*GameRecap\.aspx[^"']*)["']/i)?.[1];
    out.push({
      gameNo: gm,
      date,
      time,
      field: field || "Field TBD",
      homeTeam: uniqueTeams[0] || "Team A",
      awayTeam: uniqueTeams[1] || "Team B",
      recapUrl: recapUrl ? toAbsolutePgUrl(recapUrl) : ""
    });
  }

  return out;
}

function monthToNumber(month: string) {
  const map: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };
  return map[month.toLowerCase().slice(0, 3)] || "";
}

function inferEventYear(html: string, eventId?: string) {
  if (!eventId) return "";
  const match = html.match(new RegExp(`hfTournamentID"[^>]*value="${eventId}"[\\s\\S]{0,320}?hfStartDate"[^>]*value="\\d{1,2}\\/\\d{1,2}\\/(\\d{4})"`, "i"));
  if (match?.[1]) return match[1];
  const global = html.match(/hfStartDate"[^>]*value="\d{1,2}\/\d{1,2}\/(\d{4})"/i);
  return global?.[1] || "";
}

function parseNestedTeamScheduleFromHtml(
  html: string,
  options?: { teamName?: string; eventId?: string }
): ParsedTeamScheduleRow[] {
  const out: ParsedTeamScheduleRow[] = [];
  const teamName = options?.teamName?.trim() || "";
  const eventId = (options?.eventId || "").replace(/^pg-/i, "");
  const year = inferEventYear(html, eventId);
  const rowMatches = [...html.matchAll(/<td class="nestedscheduleGridRow">([\s\S]*?)<\/td>\s*<\/tr>/gi)];

  for (const rowMatch of rowMatches) {
    const row = rowMatch[1];
    const monthDay = cleanText(row.match(/lblMonthDay"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    if (!monthDay) continue;
    const monthDayParts = monthDay.match(/([A-Za-z]{3})\s*(\d{1,2})/);
    const month = monthDayParts?.[1] || "";
    const day = monthDayParts?.[2] || "";
    const mm = monthToNumber(month);
    const date = mm && day && year ? `${mm}/${String(Number(day))}/${year}` : monthDay;

    const homeAway = cleanText(row.match(/lblHomeAway"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const opponent = cleanText(row.match(/hlOpponentName"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const fieldPrefix = cleanText(row.match(/lblField"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const ballpark = cleanText(
      row.match(/(?:hlBallpark|hlBallPark|hlFacility|hlLocation)"[^>]*>([\s\S]*?)<\/a>/i)?.[1]
      || row.match(/(?:lblBallpark|lblBallPark|lblFacility|lblLocation)"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
      || ""
    );
    const gameNo = cleanText(row.match(/hfTournamentGameID"[^>]*value="([^"]+)"/i)?.[1] || "");
    const recapRaw = row.match(/href=["']([^"']*GameRecap\.aspx[^"']*)["']/i)?.[1] || "";
    const time = cleanText(row.match(/(?:\b\d{1,2}:\d{2}\s*(?:AM|PM)\b)/i)?.[0] || "");

    if (!opponent && !gameNo) continue;
    const homeTeam = homeAway.includes("@") ? (opponent || "Team A") : (teamName || "Team A");
    const awayTeam = homeAway.includes("@") ? (teamName || "Team B") : (opponent || "Team B");
    const linkTexts = [...row.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => cleanText(m[1]))
      .filter(Boolean);
    const fallbackVenue = linkTexts.find((txt) =>
      !teamNameMatches(txt, teamName || "")
      && !/probable pitchers|standings|roster|results|bracket|schedule|leaders|top performers|game recap|diamondkast/i.test(txt)
      && /high school|complex|park|facility|stadium|academy|field|, [A-Z]{2}\b| - [A-Z]{2}\b/i.test(txt)
    ) || "";
    const venue = ballpark || fallbackVenue;
    let field = "Field TBD";
    if (fieldPrefix && venue) {
      if (/@\s*$/.test(fieldPrefix)) {
        field = cleanText(`${fieldPrefix} ${venue}`);
      } else if (/^field\s+\d+$/i.test(fieldPrefix) || /^baseball$/i.test(fieldPrefix) || /^stadium$/i.test(fieldPrefix)) {
        field = cleanText(`${fieldPrefix} @ ${venue}`);
      } else {
        field = cleanText(`${fieldPrefix} ${venue}`);
      }
    } else if (fieldPrefix) {
      field = fieldPrefix;
    } else if (venue) {
      field = venue;
    }

    out.push({
      gameNo: gameNo || String(out.length + 1),
      date,
      time,
      field,
      homeTeam,
      awayTeam,
      recapUrl: recapRaw ? toAbsolutePgUrl(recapRaw) : ""
    });
  }

  return out;
}

function parseTeamRosterFromHtml(html: string): PgTeamRosterRow[] {
  const teamGridTable = html.match(/id="[^"]*radgridOrgTeamPlayers[^"]*"[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  const rosterSection = html.match(/TOURNAMENT ROSTER[\s\S]*?<table[\s\S]*?<\/table>/i)?.[0] || "";
  const source = teamGridTable || rosterSection || html;
  const table = source.match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[1] || source;
  if (!table) return [];

  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  if (!rows.length) return [];

  let headerIdx = 0;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 6); i += 1) {
    const candidate = [...rows[i].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => cleanText(m[1]).toLowerCase());
    const looksLikeHeader = candidate.some((h) => h.includes("name")) && candidate.some((h) => h.includes("school") || h.includes("hometown"));
    if (looksLikeHeader) {
      headerIdx = i;
      headers = candidate;
      break;
    }
  }
  if (!headers.length) {
    headers = [...rows[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => cleanText(m[1]).toLowerCase());
    headerIdx = 0;
  }

  const nameIdx = headers.findIndex((h) => h.includes("name"));
  const schoolIdx = headers.findIndex((h) => h.includes("school") || h === "hs");
  const noIdx = headers.findIndex((h) => h === "no." || h === "no");
  const htIdx = headers.findIndex((h) => h === "ht" || h.includes("height"));
  const wtIdx = headers.findIndex((h) => h === "wt" || h.includes("weight"));
  const btIdx = headers.findIndex((h) => h === "b/t" || h.includes("bats") || h.includes("throws"));
  const gradIdx = headers.findIndex((h) => h.includes("grad"));
  const hometownIdx = headers.findIndex((h) => h.includes("hometown"));
  const rankIdx = headers.findIndex((h) => h === "rank" || h.includes("national rank"));
  const commitmentIdx = headers.findIndex((h) => h.includes("commitment"));
  const out: PgTeamRosterRow[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(headerIdx + 1)) {
    const cellsRaw = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (!cellsRaw.length) continue;
    const cells = cellsRaw.map((cell) => cleanCellWithBreaks(cell));
    const rawNo = cells[noIdx >= 0 ? noIdx : 0] || "";
    if (!/^\d+$/.test(rawNo.trim())) continue;
    const rawNameCell = cellsRaw[nameIdx >= 0 ? nameIdx : 1] || "";
    const nameParts = splitCellLines(rawNameCell);
    const fallbackNameCell = cells[nameIdx >= 0 ? nameIdx : 1] || "";
    const parsedInline = parseInlinePosition(nameParts[0] || fallbackNameCell);
    const name = parsedInline.name || "";
    const inlinePosition = parsedInline.position || "";
    if (
      !name
      || !/[A-Za-z]/.test(name)
      || /sign in|create account|forgot password|pitch by pitch|tournament|game recap|diamondkast|final|perfect game/i.test(name.toLowerCase())
    ) continue;
    const school = (cells[schoolIdx >= 0 ? schoolIdx : 6] || "").trim();
    const key = `${name.toLowerCase()}|${school.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      no: rawNo,
      name,
      position: nameParts[1] || inlinePosition || "",
      height: (htIdx >= 0 ? cells[htIdx] : "") || "",
      weight: (wtIdx >= 0 ? cells[wtIdx] : "") || "",
      batsThrows: (btIdx >= 0 ? cells[btIdx] : "") || "",
      grad: (gradIdx >= 0 ? cells[gradIdx] : "") || "",
      school,
      hometown: (hometownIdx >= 0 ? cells[hometownIdx] : "") || "",
      rank: (rankIdx >= 0 ? cells[rankIdx] : "") || "",
      commitment: (commitmentIdx >= 0 ? cells[commitmentIdx] : "") || ""
    });
  }

  return out;
}

function inferEventIdFromTeamHtml(html: string) {
  const byHiddenField = html.match(/hfTournamentID"[^>]*value="(\d+)"/i)?.[1];
  if (byHiddenField) return byHiddenField;
  const byLink = html.match(/[?&]event=(\d+)/i)?.[1];
  return byLink || "";
}

function parseEventScoreboardRows(html: string): EventScoreboardRow[] {
  const out: EventScoreboardRow[] = [];
  const visitorMatches = [...html.matchAll(/id="[^"]*lblVisitorName_(\d+)"[^>]*>([\s\S]*?)<\/span>/gi)];

  for (const match of visitorMatches) {
    const idx = match[1];
    const awayTeam = cleanText(match[2]);
    if (!awayTeam) continue;

    const homeMatch = html.match(new RegExp(`id="[^"]*lblHomeTeamName_${idx}"[^>]*>([\\s\\S]*?)<\\/span>`, "i"));
    const fieldMatch = html.match(new RegExp(`id="[^"]*lblTournamentName_${idx}"[^>]*>([\\s\\S]*?)<\\/span>`, "i"));
    const recapMatch = html.match(new RegExp(`id="[^"]*hlDiamondKastRecap_${idx}"[^>]*href="([^"]+)"`, "i"));

    const homeTeam = cleanText(homeMatch?.[1] || "");
    const field = cleanText(fieldMatch?.[1] || "Field TBD");
    const recapUrl = recapMatch?.[1] ? toAbsolutePgUrl(recapMatch[1]) : "";
    if (!homeTeam || !recapUrl) continue;

    const gameNo = recapUrl.match(/gameid=(\d+)/i)?.[1] || idx;
    out.push({
      gameNo,
      field: field || "Field TBD",
      homeTeam,
      awayTeam,
      recapUrl
    });
  }

  return out;
}

function extractScheduleDatesFromHtml(html: string): string[] {
  const selectBlock = html.match(/id="[^"]*ddlActiveDates"[\s\S]*?<\/select>/i)?.[0] || "";
  const optionMatches = [...selectBlock.matchAll(/<option[^>]*value="([^"]+)"[^>]*>/gi)];
  const values = optionMatches
    .map((m) => cleanText(m[1]))
    .filter((value) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(value));
  return Array.from(new Set(values));
}

function parseScheduleFromRecapHtml(html: string, fallback: EventScoreboardRow): PgTeamScheduleRow {
  const dateTime = cleanText(html.match(/id="[^"]*lblGameDateTime"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
  const date = dateTime.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/)?.[0] || "";
  const time = dateTime.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i)?.[0] || "";
  const recapField = cleanText(html.match(/id="[^"]*lblField"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
  const recapBallpark = cleanText(
    html.match(/id="[^"]*(?:hlBallpark|hlBallPark|hlFacility|hlLocation)[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1]
    || ""
  );
  let field = recapField;
  if (recapField && /@\s*$/.test(recapField) && recapBallpark) {
    field = cleanText(`${recapField} ${recapBallpark}`);
  } else if (recapField && /@\s*$/.test(recapField) && fallback.field && /@\s*\S+/.test(fallback.field)) {
    field = fallback.field;
  } else if (recapField && !/@/.test(recapField) && fallback.field && /@\s*\S+/.test(fallback.field)) {
    field = fallback.field;
  } else if (!recapField) {
    field = fallback.field;
  }
  const awayTeam = cleanText(html.match(/id="[^"]*hlVisitorTeamNameTop"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || fallback.awayTeam);
  const homeTeam = cleanText(html.match(/id="[^"]*hlHomeTeamNameTop"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || fallback.homeTeam);

  return {
    gameNo: fallback.gameNo,
    date,
    time,
    field: field || fallback.field || "Field TBD",
    homeTeam: homeTeam || fallback.homeTeam,
    awayTeam: awayTeam || fallback.awayTeam
  };
}

function parseRosterFromRecapHtml(html: string, teamName: string): PgTeamRosterRow[] {
  const out: PgTeamRosterRow[] = [];
  const seen = new Set<string>();
  const links = [...html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)];

  for (const match of links) {
    const name = cleanText(match[1]);
    if (!name || name.length < 4) continue;
    if (/visit team page|game recap|perfect game|sign in|create account|players|teams|events|diamondkast|final/i.test(name)) continue;
    if (!/[A-Za-z]/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      no: "",
      name,
      position: "",
      height: "",
      weight: "",
      batsThrows: "",
      grad: "",
      school: teamName,
      hometown: "",
      rank: "",
      commitment: ""
    });
    if (out.length >= 60) break;
  }

  return out;
}

export async function scrapePgTeamLive(
  teamUrl: string,
  options?: { teamName?: string; eventId?: string; fastMode?: boolean }
) {
  const resolved = /^https?:\/\//i.test(teamUrl) ? teamUrl : toAbsolutePgUrl(teamUrl);
  const candidates = Array.from(new Set([resolved, normalizeTeamPageUrl(resolved)]));
  let bestSchedule: PgTeamScheduleRow[] = [];
  let bestRoster: PgTeamRosterRow[] = [];
  let numericEvent = (options?.eventId || "").replace(/^pg-/i, "");

  for (const candidate of candidates) {
    try {
      const { html } = await fetchHtml(candidate);
      if (!numericEvent) {
        numericEvent = inferEventIdFromTeamHtml(html);
      }
      const nestedSchedule = parseNestedTeamScheduleFromHtml(html, options);
      const classicSchedule = parseTeamScheduleFromHtml(html);
      const schedule = nestedSchedule.length ? nestedSchedule : classicSchedule;
      const roster = parseTeamRosterFromHtml(html);
      if (schedule.length > bestSchedule.length) {
        bestSchedule = schedule.map((row) => ({
          gameNo: row.gameNo,
          date: row.date,
          time: row.time,
          field: row.field,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam
        }));
      }
      if (roster.length > bestRoster.length) bestRoster = roster;

      const missingTimes = options?.fastMode ? [] : schedule.filter((row) => !row.time && row.recapUrl).slice(0, 24);
      if (missingTimes.length) {
        const withTimes: PgTeamScheduleRow[] = [];
        for (const row of missingTimes) {
          try {
            const recap = await fetchHtml(row.recapUrl as string);
            const enriched = parseScheduleFromRecapHtml(recap.html, {
              gameNo: row.gameNo,
              field: row.field,
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam,
              recapUrl: row.recapUrl as string
            });
            withTimes.push(enriched);
          } catch {
            withTimes.push({
              gameNo: row.gameNo,
              date: row.date,
              time: row.time,
              field: row.field,
              homeTeam: row.homeTeam,
              awayTeam: row.awayTeam
            });
          }
        }
        if (withTimes.length) {
          const byGame = new Map(withTimes.map((row) => [row.gameNo, row]));
          bestSchedule = bestSchedule.map((row) => byGame.get(row.gameNo) || row);
        }
      }
      if (bestSchedule.length && bestRoster.length) break;
    } catch {
      // Try next candidate URL.
    }
  }

  if (!options?.fastMode && numericEvent && options?.teamName) {
    try {
      const eventUrl = `https://www.perfectgame.org/events/TournamentSchedule.aspx?event=${numericEvent}`;
      const firstSchedulePage = await fetchHtml(eventUrl);
      const scheduleDates = extractScheduleDatesFromHtml(firstSchedulePage.html);
      const schedulePages = [firstSchedulePage.html];

      for (const dateValue of scheduleDates) {
        const dateUrl = `${eventUrl}&Date=${encodeURIComponent(dateValue)}`;
        try {
          const page = await fetchHtml(dateUrl);
          schedulePages.push(page.html);
        } catch {
          // Continue with available schedule pages.
        }
      }

      const scoreboardRows = schedulePages
        .flatMap((pageHtml) => parseEventScoreboardRows(pageHtml))
        .filter((row) =>
          teamNameMatches(row.homeTeam, options.teamName as string) || teamNameMatches(row.awayTeam, options.teamName as string)
        );

      const uniqueRows = Array.from(
        new Map(scoreboardRows.map((row) => [row.recapUrl, row])).values()
      );

      const scheduleRows: PgTeamScheduleRow[] = [];
      const rosterRows: PgTeamRosterRow[] = [];
      const rosterSeen = new Set<string>();

      for (const row of uniqueRows.slice(0, 40)) {
        try {
          const recap = await fetchHtml(row.recapUrl);
          const parsed = parseScheduleFromRecapHtml(recap.html, row);
          const target = options.teamName || "";
          const parsedHasHome = teamNameMatches(parsed.homeTeam, target);
          const parsedHasAway = teamNameMatches(parsed.awayTeam, target);
          const rowHasHome = teamNameMatches(row.homeTeam, target);
          const rowHasAway = teamNameMatches(row.awayTeam, target);
          const shouldUseScoreboardTeams =
            !target
            || (parsedHasHome && parsedHasAway)
            || (!parsedHasHome && !parsedHasAway)
            || parsedHasHome !== rowHasHome
            || parsedHasAway !== rowHasAway;

          scheduleRows.push(
            shouldUseScoreboardTeams
              ? {
                ...parsed,
                homeTeam: row.homeTeam || parsed.homeTeam,
                awayTeam: row.awayTeam || parsed.awayTeam
              }
              : parsed
          );
          for (const player of parseRosterFromRecapHtml(recap.html, options.teamName)) {
            const key = `${player.name.toLowerCase()}|${player.school.toLowerCase()}`;
            if (rosterSeen.has(key)) continue;
            rosterSeen.add(key);
            rosterRows.push(player);
          }
        } catch {
          scheduleRows.push({
            gameNo: row.gameNo,
            date: "",
            time: "",
            field: row.field,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam
          });
        }
      }

      if (scheduleRows.length > bestSchedule.length) {
        bestSchedule = scheduleRows.sort((a, b) => {
          const aKey = `${a.date} ${a.time}`.trim();
          const bKey = `${b.date} ${b.time}`.trim();
          const aTs = Date.parse(aKey);
          const bTs = Date.parse(bKey);
          if (!Number.isNaN(aTs) && !Number.isNaN(bTs)) return aTs - bTs;
          return a.gameNo.localeCompare(b.gameNo, undefined, { numeric: true });
        });
      }
      if (rosterRows.length > bestRoster.length) {
        bestRoster = rosterRows;
      }
    } catch {
      // Keep prior best rows if fallback fails.
    }
  }

  return { schedule: bestSchedule, roster: bestRoster };
}

export async function resolvePgTeamUrl(teamName: string, eventId: string) {
  if (!eventId) return "";
  const teamsUrl = `https://www.perfectgame.org/events/TournamentTeams.aspx?event=${eventId}`;
  const { html } = await fetchHtml(teamsUrl);
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const needle = teamName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const row of rows) {
    const href = row.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const text = cleanText(row).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!text.includes(needle)) continue;
    return normalizeTeamPageUrl(toAbsolutePgUrl(href));
  }
  return "";
}
