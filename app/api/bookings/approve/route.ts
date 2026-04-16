import { NextRequest, NextResponse } from "next/server";
import { executeTravelBookings } from "@/lib/birddog/bookingEngine";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

function parseLegs(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        at: String(row?.at || ""),
        from: String(row?.from || ""),
        to: String(row?.to || ""),
        mode: String(row?.mode || "")
      };
    })
    .filter((row) => row.from && row.to && row.mode);
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const travelLegs = parseLegs(body?.travelLegs);
  if (!travelLegs.length) {
    return NextResponse.json({ error: "No valid travel legs found." }, { status: 400 });
  }

  const traveler = {
    firstName: String(body?.traveler?.firstName || ""),
    lastName: String(body?.traveler?.lastName || ""),
    dateOfBirth: String(body?.traveler?.dateOfBirth || ""),
    gender: String(body?.traveler?.gender || "UNSPECIFIED").toUpperCase() as "MALE" | "FEMALE" | "UNSPECIFIED",
    email: String(body?.traveler?.email || session.email || ""),
    phone: String(body?.traveler?.phone || ""),
    countryCallingCode: String(body?.traveler?.countryCallingCode || "1"),
    nationality: String(body?.traveler?.nationality || "US").toUpperCase()
  };

  try {
    const results = await executeTravelBookings({
      travelLegs,
      traveler,
      teamName: String(body?.teamName || ""),
      tournamentName: String(body?.tournamentName || "")
    });
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to execute OTA bookings.",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
