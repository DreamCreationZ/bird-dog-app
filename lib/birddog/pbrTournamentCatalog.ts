import { DataProvider } from "@/lib/birddog/types";
import { CircuitSeason } from "@/lib/birddog/inventoryCatalog";

const PBR_LIST_URL = "https://tournaments.prepbaseballreport.com";
const CACHE_TTL_MS = 2 * 60 * 1000;

export type PbrCatalogItem = {
  slug: string;
  name: string;
  season: CircuitSeason;
  company: DataProvider;
  displayDate: string;
  displayCity: string;
  displayTeams: string;
  harvestHint: string;
};

type PbrCatalogCache = {
  fetchedAt: number;
  items: PbrCatalogItem[];
};

function getGlobalCache() {
  const g = globalThis as unknown as { __BIRD_DOG_PBR_CATALOG_CACHE__?: PbrCatalogCache };
  if (!g.__BIRD_DOG_PBR_CATALOG_CACHE__) {
    g.__BIRD_DOG_PBR_CATALOG_CACHE__ = { fetchedAt: 0, items: [] };
  }
  return g;
}

function normalizeSpace(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);
}

function parseUsDate(raw: string) {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !day || !year) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function monthShort(date: Date) {
  return date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
}

function formatDateRange(startRaw: string, endRaw: string) {
  const start = parseUsDate(startRaw);
  const end = parseUsDate(endRaw);
  if (!start) return "";
  if (!end) {
    return `${monthShort(start)} ${start.getUTCDate()}, ${start.getUTCFullYear()}`;
  }
  if (
    start.getUTCFullYear() === end.getUTCFullYear()
    && start.getUTCMonth() === end.getUTCMonth()
  ) {
    return `${monthShort(start)} ${start.getUTCDate()}-${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  }
  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${monthShort(start)} ${start.getUTCDate()} - ${monthShort(end)} ${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  }
  return `${monthShort(start)} ${start.getUTCDate()}, ${start.getUTCFullYear()} - ${monthShort(end)} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}

function toIsoDate(raw: string) {
  const parsed = parseUsDate(raw);
  if (!parsed) return "";
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferSeason(startRaw: string): CircuitSeason {
  const parsed = parseUsDate(startRaw);
  if (!parsed) return "summer";
  const month = parsed.getUTCMonth() + 1;
  return month >= 9 && month <= 12 ? "fall" : "summer";
}

function toAbsoluteUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${PBR_LIST_URL}${value}`;
  return `${PBR_LIST_URL}/${value}`;
}

function parseCatalogFromHtml(html: string): PbrCatalogItem[] {
  const rows: PbrCatalogItem[] = [];
  const seen = new Set<string>();
  const pattern =
    /<meta itemprop="name" content="([^"]*)">[\s\S]*?<meta itemprop="startDate" content="([^"]*)">[\s\S]*?<meta itemprop="endDate" content="([^"]*)">[\s\S]*?<meta itemprop="addressLocality" content="([^"]*)">[\s\S]*?<meta itemprop="addressRegion" content="([^"]*)">([\s\S]{0,1500}?)<a href="([^"]*\/events\/[^"]*)"[^>]*>\s*SCHEDULES\s*<\/a>/gi;

  let match: RegExpExecArray | null = pattern.exec(html);
  while (match) {
    const name = normalizeSpace(match[1]);
    const startRaw = normalizeSpace(match[2]);
    const endRaw = normalizeSpace(match[3]);
    const city = normalizeSpace(match[4]);
    const state = normalizeSpace(match[5]);
    const fragment = match[6] || "";
    const eventUrl = toAbsoluteUrl(normalizeSpace(match[7]));

    if (!name || !eventUrl) {
      match = pattern.exec(html);
      continue;
    }

    const dateLabel = formatDateRange(startRaw, endRaw);
    const isoStart = toIsoDate(startRaw);
    const displayCity = [city, state].filter(Boolean).join(", ");
    const registered = fragment.match(/(\d+)\s+Registered/i)?.[1] || "";
    const displayTeams = registered ? `${registered} Registered` : "";

    const slug = `pbr-live-${slugify(name)}-${slugify(displayCity || "city-tbd")}-${isoStart || "undated"}`;
    if (!seen.has(slug)) {
      seen.add(slug);
      rows.push({
        slug,
        name,
        season: inferSeason(startRaw),
        company: "PBR",
        displayDate: dateLabel,
        displayCity,
        displayTeams,
        harvestHint: eventUrl
      });
    }

    match = pattern.exec(html);
  }

  return rows.sort((a, b) => `${a.displayDate} ${a.name}`.localeCompare(`${b.displayDate} ${b.name}`));
}

export async function fetchPbrTournamentCatalog(forceRefresh = false) {
  const g = getGlobalCache();
  const cache = g.__BIRD_DOG_PBR_CATALOG_CACHE__!;
  const fresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (!forceRefresh && fresh && cache.items.length) {
    return { items: cache.items, source: "cache" as const };
  }

  const res = await fetch(PBR_LIST_URL, {
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!res.ok) {
    if (cache.items.length) {
      return { items: cache.items, source: "stale_cache" as const };
    }
    throw new Error(`PBR catalog returned ${res.status}`);
  }

  const html = await res.text();
  const items = parseCatalogFromHtml(html);
  if (!items.length) {
    if (cache.items.length) {
      return { items: cache.items, source: "stale_cache" as const };
    }
    throw new Error("No PBR tournaments parsed from source HTML");
  }

  g.__BIRD_DOG_PBR_CATALOG_CACHE__ = {
    fetchedAt: Date.now(),
    items
  };

  return { items, source: "live" as const };
}
