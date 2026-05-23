import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

type HotelSuggestion = {
  name: string;
  address: string;
  placeId: string;
};

function compactWhitespace(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildDestinationCandidates(rawDestination: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const cleaned = compactWhitespace(value);
    if (cleaned.length < 2) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };

  const raw = compactWhitespace(rawDestination);
  if (!raw) return out;
  push(raw);

  // Convert "Field 3 @ East Cobb Complex, Marietta, GA" -> "East Cobb Complex, Marietta, GA"
  if (raw.includes("@")) {
    push(raw.split("@").slice(1).join("@"));
  }

  // Remove common venue prefixes that hurt hotel search recall.
  push(raw.replace(/^(field|court|diamond|venue|site)\s*[^@,]*@\s*/i, ""));

  const parts = raw.split(",").map((part) => compactWhitespace(part)).filter(Boolean);
  if (parts.length >= 2) {
    const [first, ...rest] = parts;
    if (/@/.test(first) || /\b(field|court|diamond|venue|site|park|complex)\b/i.test(first)) {
      push(rest.join(", "));
    }
    push(parts.slice(-2).join(", "));
  }
  if (parts.length >= 3) {
    push(parts.slice(-3).join(", "));
  }

  const cityState = raw.match(/([A-Za-z .'-]+,\s*[A-Z]{2})(?:\b|$)/);
  if (cityState) push(cityState[1]);

  return out.slice(0, 6);
}

function mapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
}

async function fetchHotelQuery(query: string, key: string): Promise<HotelSuggestion[]> {
  const textUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  textUrl.searchParams.set("query", query);
  textUrl.searchParams.set("key", key);
  textUrl.searchParams.set("language", "en");

  const res = await fetch(textUrl.toString(), { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .slice(0, 12)
    .map((r: { name?: string; formatted_address?: string; place_id?: string }) => ({
      name: String(r?.name || "").trim(),
      address: String(r?.formatted_address || "").trim(),
      placeId: String(r?.place_id || "").trim()
    }))
    .filter((h: HotelSuggestion) => h.name);
}

function mergeHotels(groups: HotelSuggestion[][]) {
  const seen = new Set<string>();
  const merged: HotelSuggestion[] = [];
  groups.forEach((group) => {
    group.forEach((hotel) => {
      const key = `${hotel.name.toLowerCase()}::${hotel.address.toLowerCase()}::${hotel.placeId}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(hotel);
    });
  });
  return merged.slice(0, 12);
}

async function fetchNominatimHotels(query: string): Promise<HotelSuggestion[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "12");
  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      "User-Agent": "APointScout-BirdDog/1.0 (hotel-suggestions)"
    }
  });
  const data = await res.json().catch(() => ([]));
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((item: { display_name?: string; place_id?: string }) => {
      const full = String(item?.display_name || "").trim();
      if (!full) return null;
      const parts = full.split(",");
      const name = String(parts.shift() || "").trim() || full;
      const address = parts.join(",").trim();
      return {
        name,
        address,
        placeId: String(item?.place_id || "").trim()
      } as HotelSuggestion;
    })
    .filter((item): item is HotelSuggestion => Boolean(item?.name));
}

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const destination = req.nextUrl.searchParams.get("destination")?.trim() || "";
  if (!destination || destination.length < 2) {
    return NextResponse.json({ hotels: [] as HotelSuggestion[] });
  }
  const destinationCandidates = buildDestinationCandidates(destination);
  if (!destinationCandidates.length) {
    return NextResponse.json({ hotels: [] as HotelSuggestion[] });
  }

  const key = mapsApiKey();
  if (!key) {
    try {
      const nominatimQueries = destinationCandidates
        .flatMap((candidate) => [`hotel in ${candidate}`, `lodging near ${candidate}`])
        .slice(0, 8);
      const settled = await Promise.allSettled(nominatimQueries.map((query) => fetchNominatimHotels(query)));
      const hotels = mergeHotels(
        settled
          .filter((item): item is PromiseFulfilledResult<HotelSuggestion[]> => item.status === "fulfilled")
          .map((item) => item.value)
      );
      return NextResponse.json({ hotels, warning: "Using OpenStreetMap fallback results" }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ hotels: [] as HotelSuggestion[], error: String(error) }, { status: 200 });
    }
  }

  try {
    const googleQueries = destinationCandidates
      .flatMap((candidate) => [
        `hotels in ${candidate}`,
        `lodging near ${candidate}`,
        `${candidate} hotel`
      ])
      .slice(0, 12);
    const settled = await Promise.allSettled(googleQueries.map((query) => fetchHotelQuery(query, key)));
    const groups = settled
      .filter((item): item is PromiseFulfilledResult<HotelSuggestion[]> => item.status === "fulfilled")
      .map((item) => item.value);
    let hotels = mergeHotels(groups);
    if (!hotels.length) {
      const nominatimQueries = destinationCandidates
        .flatMap((candidate) => [`hotel in ${candidate}`, `lodging near ${candidate}`])
        .slice(0, 8);
      const nominatimSettled = await Promise.allSettled(
        nominatimQueries.map((query) => fetchNominatimHotels(query))
      );
      hotels = mergeHotels(
        nominatimSettled
          .filter((item): item is PromiseFulfilledResult<HotelSuggestion[]> => item.status === "fulfilled")
          .map((item) => item.value)
      );
    }
    return NextResponse.json({ hotels });
  } catch (error) {
    return NextResponse.json({ hotels: [] as HotelSuggestion[], error: String(error) }, { status: 200 });
  }
}
