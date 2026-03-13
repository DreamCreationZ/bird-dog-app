type PgGroupedEvent = {
  name: string;
  dateLabel: string;
  city: string;
  teamsLabel: string;
};

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

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const genericTokens = new Set([
  "2025",
  "2026",
  "pg",
  "wwba",
  "national",
  "world",
  "championship",
  "championships"
]);

function tokenSet(value: string) {
  return new Set(normalizeName(value).split(" ").filter(Boolean));
}

function significantTokens(value: string) {
  const tokens = Array.from(tokenSet(value));
  return tokens.filter((t) => !genericTokens.has(t));
}

function similarity(a: string, b: string) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  ta.forEach((token) => {
    if (tb.has(token)) common += 1;
  });
  return common / Math.max(ta.size, tb.size);
}

export async function fetchPgGroupedEvents(gid = "23065"): Promise<PgGroupedEvent[]> {
  const url = `https://www.perfectgame.org/Schedule/GroupedEvents.aspx?gid=${gid}`;
  const response = await fetch(url, { cache: "no-store" });
  const html = await response.text();
  if (!response.ok) return [];

  const blocks = [...html.matchAll(/<div[^>]+class="pgds-EventCard[^"]*"[\s\S]*?<\/div>\s*<\/a>/gi)].map((m) => m[0]);
  const events: PgGroupedEvent[] = [];

  for (const block of blocks) {
    const date = cleanText((block.match(/id="[^"]*lblEventDate_[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""));
    const name = cleanText((block.match(/id="[^"]*lblEventName_[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""));
    const city = cleanText((block.match(/id="[^"]*lblCityState_[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""));
    const teams = cleanText((block.match(/id="[^"]*hlTeamsAttending_[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || ""));
    if (!name || !date) continue;
    events.push({
      name,
      dateLabel: date.replace(/\s*-\s*/g, "-"),
      city,
      teamsLabel: teams
    });
  }

  return events;
}

export function bestGroupedEventMatch(targetName: string, events: PgGroupedEvent[]) {
  const targetNorm = normalizeName(targetName);
  const targetSignificant = significantTokens(targetName);

  // Prefer exact/near-exact phrase containment first.
  const exactish = events.find((event) => {
    const eventNorm = normalizeName(event.name);
    return eventNorm.includes(targetNorm) || targetNorm.includes(eventNorm);
  });
  if (exactish) return exactish;

  // Then require all significant tokens to exist in the candidate name.
  const strictCandidates = events.filter((event) => {
    const eventTokens = tokenSet(event.name);
    if (!targetSignificant.length) return false;
    return targetSignificant.every((token) => eventTokens.has(token));
  });

  const pool = strictCandidates.length ? strictCandidates : events;
  let best: PgGroupedEvent | null = null;
  let score = 0;
  for (const event of pool) {
    const s = similarity(targetName, event.name);
    if (s > score) {
      score = s;
      best = event;
    }
  }
  if (strictCandidates.length && best) return best;
  if (score < 0.55) return null;
  return best;
}
