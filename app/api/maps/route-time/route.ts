import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

function mapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
}

function parseDurationSeconds(raw: string) {
  const match = String(raw || "").trim().match(/^([\d.]+)s$/);
  if (!match) return NaN;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : NaN;
}

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const originLat = Number(req.nextUrl.searchParams.get("originLat") || "");
  const originLng = Number(req.nextUrl.searchParams.get("originLng") || "");
  const destLat = Number(req.nextUrl.searchParams.get("destLat") || "");
  const destLng = Number(req.nextUrl.searchParams.get("destLng") || "");
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng) || !Number.isFinite(destLat) || !Number.isFinite(destLng)) {
    return NextResponse.json({ minutes: null, route: null });
  }

  const key = mapsApiKey();
  if (!key) {
    return NextResponse.json({ minutes: null, route: null, error: "Missing Google Maps API key" }, { status: 200 });
  }

  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"
      },
      cache: "no-store",
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: originLat,
              longitude: originLng
            }
          }
        },
        destination: {
          location: {
            latLng: {
              latitude: destLat,
              longitude: destLng
            }
          }
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        languageCode: "en-US",
        units: "IMPERIAL"
      })
    });
    const data = await response.json().catch(() => ({}));
    const first = Array.isArray(data?.routes) ? data.routes[0] : null;
    const durationSeconds = parseDurationSeconds(String(first?.duration || ""));
    if (!Number.isFinite(durationSeconds)) {
      return NextResponse.json({ minutes: null, route: null });
    }
    const distanceMeters = Number(first?.distanceMeters || NaN);
    return NextResponse.json({
      mode: "Drive / Cab",
      minutes: Math.max(1, Math.round(durationSeconds / 60)),
      distanceKm: Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null,
      advisory: "Live route ETA"
    });
  } catch (error) {
    return NextResponse.json({ minutes: null, route: null, error: String(error) }, { status: 200 });
  }
}
