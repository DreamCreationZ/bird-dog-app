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
    if (kind === "arrival") {
      const [citySuggestions, airportHints, mixedSuggestions] = await Promise.all([
        fetchPredictions(q, key, { types: "(cities)" }),
        fetchPredictions(`${q} airport`, key),
        fetchPredictions(q, key)
      ]);
      const airportSuggestions = airportHints.filter((item) => /airport/i.test(item.label));
      suggestions = mergeSuggestions([citySuggestions, airportSuggestions, mixedSuggestions]);
    } else if (kind === "hotel") {
      const [namedHotels, hotelHints] = await Promise.all([
        fetchPredictions(q, key, { types: "establishment" }),
        fetchPredictions(`${q} hotel`, key)
      ]);
      suggestions = mergeSuggestions([namedHotels, hotelHints]);
    } else {
      suggestions = await fetchPredictions(q, key, { types: "(cities)" });
    }
    return NextResponse.json({ suggestions });
  } catch (error) {
    return NextResponse.json({ suggestions: [] as Suggestion[], error: String(error) }, { status: 200 });
  }
}
