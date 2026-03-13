import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

function mapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
}

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const address = req.nextUrl.searchParams.get("address")?.trim() || "";
  if (!address) {
    return NextResponse.json({ location: null });
  }

  const key = mapsApiKey();
  if (!key) {
    return NextResponse.json({ location: null, error: "Missing Google Maps API key" }, { status: 200 });
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    const lat = first?.geometry?.location?.lat;
    const lng = first?.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ location: null });
    }
    return NextResponse.json({
      location: {
        lat,
        lng,
        label: first?.formatted_address || address
      }
    });
  } catch (error) {
    return NextResponse.json({ location: null, error: String(error) }, { status: 200 });
  }
}
