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

function detectCompany(name: string): DataProvider {
  return name.toLowerCase().includes("pbr") ? "PBR" : "PG";
}

const summer = [
  "PG WWBA 17U National Championship",
  "PG WWBA 16U National Championship",
  "PG Elite 17U National Championship",
  "PG Elite 16U National Championship",
  "PBR NPI 17U",
  "PBR NPI 16U",
  "USA Baseball 17U National Team Champs",
  "USA Baseball 16U National Team Champs",
  "UBC 17U",
  "UBC 16U",
  "ABC 17U National Championship",
  "ABC 16U National Championship",
  "MPL 17U",
  "MPL 16U",
  "PBR 17U National Championship",
  "PBR 16U National Championship"
];

const fall = [
  "PG Jupiter (World Wood Bat)",
  "PG Fall World Series 17U",
  "PG Fall World Series 16U",
  "PG Underclass World Championship",
  "PBR Cup 17U",
  "PBR Cup 16U"
];

export const INVENTORY_SEED: InventorySeed[] = [
  ...summer.map((name) => ({ slug: slugify(name), name, season: "summer" as const, company: detectCompany(name) })),
  ...fall.map((name) => ({ slug: slugify(name), name, season: "fall" as const, company: detectCompany(name) }))
];
