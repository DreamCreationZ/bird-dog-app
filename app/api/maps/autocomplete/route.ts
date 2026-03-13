import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

type Suggestion = {
  label: string;
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

  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (!q || q.length < 2) {
    return NextResponse.json({ suggestions: [] as Suggestion[] });
  }

  const key = mapsApiKey();
  if (!key) {
    return NextResponse.json({ suggestions: [] as Suggestion[], error: "Missing Google Maps API key" }, { status: 200 });
  }

  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  url.searchParams.set("input", q);
  url.searchParams.set("types", "(cities)");
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const predictions = Array.isArray(data?.predictions) ? data.predictions : [];
    const suggestions: Suggestion[] = predictions
      .map((p: { description?: string; place_id?: string }) => ({
        label: p.description || "",
        placeId: p.place_id || ""
      }))
      .filter((s: Suggestion) => s.label);
    return NextResponse.json({ suggestions });
  } catch (error) {
    return NextResponse.json({ suggestions: [] as Suggestion[], error: String(error) }, { status: 200 });
  }
}
