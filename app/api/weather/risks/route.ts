import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

type RiskRequestItem = {
  id: string;
  location: string;
  at: string;
};

type GeoPoint = {
  lat: number;
  lng: number;
  label: string;
};

function normalizeLocation(input: string) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  const split = trimmed.split("@");
  const tail = split[split.length - 1] || trimmed;
  return tail.replace(/\s+/g, " ").trim();
}

function parseRiskItems(input: unknown): RiskRequestItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, idx) => {
      const row = item as Record<string, unknown>;
      return {
        id: String(row?.id || `item-${idx + 1}`),
        location: normalizeLocation(String(row?.location || "")),
        at: String(row?.at || "")
      };
    })
    .filter((row) => row.location && row.at);
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function geocode(location: string): Promise<GeoPoint | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const response = await fetch(url.toString(), { cache: "no-store" });
  const parsed = await readJson(response) as {
    results?: Array<{ latitude?: number; longitude?: number; name?: string; admin1?: string; country_code?: string }>;
  } | null;
  if (!response.ok) return null;
  const first = parsed?.results?.[0];
  if (typeof first?.latitude !== "number" || typeof first?.longitude !== "number") return null;
  const pieces = [first.name, first.admin1, first.country_code].filter(Boolean);
  return {
    lat: first.latitude,
    lng: first.longitude,
    label: pieces.join(", ") || location
  };
}

function nearestIndex(targetIso: string, times: string[]) {
  const targetMs = new Date(targetIso).getTime();
  if (!Number.isFinite(targetMs) || !times.length) return -1;
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const ts = new Date(times[i]).getTime();
    if (!Number.isFinite(ts)) continue;
    const delta = Math.abs(ts - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

function severityFromWeather(code: number, precipProb: number) {
  const severeCodes = new Set([65, 67, 75, 82, 86, 95, 96, 99]);
  if (severeCodes.has(code) || precipProb >= 70) return "high";
  if (precipProb >= 45 || code === 63 || code === 80 || code === 81) return "medium";
  if (precipProb >= 30) return "low";
  return "";
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const items = parseRiskItems(body?.items);
  if (!items.length) {
    return NextResponse.json({ ok: true, alerts: [] });
  }

  const geoCache = new Map<string, GeoPoint | null>();
  const weatherCache = new Map<string, {
    time: string[];
    weather_code: number[];
    precipitation_probability: number[];
    temperature_2m: number[];
  } | null>();

  const alerts: Array<{
    id: string;
    severity: "low" | "medium" | "high";
    title: string;
    detail: string;
  }> = [];

  for (const item of items.slice(0, 24)) {
    try {
      const locationKey = item.location.toLowerCase();
      if (!geoCache.has(locationKey)) {
        geoCache.set(locationKey, await geocode(item.location));
      }
      const geo = geoCache.get(locationKey);
      if (!geo) continue;

      const weatherKey = `${geo.lat.toFixed(4)},${geo.lng.toFixed(4)}`;
      if (!weatherCache.has(weatherKey)) {
        const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
        weatherUrl.searchParams.set("latitude", String(geo.lat));
        weatherUrl.searchParams.set("longitude", String(geo.lng));
        weatherUrl.searchParams.set("hourly", "weather_code,precipitation_probability,temperature_2m");
        weatherUrl.searchParams.set("forecast_days", "7");
        weatherUrl.searchParams.set("timezone", "auto");
        const weatherRes = await fetch(weatherUrl.toString(), { cache: "no-store" });
        const weatherJson = await readJson(weatherRes) as {
          hourly?: {
            time?: string[];
            weather_code?: number[];
            precipitation_probability?: number[];
            temperature_2m?: number[];
          };
        } | null;
        if (!weatherRes.ok || !weatherJson?.hourly?.time?.length) {
          weatherCache.set(weatherKey, null);
        } else {
          weatherCache.set(weatherKey, {
            time: weatherJson.hourly.time || [],
            weather_code: weatherJson.hourly.weather_code || [],
            precipitation_probability: weatherJson.hourly.precipitation_probability || [],
            temperature_2m: weatherJson.hourly.temperature_2m || []
          });
        }
      }

      const weather = weatherCache.get(weatherKey);
      if (!weather) continue;
      const idx = nearestIndex(item.at, weather.time);
      if (idx < 0) continue;
      const weatherCode = weather.weather_code[idx] || 0;
      const precip = weather.precipitation_probability[idx] || 0;
      const temp = weather.temperature_2m[idx];
      const severity = severityFromWeather(weatherCode, precip);
      if (!severity) continue;

      alerts.push({
        id: `wx-${item.id}`,
        severity,
        title: severity === "high" ? "High weather disruption risk" : "Weather watch",
        detail: `${geo.label}: precipitation chance ${precip}%${Number.isFinite(temp) ? `, temp ${temp}C` : ""}.`
      });
    } catch {
      // Continue processing remaining locations.
    }
  }

  return NextResponse.json({ ok: true, alerts });
}
