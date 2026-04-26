import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listCircuitInventory, listHarvestedTournaments, listOrgUnlocks, upsertHarvestedTournament } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { scrapePgTournamentLive } from "@/lib/birddog/pgScraper";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const [unlocked, inventory] = await Promise.all([
    listOrgUnlocks(session.orgId).catch(() => [] as string[]),
    listCircuitInventory().catch(() => [] as Array<{ slug: string; name: string }>)
  ]);
  const selected = inventory.find((item) => item.slug === inventorySlug);
  const seedMeta = INVENTORY_SEED.find((item) => item.slug === inventorySlug);
  const isArchive = isFreeTournamentAccess({
    slug: inventorySlug,
    name: selected?.name || seedMeta?.name || tournamentHint || inventorySlug,
    displayDate: seedMeta?.displayDate || ""
  });
  if (!previewUnlockAll && !isArchive && !unlocked.includes(inventorySlug)) {
    return NextResponse.json({ error: "Tournament is locked for your organization." }, { status: 402 });
  }

  try {
    const dataMode = (process.env.BIRD_DOG_DATA_MODE || "imported").toLowerCase();
    const allowLiveScrape = process.env.BIRD_DOG_ALLOW_PG_LIVE_SCRAPE === "true";

    if (dataMode !== "live" || !allowLiveScrape) {
      if (tournamentId) {
        const tournamentById = await getHarvestedTournament(session.orgId, tournamentId);
        if (tournamentById) {
          return NextResponse.json({
            ok: true,
            tournament: tournamentById,
            source: "imported_dataset"
          });
        }
      }

      const all = await listHarvestedTournaments(session.orgId, company);
      const wantedList = extractHintCandidates(tournamentHint).map(normalize).filter(Boolean);
      const found = wantedList
        .map((wanted) =>
          all.find((t) => normalize(t.name) === wanted)
          || all.find((t) => normalize(t.name).includes(wanted))
          || all.find((t) => wanted.includes(normalize(t.name)))
        )
        .find((item) => Boolean(item));

      if (found) {
        const hydrated = await getHarvestedTournament(session.orgId, found.id);
        return NextResponse.json({
          ok: true,
          tournament: hydrated || found,
          source: "imported_dataset"
        });
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
