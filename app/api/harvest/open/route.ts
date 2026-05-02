import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listCircuitInventory, listHarvestedTournaments, listOrgUnlocks, upsertHarvestedTournament } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { scrapePgTournamentLive } from "@/lib/birddog/pgScraper";
import { INVENTORY_SEED, inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { bestGroupedEventMatch, fetchPgGroupedEvents } from "@/lib/birddog/pgGroupedEvents";

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
  if (!previewUnlockAll && !isArchive && !unlocked.includes(inventorySlug)) {
    return NextResponse.json({ error: "Tournament is locked for your organization." }, { status: 402 });
  }

  try {
    const dataMode = (process.env.BIRD_DOG_DATA_MODE || "imported").toLowerCase();
    const allowLiveScrape = process.env.BIRD_DOG_ALLOW_PG_LIVE_SCRAPE === "true";

    if (dataMode !== "live" || !allowLiveScrape) {
      if (hasSupabaseConfig && tournamentId) {
        const tournamentById = await getHarvestedTournament(session.orgId, tournamentId);
        if (tournamentById) {
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
          return NextResponse.json({
            ok: true,
            tournament: hydrated || found,
            source: "imported_dataset"
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
        detail: "Live PG scraping is disabled. Import this tournament into Supabase first.",
        source: "imported_only_mode"
      }, { status: 409 });
    }

    if (company !== "PG") {
      return NextResponse.json({ error: "Live open is currently enabled for PG tournaments only." }, { status: 400 });
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
