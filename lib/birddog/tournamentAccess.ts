const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

const DEMO_FREE_TOURNAMENT_SLUGS = new Set([
  "2025-pg-16u-wwba-national-championship"
]);

function monthToIndex(token: string) {
  return MONTH_INDEX[token.trim().slice(0, 3).toLowerCase()] ?? null;
}

function extractYear(name: string) {
  const match = name.match(/\b(20\d{2})\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseEndDateFromLabel(label: string, year: number) {
  const cleaned = label
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  const range = cleaned.match(/^([A-Za-z]+)\s*(\d{1,2})\s*-\s*([A-Za-z]+)?\s*(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (range) {
    const endMonthToken = range[3] || range[1];
    const endDay = Number.parseInt(range[4], 10);
    const explicitYear = range[5] ? Number.parseInt(range[5], 10) : year;
    const endMonth = monthToIndex(endMonthToken);
    if (endMonth === null || !Number.isFinite(endDay)) return null;
    return new Date(Date.UTC(explicitYear, endMonth, endDay, 23, 59, 59, 999));
  }

  const single = cleaned.match(/^([A-Za-z]+)\s*(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (single) {
    const explicitYear = single[3] ? Number.parseInt(single[3], 10) : year;
    const endMonth = monthToIndex(single[1]);
    const endDay = Number.parseInt(single[2], 10);
    if (endMonth === null || !Number.isFinite(endDay)) return null;
    return new Date(Date.UTC(explicitYear, endMonth, endDay, 23, 59, 59, 999));
  }

  // For explicit date strings that include a 4-digit year, let Date.parse handle it.
  if (/\b20\d{2}\b/.test(cleaned)) {
    const parsedIso = Date.parse(cleaned);
    if (Number.isFinite(parsedIso)) return new Date(parsedIso);
  }

  return null;
}

export function isPastTournament(input: { name: string; displayDate?: string; now?: Date }) {
  const now = input.now || new Date();
  const currentYear = now.getUTCFullYear();
  const namedYear = extractYear(input.name);

  if (namedYear && namedYear < currentYear) return true;

  if (input.displayDate) {
    const effectiveYear = namedYear || currentYear;
    const endDate = parseEndDateFromLabel(input.displayDate, effectiveYear);
    if (endDate) {
      return endDate.getTime() < now.getTime();
    }
  }

  return false;
}

export function isDemoFreeTournament(slug?: string) {
  if (!slug) return false;
  return DEMO_FREE_TOURNAMENT_SLUGS.has(slug.trim().toLowerCase());
}

export function isFreeTournamentAccess(input: {
  slug?: string;
  name: string;
  displayDate?: string;
  now?: Date;
}) {
  const slug = String(input.slug || "").trim().toLowerCase();
  if (slug.startsWith("pg-live-") || slug.startsWith("pbr-live-")) return true;
  if (isDemoFreeTournament(input.slug)) return true;
  return isPastTournament({ name: input.name, displayDate: input.displayDate, now: input.now });
}
