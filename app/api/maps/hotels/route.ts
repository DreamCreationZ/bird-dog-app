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

  const textUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  textUrl.searchParams.set("query", `hotels in ${destination}`);
  textUrl.searchParams.set("key", key);

  try {
    const res = await fetch(textUrl.toString(), { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data?.results) ? data.results : [];
    const hotels: HotelSuggestion[] = results
      .slice(0, 12)
      .map((r: { name?: string; formatted_address?: string; place_id?: string }) => ({
        name: r.name || "",
        address: r.formatted_address || "",
        placeId: r.place_id || ""
      }))
      .filter((h: HotelSuggestion) => h.name);
    return NextResponse.json({ hotels });
  } catch (error) {
    return NextResponse.json({ hotels: [] as HotelSuggestion[], error: String(error) }, { status: 200 });
  }
}
