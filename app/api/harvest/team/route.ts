import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listOrgUnlocks } from "@/lib/birddog/repository";
import { resolvePgTeamUrl, scrapePgTeamLive } from "@/lib/birddog/pgScraper";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";
import { fetchPbrTournamentCatalog } from "@/lib/birddog/pbrTournamentCatalog";
import { Tournament } from "@/lib/birddog/types";
import { isTournamentUnlockBlockedEmail } from "@/lib/birddog/tournamentAccessPolicy";

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

function normalizeTeamPhrase(value: string) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function teamTokens(value: string) {
  return normalizeTeamPhrase(value).split(" ").filter(Boolean);
}

function teamCoreTokens(value: string) {
  const ignore = new Set(["team", "baseball", "softball", "club", "academy", "the"]);
  return teamTokens(value).filter((token) => {
    if (!token) return false;
    if (ignore.has(token)) return false;
    return true;
  });
}

function isAgeTeamToken(token: string) {
  const clean = String(token || "").trim().toLowerCase();
  if (!clean) return false;
  if (/^\d{1,2}u$/.test(clean)) return true;
  if (/^\d{1,2}$/.test(clean)) {
    const age = Number(clean);
    return Number.isFinite(age) && age >= 8 && age <= 22;
  }
  return false;
}

function teamMatches(candidate: string, target: string) {
  const normalizedCandidate = normalizeTeamPhrase(candidate);
  const normalizedTarget = normalizeTeamPhrase(target);
  if (!normalizedCandidate || !normalizedTarget) return false;
  if (normalizedCandidate === normalizedTarget) return true;

  const compactCandidate = normalize(candidate);
  const compactTarget = normalize(target);
  if (!compactCandidate || !compactTarget) return false;
  if (compactCandidate === compactTarget) return true;

  const candidateTokens = teamCoreTokens(candidate);
  const targetTokens = teamCoreTokens(target);
  if (!candidateTokens.length || !targetTokens.length) return false;

  const candidateSet = new Set(candidateTokens);
  const targetSet = new Set(targetTokens);
  const missingFromCandidate = targetTokens.filter((token) => !candidateSet.has(token));
  const missingFromTarget = candidateTokens.filter((token) => !targetSet.has(token));
  if (!missingFromCandidate.length && !missingFromTarget.length) return true;
  const targetOnlyAgeTokens = missingFromCandidate.length > 0
    && missingFromCandidate.every((token) => isAgeTeamToken(token))
    && missingFromTarget.length === 0;
  const candidateOnlyAgeTokens = missingFromTarget.length > 0
    && missingFromTarget.every((token) => isAgeTeamToken(token))
    && missingFromCandidate.length === 0;
  return targetOnlyAgeTokens || candidateOnlyAgeTokens;
}

function looksLikeVenueLabel(value: string) {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) return false;
  if (/^field\s*[a-z0-9-]*$/i.test(normalized)) return true;
  if (/^site\s*[a-z0-9-]*$/i.test(normalized)) return true;
  return /little league|sports complex|sportsplex|complex|park|stadium|facility|high school|middle school|athletic|ballpark|diamond|fieldhouse|@/.test(normalized);
}

function isPlaceholderField(value: string) {
  const normalized = cleanText(value).toLowerCase();
  return !normalized || normalized === "-" || normalized === "tbd" || normalized === "field tbd";
}

function scheduleRowsLookSuspect(rows: TeamScheduleRow[], targetTeamName: string) {
  if (!rows.length) return false;
  let venueAsTeamRows = 0;
  let targetMissingRows = 0;
  let missingFieldWithVenueRows = 0;

  rows.forEach((row) => {
    const homeTeam = cleanText(row.homeTeam || "");
    const awayTeam = cleanText(row.awayTeam || "");
    const field = cleanText(row.field || "");
    const homeLooksVenue = looksLikeVenueLabel(homeTeam);
    const awayLooksVenue = looksLikeVenueLabel(awayTeam);

    if (homeLooksVenue || awayLooksVenue) {
      venueAsTeamRows += 1;
      if (isPlaceholderField(field)) {
        missingFieldWithVenueRows += 1;
      }
    }

    if (
      targetTeamName
      && !teamMatches(homeTeam, targetTeamName)
      && !teamMatches(awayTeam, targetTeamName)
    ) {
      targetMissingRows += 1;
    }
  });

  if (venueAsTeamRows > 0) return true;
  if (missingFieldWithVenueRows > 0) return true;
  if (rows.length >= 2 && targetMissingRows === rows.length) return true;
  return false;
}

function rosterMergeKey(row: { no?: string; name?: string }) {
  const no = String(row.no || "").trim();
  const name = normalize(String(row.name || ""));
  return `${no}|${name}`;
}

function mergeRosterRows(importedRoster: TeamRosterRow[], liveRoster: TeamRosterRow[]) {
  const mergedRosterMap = new Map<string, TeamRosterRow>(
    importedRoster.map((row) => [rosterMergeKey(row), row])
  );

  for (const liveRow of liveRoster) {
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

  return Array.from(mergedRosterMap.values());
}

function scheduleRowIncludesTeam(row: TeamScheduleRow, targetTeamName: string) {
  const target = cleanText(targetTeamName || "");
  if (!target) return true;
  return teamMatches(row.homeTeam || "", target) || teamMatches(row.awayTeam || "", target);
}

function normalizeClockLabel(value: string) {
  return cleanText(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeDateLabel(value: string) {
  const clean = cleanText(value || "");
  if (!clean) return "";
  const parsed = Date.parse(clean);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  const us = clean.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const mm = String(Number(us[1])).padStart(2, "0");
    const dd = String(Number(us[2])).padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  return clean.toLowerCase();
}

function normalizeGameNo(value: string) {
  const clean = cleanText(value || "");
  if (!clean) return "";
  const digits = clean.match(/\d+/)?.[0] || "";
  return digits ? `#${digits}` : clean.toLowerCase();
}

function scheduleRowDedupeKey(row: TeamScheduleRow) {
  return [
    normalizeDateLabel(row.date || row.dayLabel || ""),
    normalizeClockLabel(row.time || ""),
    normalizeGameNo(row.gameNo || ""),
    normalizeTeamPhrase(row.homeTeam || ""),
    normalizeTeamPhrase(row.awayTeam || ""),
    cleanText(row.field || "").toLowerCase()
  ].join("|");
}

function scheduleRowIdentityScore(left: TeamScheduleRow, right: TeamScheduleRow) {
  let score = 0;
  const leftGameNo = normalizeGameNo(left.gameNo || "");
  const rightGameNo = normalizeGameNo(right.gameNo || "");
  if (leftGameNo && rightGameNo && leftGameNo === rightGameNo) score += 6;

  const leftTime = normalizeClockLabel(left.time || "");
  const rightTime = normalizeClockLabel(right.time || "");
  if (leftTime && rightTime && leftTime === rightTime) score += 4;

  const leftDate = normalizeDateLabel(left.date || left.dayLabel || "");
  const rightDate = normalizeDateLabel(right.date || right.dayLabel || "");
  if (leftDate && rightDate && leftDate === rightDate) score += 3;

  const leftHome = normalizeTeamPhrase(left.homeTeam || "");
  const leftAway = normalizeTeamPhrase(left.awayTeam || "");
  const rightHome = normalizeTeamPhrase(right.homeTeam || "");
  const rightAway = normalizeTeamPhrase(right.awayTeam || "");
  if (leftHome && rightHome && leftHome === rightHome) score += 2;
  if (leftAway && rightAway && leftAway === rightAway) score += 2;
  if (leftHome && rightAway && leftHome === rightAway) score += 1;
  if (leftAway && rightHome && leftAway === rightHome) score += 1;

  return score;
}

function scheduleRowLooksSuspect(row: TeamScheduleRow, targetTeamName: string) {
  const homeTeam = cleanText(row.homeTeam || "");
  const awayTeam = cleanText(row.awayTeam || "");
  const field = cleanText(row.field || "");
  const homeLooksVenue = looksLikeVenueLabel(homeTeam);
  const awayLooksVenue = looksLikeVenueLabel(awayTeam);
  if (homeLooksVenue || awayLooksVenue) return true;
  if ((homeTeam || awayTeam) && !scheduleRowIncludesTeam(row, targetTeamName)) return true;
  if (isPlaceholderField(field) && (homeLooksVenue || awayLooksVenue)) return true;
  return false;
}

function scheduleSortMs(row: TeamScheduleRow, index: number) {
  const candidates = [
    `${cleanText(row.date || "")} ${cleanText(row.time || "")}`.trim(),
    cleanText(row.date || ""),
    cleanText(row.dayLabel || "")
  ];
  for (const value of candidates) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.MAX_SAFE_INTEGER - (5000 - (index % 5000));
}

function normalizeScheduleRows(rows: TeamScheduleRow[]) {
  return rows
    .map((row) => ({
      gameNo: cleanText(row.gameNo || ""),
      date: cleanText(row.date || ""),
      time: cleanText(row.time || ""),
      field: cleanText(row.field || ""),
      homeTeam: normalizeTeam(row.homeTeam || ""),
      awayTeam: normalizeTeam(row.awayTeam || ""),
      dayLabel: cleanText(row.dayLabel || "") || undefined,
      ageDiv: cleanText(row.ageDiv || "") || undefined,
      homeScore: cleanText(row.homeScore || "") || undefined,
      awayScore: cleanText(row.awayScore || "") || undefined
    }))
    .filter((row) => row.homeTeam || row.awayTeam || row.gameNo || row.time || row.field);
}

function mergeScheduleRows(importedSchedule: TeamScheduleRow[], liveSchedule: TeamScheduleRow[], targetTeamName: string) {
  const imported = normalizeScheduleRows(importedSchedule);
  const live = normalizeScheduleRows(liveSchedule);
  if (!live.length) {
    return imported
      .filter((row) => scheduleRowIncludesTeam(row, targetTeamName))
      .sort((a, b) => scheduleSortMs(a, 0) - scheduleSortMs(b, 0));
  }

  const merged = new Map<string, TeamScheduleRow>();
  const importedUsed = new Set<number>();

  const bestImportedMatch = (row: TeamScheduleRow) => {
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < imported.length; i += 1) {
      const candidate = imported[i];
      const score = scheduleRowIdentityScore(row, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0 || bestScore < 4) return null;
    return { index: bestIndex, row: imported[bestIndex] };
  };

  live.forEach((liveRow) => {
    const suspicious = scheduleRowLooksSuspect(liveRow, targetTeamName);
    const importedMatch = bestImportedMatch(liveRow);
    if (importedMatch) importedUsed.add(importedMatch.index);

    let candidate: TeamScheduleRow = {
      gameNo: liveRow.gameNo || importedMatch?.row.gameNo || "",
      date: liveRow.date || importedMatch?.row.date || "",
      time: liveRow.time || importedMatch?.row.time || "",
      field: liveRow.field || importedMatch?.row.field || "Field TBD",
      homeTeam: liveRow.homeTeam || importedMatch?.row.homeTeam || "",
      awayTeam: liveRow.awayTeam || importedMatch?.row.awayTeam || "",
      dayLabel: liveRow.dayLabel || importedMatch?.row.dayLabel,
      ageDiv: liveRow.ageDiv || importedMatch?.row.ageDiv,
      homeScore: liveRow.homeScore || importedMatch?.row.homeScore,
      awayScore: liveRow.awayScore || importedMatch?.row.awayScore
    };

    if (suspicious && importedMatch) {
      candidate = {
        ...candidate,
        homeTeam: importedMatch.row.homeTeam || candidate.homeTeam,
        awayTeam: importedMatch.row.awayTeam || candidate.awayTeam,
        field: isPlaceholderField(candidate.field) ? (importedMatch.row.field || candidate.field) : candidate.field,
        date: candidate.date || importedMatch.row.date,
        time: candidate.time || importedMatch.row.time,
        dayLabel: candidate.dayLabel || importedMatch.row.dayLabel,
        ageDiv: candidate.ageDiv || importedMatch.row.ageDiv
      };
    }

    if (scheduleRowLooksSuspect(candidate, targetTeamName) && !importedMatch) {
      return;
    }

    if (!scheduleRowIncludesTeam(candidate, targetTeamName)) {
      if (importedMatch?.row && scheduleRowIncludesTeam(importedMatch.row, targetTeamName)) {
        candidate = importedMatch.row;
      } else {
        return;
      }
    }

    const key = scheduleRowDedupeKey(candidate);
    if (!key) return;
    merged.set(key, candidate);
  });

  imported.forEach((row, index) => {
    if (importedUsed.has(index)) return;
    if (!scheduleRowIncludesTeam(row, targetTeamName)) return;
    const key = scheduleRowDedupeKey(row);
    if (!key) return;
    if (merged.has(key)) return;
    merged.set(key, row);
  });

  return Array.from(merged.values()).sort((left, right) =>
    scheduleSortMs(left, 0) - scheduleSortMs(right, 0)
    || normalizeGameNo(left.gameNo || "").localeCompare(normalizeGameNo(right.gameNo || ""), undefined, { numeric: true })
  );
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

function slugifyText(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220);
}

function stripPbrTournamentSuffix(value: string) {
  return cleanText(value)
    .replace(/\s*-\s*prep baseball tournaments/i, "")
    .replace(/\s*-\s*\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}$/i, "")
    .trim();
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

const PBR_EVENT_HINT_CACHE_TTL_MS = 20 * 60 * 1000;

type PbrEventHintCacheEntry = {
  fetchedAt: number;
  value: string;
};

function getPbrEventHintCache() {
  const g = globalThis as unknown as {
    __BIRD_DOG_PBR_EVENT_HINT_CACHE__?: Record<string, PbrEventHintCacheEntry>;
  };
  if (!g.__BIRD_DOG_PBR_EVENT_HINT_CACHE__) {
    g.__BIRD_DOG_PBR_EVENT_HINT_CACHE__ = {};
  }
  return g.__BIRD_DOG_PBR_EVENT_HINT_CACHE__;
}

function pbrEventHintCacheKeys(input: {
  inventorySlug: string;
  tournamentName: string;
  teamUrl: string;
}) {
  const keys = new Set<string>();
  const slug = cleanText(input.inventorySlug);
  if (slug) keys.add(`slug:${slug.toLowerCase()}`);
  const tournamentName = cleanText(input.tournamentName);
  if (tournamentName) keys.add(`name:${normalize(tournamentName)}`);
  const fromUrl = toPbrEventBase(input.teamUrl);
  if (fromUrl) keys.add(`url:${fromUrl.toLowerCase()}`);
  return Array.from(keys);
}

function readCachedPbrEventHint(keys: string[]) {
  const cache = getPbrEventHintCache();
  const now = Date.now();
  for (const key of keys) {
    const entry = cache[key];
    if (!entry) continue;
    if (now - entry.fetchedAt > PBR_EVENT_HINT_CACHE_TTL_MS) {
      delete cache[key];
      continue;
    }
    if (entry.value) return entry.value;
  }
  return "";
}

function writeCachedPbrEventHint(keys: string[], value: string) {
  if (!value) return;
  const cache = getPbrEventHintCache();
  const next: PbrEventHintCacheEntry = { fetchedAt: Date.now(), value };
  keys.forEach((key) => {
    cache[key] = next;
  });
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

function parsePbrTeamPageUrl(teamsHtml: string, targetTeamName: string, targetTeamId = "") {
  const links = [...teamsHtml.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const teamUuid = cleanText(
    String(targetTeamId || "")
      .replace(/^pbr-team-/i, "")
      .match(/^([a-f0-9-]{8,})$/i)?.[1] || ""
  );
  if (teamUuid) {
    for (const link of links) {
      const href = cleanText(link[1] || "");
      if (!/\/team\/details\//i.test(href)) continue;
      const hrefUuid = cleanText(href.match(/\/team\/details\/\d+\/([a-f0-9-]{8,})/i)?.[1] || "");
      if (hrefUuid && hrefUuid.toLowerCase() === teamUuid.toLowerCase()) {
        return toAbsolutePbrUrl(href);
      }
    }
  }

  const targetKey = normalize(targetTeamName);
  const targetTokens = teamTokens(targetTeamName);
  let best: { href: string; score: number } | null = null;

  for (const link of links) {
    const href = cleanText(link[1] || "");
    if (!/\/team\/details\//i.test(href)) continue;

    const anchorText = normalizeTeam(link[2] || "");
    const anchorKey = normalize(anchorText);
    if (!anchorKey) continue;
    if (anchorKey === targetKey) return toAbsolutePbrUrl(href);
    if (teamMatches(anchorText, targetTeamName)) {
      const anchorTokens = teamTokens(anchorText);
      const targetSet = new Set(targetTokens);
      const overlap = anchorTokens.filter((token) => targetSet.has(token)).length;
      const ratio = overlap / Math.max(anchorTokens.length || 1, targetTokens.length || 1);
      const score = 1 + ratio + (anchorTokens[0] === targetTokens[0] ? 0.15 : 0);
      if (score > (best?.score || 0)) {
        best = { href, score };
      }
      continue;
    }

    const anchorTokens = teamTokens(anchorText);
    if (!anchorTokens.length || !targetTokens.length) continue;
    const targetSet = new Set(targetTokens);
    const overlap = anchorTokens.filter((token) => targetSet.has(token)).length;
    if (!overlap) continue;
    const ratio = overlap / Math.max(anchorTokens.length, targetTokens.length);
    const startsAligned = anchorTokens[0] === targetTokens[0];
    const score = ratio + (startsAligned ? 0.2 : 0);
    if (score > (best?.score || 0)) {
      best = { href, score };
    }

    // Single-token team aliases are common on PBR ("Forceout", "Canes", etc).
    // Accept only when token is meaningful and present in the anchor tokens.
    if (targetTokens.length === 1) {
      const token = targetTokens[0] || "";
      if (token.length >= 5 && anchorTokens.includes(token)) {
        const aliasScore = 0.72 + (anchorTokens[0] === token ? 0.12 : 0) - Math.max(0, anchorTokens.length - 2) * 0.05;
        if (aliasScore > (best?.score || 0)) {
          best = { href, score: aliasScore };
        }
      }
    }
  }

  if (best && best.score >= 0.5) return toAbsolutePbrUrl(best.href);
  return "";
}

async function tryFetchPbrLiveTeamData(input: {
  eventHint: string;
  targetTeamId: string;
  targetTeamName: string;
  fallbackIsoDate: string;
  providedTeamUrl?: string;
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

  const fetchRosterFromTeamUrl = async (candidateUrl: string) => {
    const absolute = toAbsolutePbrUrl(candidateUrl);
    if (!absolute || !/\/team\/details\//i.test(absolute)) {
      return { teamUrl: "", roster: [] as TeamRosterRow[] };
    }
    const teamRes = await fetch(absolute, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    }).catch(() => null);
    const teamHtml = teamRes && teamRes.ok ? await teamRes.text() : "";
    const rosterRows = teamHtml ? parsePbrRosterRows(teamHtml) : [];
    return { teamUrl: absolute, roster: rosterRows };
  };

  let teamUrl = toAbsolutePbrUrl(input.providedTeamUrl || "");
  let roster: TeamRosterRow[] = [];
  if (teamUrl) {
    const direct = await fetchRosterFromTeamUrl(teamUrl);
    teamUrl = direct.teamUrl || teamUrl;
    roster = direct.roster;
  }

  const teamsRes = await fetch(`${eventBase}/teams`, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  }).catch(() => null);
  const teamsHtml = teamsRes && teamsRes.ok ? await teamsRes.text() : "";
  if (teamsHtml && (!teamUrl || !roster.length)) {
    teamUrl = parsePbrTeamPageUrl(teamsHtml, input.targetTeamName, input.targetTeamId);
  }
  if (teamUrl && !roster.length) {
    const resolved = await fetchRosterFromTeamUrl(teamUrl);
    teamUrl = resolved.teamUrl || teamUrl;
    roster = resolved.roster;
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
  tournamentName: string;
}) {
  const fromTeamUrl = toPbrEventBase(input.teamUrl);
  if (fromTeamUrl) return fromTeamUrl;

  const preferredName = stripPbrTournamentSuffix(
    input.tournament?.name
    || input.tournamentName
    || ""
  );
  const cacheKeys = pbrEventHintCacheKeys({
    inventorySlug: input.inventorySlug,
    tournamentName: preferredName,
    teamUrl: input.teamUrl
  });
  const cachedHint = readCachedPbrEventHint(cacheKeys);
  if (cachedHint) return cachedHint;

  const candidateSlugs = new Set<string>();
  const rawInventorySlug = String(input.inventorySlug || "").replace(/^pbr-live-/i, "");
  if (rawInventorySlug) {
    candidateSlugs.add(rawInventorySlug);
    const parts = rawInventorySlug.split("-").filter(Boolean);
    if (parts.length >= 5) {
      const n = parts.length;
      const yyyy = parts[n - 3];
      const mm = parts[n - 2];
      const dd = parts[n - 1];
      if (/^\d{4}$/.test(yyyy) && /^\d{2}$/.test(mm) && /^\d{2}$/.test(dd)) {
        const prefix = parts.slice(0, n - 3);
        candidateSlugs.add([...prefix, mm, dd, yyyy].join("-"));
        if (prefix.length >= 2 && /^[a-z]{2}$/i.test(prefix[prefix.length - 1])) {
          const noState = prefix.slice(0, -1);
          candidateSlugs.add([...noState, mm, dd, yyyy].join("-"));
        }
      }
    }
  }

  if (preferredName) {
    const nameSlug = slugifyText(preferredName);
    if (nameSlug) {
      candidateSlugs.add(nameSlug);
      candidateSlugs.add(nameSlug.replace(/-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{4}$/i, ""));
    }
  }
  const citySlug = slugifyText(String(input.tournament?.city || "").split(",")[0] || "");
  if (citySlug && rawInventorySlug) {
    candidateSlugs.add(`${slugifyText(rawInventorySlug.replace(/-\d{4}-\d{2}-\d{2}$/i, ""))}-${citySlug}`);
  }

  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  for (const slug of candidateSlugs) {
    const cleanSlug = String(slug || "").replace(/^-+|-+$/g, "");
    if (!cleanSlug) continue;
    const eventBase = `https://tournaments.prepbaseballreport.com/events/${cleanSlug}`;
    const teamsUrl = `${eventBase}/teams`;
    const probe = await withTimeout(fetch(teamsUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    }).catch(() => null), 5000);
    if (probe && probe.ok) {
      writeCachedPbrEventHint(cacheKeys, eventBase);
      return eventBase;
    }
  }

  const catalog = await withTimeout(
    fetchPbrTournamentCatalog().then((result) => result.items).catch(() => []),
    5000
  );
  if (Array.isArray(catalog) && catalog.length) {
    const bySlug = catalog.find((item) => item.slug === input.inventorySlug);
    if (bySlug?.harvestHint) {
      const eventBase = toPbrEventBase(bySlug.harvestHint) || bySlug.harvestHint;
      writeCachedPbrEventHint(cacheKeys, eventBase);
      return eventBase;
    }

    const wanted = normalize(preferredName);
    if (wanted) {
      const byName = catalog.find((item) => {
        const itemName = normalize(item.name);
        return itemName === wanted || itemName.includes(wanted) || wanted.includes(itemName);
      });
      if (byName?.harvestHint) {
        const eventBase = toPbrEventBase(byName.harvestHint) || byName.harvestHint;
        writeCachedPbrEventHint(cacheKeys, eventBase);
        return eventBase;
      }
    }
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
  const seenGameKeys = new Set<string>();
  const teamGames = tournament.games
    .filter((game) => teamMatches(game.homeTeam, targetTeamName) || teamMatches(game.awayTeam, targetTeamName))
    .filter((game) => {
      const key = [
        String(game.startTime || ""),
        normalize(game.homeTeam || ""),
        normalize(game.awayTeam || ""),
        normalize(game.field || "")
      ].join("|");
      if (seenGameKeys.has(key)) return false;
      seenGameKeys.add(key);
      return true;
    })
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
  const tournamentName = String(body?.tournamentName || "").trim();
  const searchOnly = body?.searchOnly === true || String(body?.searchOnly || "") === "true";

  if (!inventorySlug) {
    return NextResponse.json({ error: "inventorySlug is required" }, { status: 400 });
  }

  const previewUnlockAll =
    process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true"
    && process.env.NODE_ENV !== "production";
  const isAdminUser = Boolean(session.isAdmin) || isPrivilegedAdminEmail(String(session.email || ""));
  const isBlockedUnlockEmail = !isAdminUser && isTournamentUnlockBlockedEmail(session.email);
  const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const unlockedResult = await withTimeout(listOrgUnlocks(session.orgId), 1800);
  const unlocked: string[] = Array.isArray(unlockedResult) ? unlockedResult : [];
  const seedMeta = INVENTORY_SEED.find((item) => item.slug === inventorySlug);
  if (isBlockedUnlockEmail) {
    return NextResponse.json({
      error: "Tournament access is locked for Gmail accounts. Sign in with your university domain email."
    }, { status: 402 });
  }
  if (!previewUnlockAll && !isAdminUser && !unlocked.includes(inventorySlug)) {
    return NextResponse.json({ error: "Tournament is locked for your organization domain." }, { status: 402 });
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

      const teamNameFromTournamentId = tournament?.teams?.find((team) => team.id === teamId)?.name || "";
      // Prefer canonical team name from the imported tournament for this teamId.
      // Query-string teamName can be shortened and can miss roster/schedule matches.
      const targetTeamName = teamNameFromTournamentId || teamName || "";

      if (tournament && targetTeamName) {
        const imported = importedRowsForTeam(tournament, targetTeamName);
        const schedule = imported.schedule;
        const importedScheduleNormalized = mergeScheduleRows(schedule, [] as TeamScheduleRow[], targetTeamName);
        const importedRoster = imported.roster;
        const importedReady = importedScheduleNormalized.length && importedRoster.length;
        const importedScheduleSuspect = scheduleRowsLookSuspect(schedule, targetTeamName);
        const isPbrTournament = seedMeta?.company === "PBR"
          || inventorySlug.startsWith("pbr-live-")
          || /^pbr-team-/i.test(teamId)
          || /prep baseball|pbr/i.test(`${tournament.name} ${teamName}`);

        if (searchOnly && importedRoster.length) {
          return NextResponse.json({
            ok: true,
            source: "imported_search_fast",
            schedule: importedScheduleNormalized,
            roster: importedRoster,
            teamUrl: ""
          });
        }

        if (isPbrTournament && !searchOnly) {
          const eventHint = await withTimeout(resolvePbrEventHint({
            inventorySlug,
            tournament,
            teamUrl,
            tournamentName
          }), 5000) || "";
          if (eventHint) {
            const livePbr = await withTimeout(tryFetchPbrLiveTeamData({
              eventHint,
              targetTeamId: teamId,
              targetTeamName: targetTeamName || teamName,
              fallbackIsoDate: asIsoDate(tournament.date),
              providedTeamUrl: teamUrl
            }), 7000) || { schedule: [] as TeamScheduleRow[], roster: [] as TeamRosterRow[], teamUrl: "" };

            if (livePbr.schedule.length || livePbr.roster.length) {
              const mergedSchedule = mergeScheduleRows(schedule, livePbr.schedule, targetTeamName);
              return NextResponse.json({
                ok: true,
                source: livePbr.schedule.length ? "pbr_live_team_schedule" : "pbr_live_roster_only",
                // Always prefer latest live schedule when available; fall back to imported schedule only when live is empty.
                schedule: mergedSchedule.length ? mergedSchedule : importedScheduleNormalized,
                roster: mergeRosterRows(importedRoster, livePbr.roster),
                teamUrl: livePbr.teamUrl || eventHint
              });
            }
          }

          if (importedScheduleSuspect) {
            return NextResponse.json({
              ok: true,
              source: "pbr_imported_schedule_suspect_live_pending",
              schedule: [] as TeamScheduleRow[],
              roster: importedRoster,
              teamUrl: eventHint || teamUrl || ""
            });
          }
        }

        const shouldEnrichFromLive = !isPbrTournament && !searchOnly;
        if (shouldEnrichFromLive) {
          const fallbackTeamUrl = await resolveTeamUrl({ teamId, teamUrl, teamName: targetTeamName || teamName, eventId });
          if (fallbackTeamUrl) {
            let live = await withTimeout(scrapePgTeamLive(fallbackTeamUrl, {
              teamName: targetTeamName || teamName,
              eventId,
              fastMode: true
            }), importedScheduleSuspect ? 5200 : 3200) || { schedule: [] as TeamScheduleRow[], roster: [] as TeamRosterRow[] };
            if (
              (!live.schedule.length && !live.roster.length)
              || (importedScheduleSuspect && !live.schedule.length)
            ) {
              const liveRetry = await withTimeout(scrapePgTeamLive(fallbackTeamUrl, {
                teamName: targetTeamName || teamName,
                eventId,
                fastMode: false
              }), importedScheduleSuspect ? 12000 : 7000);
              if (liveRetry && (liveRetry.schedule.length || liveRetry.roster.length)) {
                live = liveRetry;
              }
            }
            if (live.schedule.length || live.roster.length) {
              const mergedSchedule = mergeScheduleRows(schedule, live.schedule, targetTeamName);
              return NextResponse.json({
                ok: true,
                source: importedReady ? "pg_live_team_schedule" : "pg_live_fallback",
                // Always prefer latest live schedule when available; fall back to imported schedule only when live is empty.
                schedule: mergedSchedule.length ? mergedSchedule : importedScheduleNormalized,
                roster: mergeRosterRows(importedRoster, live.roster),
                teamUrl: fallbackTeamUrl
              });
            }
          }
        }

        if (importedReady) {
          if (importedScheduleSuspect) {
            return NextResponse.json({
              ok: true,
              source: "pg_imported_schedule_suspect_live_pending",
              schedule: [] as TeamScheduleRow[],
              roster: importedRoster,
              teamUrl: ""
            });
          }
          return NextResponse.json({
            ok: true,
            source: "imported_dataset",
            schedule: importedScheduleNormalized,
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
          const normalizedSchedule = mergeScheduleRows([] as TeamScheduleRow[], liveFast.schedule, targetTeamName || teamName);
          return NextResponse.json({
            ok: true,
            source: "pg_live_fallback",
            ...liveFast,
            schedule: normalizedSchedule,
            teamUrl: fallbackTeamUrl
          });
        }

        if (!searchOnly) {
          const liveRetry = await withTimeout(scrapePgTeamLive(fallbackTeamUrl, {
            teamName: targetTeamName || teamName,
            eventId,
            fastMode: false
          }), 12000);
          if (liveRetry && (liveRetry.schedule.length || liveRetry.roster.length)) {
            const normalizedSchedule = mergeScheduleRows([] as TeamScheduleRow[], liveRetry.schedule, targetTeamName || teamName);
            return NextResponse.json({
              ok: true,
              source: "pg_live_fallback_retry",
              ...liveRetry,
              schedule: normalizedSchedule,
              teamUrl: fallbackTeamUrl
            });
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
      const normalizedSchedule = mergeScheduleRows([] as TeamScheduleRow[], livePrimary.schedule, teamName);
      return NextResponse.json({ ok: true, source: "live_primary", ...livePrimary, schedule: normalizedSchedule });
    }

    if (!searchOnly) {
      const liveRetry = await withTimeout(
        scrapePgTeamLive(teamUrl, { teamName, eventId, fastMode: true }),
        9000
      );
      if (liveRetry && (liveRetry.schedule.length || liveRetry.roster.length)) {
        const normalizedSchedule = mergeScheduleRows([] as TeamScheduleRow[], liveRetry.schedule, teamName);
        return NextResponse.json({ ok: true, source: "live_retry", ...liveRetry, schedule: normalizedSchedule });
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
            const normalizedFallbackSchedule = mergeScheduleRows(
              fallbackRows.schedule,
              [] as TeamScheduleRow[],
              fallbackTeamName
            );
            return NextResponse.json({
              ok: true,
              source: "imported_after_live_timeout",
              schedule: normalizedFallbackSchedule,
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
