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

  const lat = Number(req.nextUrl.searchParams.get("lat") || "");
  const lng = Number(req.nextUrl.searchParams.get("lng") || "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ location: null });
  }

  const key = mapsApiKey();
  if (!key) {
    return NextResponse.json({ location: null, error: "Missing Google Maps API key" }, { status: 200 });
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat},${lng}`);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    if (!first) return NextResponse.json({ location: null });
    return NextResponse.json({
      location: {
        lat,
        lng,
        label: String(first?.formatted_address || "Current location")
      }
    });
  } catch (error) {
    return NextResponse.json({ location: null, error: String(error) }, { status: 200 });
  }
}
