import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

type HotelSuggestion = {
  name: string;
  address: string;
  placeId: string;
};

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

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const destination = req.nextUrl.searchParams.get("destination")?.trim() || "";
  if (!destination || destination.length < 2) {
    return NextResponse.json({ hotels: [] as HotelSuggestion[] });
  }

  const key = mapsApiKey();
  if (!key) {
    return NextResponse.json({ hotels: [] as HotelSuggestion[], error: "Missing Google Maps API key" }, { status: 200 });
  }

  try {
    const settled = await Promise.allSettled([
      fetchHotelQuery(`hotels in ${destination}`, key),
      fetchHotelQuery(`lodging near ${destination}`, key),
      fetchHotelQuery(`${destination} hotel`, key)
    ]);
    const groups = settled
      .filter((item): item is PromiseFulfilledResult<HotelSuggestion[]> => item.status === "fulfilled")
      .map((item) => item.value);
    const hotels = mergeHotels(groups);
    return NextResponse.json({ hotels });
  } catch (error) {
    return NextResponse.json({ hotels: [] as HotelSuggestion[], error: String(error) }, { status: 200 });
  }
}
