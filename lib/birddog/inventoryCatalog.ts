import { DataProvider } from "@/lib/birddog/types";

export type CircuitSeason = "summer" | "fall";

export type InventorySeed = {
  slug: string;
  name: string;
  season: CircuitSeason;
  company: DataProvider;
  displayDate?: string;
  displayCity?: string;
  displayTeams?: string;
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

const pbr = [
  "2025 PBR National Championship",
  "2025 PBR Future Games",
  "2025 PBR Junior Future Games",
  "2025 PBR Senior Future Games",
  "2025 PBR World Invite"
];

const presetMeta: Record<string, { date?: string; city?: string; teams?: string }> = {
  "2026-pg-wwba-national-championship": { date: "Jun 16-21", city: "Marietta, GA", teams: "34 TEAMS" },
  "2026-pg-14u-wwba-national-championship": { date: "Jun 20-25", city: "Hoover, AL", teams: "171 TEAMS" },
  "2026-pg-17u-wwba-national-championship": { date: "Jun 23-30", city: "Marietta, GA", teams: "374 TEAMS" },
  "2026-pg-13u-wwba-national-championship": { date: "Jun 27-Jul 1", city: "West Palm Beach, FL", teams: "50 TEAMS" },
  "2026-pg-13u-54-80-wwba-national-championship": { date: "Jun 27-Jul 1", city: "Atlanta, GA", teams: "31 TEAMS" },
  "2026-pg-16u-wwba-national-championship": { date: "Jul 6-13", city: "Marietta, GA", teams: "383 TEAMS" },
  "2026-pg-15u-wwba-national-championship": { date: "Jul 17-24", city: "Marietta, GA", teams: "288 TEAMS" },
  "2026-pg-wwba-sophomore-world-championship": { date: "Sep 24-28", city: "Fort Myers, FL", teams: "8 TEAMS" },
  "2026-pg-wwba-underclass-world-championship": { date: "Oct 1-5", city: "Fort Myers, FL", teams: "15 TEAMS" },
  "2026-pg-wwba-freshman-world-championship": { date: "Oct 8-12", city: "West Palm Beach, FL", teams: "6 TEAMS" },
  "2026-pg-wwba-world-championship": { date: "Oct 8-12", city: "Jupiter, FL" },
  "2026-pg-wwba-13u-14u-world-championship": { date: "Oct 16-19", city: "West Palm Beach, FL", teams: "9 TEAMS" },
  "2025-pbr-national-championship": { date: "Jul-Aug 2025", city: "United States" },
  "2025-pbr-future-games": { date: "Jul-Aug 2025", city: "United States" },
  "2025-pbr-junior-future-games": { date: "Jul-Aug 2025", city: "United States" },
  "2025-pbr-senior-future-games": { date: "Jul-Aug 2025", city: "United States" },
  "2025-pbr-world-invite": { date: "2025", city: "United States" }
};

export const INVENTORY_SEED: InventorySeed[] = [
  ...summer.map((name) => {
    const slug = slugify(name);
    const meta = presetMeta[slug] || {};
    return {
      slug,
      name,
      season: "summer" as const,
      company: "PG" as const,
      displayDate: meta.date,
      displayCity: meta.city,
      displayTeams: meta.teams
    };
  }),
  ...fall.map((name) => {
    const slug = slugify(name);
    const meta = presetMeta[slug] || {};
    return {
      slug,
      name,
      season: "fall" as const,
      company: "PG" as const,
      displayDate: meta.date,
      displayCity: meta.city,
      displayTeams: meta.teams
    };
  }),
  ...pbr.map((name) => {
    const slug = slugify(name);
    const meta = presetMeta[slug] || {};
    return {
      slug,
      name,
      season: "summer" as const,
      company: "PBR" as const,
      displayDate: meta.date,
      displayCity: meta.city,
      displayTeams: meta.teams
    };
  })
];

export function inventoryHarvestHint(input: { slug: string; name: string; company: DataProvider }) {
  if (input.company === "PG") {
    if (input.slug === "2025-pg-16u-wwba-national-championship" || input.slug === "2026-pg-16u-wwba-national-championship") {
      return "https://www.perfectgame.org/events/TournamentTeams.aspx?event=99733";
    }
    return `https://www.perfectgame.org/search.aspx?search=${encodeURIComponent(input.name)}`;
  }
  if (/^https?:\/\//i.test(input.name)) return input.name;
  return `https://www.prepbaseballreport.com/search?q=${encodeURIComponent(input.name)}`;
}
