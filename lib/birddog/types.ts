export type DataProvider = "PG" | "PBR";

export type Player = {
  id: string;
  name: string;
  school: string;
  position: string;
  mustSee?: boolean;
};

export type FieldLocation = {
  x: number;
  y: number;
};

export type Game = {
  id: string;
  field: string;
  fieldLocation: FieldLocation;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  players: Player[];
};

export type Tournament = {
  id: string;
  name: string;
  city: string;
  date: string;
  games: Game[];
  teams?: Array<{
    id: string;
    name: string;
    from: string;
    record?: string;
    href?: string;
  }>;
};

export type HarvesterDataset = {
  company: DataProvider;
  tournaments: Tournament[];
};

export type OrgBrand = {
  orgId: string;
  name: string;
  domain: string;
  primary: string;
  accent: string;
  logoText: string;
};

export type SessionUser = {
  userId: string;
  name: string;
  email: string;
  orgId: string;
  orgName: string;
};

export type ScoutNote = {
  id: string;
  gameId: string;
  playerId?: string;
  transcript: string;
  audioUrl?: string;
  createdAt: string;
  synced: boolean;
};

export type PulseEvent = {
  id: string;
  gameId: string;
  message: string;
  createdAt: string;
  synced: boolean;
};

export type ItineraryStop = {
  gameId: string;
  field: string;
  at: string;
  watchlistCount: number;
  players: string[];
  walkFromPrevMinutes: number;
};
