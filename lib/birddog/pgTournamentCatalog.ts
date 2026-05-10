import { DataProvider } from "@/lib/birddog/types";
import { CircuitSeason } from "@/lib/birddog/inventoryCatalog";

const PG_BASE_URL = "https://www.perfectgame.org";
const PG_SCHEDULE_URL = `${PG_BASE_URL}/Schedule/Default.aspx`;
const PG_ROOT_GROUP_URL = `${PG_BASE_URL}/Schedule/FeaturedGroups.aspx?PrtID=333`;

const CACHE_TTL_MS = 60 * 1000;
const DISCOVERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12 * 1000;
const MAX_FID_PAGES = 120;
const MAX_PRT_PAGES = 32;
const MAX_DISCOVERY_CONCURRENCY = 4;
const MAX_FEATURED_CONCURRENCY = 8;
const MAX_CATALOG_ITEMS = 500;

export type PgCatalogItem = {
  slug: string;
  name: string;
  season: CircuitSeason;
  company: DataProvider;
  displayDate: string;
  displayCity: string;
  displayTeams: string;
  harvestHint: string;
};

type DateRange = {
  start: string;
  end?: string;
};

type RowFields = Record<string, string>;

type PgCatalogCache = {
  fetchedAt: number;
  items: PgCatalogItem[];
  discoveryFetchedAt: number;
  featuredIds: number[];
  inFlight: Promise<PgCatalogItem[]> | null;
};

function getCacheRef() {
  const g = globalThis as unknown as { __BIRD_DOG_PG_CATALOG_CACHE__?: PgCatalogCache };
  if (!g.__BIRD_DOG_PG_CATALOG_CACHE__) {
    g.__BIRD_DOG_PG_CATALOG_CACHE__ = {
      fetchedAt: 0,
      items: [],
      discoveryFetchedAt: 0,
      featuredIds: [],
      inFlight: null
    };
  }
  return g.__BIRD_DOG_PG_CATALOG_CACHE__;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/");
}

function normalizeSpace(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);
}

function isTrue(value: string) {
  return /^(true|1|yes)$/i.test(normalizeSpace(value));
}

function monthFromLabel(label: string) {
  const key = normalizeSpace(label).slice(0, 3).toLowerCase();
  const map: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  };
  return map[key] || 0;
}

function toIsoDate(year: number, month: number, day: number) {
  if (!year || !month || !day) return "";
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return "";
  }
  const m = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${m}-${dd}`;
}

function inferYear(blockMonth: string) {
  const block = normalizeSpace(blockMonth);
  const year = Number(block.match(/\b(20\d{2})\b/)?.[1] || "");
  if (year) return year;
  return new Date().getUTCFullYear();
}

function parseDateRange(rawDate: string, blockMonth: string): DateRange | null {
  const cleaned = normalizeSpace(rawDate.replace(/,/g, " "));
  if (!cleaned) return null;

  const baseYear = inferYear(blockMonth);
  const crossMonth = cleaned.match(
    /^([A-Za-z]{3,9})\s+(\d{1,2})\s*-\s*([A-Za-z]{3,9})\s*(\d{1,2})$/
  );
  if (crossMonth) {
    const startMonth = monthFromLabel(crossMonth[1]);
    const startDay = Number(crossMonth[2]);
    const endMonth = monthFromLabel(crossMonth[3]);
    const endDay = Number(crossMonth[4]);
    const endYear = endMonth && startMonth && endMonth < startMonth ? baseYear + 1 : baseYear;
    const start = toIsoDate(baseYear, startMonth, startDay);
    const end = toIsoDate(endYear, endMonth, endDay);
    if (start) {
      return { start, end: end || undefined };
    }
  }

  const sameMonth = cleaned.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/);
  if (sameMonth) {
    const month = monthFromLabel(sameMonth[1]);
    const startDay = Number(sameMonth[2]);
    const endDay = Number(sameMonth[3] || sameMonth[2]);
    const start = toIsoDate(baseYear, month, startDay);
    const end = toIsoDate(baseYear, month, endDay);
    if (start) {
      return { start, end: end && end !== start ? end : undefined };
    }
  }

  return null;
}

function inferSeason(isoDate: string): CircuitSeason {
  const month = Number(isoDate.slice(5, 7));
  if (Number.isFinite(month) && month >= 9 && month <= 12) return "fall";
  return "summer";
}

function parseNumberSet(html: string, pattern: RegExp) {
  const set = new Set<number>();
  let match = pattern.exec(html);
  while (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      set.add(value);
    }
    match = pattern.exec(html);
  }
  return set;
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`PG returned ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const size = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  }

  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}

async function discoverFeaturedIds(forceRefresh = false) {
  const cache = getCacheRef();
  const now = Date.now();
  if (!forceRefresh && cache.featuredIds.length && now - cache.discoveryFetchedAt < DISCOVERY_CACHE_TTL_MS) {
    return cache.featuredIds;
  }

  const featuredSet = new Set<number>();
  const groupSet = new Set<number>([333]);

  const [scheduleHtml, rootGroupHtml] = await Promise.all([
    fetchHtml(PG_SCHEDULE_URL).catch(() => ""),
    fetchHtml(PG_ROOT_GROUP_URL).catch(() => "")
  ]);

  [scheduleHtml, rootGroupHtml].forEach((html) => {
    if (!html) return;
    parseNumberSet(html, /FeaturedEvents\.aspx\?fid=(\d+)/gi).forEach((id) => featuredSet.add(id));
    parseNumberSet(html, /FeaturedGroups\.aspx\?PrtID=(\d+)/gi).forEach((id) => groupSet.add(id));
  });

  let frontier = Array.from(groupSet).slice(0, MAX_PRT_PAGES);
  const visited = new Set<number>();
  let depth = 0;

  while (frontier.length && depth < 2) {
    const pages = await mapWithConcurrency(frontier, MAX_DISCOVERY_CONCURRENCY, async (prtid) => {
      visited.add(prtid);
      try {
        return await fetchHtml(`${PG_BASE_URL}/Schedule/FeaturedGroups.aspx?PrtID=${prtid}`);
      } catch {
        return "";
      }
    });

    const nextGroups = new Set<number>();
    pages.forEach((html) => {
      if (!html) return;
      parseNumberSet(html, /FeaturedEvents\.aspx\?fid=(\d+)/gi).forEach((id) => featuredSet.add(id));
      parseNumberSet(html, /FeaturedGroups\.aspx\?PrtID=(\d+)/gi).forEach((id) => {
        if (!visited.has(id)) nextGroups.add(id);
      });
    });

    frontier = Array.from(nextGroups).slice(0, MAX_PRT_PAGES);
    depth += 1;
  }

  const featuredIds = Array.from(featuredSet).sort((a, b) => a - b).slice(0, MAX_FID_PAGES);
  if (featuredIds.length) {
    cache.featuredIds = featuredIds;
    cache.discoveryFetchedAt = now;
  }
  return featuredIds;
}

function parseFeaturedEventRows(html: string) {
  const rows = new Map<string, RowFields>();
  const inputPattern =
    /<input[^>]*id="[^"]*repSchedule_(hl[A-Za-z]+|hf[A-Za-z]+)_([0-9]+)"[^>]*value="([^"]*)"[^>]*>/gi;

  let match = inputPattern.exec(html);
  while (match) {
    const field = match[1];
    const idx = match[2];
    const value = normalizeSpace(match[3] || "");
    const row = rows.get(idx) || {};
    row[field] = value;
    rows.set(idx, row);
    match = inputPattern.exec(html);
  }
  return Array.from(rows.values());
}

function parseFeaturedEvents(html: string): PgCatalogItem[] {
  const rows = parseFeaturedEventRows(html);
  if (!rows.length) return [];

  const map = new Map<string, PgCatalogItem>();

  rows.forEach((row) => {
    const grouped = isTrue(row.hlGrouped || "");
    const ended = grouped
      ? isTrue(row.hlGroupEnded || row.hlEventEnded || "")
      : isTrue(row.hlEventEnded || "");
    if (ended) return;

    const groupId = normalizeSpace(row.hlGroupID || "");
    const eventId = normalizeSpace(row.hlEventID || "");
    const name = normalizeSpace(
      grouped
        ? row.hlGroupName || row.hlEventName || ""
        : row.hlEventName || row.hlGroupName || ""
    );
    if (!name) return;

    const city = normalizeSpace(
      grouped
        ? row.hlGroupLocation || row.hlEventLocation || ""
        : row.hlEventLocation || row.hlGroupLocation || ""
    );
    const displayDate = normalizeSpace(
      grouped
        ? row.hlGroupDate || row.hlEventDate || row.hlBlockMonth || ""
        : row.hlEventDate || row.hlGroupDate || row.hlBlockMonth || ""
    );
    const parsedRange = parseDateRange(displayDate, row.hlBlockMonth || "");
    const date = parsedRange?.start || new Date().toISOString().slice(0, 10);

    const teamsRaw = normalizeSpace(row.hlTotalTeams || "");
    const teamsValue = teamsRaw
      ? (/teams?/i.test(teamsRaw) ? teamsRaw : `${teamsRaw} TEAMS`)
      : "";

    const harvestHint = grouped && groupId
      ? `${PG_BASE_URL}/Schedule/GroupedEvents.aspx?gid=${groupId}`
      : eventId
        ? `${PG_BASE_URL}/Events/Default.aspx?event=${eventId}`
        : `${PG_BASE_URL}/search.aspx?search=${encodeURIComponent(name)}`;

    const slugBase = grouped && groupId
      ? `pg-live-${groupId}-${slugify(name)}`
      : eventId
        ? `pg-live-event-${eventId}-${slugify(name)}`
        : `pg-live-${slugify(name)}-${slugify(city || "city-tbd")}-${date}`;

    const item: PgCatalogItem = {
      slug: slugBase.slice(0, 240),
      name,
      season: inferSeason(date),
      company: "PG",
      displayDate,
      displayCity: city,
      displayTeams: teamsValue,
      harvestHint
    };

    const key = `${item.name.toLowerCase()}::${item.harvestHint.toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  });

  return Array.from(map.values());
}

function sortItems(items: PgCatalogItem[]) {
  return items.sort((a, b) => `${a.displayDate} ${a.name}`.localeCompare(`${b.displayDate} ${b.name}`));
}

async function fetchPgFromSource(forceDiscoveryRefresh = false) {
  const featuredIds = await discoverFeaturedIds(forceDiscoveryRefresh);
  if (!featuredIds.length) return [];

  const pages = await mapWithConcurrency(
    featuredIds,
    MAX_FEATURED_CONCURRENCY,
    async (fid) => {
      try {
        const html = await fetchHtml(`${PG_BASE_URL}/Schedule/FeaturedEvents.aspx?fid=${fid}`);
        return parseFeaturedEvents(html);
      } catch {
        return [];
      }
    }
  );

  const byHint = new Map<string, PgCatalogItem>();
  pages.flat().forEach((item) => {
    const key = item.harvestHint.toLowerCase();
    if (!byHint.has(key)) byHint.set(key, item);
  });

  return sortItems(Array.from(byHint.values())).slice(0, MAX_CATALOG_ITEMS);
}

export async function fetchPgTournamentCatalog(forceRefresh = false) {
  const cache = getCacheRef();
  const now = Date.now();
  const isFresh = now - cache.fetchedAt < CACHE_TTL_MS;

  if (!forceRefresh && isFresh && cache.items.length) {
    return { items: cache.items, source: "cache" as const };
  }

  if (cache.inFlight) {
    try {
      const items = await cache.inFlight;
      return { items, source: "cache" as const };
    } catch {
      if (cache.items.length) {
        return { items: cache.items, source: "stale_cache" as const };
      }
    }
  }

  const task = fetchPgFromSource(forceRefresh);
  cache.inFlight = task;

  try {
    const items = await task;
    if (items.length) {
      cache.items = items;
      cache.fetchedAt = Date.now();
      return { items, source: "live" as const };
    }
  } catch {
    // Preserve stale cache on parser/network errors.
  } finally {
    cache.inFlight = null;
  }

  if (cache.items.length) {
    return { items: cache.items, source: "stale_cache" as const };
  }

  throw new Error("Could not fetch live PG tournament catalog.");
}
