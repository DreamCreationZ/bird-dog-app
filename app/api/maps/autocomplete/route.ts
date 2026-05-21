import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

type Suggestion = {
  label: string;
  placeId: string;
};

type FetchPredictionOptions = {
  types?: string;
};

function mapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
}

async function fetchPredictions(input: string, key: string, options: FetchPredictionOptions = {}): Promise<Suggestion[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  url.searchParams.set("input", input);
  url.searchParams.set("key", key);
  url.searchParams.set("language", "en");
  if (options.types) {
    url.searchParams.set("types", options.types);
  }
  const res = await fetch(url.toString(), { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  const predictions = Array.isArray(data?.predictions) ? data.predictions : [];
  return predictions
    .map((p: { description?: string; place_id?: string }) => ({
      label: p.description || "",
      placeId: p.place_id || ""
    }))
    .filter((s: Suggestion) => s.label);
}

async function fetchTextSuggestions(query: string, key: string): Promise<Suggestion[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("key", key);
  url.searchParams.set("language", "en");
  const res = await fetch(url.toString(), { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .map((item: { name?: string; formatted_address?: string; place_id?: string }) => {
      const name = String(item?.name || "").trim();
      const address = String(item?.formatted_address || "").trim();
      const label = [name, address].filter(Boolean).join(", ").trim() || address;
      return {
        label,
        placeId: String(item?.place_id || "").trim()
      };
    })
    .filter((item: Suggestion) => item.label);
}

async function fetchGeocodeSuggestions(query: string, key: string): Promise<Suggestion[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);
  url.searchParams.set("language", "en");
  const res = await fetch(url.toString(), { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .map((item: { formatted_address?: string; place_id?: string }) => ({
      label: String(item?.formatted_address || "").trim(),
      placeId: String(item?.place_id || "").trim()
    }))
    .filter((item: Suggestion) => item.label);
}

async function settleSuggestionGroups(tasks: Array<Promise<Suggestion[]>>) {
  const settled = await Promise.allSettled(tasks);
  return settled
    .filter((item): item is PromiseFulfilledResult<Suggestion[]> => item.status === "fulfilled")
    .map((item) => item.value);
}

function appendTokenIfMissing(base: string, token: string) {
  const cleanBase = String(base || "").trim();
  const cleanToken = String(token || "").trim();
  if (!cleanBase || !cleanToken) return cleanBase;
  const tokenPattern = new RegExp(`\\b${cleanToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (tokenPattern.test(cleanBase)) return cleanBase;
  return `${cleanBase} ${cleanToken}`.trim();
}

function mergeSuggestions(groups: Suggestion[][], limit = 12) {
  const seen = new Set<string>();
  const merged: Suggestion[] = [];
  groups.forEach((group) => {
    group.forEach((item) => {
      const key = `${item.label.toLowerCase()}::${item.placeId}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    });
  });
  return merged.slice(0, limit);
}

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const kind = (req.nextUrl.searchParams.get("kind") || "city").trim().toLowerCase();
  if (!q || q.length < 2) {
    return NextResponse.json({ suggestions: [] as Suggestion[] });
  }

  const key = mapsApiKey();
  if (!key) {
    return NextResponse.json({ suggestions: [] as Suggestion[], error: "Missing Google Maps API key" }, { status: 200 });
  }

  try {
    let suggestions: Suggestion[] = [];
    const stateHint = String(req.nextUrl.searchParams.get("state") || "").trim().toUpperCase();
    const stateQuery = /^[A-Z]{2}$/.test(stateHint) && !new RegExp(`\\b${stateHint}\\b`, "i").test(q)
      ? `${q}, ${stateHint}`
      : "";
    if (kind === "arrival") {
      const airportQuery = appendTokenIfMissing(q, "airport");
      const groups = await settleSuggestionGroups([
        fetchPredictions(q, key, { types: "(cities)" }),
        fetchPredictions(q, key, { types: "geocode" }),
        fetchPredictions(q, key),
        fetchPredictions(airportQuery, key),
        fetchTextSuggestions(q, key),
        fetchTextSuggestions(airportQuery, key),
        fetchGeocodeSuggestions(q, key),
        ...(stateQuery
          ? [
            fetchPredictions(stateQuery, key, { types: "geocode" }),
            fetchTextSuggestions(stateQuery, key)
          ]
          : [])
      ]);
      const airportSuggestions = groups
        .flat()
        .filter((item) => /\b(airport|airfield|intl|international)\b/i.test(item.label));
      const nonAirportSuggestions = groups
        .flat()
        .filter((item) => !/\b(airport|airfield|intl|international)\b/i.test(item.label));
      const queryLooksAirport = /\b(airport|airfield|intl|international)\b/i.test(q);
      suggestions = queryLooksAirport
        ? mergeSuggestions([airportSuggestions, nonAirportSuggestions])
        : mergeSuggestions([...groups, airportSuggestions]);
    } else if (kind === "hotel") {
      const hotelQuery = appendTokenIfMissing(q, "hotel");
      const groups = await settleSuggestionGroups([
        fetchPredictions(q, key, { types: "establishment" }),
        fetchPredictions(q, key),
        fetchPredictions(hotelQuery, key),
        fetchTextSuggestions(q, key),
        fetchTextSuggestions(hotelQuery, key),
        fetchTextSuggestions(appendTokenIfMissing(q, "lodging"), key),
        ...(stateQuery ? [fetchTextSuggestions(`${hotelQuery} ${stateHint}`, key)] : [])
      ]);
      suggestions = mergeSuggestions(groups);
    } else {
      const groups = await settleSuggestionGroups([
        fetchPredictions(q, key, { types: "(cities)" }),
        fetchPredictions(q, key, { types: "geocode" }),
        fetchTextSuggestions(q, key),
        fetchGeocodeSuggestions(q, key)
      ]);
      suggestions = mergeSuggestions(groups);
    }
    return NextResponse.json({ suggestions });
  } catch (error) {
    return NextResponse.json({ suggestions: [] as Suggestion[], error: String(error) }, { status: 200 });
  }
}
