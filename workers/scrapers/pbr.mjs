import { fetchTournamentHtml } from "../lib/http-client.mjs";

const PBR_TOURNAMENTS_BASE_URL = "https://tournaments.prepbaseballreport.com";

function cleanText(input) {
  const value = String(input ?? "");
  return value
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

function parseDateParts(value) {
  const raw = cleanText(value || "");
  if (!raw) return null;

  const numeric = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900) {
      return { year, month, day };
    }
  }

  const monthName = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (monthName) {
    const names = {
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12
    };
    const month = names[monthName[1].toLowerCase()];
    const day = Number(monthName[2]);
    const year = Number(monthName[3]);
    if (month && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }

  return null;
}

function datePartsToIso(parts) {
  if (!parts) return "";
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoFromDateAndTime(dateIso, timeText, fallbackIso) {
  const dateMatch = String(dateIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return fallbackIso;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const raw = cleanText(timeText || "");

  let hour = 9;
  let minute = 0;

  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (ampm) {
    hour = Number(ampm[1]) % 12;
    if (ampm[3].toUpperCase() === "PM") hour += 12;
    minute = Number(ampm[2]);
  } else {
    const twentyFour = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (twentyFour) {
      hour = Number(twentyFour[1]);
      minute = Number(twentyFour[2]);
    } else {
      return fallbackIso;
    }
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  if (Number.isNaN(parsed.getTime())) return fallbackIso;
  return parsed.toISOString();
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
  const schemaStart = html.match(/<meta[^>]+itemprop=["']startDate["'][^>]+content=["']([^"']+)["']/i);
  if (schemaStart) {
    const iso = datePartsToIso(parseDateParts(schemaStart[1]));
    if (iso) return iso;
  }

  const monthDate = html.match(/(\b\w+\s+\d{1,2},\s+\d{4}\b)/);
  if (monthDate) {
    const iso = datePartsToIso(parseDateParts(monthDate[1]));
    if (iso) return iso;
  }
  const numericDate = html.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
  if (numericDate) {
    const iso = datePartsToIso(parseDateParts(numericDate[1]));
    if (iso) return iso;
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
  return `${PBR_TOURNAMENTS_BASE_URL}${value.startsWith("/") ? "" : "/"}${value}`;
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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseScheduleDateLabel(label, fallbackDate) {
  const raw = cleanText(label || "");
  if (!raw) return fallbackDate;
  const normalized = raw.replace(/^[A-Za-z]+\s*-\s*/, "").trim();
  const iso = datePartsToIso(parseDateParts(normalized));
  return iso || fallbackDate;
}

function parseScheduleContext(html, targetUrl) {
  const eventId = html.match(/window\.EVENT_ID\s*=\s*"(\d+)"/i)?.[1] || "";
  const defaultEventPriceId = html.match(/window\.EVENT_PRICE_ID\s*=\s*"([^"]+)"/i)?.[1] || "0";
  const scheduleAjaxUrl = html.match(/window\.SCHEDULE_AJAX_URL\s*=\s*"([^"]+)"/i)?.[1]
    || `${PBR_TOURNAMENTS_BASE_URL}/schedule_ajax`;
  const csrfToken = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
  const divisionsRaw = html.match(/window\.DIVISIONS\s*=\s*(\{[\s\S]*?\});/i)?.[1] || "";

  let divisions = {};
  if (divisionsRaw) {
    try {
      divisions = JSON.parse(divisionsRaw);
    } catch {
      divisions = {};
    }
  }

  const divisionKeys = Object.keys(divisions || {})
    .map((key) => Number(key))
    .filter((value) => Number.isFinite(value) && value >= 0);

  const eventBase = targetUrl.match(/^(https?:\/\/[^/]+\/events\/[^/?#]+)/i)?.[1] || "";

  return {
    eventId,
    defaultEventPriceId: String(defaultEventPriceId || "0"),
    scheduleAjaxUrl,
    csrfToken,
    divisions,
    divisionKeys,
    eventBase
  };
}

function scheduleAllUrl(targetUrl) {
  const eventBase = targetUrl.match(/^(https?:\/\/[^/]+\/events\/[^/?#]+)/i)?.[1];
  if (!eventBase) return targetUrl;
  return `${eventBase}/schedule/all`;
}

async function fetchSchedulePayload(context, eventPriceId, scheduleId, scheduleDate = []) {
  if (!context.eventId || !context.scheduleAjaxUrl) return null;

  const body = new URLSearchParams();
  body.set("event_id", String(context.eventId));
  body.set("event_price_id", String(eventPriceId));
  body.set("event_registration_item_id", "0");
  body.set("schedule_id", String(scheduleId));
  body.set("data_type", "schedules");
  if (Array.isArray(scheduleDate) && scheduleDate.length) {
    scheduleDate.forEach((value) => body.append("schedule_date[]", value));
  }
  if (context.csrfToken) {
    body.set("_token", context.csrfToken);
  }

  const response = await fetch(context.scheduleAjaxUrl, {
    method: "POST",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: context.eventBase ? `${context.eventBase}/schedule/all` : PBR_TOURNAMENTS_BASE_URL,
      Origin: PBR_TOURNAMENTS_BASE_URL,
      ...(context.csrfToken ? { "X-CSRF-TOKEN": context.csrfToken } : {})
    },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error(`schedule_ajax ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  return payload && typeof payload === "object" ? payload : null;
}

function parseGamesFromSchedulePayload(payload, fallbackDate, divisionLabel = "") {
  const schedules = payload?.schedules;
  if (!schedules || typeof schedules !== "object") return [];

  const output = [];
  const seen = new Set();

  const scheduleEntries = Object.values(schedules);
  for (const schedule of scheduleEntries) {
    if (!schedule || typeof schedule !== "object") continue;
    const dateLabel = cleanText(schedule.date || "");
    const gameDate = parseScheduleDateLabel(dateLabel, fallbackDate);
    const fallbackIso = `${gameDate}T09:00:00.000Z`;
    const teams = Array.isArray(schedule.teams)
      ? schedule.teams
      : Object.values(schedule.teams || {});

    for (const row of teams) {
      if (!row || typeof row !== "object") continue;
      const gameType = Number(row.game_type || 0);
      // game_type=3 is practice session in PBR and is hidden on the default board view.
      if (gameType === 3) continue;

      const homeTeam = normalizeTeamName(row.team_name_1 || "");
      const awayTeam = normalizeTeamName(row.team_name_2 || "");
      if (!homeTeam && !awayTeam) continue;

      const location = cleanText(row.location || row.field_name || "Field TBD");
      const timeRaw = cleanText(row.time || "");
      const gameNumber = cleanText(row.game_number || "");
      const division = cleanText(row.division || divisionLabel || "");
      const startTime = timeRaw
        ? isoFromDateAndTime(gameDate, timeRaw, fallbackIso)
        : fallbackIso;

      const dedupeKey = [
        gameDate,
        timeRaw.toLowerCase(),
        gameNumber.toLowerCase(),
        location.toLowerCase(),
        homeTeam.toLowerCase(),
        awayTeam.toLowerCase(),
        division.toLowerCase()
      ].join("::");
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const idParts = [
        "pbr",
        slugify(gameDate || fallbackDate || "date"),
        slugify(gameNumber || `${output.length + 1}`),
        slugify(homeTeam || "team-a"),
        slugify(awayTeam || "team-b")
      ].filter(Boolean);
      if (division) idParts.push(slugify(division));

      output.push({
        id: idParts.join("-"),
        field: location,
        fieldLocation: {
          x: Number(row.field_id || row.location_id || output.length + 1) || output.length + 1,
          y: Number(row.location_id || row.field_id || output.length + 2) || output.length + 2
        },
        startTime,
        homeTeam: homeTeam || "TBD",
        awayTeam: awayTeam || "TBD",
        players: []
      });
    }
  }

  return output;
}

async function parseScheduleGames(scheduleHtml, fallbackDate, targetUrl) {
  const context = parseScheduleContext(scheduleHtml, targetUrl);
  if (!context.eventId) return [];

  const games = [];
  const seenIds = new Set();
  const addGames = (rows) => {
    for (const game of rows || []) {
      const key = `${game.id}:${game.startTime}:${game.homeTeam}:${game.awayTeam}:${game.field}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      games.push(game);
    }
  };

  const primaryScheduleId = Number(context.divisions?.[context.defaultEventPriceId]?.schedule_id || 0) || 0;
  try {
    const allPayload = await fetchSchedulePayload(context, context.defaultEventPriceId, primaryScheduleId, []);
    addGames(parseGamesFromSchedulePayload(allPayload, fallbackDate, ""));
  } catch {
    // Fallback to per-division calls below.
  }

  if (!games.length) {
    for (const divisionKey of context.divisionKeys) {
      if (!divisionKey) continue;
      const division = context.divisions?.[divisionKey];
      const scheduleId = Number(division?.schedule_id || 0);
      if (!scheduleId) continue;
      try {
        const payload = await fetchSchedulePayload(context, divisionKey, scheduleId, []);
        addGames(parseGamesFromSchedulePayload(payload, fallbackDate, cleanText(division?.label || "")));
      } catch {
        // Ignore single division failures and continue collecting others.
      }
    }
  }

  return games
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    .slice(0, 600);
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
  let parsedGames = [];
  try {
    const scheduleFetch = await fetchTournamentHtml("PBR", scheduleAllUrl(target));
    parsedGames = await parseScheduleGames(scheduleFetch.html, date, scheduleFetch.target);
  } catch {
    parsedGames = [];
  }
  if (!parsedGames.length) {
    parsedGames = parseGames(html, date);
  }
  const players = parsePlayers(html);
  let teamsHtml = html;
  try {
    const eventBase = target.match(/^(https?:\/\/[^/]+\/events\/[^/?#]+)/i)?.[1];
    if (eventBase) {
      const teamsFetch = await fetchTournamentHtml("PBR", `${eventBase}/teams`);
      teamsHtml = teamsFetch.html;
    }
  } catch {
    teamsHtml = html;
  }
  const teams = parseParticipatingTeams(teamsHtml, parsedGames);
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
