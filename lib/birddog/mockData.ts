import { HarvesterDataset, OrgBrand } from "@/lib/birddog/types";

export const ORGS: OrgBrand[] = [
  {
    orgId: "arkansas",
    name: "Arkansas Razorbacks",
    domain: "uark.edu",
    primary: "#9d2235",
    accent: "#ffffff",
    logoText: "ARK",
    logoUrl: "https://arkansasrazorbacks.com/wp-content/themes/razorbacks/images/arkansas-razorbacks-logo.png"
  },
  {
    orgId: "arizona",
    name: "Arizona Wildcats",
    domain: "arizona.edu",
    primary: "#003366",
    accent: "#cc0033",
    logoText: "UAZ",
    logoUrl: "https://arizonawildcats.com/images/logos/site/site.png"
  },
  {
    orgId: "asu",
    name: "Arizona State Sun Devils",
    domain: "asu.edu",
    primary: "#8c1d40",
    accent: "#ffc627",
    logoText: "ASU",
    logoUrl: "https://thesundevils.com/images/logos/site/site.png"
  },
  {
    orgId: "clemson",
    name: "Clemson Tigers",
    domain: "clemson.edu",
    primary: "#f56600",
    accent: "#522d80",
    logoText: "CLEM",
    logoUrl: "https://clemsontigers.com/wp-content/themes/clemson/images/logo.png"
  },
  {
    orgId: "duke",
    name: "Duke Blue Devils",
    domain: "duke.edu",
    primary: "#003087",
    accent: "#ffffff",
    logoText: "DUKE",
    logoUrl: "https://goduke.com/images/logos/site/site.png"
  },
  {
    orgId: "florida",
    name: "Florida Gators",
    domain: "ufl.edu",
    primary: "#0021a5",
    accent: "#fa4616",
    logoText: "UF",
    logoUrl: "https://floridagators.com/images/logos/site/site.png"
  },
  {
    orgId: "fsu",
    name: "Florida State Seminoles",
    domain: "fsu.edu",
    primary: "#782f40",
    accent: "#ceb888",
    logoText: "FSU",
    logoUrl: "https://seminoles.com/wp-content/themes/fsu/images/logo.png"
  },
  {
    orgId: "georgia",
    name: "Georgia Bulldogs",
    domain: "uga.edu",
    primary: "#ba0c2f",
    accent: "#000000",
    logoText: "UGA",
    logoUrl: "https://georgiadogs.com/images/logos/site/site.png"
  },
  {
    orgId: "kentucky",
    name: "Kentucky Wildcats",
    domain: "uky.edu",
    primary: "#0033a0",
    accent: "#ffffff",
    logoText: "UK",
    logoUrl: "https://ukathletics.com/wp-content/themes/ukathletics/images/logo.png"
  },
  {
    orgId: "lsu",
    name: "LSU Baseball",
    domain: "lsu.edu",
    primary: "#461D7C",
    accent: "#FDD023",
    logoText: "LSU",
    logoUrl: "https://storage.googleapis.com/lsusports-com/2021/07/70691764-lsu-logo-2021.png"
  },
  {
    orgId: "louisville",
    name: "Louisville Cardinals",
    domain: "louisville.edu",
    primary: "#ad0000",
    accent: "#000000",
    logoText: "UL",
    logoUrl: "https://gocards.com/images/logos/site/site.png"
  },
  {
    orgId: "miami",
    name: "Miami Hurricanes",
    domain: "miami.edu",
    primary: "#f47321",
    accent: "#005030",
    logoText: "UM",
    logoUrl: "https://miamihurricanes.com/wp-content/themes/hurricanes/images/logo.svg"
  },
  {
    orgId: "msstate",
    name: "Mississippi State Bulldogs",
    domain: "msstate.edu",
    primary: "#660000",
    accent: "#ffffff",
    logoText: "MSU",
    logoUrl: "https://hailstate.com/images/logos/site/site.png"
  },
  {
    orgId: "ncsu",
    name: "NC State Wolfpack",
    domain: "ncsu.edu",
    primary: "#cc0000",
    accent: "#000000",
    logoText: "NCSU",
    logoUrl: "https://gopack.com/images/logos/site/site.png"
  },
  {
    orgId: "unc",
    name: "North Carolina Tar Heels",
    domain: "unc.edu",
    primary: "#7bafd4",
    accent: "#13294b",
    logoText: "UNC",
    logoUrl: "https://goheels.com/images/logos/site/site.png"
  },
  {
    orgId: "ou",
    name: "Oklahoma Sooners",
    domain: "ou.edu",
    primary: "#841617",
    accent: "#fdf9d8",
    logoText: "OU",
    logoUrl: "https://soonersports.com/images/logos/site/site.png"
  },
  {
    orgId: "okstate",
    name: "Oklahoma State Cowboys",
    domain: "okstate.edu",
    primary: "#ff7300",
    accent: "#000000",
    logoText: "OSU",
    logoUrl: "https://okstate.com/images/logos/site/site.png"
  },
  {
    orgId: "odu",
    name: "Old Dominion Baseball",
    domain: "odu.edu",
    primary: "#003057",
    accent: "#7C878E",
    logoText: "ODU"
  },
  {
    orgId: "default",
    name: "Neutral Org",
    domain: "",
    primary: "#1f3a5f",
    accent: "#d7a316",
    logoText: "ORG",
    logoUrl: ""
  }
];

export const HARVEST_DATA: HarvesterDataset[] = [
  {
    company: "PG",
    tournaments: [
      {
        id: "pg-spring-1",
        name: "PG Spring Showdown",
        city: "Houston",
        date: "2026-03-12",
        games: [
          {
            id: "g1",
            field: "Field 4",
            fieldLocation: { x: 1.2, y: 2.4 },
            startTime: "2026-03-12T10:00:00",
            homeTeam: "TX Heat",
            awayTeam: "Gulf Coast Elite",
            players: [
              { id: "p1", name: "Jayden Cole", school: "LSU Commit", position: "SS", mustSee: true },
              { id: "p2", name: "Marco Diaz", school: "Uncommitted", position: "RHP" }
            ]
          },
          {
            id: "g2",
            field: "Field 9",
            fieldLocation: { x: 5.8, y: 3.1 },
            startTime: "2026-03-12T13:00:00",
            homeTeam: "Bay Area Hawks",
            awayTeam: "OK Storm",
            players: [
              { id: "p3", name: "Tyler Quinn", school: "ODU Commit", position: "CF" },
              { id: "p4", name: "Dante Myers", school: "LSU Target", position: "C", mustSee: true }
            ]
          }
        ]
      },
      {
        id: "pg-summer-2",
        name: "PG National Invite",
        city: "Atlanta",
        date: "2026-07-08",
        games: [
          {
            id: "g3",
            field: "Field 2",
            fieldLocation: { x: 2.5, y: 1.1 },
            startTime: "2026-07-08T09:00:00",
            homeTeam: "South Elite",
            awayTeam: "Carolina Blue",
            players: [
              { id: "p5", name: "Reid Lawson", school: "Florida Target", position: "LHP" },
              { id: "p6", name: "Evan Scott", school: "LSU Target", position: "3B", mustSee: true }
            ]
          }
        ]
      }
    ]
  },
  {
    company: "PBR",
    tournaments: [
      {
        id: "pbr-regional-1",
        name: "PBR Gulf Regional",
        city: "Baton Rouge",
        date: "2026-03-21",
        games: [
          {
            id: "g4",
            field: "Field 1",
            fieldLocation: { x: 0.6, y: 2.2 },
            startTime: "2026-03-21T11:30:00",
            homeTeam: "River Parish",
            awayTeam: "Acadiana Select",
            players: [
              { id: "p7", name: "Kade Brooks", school: "LSU Commit", position: "RHP", mustSee: true },
              { id: "p8", name: "Owen Miles", school: "ODU Target", position: "INF" }
            ]
          },
          {
            id: "g5",
            field: "Field 6",
            fieldLocation: { x: 3.9, y: 4.7 },
            startTime: "2026-03-21T15:00:00",
            homeTeam: "Bayou Bombers",
            awayTeam: "Cajun Prime",
            players: [{ id: "p9", name: "Noah Banks", school: "Uncommitted", position: "C" }]
          }
        ]
      }
    ]
  }
];

const DOMAIN_THEME_PALETTES = [
  { primary: "#123D79", accent: "#F1C45B" },
  { primary: "#6E1A2A", accent: "#F5D16B" },
  { primary: "#0F4B45", accent: "#BEE6CC" },
  { primary: "#4F1C66", accent: "#E2B9FF" },
  { primary: "#7A2A17", accent: "#F6C29A" },
  { primary: "#1A355B", accent: "#A7CDF8" }
] as const;

function hashDomain(input: string) {
  let hash = 0;
  for (let idx = 0; idx < input.length; idx += 1) {
    hash = (hash * 31 + input.charCodeAt(idx)) | 0;
  }
  return Math.abs(hash);
}

function toTitleCaseWord(word: string) {
  if (!word) return "";
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

function createFallbackOrgFromDomain(domain: string): OrgBrand {
  const cleanDomain = domain.trim().toLowerCase();
  const palette = DOMAIN_THEME_PALETTES[hashDomain(cleanDomain) % DOMAIN_THEME_PALETTES.length];
  const root = cleanDomain.split(".")[0] || "scout";
  const label = root
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => toTitleCaseWord(part))
    .join(" ")
    .trim() || "Scout";
  const orgId = root.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "default";
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "ORG";

  return {
    orgId: `domain-${orgId}`,
    name: `${label} Athletics`,
    domain: cleanDomain,
    primary: palette.primary,
    accent: palette.accent,
    logoText: initials
  };
}

export function getOrgByEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase().trim() || "";
  const known = ORGS.find((org) => org.domain && domain.endsWith(org.domain));
  if (known) return known;
  if (domain) return createFallbackOrgFromDomain(domain);
  return ORGS.find((org) => org.orgId === "default")!;
}
