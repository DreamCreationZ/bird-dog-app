import { HarvesterDataset, OrgBrand } from "@/lib/birddog/types";

export const ORGS: OrgBrand[] = [
  {
    orgId: "lsu",
    name: "LSU Baseball",
    domain: "lsu.edu",
    primary: "#461D7C",
    accent: "#FDD023",
    logoText: "LSU"
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
    logoText: "ORG"
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

export function getOrgByEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return ORGS.find((org) => org.domain && domain.endsWith(org.domain)) || ORGS.find((org) => org.orgId === "default")!;
}
