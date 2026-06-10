import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, getHarvestedTournamentByExternalId, listCircuitInventory, listHarvestedTournaments, listOrgUnlocks, upsertHarvestedTournament } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { scrapePgTournamentLive } from "@/lib/birddog/pgScraper";
import { INVENTORY_SEED, inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { isPastTournament } from "@/lib/birddog/tournamentAccess";
import { bestGroupedEventMatch, fetchPgGroupedEvents } from "@/lib/birddog/pgGroupedEvents";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";
import { fetchPbrTournamentCatalog } from "@/lib/birddog/pbrTournamentCatalog";
import { Game, Tournament } from "@/lib/birddog/types";
import { isTournamentUnlockBlockedEmail } from "@/lib/birddog/tournamentAccessPolicy";

type ParticipatingTeam = NonNullable<Tournament["teams"]>[number];

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

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractHintCandidates(tournamentHint: string) {
  const candidates = [tournamentHint];

  try {
    const url = new URL(tournamentHint);
    const search = url.searchParams.get("search");
    if (search) candidates.push(search);

    const event = url.searchParams.get("event");
    if (event) candidates.push(`pg ${event}`);
  } catch {
    // tournamentHint can be plain text, not always URL.
  }

  return candidates
    .map((item) => item.trim())
    .filter(Boolean);
}

function teamCount(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.length;
}

function tournamentHasAnyData(tournament: Tournament | null | undefined) {
  if (!tournament) return false;
  return teamCount(tournament.teams) > 0 || teamCount(tournament.games) > 0;
}

function safeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
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
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugify(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);
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
  return `https://tournaments.prepbaseballreport.com${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function toPbrEventBase(url: string) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(https?:\/\/[^/]+\/events\/[^/?#]+)/i);
  return match ? match[1] : "";
}

const PBR_FETCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function pbrHtmlLooksBlocked(status: number, html: string) {
  if (status === 403 || status === 429 || status === 503) return true;
  const low = String(html || "").toLowerCase();
  if (!low) return true;
  if (low.includes("cf-turnstile")) return true;
  if (low.includes("just a moment")) return true;
  if (low.includes("verify you are human")) return true;
  if (low.includes("security check to access")) return true;
  if (low.includes("attention required")) return true;
  return false;
}

function pbrProxyTemplateUrls() {
  return String(process.env.RESIDENTIAL_PROXY_TEMPLATE_URLS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pbrFetchCandidateUrls(targetUrl: string) {
  const urls: string[] = [targetUrl];
  pbrProxyTemplateUrls().forEach((template) => {
    if (!template) return;
    if (template.includes("{url}")) {
      urls.push(template.replace("{url}", encodeURIComponent(targetUrl)));
      return;
    }
    urls.push(template);
  });
  return Array.from(new Set(urls));
}

async function fetchPbrHtmlWithProxyFallback(targetUrl: string, perAttemptTimeoutMs = 6500) {
  for (const url of pbrFetchCandidateUrls(targetUrl)) {
    const res = await withTimeout(fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": PBR_FETCH_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "no-cache"
      }
    }).catch(() => null), perAttemptTimeoutMs);
    if (!res) continue;
    const html = await res.text().catch(() => "");
    if (!res.ok) continue;
    if (pbrHtmlLooksBlocked(res.status, html)) continue;
    if (!cleanText(html)) continue;
    return html;
  }
  return "";
}

const PBR_EVENT_HINT_CACHE_TTL_MS = 20 * 60 * 1000;

type PbrEventHintCacheEntry = {
  fetchedAt: number;
  value: string;
};

const LIVE_TOURNAMENT_CACHE_TTL_MS = 10 * 60 * 1000;

type LiveTournamentCacheEntry = {
  cachedAt: number;
  source: string;
  tournament: Tournament;
};

function getPbrEventHintCache() {
  const g = globalThis as unknown as {
    __BIRD_DOG_OPEN_PBR_EVENT_HINT_CACHE__?: Record<string, PbrEventHintCacheEntry>;
  };
  if (!g.__BIRD_DOG_OPEN_PBR_EVENT_HINT_CACHE__) {
    g.__BIRD_DOG_OPEN_PBR_EVENT_HINT_CACHE__ = {};
  }
  return g.__BIRD_DOG_OPEN_PBR_EVENT_HINT_CACHE__;
}

function getLiveTournamentCache() {
  const g = globalThis as unknown as {
    __BIRD_DOG_OPEN_LIVE_TOURNAMENT_CACHE__?: Record<string, LiveTournamentCacheEntry>;
  };
  if (!g.__BIRD_DOG_OPEN_LIVE_TOURNAMENT_CACHE__) {
    g.__BIRD_DOG_OPEN_LIVE_TOURNAMENT_CACHE__ = {};
  }
  return g.__BIRD_DOG_OPEN_LIVE_TOURNAMENT_CACHE__;
}

function pbrEventHintCacheKeys(input: {
  inventorySlug: string;
  preferredName: string;
  tournamentHint: string;
}) {
  const keys = new Set<string>();
  const slug = cleanText(input.inventorySlug);
  if (slug) keys.add(`slug:${slug.toLowerCase()}`);
  const preferred = cleanText(input.preferredName);
  if (preferred) keys.add(`name:${normalize(preferred)}`);
  const fromHint = toPbrEventBase(input.tournamentHint);
  if (fromHint) keys.add(`url:${fromHint.toLowerCase()}`);
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

function readCachedLiveTournament(key: string) {
  if (!key) return null;
  const cache = getLiveTournamentCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > LIVE_TOURNAMENT_CACHE_TTL_MS) {
    delete cache[key];
    return null;
  }
  return entry;
}

function writeCachedLiveTournament(key: string, source: string, tournament: Tournament | null) {
  if (!key || !tournament) return;
  const cache = getLiveTournamentCache();
  cache[key] = {
    cachedAt: Date.now(),
    source,
    tournament
  };
}

function toIsoDate(raw: string) {
  const value = cleanText(raw);
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const month = String(Number(slash[1])).padStart(2, "0");
    const day = String(Number(slash[2])).padStart(2, "0");
    const year = slash[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

type PbrScheduleDivision = {
  event_price_id?: string | number;
  schedule_id?: string | number;
  label?: string;
};

function parsePbrScheduleContext(html: string, sourceUrl: string) {
  const eventBase = toPbrEventBase(sourceUrl);
  const eventId = cleanText(
    html.match(/window\.EVENT_ID\s*=\s*["']?(\d+)["']?/i)?.[1]
    || html.match(/data-weather=["'](\d+)["']/i)?.[1]
    || html.match(/data-event-alert=["'](\d+)["']/i)?.[1]
    || ""
  );
  const scheduleAjaxUrl = toAbsolutePbrUrl(
    cleanText(
      html.match(/window\.SCHEDULE_AJAX_URL\s*=\s*["']([^"']+)["']/i)?.[1]
      || "https://tournaments.prepbaseballreport.com/schedule_ajax"
    )
  );
  const csrfToken = cleanText(
    html.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i)?.[1] || ""
  );
  const divisionsRaw = html.match(/window\.DIVISIONS\s*=\s*(\{[\s\S]*?\});/i)?.[1] || "";
  let divisions: Record<string, PbrScheduleDivision> = {};
  if (divisionsRaw) {
    try {
      divisions = JSON.parse(divisionsRaw) as Record<string, PbrScheduleDivision>;
    } catch {
      divisions = {};
    }
  }

  return {
    eventBase,
    eventId,
    scheduleAjaxUrl,
    csrfToken,
    divisions
  };
}

async function fetchPbrSchedulePayload(input: {
  eventId: string;
  scheduleAjaxUrl: string;
  eventBase: string;
  csrfToken: string;
  eventPriceId: string;
  scheduleId: string;
}) {
  if (!input.eventId || !input.scheduleAjaxUrl || !input.eventPriceId || !input.scheduleId) return null;
  const form = new URLSearchParams();
  form.set("event_id", input.eventId);
  form.set("event_price_id", input.eventPriceId);
  form.set("event_registration_item_id", "0");
  form.set("schedule_id", input.scheduleId);
  form.set("data_type", "schedules");
  if (input.csrfToken) form.set("_token", input.csrfToken);

  const res = await fetch(input.scheduleAjaxUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${input.eventBase}/schedule/all`,
      Origin: "https://tournaments.prepbaseballreport.com",
      ...(input.csrfToken ? { "X-CSRF-TOKEN": input.csrfToken } : {})
    },
    body: form.toString()
  });
  if (!res.ok) return null;
  const payload = await res.json().catch(() => null);
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
}

function parsePbrScheduleRows(payload: Record<string, unknown> | null) {
  const rows: Array<Record<string, unknown>> = [];
  if (!payload) return rows;
  const schedules = payload.schedules;
  if (!schedules || typeof schedules !== "object") return rows;

  Object.values(schedules as Record<string, unknown>).forEach((schedule) => {
    if (!schedule || typeof schedule !== "object") return;
    const teams = (schedule as { teams?: unknown }).teams;
    if (Array.isArray(teams)) {
      teams.forEach((team) => {
        if (team && typeof team === "object") rows.push(team as Record<string, unknown>);
      });
      return;
    }
    if (teams && typeof teams === "object") {
      Object.values(teams as Record<string, unknown>).forEach((team) => {
        if (team && typeof team === "object") rows.push(team as Record<string, unknown>);
      });
    }
  });

  return rows;
}

function parsePbrTeamsFromPayload(payloads: Array<Record<string, unknown> | null>) {
  const map = new Map<string, ParticipatingTeam>();

  payloads.forEach((payload) => {
    parsePbrScheduleRows(payload).forEach((row) => {
      const addTeam = (suffix: "1" | "2") => {
        const name = cleanText(String(row[`team_name_${suffix}`] || ""));
        if (!name) return;
        if (/pool\s+[a-z]\s+place|division\s+place|winner\s*#/i.test(name)) return;
        const link = toAbsolutePbrUrl(String(row[`team_link_${suffix}`] || ""));
        const uuid = cleanText(
          String(row[`team_${suffix}_uuid`] || "")
          || link.match(/#([a-f0-9-]{8,})/i)?.[1]
          || link.match(/\/team\/details\/\d+\/([a-f0-9-]{8,})/i)?.[1]
          || ""
        );
        const id = uuid ? `pbr-team-${uuid}` : `pbr-team-${slugify(name)}`;
        const key = (id || "").toLowerCase() || (link || "").toLowerCase() || `name:${normalizeTeam(name)}`;
        if (!key) return;
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            id,
            name,
            from: "",
            record: "",
            href: link || undefined
          });
          return;
        }
        if (!existing.href && link) existing.href = link;
      };
      addTeam("1");
      addTeam("2");
    });
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function parsePbrTeamsFromScheduleHtml(html: string) {
  const out = new Map<string, ParticipatingTeam>();
  const links = [...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  links.forEach((link) => {
    const href = toAbsolutePbrUrl(link[1] || "");
    if (!/\/team\/details\/\d+\//i.test(href) && !/#([a-f0-9-]{8,})/i.test(href)) return;
    const name = cleanText(link[2] || "");
    if (!name || /register|login|account|schedule|teams/i.test(name.toLowerCase())) return;
    const uuid = cleanText(
      href.match(/\/team\/details\/\d+\/([a-f0-9-]{8,})/i)?.[1]
      || href.match(/#([a-f0-9-]{8,})/i)?.[1]
      || ""
    );
    const id = uuid ? `pbr-team-${uuid}` : `pbr-team-${slugify(name)}`;
    const key = (id || "").toLowerCase() || (href || "").toLowerCase() || `name:${normalizeTeam(name)}`;
    if (!key || out.has(key)) return;
    out.set(key, {
      id,
      name,
      from: "",
      record: "",
      href: href || undefined
    });
  });
  return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function parsePbrTeamsFromTeamsHtml(html: string) {
  const out = new Map<string, ParticipatingTeam>();
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  for (const row of rows) {
    const link = row.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const name = cleanText(link[2] || "");
    if (!name || /team|register/i.test(name.toLowerCase())) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cleanText(cell[1] || ""));
    const from = cells.find((cell) => /,\s*[A-Z]{2}\b/.test(cell)) || "";
    const record = cells.find((cell) => /^\d+\s*-\s*\d+(\s*-\s*\d+)?$/.test(cell)) || "";
    const href = toAbsolutePbrUrl(link[1] || "");
    const uuid = cleanText(
      href.match(/\/team\/details\/\d+\/([a-f0-9-]{8,})/i)?.[1]
      || href.match(/#([a-f0-9-]{8,})/i)?.[1]
      || ""
    );
    const id = uuid ? `pbr-team-${uuid}` : `pbr-team-${slugify(name)}`;
    const key = (id || "").toLowerCase() || (href || "").toLowerCase() || `name:${normalizeTeam(name)}`;
    if (!key) continue;
    if (!out.has(key)) {
      out.set(key, {
        id,
        name,
        from,
        record,
        href: href || undefined
      });
    }
  }
  return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function parsePbrGamesFromPayload(payloads: Array<Record<string, unknown> | null>) {
  const map = new Map<string, Game & Record<string, unknown>>();
  payloads.forEach((payload) => {
    parsePbrScheduleRows(payload).forEach((row, index) => {
      const homeTeam = cleanText(String(row.team_name_1 || ""));
      const awayTeam = cleanText(String(row.team_name_2 || ""));
      if (!homeTeam && !awayTeam) return;
      const homeTeamHref = toAbsolutePbrUrl(String(row.team_link_1 || ""));
      const awayTeamHref = toAbsolutePbrUrl(String(row.team_link_2 || ""));
      const homeTeamUuid = cleanText(
        String(row.team_1_uuid || "")
        || homeTeamHref.match(/#([a-f0-9-]{8,})/i)?.[1]
        || homeTeamHref.match(/\/team\/details\/\d+\/([a-f0-9-]{8,})/i)?.[1]
        || ""
      );
      const awayTeamUuid = cleanText(
        String(row.team_2_uuid || "")
        || awayTeamHref.match(/#([a-f0-9-]{8,})/i)?.[1]
        || awayTeamHref.match(/\/team\/details\/\d+\/([a-f0-9-]{8,})/i)?.[1]
        || ""
      );
      const homeTeamId = homeTeamUuid ? `pbr-team-${homeTeamUuid}` : "";
      const awayTeamId = awayTeamUuid ? `pbr-team-${awayTeamUuid}` : "";
      const location = cleanText(String(row.location || row.field_name || "Field TBD"));
      const gameExternal = cleanText(String(row.schedule_game_id || row.game_number || index + 1));
      const displayGameNo = cleanText(String(row.game_number || ""));
      const gameId = gameExternal ? `pbr-game-${gameExternal}` : `pbr-game-${slugify(`${homeTeam}-${awayTeam}-${index + 1}`)}`;
      const scheduleTimeRaw = cleanText(String(row.schedule_time || ""));
      const timeLabel = cleanText(String(row.time || ""));
      const dateRaw = cleanText(String(row.date_short || ""));
      const dayLabel = cleanText(String(row.day_of_week || ""));
      const ageDiv = cleanText(String(row.age_div || row.division || row.div_name || row.age || ""));
      const homeScore = cleanText(String(
        row.team_1_score
        || row.team1_score
        || row.score_1
        || row.home_score
        || row.score_home
        || ""
      ));
      const awayScore = cleanText(String(
        row.team_2_score
        || row.team2_score
        || row.score_2
        || row.away_score
        || row.score_away
        || ""
      ));
      let startTime = "";
      if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(scheduleTimeRaw)) {
        startTime = `${scheduleTimeRaw.replace(" ", "T")}Z`;
      } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(scheduleTimeRaw)) {
        startTime = scheduleTimeRaw.endsWith("Z") ? scheduleTimeRaw : `${scheduleTimeRaw}Z`;
      } else {
        const isoDate = toIsoDate(dateRaw) || new Date().toISOString().slice(0, 10);
        const ampm = timeLabel.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
        if (ampm) {
          let hour = Number(ampm[1]);
          const min = Number(ampm[2]);
          if (ampm[3].toUpperCase() === "PM" && hour < 12) hour += 12;
          if (ampm[3].toUpperCase() === "AM" && hour === 12) hour = 0;
          startTime = `${isoDate}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000Z`;
        } else {
          startTime = `${isoDate}T09:00:00.000Z`;
        }
      }

      const dedupeKey = [
        startTime,
        normalizeTeam(homeTeam),
        (homeTeamId || "").toLowerCase(),
        normalizeTeam(awayTeam),
        (awayTeamId || "").toLowerCase(),
        cleanText(location).toLowerCase(),
        cleanText(ageDiv).toLowerCase()
      ].join("|");

      if (!map.has(dedupeKey)) {
        map.set(dedupeKey, {
          id: gameId,
          field: location || "Field TBD",
          fieldLocation: { x: 0, y: 0 },
          startTime,
          homeTeam: homeTeam || "TBD",
          awayTeam: awayTeam || "TBD",
          players: [],
          homeTeamId,
          awayTeamId,
          homeTeamHref,
          awayTeamHref,
          gameNo: displayGameNo,
          timeLabel,
          dateLabel: dateRaw,
          dayLabel,
          ageDiv,
          homeScore,
          awayScore
        });
        return;
      }

      const existing = map.get(dedupeKey)!;
      if (!existing.homeScore && homeScore) existing.homeScore = homeScore;
      if (!existing.awayScore && awayScore) existing.awayScore = awayScore;
      if (!existing.ageDiv && ageDiv) existing.ageDiv = ageDiv;
      if (!existing.dayLabel && dayLabel) existing.dayLabel = dayLabel;
      if (!existing.timeLabel && timeLabel) existing.timeLabel = timeLabel;
      if (!existing.gameNo && displayGameNo) existing.gameNo = displayGameNo;
      if (!existing.homeTeamId && homeTeamId) existing.homeTeamId = homeTeamId;
      if (!existing.awayTeamId && awayTeamId) existing.awayTeamId = awayTeamId;
      if (!existing.homeTeamHref && homeTeamHref) existing.homeTeamHref = homeTeamHref;
      if (!existing.awayTeamHref && awayTeamHref) existing.awayTeamHref = awayTeamHref;
    });
  });

  return Array.from(map.values()).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function parsePbrGamesFromScheduleHtml(html: string) {
  const out: Array<Game & Record<string, unknown>> = [];
  const seen = new Set<string>();
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);

  rows.forEach((row, index) => {
    const links = [...row.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((link) => ({
        href: toAbsolutePbrUrl(link[1] || ""),
        name: cleanText(link[2] || "")
      }))
      .filter((item) => item.name && /\/team\/details\/\d+\//i.test(item.href));
    if (links.length < 2) return;

    const homeTeam = cleanText(links[0]?.name || "");
    const awayTeam = cleanText(links[1]?.name || "");
    if (!homeTeam || !awayTeam) return;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cleanText(cell[1] || ""));
    const dateLabel = cleanText(
      row.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/i)?.[1]
      || cells.find((cell) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(cell))
      || ""
    );
    const timeLabel = cleanText(
      row.match(/\b(\d{1,2}:\d{2}\s*[AP]M)\b/i)?.[1]
      || cells.find((cell) => /\d{1,2}:\d{2}\s*[AP]M/i.test(cell))
      || ""
    );
    const field = cleanText(
      cells.find((cell) => /(field|park|complex|stadium|academy|ballpark|sportsplex|site\s+\d+)/i.test(cell))
      || "Field TBD"
    );
    const gameNo = cleanText(
      row.match(/\bgame(?:\s*id)?\s*[:#]?\s*(\d{3,})\b/i)?.[1]
      || ""
    );

    const isoDate = toIsoDate(dateLabel) || new Date().toISOString().slice(0, 10);
    let startTime = `${isoDate}T09:00:00.000Z`;
    const ampm = timeLabel.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (ampm) {
      let hour = Number(ampm[1]);
      const min = Number(ampm[2]);
      if (ampm[3].toUpperCase() === "PM" && hour < 12) hour += 12;
      if (ampm[3].toUpperCase() === "AM" && hour === 12) hour = 0;
      startTime = `${isoDate}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00.000Z`;
    }

    const dedupeKey = [
      startTime,
      normalizeTeam(homeTeam),
      normalizeTeam(awayTeam),
      field.toLowerCase(),
      gameNo
    ].join("|");
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    out.push({
      id: gameNo ? `pbr-game-${gameNo}` : `pbr-game-${slugify(`${homeTeam}-${awayTeam}-${index + 1}`)}`,
      field: field || "Field TBD",
      fieldLocation: { x: 0, y: 0 },
      startTime,
      homeTeam,
      awayTeam,
      players: []
    });
  });

  return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

async function resolvePbrTournamentHint(input: {
  inventorySlug: string;
  tournamentHint: string;
  preferredName: string;
}) {
  const direct = toPbrEventBase(input.tournamentHint) || toPbrEventBase(toAbsolutePbrUrl(input.tournamentHint));
  if (direct) return direct;

  const preferredName = stripPbrTournamentSuffix(input.preferredName || input.tournamentHint || "");
  const cacheKeys = pbrEventHintCacheKeys({
    inventorySlug: input.inventorySlug,
    preferredName,
    tournamentHint: input.tournamentHint
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

  const nameSlug = slugify(preferredName);
  if (nameSlug) {
    candidateSlugs.add(nameSlug);
    candidateSlugs.add(nameSlug.replace(/-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{4}$/i, ""));
  }

  for (const slug of candidateSlugs) {
    const cleanSlug = String(slug || "").replace(/^-+|-+$/g, "");
    if (!cleanSlug) continue;
    const eventBase = `https://tournaments.prepbaseballreport.com/events/${cleanSlug}`;
    const teamsUrl = `${eventBase}/teams`;
    const probeHtml = await fetchPbrHtmlWithProxyFallback(teamsUrl, 5000);
    if (probeHtml) {
      writeCachedPbrEventHint(cacheKeys, eventBase);
      return eventBase;
    }
  }

  const catalog = await withTimeout(
    fetchPbrTournamentCatalog().then((result) => result.items).catch(() => []),
    5000
  );
  if (!Array.isArray(catalog) || !catalog.length) return "";

  const bySlug = catalog.find((item) => item.slug === input.inventorySlug);
  if (bySlug?.harvestHint) {
    const eventBase = toPbrEventBase(bySlug.harvestHint) || bySlug.harvestHint;
    writeCachedPbrEventHint(cacheKeys, eventBase);
    return eventBase;
  }

  const wanted = normalize(preferredName);
  if (!wanted) return "";

  const byName = catalog.find((item) => {
    const name = normalize(item.name);
    return name === wanted || name.includes(wanted) || wanted.includes(name);
  });
  if (!byName?.harvestHint) return "";
  const eventBase = toPbrEventBase(byName.harvestHint) || byName.harvestHint;
  writeCachedPbrEventHint(cacheKeys, eventBase);
  return eventBase;
}

async function buildPbrLiveTournament(input: {
  inventorySlug: string;
  tournamentHint: string;
  preferredName: string;
}) {
  const eventBase = await resolvePbrTournamentHint(input);
  if (!eventBase) return null;

  const scheduleAllUrl = `${eventBase}/schedule/all`;
  const scheduleHtml = await fetchPbrHtmlWithProxyFallback(scheduleAllUrl, 7000);
  if (!scheduleHtml) return null;
  const context = parsePbrScheduleContext(scheduleHtml, scheduleAllUrl);

  const payloads: Array<Record<string, unknown> | null> = [];
  const seenDivisionKeys = new Set<string>();
  const pushPayload = (key: string, payload: Record<string, unknown> | null) => {
    if (!payload) return;
    if (seenDivisionKeys.has(key)) return;
    seenDivisionKeys.add(key);
    payloads.push(payload);
  };
  if (context.eventId) {
    const allPayload = await fetchPbrSchedulePayload({
      eventId: context.eventId,
      scheduleAjaxUrl: context.scheduleAjaxUrl,
      eventBase: context.eventBase,
      csrfToken: context.csrfToken,
      eventPriceId: "0",
      scheduleId: "0"
    });
    pushPayload("0|0", allPayload);

    const divisionEntries = Object.entries(context.divisions)
      .filter(([key, division]) => key !== "0" && safeString(division?.event_price_id || key))
      .map(([key, division]) => ({
        eventPriceId: safeString(division?.event_price_id || key),
        scheduleId: safeString(division?.schedule_id || "")
      }))
      .filter((item) => item.eventPriceId && item.scheduleId);

    for (const division of divisionEntries) {
      const divisionKey = `${division.eventPriceId}|${division.scheduleId}`;
      if (seenDivisionKeys.has(divisionKey)) continue;
      const payload = await fetchPbrSchedulePayload({
        eventId: context.eventId,
        scheduleAjaxUrl: context.scheduleAjaxUrl,
        eventBase: context.eventBase,
        csrfToken: context.csrfToken,
        eventPriceId: division.eventPriceId,
        scheduleId: division.scheduleId
      });
      pushPayload(divisionKey, payload);
    }
  }

  const teamsHtml = await fetchPbrHtmlWithProxyFallback(`${eventBase}/teams`, 6500);

  const teamsFromSchedule = scheduleHtml ? parsePbrTeamsFromScheduleHtml(scheduleHtml) : [];
  const teamsFromHtml = teamsHtml ? parsePbrTeamsFromTeamsHtml(teamsHtml) : [];
  const teamsFromPayload = parsePbrTeamsFromPayload(payloads);
  const teams = teamsFromHtml.length
    ? teamsFromHtml
    : (teamsFromPayload.length ? teamsFromPayload : teamsFromSchedule);

  const gamesFromPayload = parsePbrGamesFromPayload(payloads);
  const games = gamesFromPayload.length ? gamesFromPayload : parsePbrGamesFromScheduleHtml(scheduleHtml);

  const name = cleanText(
    scheduleHtml.match(/<meta itemprop="name" content="([^"]+)"/i)?.[1]
    || input.preferredName
    || "PBR Tournament"
  );
  const cityLocality = cleanText(scheduleHtml.match(/<meta itemprop="addressLocality" content="([^"]+)"/i)?.[1] || "");
  const cityRegion = cleanText(scheduleHtml.match(/<meta itemprop="addressRegion" content="([^"]+)"/i)?.[1] || "");
  const city = [cityLocality, cityRegion].filter(Boolean).join(", ") || "TBD";
  const date = toIsoDate(
    cleanText(scheduleHtml.match(/<meta itemprop="startDate" content="([^"]+)"/i)?.[1] || "")
  ) || new Date().toISOString().slice(0, 10);

  const tournament: Tournament = {
    id: input.inventorySlug || `pbr-live-${slugify(name)}-${date}`,
    name,
    city,
    date,
    games,
    teams
  };

  return tournament;
}

function canonicalizeTournamentForInventory(input: {
  tournament: Tournament;
  inventorySlug: string;
  preferredName?: string;
}) {
  const canonicalId = cleanText(input.inventorySlug);
  if (!canonicalId) return input.tournament;
  const preferredName = cleanText(input.preferredName || "");
  return {
    ...input.tournament,
    id: canonicalId,
    name: preferredName || input.tournament.name
  } as Tournament;
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const company = body?.company === "PBR" ? "PBR" : "PG";
  const inventorySlug = String(body?.inventorySlug || "").trim();
  const tournamentHint = String(body?.tournamentHint || "").trim();
  const tournamentId = String(body?.tournamentId || "").trim();

  if (!inventorySlug || (!tournamentHint && !tournamentId)) {
    return NextResponse.json({ error: "inventorySlug and tournamentHint or tournamentId are required" }, { status: 400 });
  }

  const previewUnlockAll =
    process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true"
    && process.env.NODE_ENV !== "production";
  const isAdminUser = Boolean(session.isAdmin) || isPrivilegedAdminEmail(String(session.email || ""));
  const isBlockedUnlockEmail = !isAdminUser && isTournamentUnlockBlockedEmail(session.email);
  const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const [unlockedResult, inventoryResult] = await Promise.all([
    withTimeout(listOrgUnlocks(session.orgId).catch(() => [] as string[]), 3500),
    withTimeout(
      listCircuitInventory().catch(() => [] as Array<{ slug: string; name: string }>),
      3500
    )
  ]);
  const unlocked = Array.isArray(unlockedResult) ? unlockedResult : [] as string[];
  const inventory = Array.isArray(inventoryResult)
    ? inventoryResult
    : [] as Array<{ slug: string; name: string }>;
  const selected = inventory.find((item) => item.slug === inventorySlug);
  const seedMeta = INVENTORY_SEED.find((item) => item.slug === inventorySlug);
  const groupedEvents = company === "PG"
    ? ((await withTimeout(fetchPgGroupedEvents("23065").catch(() => []), 3500)) || [])
    : [];
  const groupedMatch = selected?.name && groupedEvents.length
    ? bestGroupedEventMatch(selected.name, groupedEvents)
    : null;
  const displayDate = groupedMatch?.dateLabel || seedMeta?.displayDate || "";
  const archiveCandidates = [
    selected?.name,
    seedMeta?.name,
    tournamentHint,
    inventorySlug
  ].filter(Boolean) as string[];
  const isArchive = archiveCandidates.some((name) =>
    isPastTournament({ name, displayDate })
  );
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
    const liveScrapeTimeoutRaw = Number(String(process.env.BIRD_DOG_OPEN_LIVE_TIMEOUT_MS || "").trim());
    const liveScrapeTimeoutMs = Number.isFinite(liveScrapeTimeoutRaw)
      ? Math.max(3000, Math.min(30000, Math.trunc(liveScrapeTimeoutRaw)))
      : 14000;
    const enableLivePreferredOpen = process.env.BIRD_DOG_ENABLE_LIVE_PREFERRED_OPEN === "true";
    const liveCacheKey = `${session.orgId}:${company}:${inventorySlug}`;

    const pgLiveHint = tournamentHint || inventoryHarvestHint({
      slug: inventorySlug,
      name: selected?.name || seedMeta?.name || "Perfect Game Tournament",
      company: "PG"
    });
    const preferredTournamentName = selected?.name || seedMeta?.name || "";

    const shouldRefreshImportedSnapshot = (existingTeamCount: number) => {
      if (existingTeamCount === 0) return true;
      return false;
    };
    const shouldForceLiveRefresh = process.env.BIRD_DOG_FORCE_LIVE_REFRESH_ON_OPEN === "true";
    const liveRefreshSourcePrefix = company === "PBR" ? "pbr" : "pg";

    const refreshFromLive = async (fallbackName: string) => {
      const preferredName = fallbackName || preferredTournamentName || (company === "PBR" ? "PBR Tournament" : "Perfect Game Tournament");
      try {
        const rawLiveTournament = await withTimeout(
          company === "PBR"
            ? buildPbrLiveTournament({
              inventorySlug,
              tournamentHint,
              preferredName
            })
            : scrapePgTournamentLive(
              tournamentHint || inventoryHarvestHint({
                slug: inventorySlug,
                name: preferredName,
                company
              })
            ),
          liveScrapeTimeoutMs
        );
        const liveTournament = rawLiveTournament
          ? canonicalizeTournamentForInventory({
            tournament: rawLiveTournament,
            inventorySlug,
            preferredName
          })
          : null;
        if (!liveTournament) return null;
        if (!hasSupabaseConfig) {
          writeCachedLiveTournament(liveCacheKey, `${liveRefreshSourcePrefix}_live_refresh`, liveTournament);
          return liveTournament;
        }
        const dbId = await upsertHarvestedTournament({
          orgId: session.orgId,
          company,
          tournament: liveTournament
        }).catch(() => "");
        if (!dbId) return liveTournament;
        const hydrated = await getHarvestedTournament(session.orgId, dbId).catch(() => null);
        const next = hydrated || liveTournament;
        writeCachedLiveTournament(liveCacheKey, `${liveRefreshSourcePrefix}_live_refresh`, next);
        return next;
      } catch {
        return null;
      }
    };

    const liveFirstPg = async () => {
      if (company !== "PG") return null as Tournament | null;
      const rawLiveTournament = await withTimeout(scrapePgTournamentLive(pgLiveHint), liveScrapeTimeoutMs);
      const liveTournament = rawLiveTournament
        ? canonicalizeTournamentForInventory({
          tournament: rawLiveTournament,
          inventorySlug,
          preferredName: preferredTournamentName
        })
        : null;
      if (!liveTournament) return null;
      if (!hasSupabaseConfig) {
        writeCachedLiveTournament(liveCacheKey, "pg_live_preferred", liveTournament);
        return liveTournament;
      }
      writeCachedLiveTournament(liveCacheKey, "pg_live_preferred", liveTournament);
      void upsertHarvestedTournament({
        orgId: session.orgId,
        company,
        tournament: liveTournament
      })
        .then(async (dbId) => {
          if (!dbId) return;
          const hydrated = await getHarvestedTournament(session.orgId, dbId).catch(() => null);
          const next = hydrated || liveTournament;
          writeCachedLiveTournament(liveCacheKey, "pg_live_preferred", next);
        })
        .catch(() => {});
      return liveTournament;
    };

    const liveFirstPbr = async () => {
      if (company !== "PBR") return null as Tournament | null;
      const rawLiveTournament = await withTimeout(buildPbrLiveTournament({
        inventorySlug,
        tournamentHint,
        preferredName: selected?.name || seedMeta?.name || ""
      }), liveScrapeTimeoutMs);
      const liveTournament = rawLiveTournament
        ? canonicalizeTournamentForInventory({
          tournament: rawLiveTournament,
          inventorySlug,
          preferredName: selected?.name || seedMeta?.name || ""
        })
        : null;
      if (!liveTournament) return null;
      if (!hasSupabaseConfig) {
        writeCachedLiveTournament(liveCacheKey, "pbr_live_preferred", liveTournament);
        return liveTournament;
      }
      writeCachedLiveTournament(liveCacheKey, "pbr_live_preferred", liveTournament);
      void upsertHarvestedTournament({
        orgId: session.orgId,
        company,
        tournament: liveTournament
      })
        .then(async (dbId) => {
          if (!dbId) return;
          const hydrated = await getHarvestedTournament(session.orgId, dbId).catch(() => null);
          const next = hydrated || liveTournament;
          writeCachedLiveTournament(liveCacheKey, "pbr_live_preferred", next);
        })
        .catch(() => {});
      return liveTournament;
    };

    if (dataMode !== "live" || !allowLiveScrape) {
      const cachedLive = readCachedLiveTournament(liveCacheKey);
      if (cachedLive && tournamentHasAnyData(cachedLive.tournament)) {
        return NextResponse.json({
          ok: true,
          tournament: cachedLive.tournament,
          source: `${cachedLive.source}_cache`
        });
      }
      let livePreferredAttempted = false;
      let livePreferredFailed = false;
      if (enableLivePreferredOpen && company === "PG") {
        livePreferredAttempted = true;
        const livePgTournament = await liveFirstPg().catch(() => null);
        if (livePgTournament && tournamentHasAnyData(livePgTournament)) {
          return NextResponse.json({
            ok: true,
            tournament: livePgTournament,
            source: "pg_live_preferred"
          });
        }
        livePreferredFailed = true;
      }
      if (enableLivePreferredOpen && company === "PBR") {
        livePreferredAttempted = true;
        const livePbrTournament = await liveFirstPbr().catch(() => null);
        if (livePbrTournament && tournamentHasAnyData(livePbrTournament)) {
          return NextResponse.json({
            ok: true,
            tournament: livePbrTournament,
            source: "pbr_live_preferred"
          });
        }
        livePreferredFailed = true;
      }
      const allowBlockingRefresh = !livePreferredAttempted || !livePreferredFailed;

      if (hasSupabaseConfig) {
        const tournamentByExternal = await getHarvestedTournamentByExternalId(
          session.orgId,
          company,
          inventorySlug
        ).catch(() => null);
        if (tournamentByExternal) {
          const existingTeamCount = teamCount(tournamentByExternal.teams);
          const existingGameCount = teamCount(tournamentByExternal.games);
          if ((shouldForceLiveRefresh || shouldRefreshImportedSnapshot(existingTeamCount) || existingGameCount === 0) && allowBlockingRefresh) {
            const refreshedHydrated = await refreshFromLive(tournamentByExternal.name || preferredTournamentName);
            if (refreshedHydrated) {
              return NextResponse.json({
                ok: true,
                tournament: refreshedHydrated,
                source: `${liveRefreshSourcePrefix}_live_refresh_by_external_id`
              });
            }
          }
          return NextResponse.json({
            ok: true,
            tournament: tournamentByExternal,
            source: "imported_dataset_by_external_id"
          });
        }
      }

      if (hasSupabaseConfig && tournamentId) {
        const tournamentById = await getHarvestedTournament(session.orgId, tournamentId);
        if (tournamentById) {
          const existingTeamCount = teamCount(tournamentById.teams);
          const existingGameCount = teamCount(tournamentById.games);
          if ((shouldForceLiveRefresh || shouldRefreshImportedSnapshot(existingTeamCount) || existingGameCount === 0) && allowBlockingRefresh) {
            const refreshedHydrated = await refreshFromLive(tournamentById.name || preferredTournamentName);
            if (refreshedHydrated) {
              return NextResponse.json({
                ok: true,
                tournament: refreshedHydrated,
                source: `${liveRefreshSourcePrefix}_live_refresh_by_id`
              });
            }
          }
          return NextResponse.json({
            ok: true,
            tournament: tournamentById,
            source: "imported_dataset"
          });
        }
      }

      if (hasSupabaseConfig) {
        const all = await listHarvestedTournaments(session.orgId, company).catch(() => []);
        const wantedList = [
          ...extractHintCandidates(tournamentHint),
          selected?.name || "",
          seedMeta?.name || "",
          inventorySlug
        ]
          .map(normalize)
          .filter(Boolean);
        const found = wantedList
          .map((wanted) =>
            all.find((t) => normalize(t.name) === wanted)
            || (company === "PBR"
              ? all.find((t) => normalize(t.name).includes(wanted))
                || all.find((t) => wanted.includes(normalize(t.name)))
              : null)
          )
          .find((item) => Boolean(item));

        if (found) {
          const hydrated = await getHarvestedTournament(session.orgId, found.id).catch(() => null);
          const existingTournament = hydrated || found;
          const existingTeamCount = teamCount(existingTournament?.teams);
          const existingGameCount = teamCount(existingTournament?.games);
          if ((shouldForceLiveRefresh || shouldRefreshImportedSnapshot(existingTeamCount) || existingGameCount === 0) && allowBlockingRefresh) {
            const refreshedHydrated = await refreshFromLive(found.name || preferredTournamentName);
            if (refreshedHydrated) {
              return NextResponse.json({
                ok: true,
                tournament: refreshedHydrated,
                source: `${liveRefreshSourcePrefix}_live_refresh_by_name`
              });
            }
          }
          return NextResponse.json({
            ok: true,
            tournament: existingTournament,
            source: "imported_dataset"
          });
        }
      }

      if (company === "PBR") {
        const livePbrRaw = await buildPbrLiveTournament({
          inventorySlug,
          tournamentHint,
          preferredName: selected?.name || seedMeta?.name || ""
        }).catch(() => null);
        const livePbr = livePbrRaw
          ? canonicalizeTournamentForInventory({
            tournament: livePbrRaw,
            inventorySlug,
            preferredName: selected?.name || seedMeta?.name || ""
          })
          : null;
        if (livePbr) {
          if (hasSupabaseConfig) {
            try {
              const dbId = await upsertHarvestedTournament({
                orgId: session.orgId,
                company,
                tournament: livePbr
              });
              const hydrated = await getHarvestedTournament(session.orgId, dbId).catch(() => null);
              return NextResponse.json({
                ok: true,
                tournament: hydrated || livePbr,
                source: "pbr_live_open"
              });
            } catch {
              // Continue with in-memory live payload.
            }
          }
          return NextResponse.json({
            ok: true,
            tournament: livePbr,
            source: "pbr_live_open"
          });
        }
      }

      // Archive/free tournaments must still be openable even when imported data is missing.
      if (company === "PG" && isArchive) {
        const scrapeHint = tournamentHint || inventoryHarvestHint({
          slug: inventorySlug,
          name: selected?.name || seedMeta?.name || "Perfect Game Tournament",
          company
        });
        try {
          const scrapedRaw = await scrapePgTournamentLive(scrapeHint);
          const scrapedTournament = canonicalizeTournamentForInventory({
            tournament: scrapedRaw,
            inventorySlug,
            preferredName: selected?.name || seedMeta?.name || ""
          });
          try {
            const dbId = await upsertHarvestedTournament({
              orgId: session.orgId,
              company,
              tournament: scrapedTournament
            });
            const hydrated = await getHarvestedTournament(session.orgId, dbId);
            return NextResponse.json({
              ok: true,
              tournament: hydrated || scrapedTournament,
              source: "archive_live_fallback"
            });
          } catch {
            return NextResponse.json({
              ok: true,
              tournament: scrapedTournament,
              source: "archive_live_fallback"
            });
          }
        } catch {
          // If live scrape fails, continue to 409 response below.
        }
      }

      if (!hasSupabaseConfig && company === "PG") {
        const scrapeHint = tournamentHint || inventoryHarvestHint({
          slug: inventorySlug,
          name: selected?.name || seedMeta?.name || "Perfect Game Tournament",
          company
        });
        try {
          const scrapedRaw = await scrapePgTournamentLive(scrapeHint);
          const scrapedTournament = canonicalizeTournamentForInventory({
            tournament: scrapedRaw,
            inventorySlug,
            preferredName: selected?.name || seedMeta?.name || ""
          });
          return NextResponse.json({
            ok: true,
            tournament: scrapedTournament,
            source: "pg_live_emergency_fallback"
          });
        } catch {
          // Continue to config error below if live fallback fails.
        }
      }

      if (!hasSupabaseConfig) {
        return NextResponse.json({
          error: "Tournament data source is not configured.",
          detail: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
        }, { status: 503 });
      }

      return NextResponse.json({
        error: "Tournament not available in imported dataset yet.",
        detail: "Live scrape is disabled for this source right now. Queue an ingest job and retry after sync completes.",
        source: "imported_only_mode"
      }, { status: 409 });
    }

    if (company !== "PG") {
      const livePbrRaw = await buildPbrLiveTournament({
        inventorySlug,
        tournamentHint,
        preferredName: selected?.name || seedMeta?.name || ""
      }).catch(() => null);
      const livePbr = livePbrRaw
        ? canonicalizeTournamentForInventory({
          tournament: livePbrRaw,
          inventorySlug,
          preferredName: selected?.name || seedMeta?.name || ""
        })
        : null;
      if (livePbr) {
        if (hasSupabaseConfig) {
          try {
            const dbId = await upsertHarvestedTournament({
              orgId: session.orgId,
              company,
              tournament: livePbr
            });
            const hydrated = await getHarvestedTournament(session.orgId, dbId).catch(() => null);
            return NextResponse.json({
              ok: true,
              tournament: hydrated || livePbr,
              source: "pbr_live_open"
            });
          } catch {
            // Continue with live payload below.
          }
        }
        return NextResponse.json({
          ok: true,
          tournament: livePbr,
          source: "pbr_live_open"
        });
      }
      return NextResponse.json({
        error: "Tournament requires ingest before opening.",
        detail: "Queue a harvest job for this source and retry after sync.",
        source: "queue_required_mode"
      }, { status: 409 });
    }

    const scrapedRaw = await scrapePgTournamentLive(pgLiveHint);
    const scrapedTournament = canonicalizeTournamentForInventory({
      tournament: scrapedRaw,
      inventorySlug,
      preferredName: selected?.name || seedMeta?.name || ""
    });
    if (!hasSupabaseConfig) {
      return NextResponse.json({
        ok: true,
        tournament: scrapedTournament,
        source: "pg_live_scrape_no_db"
      });
    }
    const dbId = await upsertHarvestedTournament({
      orgId: session.orgId,
      company,
      tournament: scrapedTournament
    });
    const hydrated = await getHarvestedTournament(session.orgId, dbId);

    return NextResponse.json({
      ok: true,
      tournament: hydrated || scrapedTournament,
      source: "pg_live_scrape"
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to open tournament", detail: String(error) }, { status: 500 });
  }
}
