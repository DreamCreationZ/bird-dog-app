import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listCircuitInventory, listHarvestedTournaments, listOrgUnlocks, upsertHarvestedTournament } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { scrapePgTournamentLive } from "@/lib/birddog/pgScraper";
import { INVENTORY_SEED, inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { bestGroupedEventMatch, fetchPgGroupedEvents } from "@/lib/birddog/pgGroupedEvents";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";

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
        const tournamentById = await getHarvestedTournament(session.orgId, tournamentId, company);
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
              const refreshedHydrated = await getHarvestedTournament(session.orgId, dbId, company).catch(() => null);
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
          const hydrated = await getHarvestedTournament(session.orgId, found.id, company).catch(() => null);
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
              const refreshedHydrated = await getHarvestedTournament(session.orgId, dbId, company).catch(() => null);
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
            const hydrated = await getHarvestedTournament(session.orgId, dbId, company);
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
    const hydrated = await getHarvestedTournament(session.orgId, dbId, company);

    return NextResponse.json({
      ok: true,
      tournament: hydrated || scrapedTournament,
      source: "pg_live_scrape"
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to open tournament", detail: String(error) }, { status: 500 });
  }
}
