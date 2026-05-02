import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

function mapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
}

async function reverseViaOpenStreetMap(lat: number, lng: number) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "10");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "ApointScout/1.0"
    }
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const addr = data?.address || {};
  const city = String(addr.city || addr.town || addr.village || addr.county || "").trim();
  const state = String(addr.state || "").trim();
  const country = String(addr.country || "").trim();
  const label = [city, state, country].filter(Boolean).join(", ") || String(data?.display_name || "").trim();
  return label || null;
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

  try {
    const key = mapsApiKey();
    let label = "";

    if (key) {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", `${lat},${lng}`);
      url.searchParams.set("key", key);
      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const first = Array.isArray(data?.results) ? data.results[0] : null;
      label = String(first?.formatted_address || "").trim();
    }
    if (!label) {
      label = String((await reverseViaOpenStreetMap(lat, lng)) || "").trim();
    }
    if (!label) {
      label = "Current location";
    }
    return NextResponse.json({
      location: {
        lat,
        lng,
        label
      }
    });
  } catch (error) {
    return NextResponse.json({
      location: { lat, lng, label: "Current location" },
      error: String(error)
    }, { status: 200 });
  }
}
