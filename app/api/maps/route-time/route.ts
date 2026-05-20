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

function trafficAdvisory(delayMinutes: number) {
  if (!Number.isFinite(delayMinutes) || delayMinutes <= 0) {
    return "Live route ETA";
  }
  if (delayMinutes >= 20) return `Heavy traffic (+${delayMinutes} min vs free-flow)`;
  if (delayMinutes >= 8) return `Moderate traffic (+${delayMinutes} min vs free-flow)`;
  return `Light traffic (+${delayMinutes} min vs free-flow)`;
}

async function computeDriveRoute(input: {
  key: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  routingPreference: "TRAFFIC_AWARE_OPTIMAL" | "TRAFFIC_UNAWARE";
  departureIso?: string;
}) {
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": input.key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"
    },
    cache: "no-store",
    body: JSON.stringify({
      origin: {
        location: {
          latLng: {
            latitude: input.originLat,
            longitude: input.originLng
          }
        }
      },
      destination: {
        location: {
          latLng: {
            latitude: input.destLat,
            longitude: input.destLng
          }
        }
      },
      travelMode: "DRIVE",
      routingPreference: input.routingPreference,
      languageCode: "en-US",
      units: "IMPERIAL",
      ...(input.departureIso ? { departureTime: input.departureIso } : {})
    })
  });
  const data = await response.json().catch(() => ({}));
  const first = Array.isArray(data?.routes) ? data.routes[0] : null;
  const durationSeconds = parseDurationSeconds(String(first?.duration || ""));
  const distanceMeters = Number(first?.distanceMeters || NaN);
  return {
    durationSeconds,
    distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : NaN
  };
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
  const departAtRaw = String(req.nextUrl.searchParams.get("departAt") || "").trim();
  const departAtMs = Date.parse(departAtRaw);
  const departureIso = Number.isFinite(departAtMs) ? new Date(departAtMs).toISOString() : undefined;
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng) || !Number.isFinite(destLat) || !Number.isFinite(destLng)) {
    return NextResponse.json({ minutes: null, route: null });
  }

  const key = mapsApiKey();
  if (!key) {
    return NextResponse.json({ minutes: null, route: null, error: "Missing Google Maps API key" }, { status: 200 });
  }

  try {
    const trafficAware = await computeDriveRoute({
      key,
      originLat,
      originLng,
      destLat,
      destLng,
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      departureIso
    });
    if (!Number.isFinite(trafficAware.durationSeconds)) {
      return NextResponse.json({ minutes: null, route: null });
    }
    const trafficUnaware = await computeDriveRoute({
      key,
      originLat,
      originLng,
      destLat,
      destLng,
      routingPreference: "TRAFFIC_UNAWARE",
      departureIso
    }).catch(() => ({ durationSeconds: NaN, distanceMeters: NaN }));
    const delayMinutes = Number.isFinite(trafficUnaware.durationSeconds)
      ? Math.max(0, Math.round((trafficAware.durationSeconds - trafficUnaware.durationSeconds) / 60))
      : 0;
    const distanceMeters = Number.isFinite(trafficAware.distanceMeters)
      ? trafficAware.distanceMeters
      : trafficUnaware.distanceMeters;
    return NextResponse.json({
      mode: "Drive / Cab",
      minutes: Math.max(1, Math.round(trafficAware.durationSeconds / 60)),
      distanceKm: Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null,
      delayMinutes,
      advisory: trafficAdvisory(delayMinutes)
    });
  } catch (error) {
    return NextResponse.json({ minutes: null, route: null, error: String(error) }, { status: 200 });
  }
}
