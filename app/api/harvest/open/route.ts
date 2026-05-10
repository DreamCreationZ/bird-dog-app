import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listCircuitInventory, listHarvestedTournaments, listOrgUnlocks, upsertHarvestedTournament } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { scrapePgTournamentLive } from "@/lib/birddog/pgScraper";
import { INVENTORY_SEED, inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { bestGroupedEventMatch, fetchPgGroupedEvents } from "@/lib/birddog/pgGroupedEvents";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";
import { fetchPbrTournamentCatalog } from "@/lib/birddog/pbrTournamentCatalog";
import { Game, Tournament } from "@/lib/birddog/types";

type ParticipatingTeam = NonNullable<Tournament["teams"]>[number];

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
  const eventId = cleanText(html.match(/window\.EVENT_ID\s*=\s*["']?(\d+)["']?/i)?.[1] || "");
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
        const key = normalizeTeam(name);
        if (!key) return;
        const uuid = cleanText(String(row[`team_${suffix}_uuid`] || ""));
        const link = toAbsolutePbrUrl(String(row[`team_link_${suffix}`] || ""));
        const id = uuid || `pbr-team-${slugify(name)}`;
        if (!map.has(key)) {
          map.set(key, {
            id,
            name,
            from: "",
            record: "",
            href: link || undefined
          });
        } else if (link) {
          const existing = map.get(key)!;
          if (!existing.href) existing.href = link;
          if (!existing.id && id) existing.id = id;
        }
      };
      addTeam("1");
      addTeam("2");
    });
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function parsePbrTeamsFromTeamsHtml(html: string) {
  const out = new Map<string, ParticipatingTeam>();
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  for (const row of rows) {
    const link = row.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const name = cleanText(link[2] || "");
    if (!name || /team|register/i.test(name.toLowerCase())) continue;
    const key = normalizeTeam(name);
    if (!key) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cleanText(cell[1] || ""));
    const from = cells.find((cell) => /,\s*[A-Z]{2}\b/.test(cell)) || "";
    const record = cells.find((cell) => /^\d+\s*-\s*\d+(\s*-\s*\d+)?$/.test(cell)) || "";
    const href = toAbsolutePbrUrl(link[1] || "");
    const id = cleanText(href.match(/#([a-f0-9-]{8,})/i)?.[1] || "") || `pbr-team-${slugify(name)}`;
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

      if (!map.has(gameId)) {
        map.set(gameId, {
          id: gameId,
          field: location || "Field TBD",
          fieldLocation: { x: 0, y: 0 },
          startTime,
          homeTeam: homeTeam || "TBD",
          awayTeam: awayTeam || "TBD",
          players: [],
          gameNo: displayGameNo,
          timeLabel,
          dateLabel: dateRaw,
          dayLabel,
          ageDiv,
          homeScore,
          awayScore
        });
      }
    });
  });

  return Array.from(map.values()).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

async function resolvePbrTournamentHint(input: {
  inventorySlug: string;
  tournamentHint: string;
  preferredName: string;
}) {
  const direct = toPbrEventBase(input.tournamentHint) || toPbrEventBase(toAbsolutePbrUrl(input.tournamentHint));
  if (direct) return direct;

  const catalog = await fetchPbrTournamentCatalog().then((result) => result.items).catch(() => []);
  if (!catalog.length) return "";

  const bySlug = catalog.find((item) => item.slug === input.inventorySlug);
  if (bySlug?.harvestHint) return toPbrEventBase(bySlug.harvestHint) || bySlug.harvestHint;

  const wanted = normalize(input.preferredName || input.tournamentHint);
  if (!wanted) return "";

  const byName = catalog.find((item) => {
    const name = normalize(item.name);
    return name === wanted || name.includes(wanted) || wanted.includes(name);
  });
  if (!byName?.harvestHint) return "";
  return toPbrEventBase(byName.harvestHint) || byName.harvestHint;
}

async function buildPbrLiveTournament(input: {
  inventorySlug: string;
  tournamentHint: string;
  preferredName: string;
}) {
  const eventBase = await resolvePbrTournamentHint(input);
  if (!eventBase) return null;

  const scheduleAllUrl = `${eventBase}/schedule/all`;
  const scheduleRes = await fetch(scheduleAllUrl, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  }).catch(() => null);
  if (!scheduleRes || !scheduleRes.ok) return null;
  const scheduleHtml = await scheduleRes.text();
  const context = parsePbrScheduleContext(scheduleHtml, scheduleAllUrl);
  if (!context.eventId) return null;

  const payloads: Array<Record<string, unknown> | null> = [];
  const allPayload = await fetchPbrSchedulePayload({
    eventId: context.eventId,
    scheduleAjaxUrl: context.scheduleAjaxUrl,
    eventBase: context.eventBase,
    csrfToken: context.csrfToken,
    eventPriceId: "0",
    scheduleId: "0"
  });
  if (allPayload) payloads.push(allPayload);

  if (!payloads.length || parsePbrScheduleRows(payloads[0]).length === 0) {
    const divisionEntries = Object.entries(context.divisions)
      .filter(([key, division]) => key !== "0" && safeString(division?.event_price_id || key))
      .map(([key, division]) => ({
        eventPriceId: safeString(division?.event_price_id || key),
        scheduleId: safeString(division?.schedule_id || "")
      }))
      .filter((item) => item.eventPriceId && item.scheduleId);

    for (const division of divisionEntries) {
      const payload = await fetchPbrSchedulePayload({
        eventId: context.eventId,
        scheduleAjaxUrl: context.scheduleAjaxUrl,
        eventBase: context.eventBase,
        csrfToken: context.csrfToken,
        eventPriceId: division.eventPriceId,
        scheduleId: division.scheduleId
      });
      if (payload) payloads.push(payload);
    }
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

  const teamsFromHtml = teamsHtml ? parsePbrTeamsFromTeamsHtml(teamsHtml) : [];
  const teams = teamsFromHtml.length ? teamsFromHtml : parsePbrTeamsFromPayload(payloads);
  const games = parsePbrGamesFromPayload(payloads);

  if (!teams.length && !games.length) return null;

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

  const previewUnlockAll = process.env.BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";
  const isAdminUser = Boolean(session.isAdmin) || isPrivilegedAdminEmail(String(session.email || ""));
  const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const [unlocked, inventory] = await Promise.all([
    listOrgUnlocks(session.orgId).catch(() => [] as string[]),
    listCircuitInventory().catch(() => [] as Array<{ slug: string; name: string }>)
  ]);
  const selected = inventory.find((item) => item.slug === inventorySlug);
  const seedMeta = INVENTORY_SEED.find((item) => item.slug === inventorySlug);
  const groupedEvents = company === "PG"
    ? await fetchPgGroupedEvents("23065").catch(() => [])
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
    isFreeTournamentAccess({
      slug: inventorySlug,
      name,
      displayDate
    })
  );
  if (!previewUnlockAll && !isAdminUser && !isArchive && !unlocked.includes(inventorySlug)) {
    return NextResponse.json({ error: "Tournament is locked for your organization." }, { status: 402 });
  }

  try {
    const dataMode = (process.env.BIRD_DOG_DATA_MODE || "imported").toLowerCase();
    const allowLiveScrape = process.env.BIRD_DOG_ALLOW_PG_LIVE_SCRAPE === "true";

    if (dataMode !== "live" || !allowLiveScrape) {
      if (hasSupabaseConfig && tournamentId) {
        const tournamentById = await getHarvestedTournament(session.orgId, tournamentId);
        if (tournamentById) {
          const existingTeamCount = teamCount(tournamentById.teams);
          const looksIncompleteDataset = company === "PG" && existingTeamCount === 0;
          const looksTruncatedArchive = company === "PG" && isArchive && existingTeamCount > 0 && existingTeamCount <= 120;
          if (looksTruncatedArchive || looksIncompleteDataset) {
            const scrapeHint = tournamentHint || inventoryHarvestHint({
              slug: inventorySlug,
              name: selected?.name || seedMeta?.name || tournamentById.name || "Perfect Game Tournament",
              company
            });
            try {
              const refreshedTournament = await scrapePgTournamentLive(scrapeHint);
              const dbId = await upsertHarvestedTournament({
                orgId: session.orgId,
                company,
                tournament: refreshedTournament
              });
              const refreshedHydrated = await getHarvestedTournament(session.orgId, dbId).catch(() => null);
              return NextResponse.json({
                ok: true,
                tournament: refreshedHydrated || refreshedTournament,
                source: "archive_live_refresh_by_id"
              });
            } catch {
              // If refresh fails, continue with existing imported dataset.
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
            || all.find((t) => normalize(t.name).includes(wanted))
            || all.find((t) => wanted.includes(normalize(t.name)))
          )
          .find((item) => Boolean(item));

        if (found) {
          const hydrated = await getHarvestedTournament(session.orgId, found.id).catch(() => null);
          const existingTournament = hydrated || found;
          const existingTeamCount = teamCount(existingTournament?.teams);
          const looksIncompleteDataset = company === "PG" && existingTeamCount === 0;
          const looksTruncatedArchive = company === "PG" && isArchive && existingTeamCount > 0 && existingTeamCount <= 120;
          if (looksTruncatedArchive || looksIncompleteDataset) {
            const scrapeHint = tournamentHint || inventoryHarvestHint({
              slug: inventorySlug,
              name: selected?.name || seedMeta?.name || found.name || "Perfect Game Tournament",
              company
            });
            try {
              const refreshedTournament = await scrapePgTournamentLive(scrapeHint);
              const dbId = await upsertHarvestedTournament({
                orgId: session.orgId,
                company,
                tournament: refreshedTournament
              });
              const refreshedHydrated = await getHarvestedTournament(session.orgId, dbId).catch(() => null);
              return NextResponse.json({
                ok: true,
                tournament: refreshedHydrated || refreshedTournament,
                source: "archive_live_refresh"
              });
            } catch {
              // If refresh fails, continue with existing imported dataset.
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
        const livePbr = await buildPbrLiveTournament({
          inventorySlug,
          tournamentHint,
          preferredName: selected?.name || seedMeta?.name || ""
        }).catch(() => null);
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
          const scrapedTournament = await scrapePgTournamentLive(scrapeHint);
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
          const scrapedTournament = await scrapePgTournamentLive(scrapeHint);
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
      const livePbr = await buildPbrLiveTournament({
        inventorySlug,
        tournamentHint,
        preferredName: selected?.name || seedMeta?.name || ""
      }).catch(() => null);
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

    const scrapedTournament = await scrapePgTournamentLive(tournamentHint);
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
