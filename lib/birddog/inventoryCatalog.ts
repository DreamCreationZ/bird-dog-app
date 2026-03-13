import { DataProvider } from "@/lib/birddog/types";

export type CircuitSeason = "summer" | "fall";

export type InventorySeed = {
  slug: string;
  name: string;
  season: CircuitSeason;
  company: DataProvider;
};

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const summer = [
  "2025 PG 16U WWBA National Championship",
  "2026 PG WWBA National Championship",
  "2026 PG 14U WWBA National Championship",
  "2026 PG 17U WWBA National Championship",
  "2026 PG 13U WWBA National Championship",
  "2026 PG 13U 54/80 WWBA National Championship",
  "2026 PG 16U WWBA National Championship",
  "2026 PG 15U WWBA National Championship"
];

const fall = [
  "2026 PG WWBA Sophomore World Championship",
  "2026 PG WWBA Underclass World Championship",
  "2026 PG WWBA Freshman World Championship",
  "2026 PG WWBA World Championship",
  "2026 PG WWBA 13U & 14U World Championship"
];

export const INVENTORY_SEED: InventorySeed[] = [
  ...summer.map((name) => ({ slug: slugify(name), name, season: "summer" as const, company: "PG" as const })),
  ...fall.map((name) => ({ slug: slugify(name), name, season: "fall" as const, company: "PG" as const }))
];

export function inventoryHarvestHint(input: { slug: string; name: string; company: DataProvider }) {
  if (input.company === "PG") {
    if (input.slug === "2025-pg-16u-wwba-national-championship" || input.slug === "2026-pg-16u-wwba-national-championship") {
      return "https://www.perfectgame.org/events/TournamentTeams.aspx?event=99733";
    }
    return `https://www.perfectgame.org/search.aspx?search=${encodeURIComponent(input.name)}`;
  }
  return input.name;
}
