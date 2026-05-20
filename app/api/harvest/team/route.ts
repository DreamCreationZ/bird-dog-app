import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listOrgUnlocks } from "@/lib/birddog/repository";
import { resolvePgTeamUrl, scrapePgTeamLive } from "@/lib/birddog/pgScraper";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";
import { fetchPbrTournamentCatalog } from "@/lib/birddog/pbrTournamentCatalog";
import { Tournament } from "@/lib/birddog/types";

type TeamScheduleRow = {
  gameNo: string;
  date: string;
  time: string;
  field: string;
  homeTeam: string;
  awayTeam: string;
  dayLabel?: string;
  ageDiv?: string;
  homeScore?: string;
  awayScore?: string;
};

type TeamRosterRow = {
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

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function teamMatches(candidate: string, target: string) {
  const a = normalize(candidate);
  const b = normalize(target);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function hasDetailedRosterColumns(
  roster: Array<{
    height?: string;
    weight?: string;
    batsThrows?: string;
    grad?: string;
    hometown?: string;
    rank?: string;
    commitment?: string;
  }>
) {
  return roster.some((row) =>
    Boolean(
      row.height
      || row.weight
      || row.batsThrows
      || row.grad
      || row.hometown
      || row.rank
      || row.commitment
    )
  );
}

function rosterMergeKey(row: { no?: string; name?: string }) {
  const no = String(row.no || "").trim();
  const name = normalize(String(row.name || ""));
  return `${no}|${name}`;
}

function decodeHtmlEntities(value: string) {
  return String(value || "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#47;", "/");
}

function cleanText(value: string) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeam(value: string) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function toAbsolutePbrUrl(href: string) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  const lead = raw.startsWith("/") ? "" : "/";
  return `https://tournaments.prepbaseballreport.com${lead}${raw}`;
}

function toPbrEventBase(url: string) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(https?:\/\/[^/]+\/events\/[^/?#]+)/i);
  return match ? match[1] : "";
}

function formatDayLabelFromDate(date: Date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase();
  const month = date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${weekday} - ${month} ${day}, ${year}`;
}

function parseDateLabelParts(label: string, fallbackIsoDate: string) {
  const raw = cleanText(label);
  const fallbackDate = new Date(`${fallbackIsoDate}T00:00:00.000Z`);
  const fallbackValid = Number.isFinite(fallbackDate.getTime());
  const fallback = fallbackValid ? fallbackDate : new Date();

  if (!raw) {
    return {
      isoDate: fallback.toISOString().slice(0, 10),
      date: fallback.toLocaleDateString("en-US", { timeZone: "UTC" }),
      dayLabel: formatDayLabelFromDate(fallback)
    };
  }

  const direct = new Date(raw);
  if (Number.isFinite(direct.getTime())) {
    return {
      isoDate: direct.toISOString().slice(0, 10),
      date: direct.toLocaleDateString("en-US", { timeZone: "UTC" }),
      dayLabel: formatDayLabelFromDate(direct)
    };
  }

  const suffix = raw.split("-").pop()?.trim() || raw;
  const withYear = new Date(suffix);
  if (Number.isFinite(withYear.getTime())) {
    return {
      isoDate: withYear.toISOString().slice(0, 10),
      date: withYear.toLocaleDateString("en-US", { timeZone: "UTC" }),
      dayLabel: formatDayLabelFromDate(withYear)
    };
  }

  return {
    isoDate: fallback.toISOString().slice(0, 10),
    date: fallback.toLocaleDateString("en-US", { timeZone: "UTC" }),
    dayLabel: raw.toUpperCase()
  };
}

function toSortableDateTime(isoDate: string, timeLabel: string) {
  const clean = cleanText(timeLabel || "");
  if (!clean) return `${isoDate}T09:00:00.000Z`;

  const ampm = clean.match(/(\d{1,2})\s*:\s*(\d{2})\s*([ap]m)/i);
  if (ampm) {
    const hourBase = Number(ampm[1]);
    const mins = Number(ampm[2]);
    const marker = ampm[3].toLowerCase();
    const hour = marker === "pm" ? (hourBase % 12) + 12 : (hourBase % 12);
    return `${isoDate}T${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00.000Z`;
  }

  const military = clean.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (military) {
    const hour = Math.max(0, Math.min(23, Number(military[1])));
    const mins = Math.max(0, Math.min(59, Number(military[2])));
    return `${isoDate}T${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00.000Z`;
  }

  return `${isoDate}T09:00:00.000Z`;
}

function parseScore(value: unknown) {
  const clean = cleanText(String(value ?? ""));
  if (!clean) return "";
  const match = clean.match(/-?\d+/);
  if (!match) return "";
  const num = Number(match[0]);
  if (!Number.isFinite(num)) return "";
  return String(num).padStart(2, "0");
}

function parseGameNumber(value: unknown, fallback: number) {
  const raw = cleanText(String(value ?? ""));
  if (!raw) return `#${fallback}`;
  if (raw.startsWith("#")) return raw;
  const num = raw.match(/\d+/)?.[0] || raw;
  return `#${num}`;
}

function parsePbrScheduleContext(html: string, sourceUrl: string) {
  const eventBase = toPbrEventBase(sourceUrl);
  const eventId = cleanText(html.match(/window\.EVENT_ID\s*=\s*["']?(\d+)["']?/i)?.[1] || "");
  const defaultEventPriceId = cleanText(html.match(/window\.EVENT_PRICE_ID\s*=\s*["']?(\d+)["']?/i)?.[1] || "");
  const scheduleAjaxUrl = cleanText(
    html.match(/window\.SCHEDULE_AJAX_URL\s*=\s*["']([^"']+)["']/i)?.[1]
      || "https://tournaments.prepbaseballreport.com/schedule_ajax"
  );
  const csrfToken = cleanText(
    html.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i)?.[1]
      || ""
  );
  const divisionsRaw = html.match(/window\.DIVISIONS\s*=\s*(\{[\s\S]*?\});/i)?.[1] || "";
  let divisions: Record<string, { schedule_id?: string | number; label?: string }> = {};
  if (divisionsRaw) {
    try {
      divisions = JSON.parse(divisionsRaw) as Record<string, { schedule_id?: string | number; label?: string }>;
    } catch {
      divisions = {};
    }
  }

  const divisionKeys = Object.keys(divisions)
    .filter((key) => key && key !== "0")
    .sort((a, b) => Number(a) - Number(b));

  return {
    eventBase,
    eventId,
    defaultEventPriceId: defaultEventPriceId || (divisionKeys[0] || ""),
    scheduleAjaxUrl: toAbsolutePbrUrl(scheduleAjaxUrl),
    csrfToken,
    divisions,
    divisionKeys
  };
}

async function fetchPbrSchedulePayload(
  context: ReturnType<typeof parsePbrScheduleContext>,
  eventPriceId: string,
  scheduleId: string
) {
  if (!context.eventId || !context.scheduleAjaxUrl || !eventPriceId || !scheduleId) return null;

  const form = new URLSearchParams();
  form.set("event_id", String(context.eventId));
  form.set("event_price_id", String(eventPriceId));
  form.set("event_registration_item_id", String(eventPriceId));
  form.set("schedule_id", String(scheduleId));
  form.set("data_type", "schedules");
  if (context.csrfToken) form.set("_token", context.csrfToken);

  const res = await fetch(context.scheduleAjaxUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${context.eventBase}/schedule/all`,
      Origin: "https://tournaments.prepbaseballreport.com",
      ...(context.csrfToken ? { "X-CSRF-TOKEN": context.csrfToken } : {})
    },
    body: form.toString()
  });
  if (!res.ok) return null;
  const payload = await res.json().catch(() => null);
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
}

function parsePbrScheduleRowsFromPayload(input: {
  payload: Record<string, unknown> | null;
  targetTeamName: string;
  fallbackIsoDate: string;
  defaultDivision?: string;
}) {
  if (!input.payload) return [];
  const schedules = (input.payload as { schedules?: unknown }).schedules;
  if (!schedules || typeof schedules !== "object") return [];

  const out: Array<TeamScheduleRow & { _sortAt: string }> = [];
  const seen = new Set<string>();

  const scheduleItems = Object.values(schedules as Record<string, unknown>);
  for (const scheduleItem of scheduleItems) {
    if (!scheduleItem || typeof scheduleItem !== "object") continue;
    const scheduleDateRaw = cleanText((scheduleItem as { date?: unknown }).date as string);
    const dateParts = parseDateLabelParts(scheduleDateRaw, input.fallbackIsoDate);
    const teamRows = Array.isArray((scheduleItem as { teams?: unknown }).teams)
      ? ((scheduleItem as { teams?: unknown[] }).teams || [])
      : Object.values(((scheduleItem as { teams?: Record<string, unknown> }).teams || {}));

    for (const teamRow of teamRows) {
      if (!teamRow || typeof teamRow !== "object") continue;
      const row = teamRow as Record<string, unknown>;
      const gameType = Number(row.game_type || 0);
      if (gameType === 3) continue;

      const homeTeam = normalizeTeam(String(row.team_name_1 || ""));
      const awayTeam = normalizeTeam(String(row.team_name_2 || ""));
      if (!homeTeam && !awayTeam) continue;
      if (!teamMatches(homeTeam, input.targetTeamName) && !teamMatches(awayTeam, input.targetTeamName)) continue;

      const time = cleanText(String(row.time || ""));
      const gameNo = parseGameNumber(row.game_number, out.length + 1);
      const ageDiv = cleanText(String(row.division || input.defaultDivision || ""));
      const location = cleanText(String(row.location || row.field_name || "Field TBD"));
      const homeScore = parseScore(row.team_score_1);
      const awayScore = parseScore(row.team_score_2);
      const sortAt = toSortableDateTime(dateParts.isoDate, time);
      const dedupeKey = [
        dateParts.isoDate,
        gameNo,
        time.toLowerCase(),
        location.toLowerCase(),
        homeTeam.toLowerCase(),
        awayTeam.toLowerCase()
      ].join("|");
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push({
        gameNo,
        date: dateParts.date,
        dayLabel: dateParts.dayLabel,
        time: time || "-",
        field: location || "Field TBD",
        ageDiv,
        homeTeam: homeTeam || "TBD",
        awayTeam: awayTeam || "TBD",
        homeScore,
        awayScore,
        _sortAt: sortAt
      });
    }
  }

  return out;
}

function parsePbrRosterRows(html: string) {
  const seen = new Set<string>();
  const rosterTable =
    html.match(/<div[^>]*id=["']block_roster["'][\s\S]*?<table[^>]*class=["'][^"']*\broster\b[^"']*["'][\s\S]*?<\/table>/i)?.[0]
    || html.match(/<table[^>]*class=["'][^"']*\broster\b[^"']*["'][\s\S]*?<\/table>/i)?.[0]
    || "";
  const scopeHtml = rosterTable || html;

  const headerRow =
    scopeHtml.match(/<thead[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i)?.[1]
    || "";
  const headers = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => cleanText(match[1]).toLowerCase());

  const bodyHtml = scopeHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || scopeHtml;
  const rowHtml = [...bodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);

  const output: TeamRosterRow[] = [];

  const readByHeader = (cells: string[], patterns: RegExp[]) => {
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i] || "";
      if (patterns.some((pattern) => pattern.test(header))) {
        return cells[i] || "";
      }
    }
    return "";
  };

  for (const row of rowHtml) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cleanText(match[1]));
    if (cells.length < 2) continue;

    const no = readByHeader(cells, [/^#$/, /jersey/, /^no\.?$/]) || cells[0] || "";
    const name = readByHeader(cells, [/^name$/, /player/]) || cells[1] || "";

    if (!name || name.length < 2) continue;
    if (/visit team page|roster|schedule|teams/i.test(name)) continue;
    if (/^w-l-t$/i.test(no) || /^w-l-t$/i.test(name)) continue;

    const grad = readByHeader(cells, [/grad/]);
    const school = readByHeader(cells, [/high school/, /^school$/]) || cells[3] || "";
    const city = readByHeader(cells, [/^city$/]);
    const state = readByHeader(cells, [/^state$/]);
    const hometown = readByHeader(cells, [/hometown/]) || [city, state].filter(Boolean).join(", ");

    const parsed: TeamRosterRow = {
      no,
      name,
      position: readByHeader(cells, [/primary pos/, /^position$/]) || "",
      school,
      hometown,
      commitment: readByHeader(cells, [/commitment/]) || "",
      grad,
      height: readByHeader(cells, [/height/]) || "",
      weight: readByHeader(cells, [/weight/]) || "",
      batsThrows: readByHeader(cells, [/b\/t/, /bats/, /throws/]) || ""
    };

    const key = rosterMergeKey({ no: parsed.no, name: parsed.name });
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(parsed);
  }

  if (output.length) return output;

  const anchors = [...html.matchAll(/<a[^>]*href=["'][^"']*(\/player\/|player-profile|\/players\/)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const fallback: TeamRosterRow[] = [];
  for (const anchor of anchors) {
    const name = cleanText(anchor[2] || "");
    if (!name || name.length < 2) continue;
    const key = rosterMergeKey({ no: "", name });
    if (seen.has(key)) continue;
    seen.add(key);
    fallback.push({
      no: "",
      name,
      position: "",
      school: ""
    });
  }
  return fallback;
}

function parsePbrTeamPageUrl(teamsHtml: string, targetTeamName: string) {
  const links = [...teamsHtml.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  for (const link of links) {
    const href = cleanText(link[1] || "");
    if (!/\/team\/details\//i.test(href)) continue;

    const anchorText = normalizeTeam(link[2] || "");
    if (teamMatches(anchorText, targetTeamName)) {
      return toAbsolutePbrUrl(href);
    }
  }

  return "";
}

async function tryFetchPbrLiveTeamData(input: {
  eventHint: string;
  targetTeamName: string;
  fallbackIsoDate: string;
}) {
  const eventBase = toPbrEventBase(input.eventHint) || toPbrEventBase(toAbsolutePbrUrl(input.eventHint));
  if (!eventBase) {
    return {
      schedule: [] as TeamScheduleRow[],
      roster: [] as TeamRosterRow[],
      teamUrl: ""
    };
  }

  const schedulePageRes = await fetch(`${eventBase}/schedule/all`, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  }).catch(() => null);
  const scheduleHtml = schedulePageRes && schedulePageRes.ok ? await schedulePageRes.text() : "";
  const context = scheduleHtml ? parsePbrScheduleContext(scheduleHtml, `${eventBase}/schedule/all`) : null;

  const scheduleRows: Array<TeamScheduleRow & { _sortAt: string }> = [];
  const addSchedule = (rows: Array<TeamScheduleRow & { _sortAt: string }>) => {
    rows.forEach((row) => scheduleRows.push(row));
  };

  if (context?.eventId) {
    const primaryScheduleId = String(context.divisions?.[context.defaultEventPriceId]?.schedule_id || "");
    if (context.defaultEventPriceId && primaryScheduleId) {
      const payload = await fetchPbrSchedulePayload(context, context.defaultEventPriceId, primaryScheduleId);
      addSchedule(parsePbrScheduleRowsFromPayload({
        payload,
        targetTeamName: input.targetTeamName,
        fallbackIsoDate: input.fallbackIsoDate
      }));
    }

    if (!scheduleRows.length) {
      for (const key of context.divisionKeys) {
        const division = context.divisions[key];
        const scheduleId = String(division?.schedule_id || "");
        if (!scheduleId) continue;
        const payload = await fetchPbrSchedulePayload(context, key, scheduleId);
        addSchedule(parsePbrScheduleRowsFromPayload({
          payload,
          targetTeamName: input.targetTeamName,
          fallbackIsoDate: input.fallbackIsoDate,
          defaultDivision: cleanText(String(division?.label || ""))
        }));
      }
    }
  }

  const orderedSchedule = scheduleRows
    .sort((a, b) => a._sortAt.localeCompare(b._sortAt) || a.gameNo.localeCompare(b.gameNo))
    .map((row) => ({
      gameNo: row.gameNo,
      date: row.date,
      dayLabel: row.dayLabel,
      time: row.time,
      field: row.field,
      ageDiv: row.ageDiv,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      homeScore: row.homeScore,
      awayScore: row.awayScore
    }));

  let teamUrl = "";
  let roster: TeamRosterRow[] = [];
  const teamsRes = await fetch(`${eventBase}/teams`, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  }).catch(() => null);
  const teamsHtml = teamsRes && teamsRes.ok ? await teamsRes.text() : "";
  if (teamsHtml) {
    teamUrl = parsePbrTeamPageUrl(teamsHtml, input.targetTeamName);
  }
  if (teamUrl) {
    const teamRes = await fetch(teamUrl, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    }).catch(() => null);
    const teamHtml = teamRes && teamRes.ok ? await teamRes.text() : "";
    if (teamHtml) roster = parsePbrRosterRows(teamHtml);
  }

  return {
    schedule: orderedSchedule,
    roster,
    teamUrl
  };
}

function asIsoDate(value: string) {
  const d = new Date(String(value || ""));
  if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T | null> {
  let settled = false;
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    task
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

async function resolvePbrEventHint(input: {
  inventorySlug: string;
  tournament: Tournament | null;
  teamUrl: string;
}) {
  const fromTeamUrl = toPbrEventBase(input.teamUrl);
  if (fromTeamUrl) return fromTeamUrl;

  const catalog = await fetchPbrTournamentCatalog().then((result) => result.items).catch(() => []);
  if (!catalog.length) return "";

  const bySlug = catalog.find((item) => item.slug === input.inventorySlug);
  if (bySlug?.harvestHint) return bySlug.harvestHint;

  const tournamentName = normalize(input.tournament?.name || "");
  if (tournamentName) {
    const byName = catalog.find((item) => {
      const itemName = normalize(item.name);
      return itemName === tournamentName || itemName.includes(tournamentName) || tournamentName.includes(itemName);
    });
    if (byName?.harvestHint) return byName.harvestHint;
  }

  return "";
}

function importedScheduleRows(teamGames: Tournament["games"]): TeamScheduleRow[] {
  return teamGames.map((game, index) => {
    const start = new Date(game.startTime);
    const valid = Number.isFinite(start.getTime()) ? start : new Date(Date.now() + index * 60 * 60 * 1000);
    return {
      gameNo: `#${index + 1}`,
      date: valid.toLocaleDateString("en-US"),
      dayLabel: formatDayLabelFromDate(new Date(Date.UTC(valid.getFullYear(), valid.getMonth(), valid.getDate()))),
      time: valid.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }).replace(/^0/, ""),
      field: game.field,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam
    };
  });
}

function importedRowsForTeam(tournament: Tournament, targetTeamName: string) {
  const teamGames = tournament.games
    .filter((game) => teamMatches(game.homeTeam, targetTeamName) || teamMatches(game.awayTeam, targetTeamName))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const schedule = importedScheduleRows(teamGames);
  const rosterMap = new Map<string, TeamRosterRow>();
  teamGames.forEach((game) => {
    game.players.forEach((player) => {
      if (!rosterMap.has(player.id)) {
        rosterMap.set(player.id, {
          no: "",
          name: player.name,
          position: player.position || "",
          height: "",
          weight: "",
          batsThrows: "",
          grad: "",
          school: player.school || "",
          hometown: "",
          rank: "",
          commitment: ""
        });
      }
    });
  });
  const roster = Array.from(rosterMap.values());
  return { schedule, roster };
}

async function resolveTeamUrl(input: {
  teamId: string;
  teamUrl: string;
  teamName: string;
  eventId: string;
}) {
  let url = input.teamUrl;
  if (!url && /^pg-team-\d+$/i.test(input.teamId)) {
    const teamNum = input.teamId.replace(/^pg-team-/i, "");
    url = `https://www.perfectgame.org/Events/Tournaments/Teams/Default.aspx?team=${teamNum}`;
  }
  if (!url && input.teamName && input.eventId) {
    // Avoid long hangs when PG lookup stalls.
    const resolved = await withTimeout(resolvePgTeamUrl(input.teamName, input.eventId), 1800);
    url = resolved || "";
  }
  return url;
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const inventorySlug = String(body?.inventorySlug || "").trim();
  const teamId = String(body?.teamId || "").trim();
  let teamUrl = String(body?.teamUrl || "").trim();
  const teamName = String(body?.teamName || "").trim();
  const eventId = String(body?.eventId || "").trim();
  const tournamentId = String(body?.tournamentId || "").trim();
  const searchOnly = body?.searchOnly === true || String(body?.searchOnly || "") === "true";

  if (!inventorySlug) {
    return NextResponse.json({ error: "inventorySlug is required" }, { status: 400 });
  }

  const previewUnlockAll = process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";
  const isAdminUser = Boolean(session.isAdmin) || isPrivilegedAdminEmail(String(session.email || ""));
  const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const unlockedResult = await withTimeout(listOrgUnlocks(session.orgId), 1800);
  const unlockedTimedOut = unlockedResult === null;
  const unlocked: string[] = Array.isArray(unlockedResult) ? unlockedResult : [];
  const seedMeta = INVENTORY_SEED.find((item) => item.slug === inventorySlug);
  const displayDate = seedMeta?.displayDate || "";
  const archiveCandidates = [seedMeta?.name, inventorySlug, tournamentId, teamName].filter(Boolean) as string[];
  const isArchive = archiveCandidates.some((name) =>
    isFreeTournamentAccess({
      slug: inventorySlug,
      name,
      displayDate
    })
  );
  if (!unlockedTimedOut && !previewUnlockAll && !isAdminUser && !isArchive && !unlocked.includes(inventorySlug)) {
    return NextResponse.json({ error: "Tournament is locked for your organization." }, { status: 402 });
  }

  try {
    const dataMode = (process.env.BIRD_DOG_DATA_MODE || "imported").toLowerCase();
    const allowLiveScrape = process.env.BIRD_DOG_ALLOW_PG_LIVE_SCRAPE === "true";

    if (dataMode !== "live" || !allowLiveScrape) {
      const tournament = tournamentId
        ? (hasSupabaseConfig
            ? (await withTimeout(
              getHarvestedTournament(session.orgId, tournamentId).catch(() => null),
              searchOnly ? 1800 : 3500
            ))
            : null)
        : null;

      const targetTeamName = teamName
        || tournament?.teams?.find((team) => team.id === teamId)?.name
        || "";

      if (tournament && targetTeamName) {
        const imported = importedRowsForTeam(tournament, targetTeamName);
        const schedule = imported.schedule;
        const importedRoster = imported.roster;
        const importedReady = schedule.length && importedRoster.length;
        const importedDetailed = hasDetailedRosterColumns(importedRoster);
        const isPbrTournament = seedMeta?.company === "PBR"
          || inventorySlug.startsWith("pbr-live-")
          || /^pbr-team-/i.test(teamId)
          || /prep baseball|pbr/i.test(`${tournament.name} ${teamName}`);

        if (searchOnly && importedRoster.length) {
          return NextResponse.json({
            ok: true,
            source: "imported_search_fast",
            schedule,
            roster: importedRoster,
            teamUrl: ""
          });
        }

        if (isPbrTournament && !searchOnly) {
          const eventHint = await resolvePbrEventHint({
            inventorySlug,
            tournament,
            teamUrl
          });
          if (eventHint) {
            const livePbr = await withTimeout(tryFetchPbrLiveTeamData({
              eventHint,
              targetTeamName: targetTeamName || teamName,
              fallbackIsoDate: asIsoDate(tournament.date)
            }), 3000) || { schedule: [] as TeamScheduleRow[], roster: [] as TeamRosterRow[], teamUrl: "" };

            if (livePbr.schedule.length || livePbr.roster.length) {
              const mergedRosterMap = new Map<string, TeamRosterRow>(
                importedRoster.map((row) => [rosterMergeKey(row), row])
              );
              for (const liveRow of livePbr.roster) {
                const key = rosterMergeKey(liveRow);
                const existing = mergedRosterMap.get(key);
                mergedRosterMap.set(key, {
                  no: liveRow.no || existing?.no || "",
                  name: liveRow.name || existing?.name || "",
                  position: liveRow.position || existing?.position || "",
                  height: liveRow.height || existing?.height || "",
                  weight: liveRow.weight || existing?.weight || "",
                  batsThrows: liveRow.batsThrows || existing?.batsThrows || "",
                  grad: liveRow.grad || existing?.grad || "",
                  school: liveRow.school || existing?.school || "",
                  hometown: liveRow.hometown || existing?.hometown || "",
                  rank: liveRow.rank || existing?.rank || "",
                  commitment: liveRow.commitment || existing?.commitment || ""
                });
              }

              return NextResponse.json({
                ok: true,
                source: "pbr_live_team_schedule",
                schedule: livePbr.schedule.length ? livePbr.schedule : schedule,
                roster: Array.from(mergedRosterMap.values()),
                teamUrl: livePbr.teamUrl || eventHint
              });
            }
          }
        }

        const shouldEnrichFromLive = !isPbrTournament && (!importedReady || !importedDetailed);
        if (shouldEnrichFromLive) {
          const fallbackTeamUrl = await resolveTeamUrl({ teamId, teamUrl, teamName: targetTeamName || teamName, eventId });
          if (fallbackTeamUrl) {
            const live = await withTimeout(scrapePgTeamLive(fallbackTeamUrl, {
              teamName: targetTeamName || teamName,
              eventId,
              fastMode: true
            }), 2800) || { schedule: [] as TeamScheduleRow[], roster: [] as TeamRosterRow[] };
            if (live.schedule.length || live.roster.length) {
              const mergedRosterMap = new Map<string, {
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
              }>(
                importedRoster.map((row) => [rosterMergeKey(row), row])
              );
              for (const liveRow of live.roster) {
                const key = rosterMergeKey(liveRow);
                const existing = mergedRosterMap.get(key);
                mergedRosterMap.set(key, {
                  no: liveRow.no || existing?.no || "",
                  name: liveRow.name || existing?.name || "",
                  position: liveRow.position || existing?.position || "",
                  height: liveRow.height || existing?.height || "",
                  weight: liveRow.weight || existing?.weight || "",
                  batsThrows: liveRow.batsThrows || existing?.batsThrows || "",
                  grad: liveRow.grad || existing?.grad || "",
                  school: liveRow.school || existing?.school || "",
                  hometown: liveRow.hometown || existing?.hometown || "",
                  rank: liveRow.rank || existing?.rank || "",
                  commitment: liveRow.commitment || existing?.commitment || ""
                });
              }
              return NextResponse.json({
                ok: true,
                source: importedReady ? "imported_plus_pg_live" : "pg_live_fallback",
                schedule: live.schedule.length ? live.schedule : schedule,
                roster: Array.from(mergedRosterMap.values()),
                teamUrl: fallbackTeamUrl
              });
            }
          }
        }

        if (importedReady) {
          return NextResponse.json({
            ok: true,
            source: "imported_dataset",
            schedule,
            roster: importedRoster,
            teamUrl: ""
          });
        }
      }

      const fallbackTeamUrl = await resolveTeamUrl({ teamId, teamUrl, teamName: targetTeamName || teamName, eventId });
      if (fallbackTeamUrl) {
        const liveFast = await withTimeout(scrapePgTeamLive(fallbackTeamUrl, {
          teamName: targetTeamName || teamName,
          eventId,
          fastMode: true
        }), searchOnly ? 7000 : 12000);
        if (liveFast && (liveFast.schedule.length || liveFast.roster.length)) {
          return NextResponse.json({ ok: true, source: "pg_live_fallback", ...liveFast, teamUrl: fallbackTeamUrl });
        }

        if (!searchOnly) {
          const liveRetry = await withTimeout(scrapePgTeamLive(fallbackTeamUrl, {
            teamName: targetTeamName || teamName,
            eventId,
            fastMode: false
          }), 12000);
          if (liveRetry && (liveRetry.schedule.length || liveRetry.roster.length)) {
            return NextResponse.json({ ok: true, source: "pg_live_fallback_retry", ...liveRetry, teamUrl: fallbackTeamUrl });
          }
        }
      }

      if (!tournament) {
        return NextResponse.json({
          ok: true,
          source: "imported_missing_live_pending",
          schedule: [] as TeamScheduleRow[],
          roster: [] as TeamRosterRow[],
          teamUrl: fallbackTeamUrl || ""
        });
      }

      return NextResponse.json({
        ok: true,
        source: "imported_dataset",
        schedule: [],
        roster: [],
        teamUrl: fallbackTeamUrl || ""
      });
    }

    teamUrl = await resolveTeamUrl({ teamId, teamUrl, teamName, eventId });
    if (!teamUrl) {
      return NextResponse.json({
        ok: true,
        source: "team_url_unresolved",
        schedule: [] as TeamScheduleRow[],
        roster: [] as TeamRosterRow[],
        teamUrl: ""
      });
    }
    const livePrimary = await withTimeout(
      scrapePgTeamLive(teamUrl, { teamName, eventId, fastMode: searchOnly }),
      searchOnly ? 9000 : 12000
    );
    if (livePrimary && (livePrimary.schedule.length || livePrimary.roster.length)) {
      return NextResponse.json({ ok: true, source: "live_primary", ...livePrimary });
    }

    if (!searchOnly) {
      const liveRetry = await withTimeout(
        scrapePgTeamLive(teamUrl, { teamName, eventId, fastMode: true }),
        9000
      );
      if (liveRetry && (liveRetry.schedule.length || liveRetry.roster.length)) {
        return NextResponse.json({ ok: true, source: "live_retry", ...liveRetry });
      }
    }

    if (!searchOnly && hasSupabaseConfig && tournamentId) {
      const fallbackTournament = await withTimeout(
        getHarvestedTournament(session.orgId, tournamentId).catch(() => null),
        2500
      );
      if (fallbackTournament) {
        const fallbackTeamName = teamName || fallbackTournament.teams?.find((team) => team.id === teamId)?.name || "";
        if (fallbackTeamName) {
          const fallbackRows = importedRowsForTeam(fallbackTournament, fallbackTeamName);
          if (fallbackRows.schedule.length || fallbackRows.roster.length) {
            return NextResponse.json({
              ok: true,
              source: "imported_after_live_timeout",
              schedule: fallbackRows.schedule,
              roster: fallbackRows.roster,
              teamUrl
            });
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      source: "live_sync_pending",
      schedule: [] as TeamScheduleRow[],
      roster: [] as TeamRosterRow[],
      teamUrl
    });
  } catch (error) {
    const detail = String(error || "");
    if (/timed out|AbortError/i.test(detail)) {
      return NextResponse.json({
        ok: true,
        source: "team_sync_timeout",
        schedule: [] as TeamScheduleRow[],
        roster: [] as TeamRosterRow[],
        teamUrl: teamUrl || ""
      });
    }
    return NextResponse.json({ error: "Failed to load team details", detail }, { status: 500 });
  }
}
