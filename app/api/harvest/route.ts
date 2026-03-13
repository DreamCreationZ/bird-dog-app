import { NextRequest, NextResponse } from "next/server";
import { getHarvestedTournament, listHarvestCompanies, listHarvestedTournaments } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const company = req.nextUrl.searchParams.get("company") as "PG" | "PBR" | null;
  const tournamentId = req.nextUrl.searchParams.get("tournamentId");

  if (!company) {
    const dbCompanies = await listHarvestCompanies(session.orgId).catch(() => []);
    const companies = dbCompanies.length ? dbCompanies : ["PG", "PBR"];

    return NextResponse.json({
      companies,
      note: "Queue a scrape job to ingest live PG/PBR data. Mock data appears only when DB is empty.",
      queueEndpoint: "/api/harvest/jobs"
    });
  }

  if (tournamentId) {
    const tournament = await getHarvestedTournament(session.orgId, tournamentId);
    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }
    return NextResponse.json({
      tournament,
      source: "supabase_harvested",
      fetchedAt: new Date().toISOString()
    });
  }

  const harvestedTournaments = await listHarvestedTournaments(session.orgId, company).catch(() => []);
  if (harvestedTournaments.length) {
    return NextResponse.json({
      dataset: {
        company,
        tournaments: harvestedTournaments
      },
      antiBlock: {
        strategy: "residential_proxy_rotation",
        status: "worker_enabled"
      },
      source: "supabase_harvested",
      fetchedAt: new Date().toISOString()
    });
  }

  return NextResponse.json({
    dataset: { company, tournaments: [] },
    antiBlock: {
      strategy: "residential_proxy_rotation",
      status: "queue_required"
    },
    source: "none",
    fetchedAt: new Date().toISOString()
  });
}
