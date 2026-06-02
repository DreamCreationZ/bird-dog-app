"use client";

import { Fragment, SetStateAction, TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Game, ItineraryStop, Player, PulseEvent, ScoutNote, SessionUser, Tournament } from "@/lib/birddog/types";
import { loadHarvestDataset, loadHarvestOverview, loadHarvestTournament } from "@/lib/birddog/clientHarvest";
import { isPastTournament } from "@/lib/birddog/tournamentAccess";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";

type RecorderState = "idle" | "recording";

type BrowserSpeechResultEvent = Event & {
  results: {
    length: number;
    [index: number]: {
      length: number;
      0: {
        transcript: string;
      };
    };
  };
};

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: BrowserSpeechResultEvent) => void) | null;
  onerror?: ((event: Event) => void) | null;
  onend?: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type BrowserSpeechConstructor = new () => BrowserSpeechRecognition;

type HarvestJob = {
  id: string;
  company: "PG" | "PBR";
  tournament_hint: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
};

type InventoryTournament = {
  slug: string;
  name: string;
  season: "summer" | "fall";
  company: "PG" | "PBR";
  locked: boolean;
  isArchive?: boolean;
  harvestHint?: string;
  displayDate?: string;
  displayTeams?: string;
  displayCity?: string;
};

type PlanItem = {
  at: string;
  title: string;
  detail: string;
  mapUrl?: string;
};

type PlanWorkflowStatus = "draft" | "pending_approval" | "approved";

type BookingQuoteResult = {
  provider?: string;
  status?: "booked" | "quoted" | "failed" | "skipped";
  leg?: {
    at?: string;
    from?: string;
    to?: string;
    mode?: string;
  };
  detail?: string;
  price?: string;
};

type BookingReviewDraft = {
  travelLegs: Array<{
    at: string;
    from: string;
    to: string;
    mode: string;
  }>;
  planItems: PlanItem[];
  traveler: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: "MALE" | "FEMALE" | "UNSPECIFIED";
    email: string;
    phone: string;
    countryCallingCode: string;
    nationality: string;
  };
  teamName: string;
  tournamentName: string;
};

type BookingSummarySnapshot = {
  savedAt: string;
  paymentMethod: "UPI" | "CARD";
  booked: number;
  quoted: number;
  failed: number;
  results: BookingQuoteResult[];
};

type ProfileFormState = {
  firstName: string;
  lastName: string;
  universityEmail: string;
  gender: "MALE" | "FEMALE" | "UNSPECIFIED";
  countryCallingCode: string;
  mobileNumber: string;
  dateOfBirth: string;
};

type DesiredPlayer = {
  playerId: string;
  selectionKey?: string;
  name: string;
  team: string;
  hometown?: string;
  sourceTeamId?: string;
  sourceTeamName?: string;
  sourceGameId?: string;
  sourceGameStartAt?: string;
  sourceGameTimeLabel?: string;
  sourceGameOpponent?: string;
  sourceGameField?: string;
};

type CoachSchedule = {
  id: string;
  user_id: string;
  coach_name: string;
  coach_email?: string | null;
  flight_source: string | null;
  flight_destination: string | null;
  flight_arrival_time: string | null;
  hotel_name: string | null;
  notes: string | null;
  desired_players: DesiredPlayer[];
  generated_plan: PlanItem[];
  updated_at: string;
};

type CoachLiveLocation = {
  id: string;
  org_id: string;
  user_id: string;
  coach_name: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  captured_at: string;
  updated_at: string;
};

type CoachSharedNote = {
  id: string;
  user_id: string;
  game_id: string;
  player_id: string | null;
  transcript: string;
  audio_url: string | null;
  observed_at: string;
};

type CoachMeetSuggestion = {
  kind: "common" | "midpoint" | "none";
  label: string;
  detail: string;
  mapUrl?: string;
};

type PlaceSuggestion = {
  label: string;
  placeId: string;
};

type HotelSuggestion = {
  name: string;
  address: string;
  placeId: string;
};

type StateArrivalInput = {
  arrivalLocation: string;
  arrivalTime: string;
};

type StateHotelInput = {
  hotelName: string;
  checkIn: string;
  checkOut: string;
};

type CoachTravelInputsSnapshot = {
  flightBooked?: "yes" | "no";
  hotelBooked?: "yes" | "no";
  stateArrivalInputs?: Record<string, StateArrivalInput>;
  stateHotelInputs?: Record<string, StateHotelInput>;
};

type TeamRef = NonNullable<Tournament["teams"]>[number];

type InlineTeamNoteTarget = {
  teamId: string;
  teamName: string;
  playerId?: string;
  playerName?: string;
  selectionKey?: string;
};

type InlineTeamNoteDraft = {
  text: string;
  audioUrl: string;
  updatedAt: string;
};

type TeamRosterSearchRow = {
  no?: string;
  name: string;
  hometown?: string;
};

type TeamDetailsScheduleRow = {
  gameNo: string;
  date: string;
  time: string;
  field: string;
  homeTeam: string;
  awayTeam: string;
  dayLabel?: string;
  ageDiv?: string;
  homeScore?: string;
  awayScore?: string;
};

type TeamDetailsRosterRow = {
  no: string;
  name: string;
  position: string;
  school: string;
  hometown?: string;
  commitment?: string;
  team?: string;
};

type TeamDetailsSnapshot = {
  schedule: TeamDetailsScheduleRow[];
  roster: TeamDetailsRosterRow[];
};

type TournamentScheduleRowView = {
  key: string;
  gameId?: string;
  startAt?: string;
  dayKey: string;
  dayLabel: string;
  sortAt: number;
  time: string;
  gameNo: string;
  location: string;
  ageDiv: string;
  homeTeam: string;
  homeTeamId?: string;
  homeTeamHref?: string;
  homeScore: string;
  awayScore: string;
  awayTeam: string;
  awayTeamId?: string;
  awayTeamHref?: string;
};

type TournamentPlayerIndexRow = {
  playerId: string;
  name: string;
  hometown: string;
  teamId: string;
  teamName: string;
};

type SmartPlayerResult = {
  key: string;
  playerId: string;
  name: string;
  hometown: string;
  teamId: string;
  teamName: string;
};

type GeoLocation = {
  lat: number;
  lng: number;
  label: string;
};

type OptimizedStop = ItineraryStop & {
  gameStartAt: string;
  gameEndAt: string;
  arrivalAt: string;
  coveredPlayerIds: string[];
  lateByMinutes: number;
};

type CoachGameCandidate = {
  key: string;
  gameNo: string;
  startMs: number;
  endMs: number;
  stateCode: string;
  locationLabel: string;
  locationQuery: string;
  homeTeam: string;
  awayTeam: string;
  matchedPlayers: DesiredPlayer[];
  point: GeoLocation | null;
};

type BirdDogTab = "tournaments" | "notes" | "myPlayersSchedule" | "profile";

const CACHE_KEY = "bird_dog_tournament_cache";
const PREVIEW_UNLOCK_ALL =
  process.env.NEXT_PUBLIC_BIRD_DOG_PREVIEW_UNLOCK_ALL === "true"
  && process.env.NODE_ENV !== "production";
const TOURNAMENT_UNLOCK_EVENT_KEY = "bird_dog:tournament_unlock_event:v1";
const COACH_LOCATION_SHARING_KEY = "bird_dog:coach_location_sharing";
const LOCAL_SCHEDULE_FALLBACK_KEY = "bird_dog:local_schedule_fallback:v1";
const PLAN_WORKFLOW_STATUS_KEY_PREFIX = "bird_dog:plan_workflow_status:v1";
const COACH_TRAVEL_INPUTS_STORAGE_KEY_PREFIX = "bird_dog:coach_travel_inputs:v1";
const DESIRED_PLAYERS_STORAGE_KEY_PREFIX = "bird_dog:desired_players:v1";
const ROSTER_CART_STORAGE_KEY_PREFIX = "bird_dog:roster_cart:v3";
const ROSTER_CART_GLOBAL_KEY = "bird_dog:roster_cart:v3:global";
const INVENTORY_CACHE_STORAGE_KEY_PREFIX = "bird_dog:inventory_cache:v2";
const BOOKING_REVIEW_DRAFT_KEY = "bird_dog:booking_review_draft:v1";
const BOOKING_SUMMARY_KEY = "bird_dog:booking_summary:v1";
const PROFILE_FORM_STORAGE_KEY_PREFIX = "bird_dog:profile_form:v1";

function parseCompanyParam(value: string | null | undefined): "PG" | "PBR" | null {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "PBR") return "PBR";
  if (normalized === "PG") return "PG";
  return null;
}

function companyLabel(value: "PG" | "PBR") {
  return value === "PBR" ? "PBR" : "PG";
}

function sourceLabel(value: "PG" | "PBR") {
  return value === "PBR" ? "Prep Baseball Report" : "Perfect Game";
}

function scheduleNotUploadedMessage(value: "PG" | "PBR") {
  return `${companyLabel(value)} schedule data is not uploaded yet for this tournament. Once it is uploaded, the full schedule will appear here.`;
}

function isTournamentLocked(item: InventoryTournament | null | undefined, options?: { forceUnlocked?: boolean }) {
  if (!item) return true;
  if (options?.forceUnlocked) return false;
  if (PREVIEW_UNLOCK_ALL) return false;
  if (item.isArchive) return false;
  return item.locked;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString();
}

function formatScheduleDayLabel(value: Date) {
  return value.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).toUpperCase();
}

function formatTournamentGameDate(valueMs: number) {
  if (!Number.isFinite(valueMs)) return "";
  return new Date(valueMs).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  });
}

function formatTournamentGameDateTime(valueMs: number) {
  if (!Number.isFinite(valueMs)) return "Time TBD";
  return new Date(valueMs).toLocaleString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function gameTimeLabelFromGame(game: Game, startMs: number) {
  const rawGame = game as unknown as Record<string, unknown>;
  const explicitTime = String(rawGame.timeLabel || "").trim();
  if (explicitTime) return explicitTime;
  if (!Number.isFinite(startMs)) return "";
  return new Date(startMs).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC"
  });
}

function formatTournamentGameDisplay(startMs: number, explicitTimeLabel: string) {
  const cleanTime = String(explicitTimeLabel || "").trim();
  if (!Number.isFinite(startMs)) {
    return cleanTime || "Time TBD";
  }
  if (!cleanTime) return formatTournamentGameDateTime(startMs);
  const dateLabel = formatTournamentGameDate(startMs);
  return dateLabel ? `${dateLabel}, ${cleanTime}` : cleanTime;
}

function extractGameNoLabel(game: Game, index: number) {
  const rawGame = game as unknown as Record<string, unknown>;
  const explicitGameNo = String(rawGame.gameNo || "").trim();
  if (explicitGameNo) {
    return explicitGameNo.startsWith("#") ? explicitGameNo : `#${explicitGameNo}`;
  }
  return `#${index + 1}`;
}

function sanitizeScore(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!value) return "00";
  if (/^\d+$/.test(value)) return value.padStart(2, "0");
  return value;
}

function pickGameScore(game: Game, side: "home" | "away") {
  const rawGame = game as unknown as Record<string, unknown>;
  const candidateKeys = side === "home"
    ? ["homeScore", "team1Score", "team_1_score", "score1", "score_home"]
    : ["awayScore", "team2Score", "team_2_score", "score2", "score_away"];
  for (const key of candidateKeys) {
    if (rawGame[key] != null && String(rawGame[key]).trim()) {
      return sanitizeScore(rawGame[key]);
    }
  }
  return "00";
}

function inferAgeDivisionLabel(homeTeam: string, awayTeam: string) {
  const text = `${homeTeam} ${awayTeam}`.toLowerCase();
  const ageToken = text.match(/\b(\d{1,2})u\b/i);
  if (ageToken?.[1]) return `${ageToken[1]}U`;
  if (/\bvarsity\b/.test(text)) return "Varsity";
  if (/\bprospect\b/.test(text)) return "Prospect";
  if (/\bpremier\b/.test(text)) return "Premier";
  if (/\bjv|junior varsity\b/.test(text)) return "JV";
  return "-";
}

function pickAgeDivision(game: Game) {
  const rawGame = game as unknown as Record<string, unknown>;
  const explicitAgeDiv = String(rawGame.ageDiv || "").trim();
  if (explicitAgeDiv) return explicitAgeDiv;
  return inferAgeDivisionLabel(game.homeTeam, game.awayTeam);
}

function normalizeTeamDetailsScheduleRows(input: unknown) {
  if (!Array.isArray(input)) return [] as TeamDetailsScheduleRow[];
  return input
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        gameNo: String(item?.gameNo || "").trim(),
        date: String(item?.date || "").trim(),
        time: String(item?.time || "").trim(),
        field: String(item?.field || "").trim(),
        homeTeam: String(item?.homeTeam || "").trim(),
        awayTeam: String(item?.awayTeam || "").trim(),
        dayLabel: String(item?.dayLabel || "").trim() || undefined,
        ageDiv: String(item?.ageDiv || "").trim() || undefined,
        homeScore: String(item?.homeScore || "").trim() || undefined,
        awayScore: String(item?.awayScore || "").trim() || undefined
      } satisfies TeamDetailsScheduleRow;
    })
    .filter((row) => row.homeTeam || row.awayTeam || row.gameNo || row.time || row.field);
}

function looksLikeRosterPlayerName(value: string) {
  const name = String(value || "").trim();
  if (!name || name.length < 4) return false;
  if (!/[A-Za-z]/.test(name)) return false;
  if (/\d{2,}/.test(name)) return false;
  if (/[|@]/.test(name)) return false;
  if (!/^[A-Za-z'.-]+(?:\s+[A-Za-z'.-]+){1,4}$/.test(name)) return false;
  if (
    /visit team page|advanced search|hs state rankings|state rankings|tournament|roster schedule|roster tools|diamondkast|perfect game|sign in|create account|players|teams|events|schedule|bracket|results|leaders|top performers|probable pitchers/i.test(name)
  ) {
    return false;
  }
  return true;
}

function normalizePlaceholderCell(value: string) {
  return String(value || "").trim().toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
}

function isPlaceholderCellValue(value: string) {
  const normalized = normalizePlaceholderCell(value);
  if (!normalized) return true;
  if (normalized === "-" || normalized === "--" || normalized === "---") return true;
  return normalized === "n/a"
    || normalized === "na"
    || normalized === "none"
    || normalized === "unknown"
    || normalized === "tbd"
    || normalized === "null";
}

function hasTeamDetailsRosterSignal(row: TeamDetailsRosterRow, targetTeamName = "") {
  const no = String(row.no || "").trim();
  const school = String(row.school || "").trim();
  const hometown = String(row.hometown || "").trim();
  const commitment = String(row.commitment || "").trim();
  const normalizedTargetTeam = normalizeSmartSearch(targetTeamName);
  const schoolMatchesTargetTeam = Boolean(
    normalizedTargetTeam
    && school
    && normalizeSmartSearch(school) === normalizedTargetTeam
  );
  const noLooksReal = /^\d{1,3}$/.test(no);
  const hometownLooksReal = Boolean(!isPlaceholderCellValue(hometown) && /[a-z]/i.test(hometown));
  const schoolLooksReal = Boolean(
    school
    && !isPlaceholderCellValue(school)
    && /[a-z]/i.test(school)
    && !schoolMatchesTargetTeam
  );
  const commitmentLooksReal = Boolean(!isPlaceholderCellValue(commitment) && /[a-z]/i.test(commitment));
  return Boolean(
    noLooksReal
    || hometownLooksReal
    || schoolLooksReal
    || commitmentLooksReal
  );
}

function normalizeTeamDetailsRosterRows(input: unknown, targetTeamName = "") {
  if (!Array.isArray(input)) return [] as TeamDetailsRosterRow[];
  return input
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        no: String(item?.no || "").trim(),
        name: String(item?.name || "").trim(),
        position: String(item?.position || "").trim(),
        school: String(item?.school || "").trim(),
        hometown: String(item?.hometown || "").trim() || undefined,
        commitment: String(item?.commitment || "").trim() || undefined,
        team: String(item?.team || "").trim() || undefined
      } satisfies TeamDetailsRosterRow;
    })
    .filter((row) => {
      if (!looksLikeRosterPlayerName(row.name || "")) return false;
      const position = String(row.position || "").trim();
      if (/roster\s*schedule|advanced search|state rankings|tournament/i.test(position)) return false;
      if (!hasTeamDetailsRosterSignal(row, targetTeamName)) return false;
      return true;
    });
}

function parseTeamDetailsScheduleSortMs(row: TeamDetailsScheduleRow, index: number) {
  const candidates = [
    `${String(row.date || "").trim()} ${String(row.time || "").trim()}`.trim(),
    String(row.date || "").trim(),
    String(row.dayLabel || "").trim()
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.MAX_SAFE_INTEGER - (1000 - (index % 1000));
}

function toInputDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Keep planner input clock aligned with schedule display clock (UTC).
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function parsePlannerDateTimeInputMs(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    // Interpret datetime-local fields as UTC wall-clock so feasibility checks
    // stay consistent with tournament game times rendered in UTC.
    return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function localInputToOffsetIso(localInput: string) {
  const parsedMs = parsePlannerDateTimeInputMs(localInput);
  if (!Number.isFinite(parsedMs)) return localInput;
  return new Date(parsedMs).toISOString();
}

function makeOrgKey(orgId: string, userId: string, key: string) {
  return `bird_dog:${orgId}:${userId}:${key}`;
}

function parseJsonSafe<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeLocalGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

function safeLocalRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
}

type InventoryCacheSnapshot = {
  cachedAt: string;
  subscribed: boolean;
  inventory: InventoryTournament[];
};

function inventoryCacheStorageKey(user: SessionUser | null) {
  if (!user) return "";
  const orgScope = normalizeStorageScope(user.orgId || "org");
  const userScope = normalizeStorageScope(user.userId || "user");
  return `${INVENTORY_CACHE_STORAGE_KEY_PREFIX}:${orgScope}:${userScope}`;
}

function sanitizeInventoryRows(rows: unknown): InventoryTournament[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((item) => {
      const row = item as Record<string, unknown>;
      const company = String(row?.company || "").trim().toUpperCase() === "PBR" ? "PBR" : "PG";
      const season = String(row?.season || "").trim().toLowerCase() === "fall" ? "fall" : "summer";
      return {
        slug: String(row?.slug || "").trim(),
        name: String(row?.name || "").trim(),
        season,
        company,
        locked: Boolean(row?.locked),
        isArchive: Boolean(row?.isArchive),
        harvestHint: row?.harvestHint ? String(row.harvestHint) : "",
        displayDate: row?.displayDate ? String(row.displayDate) : "",
        displayTeams: row?.displayTeams ? String(row.displayTeams) : "",
        displayCity: row?.displayCity ? String(row.displayCity) : ""
      } as InventoryTournament;
    })
    .filter((item) => item.slug && item.name);
}

function readInventoryCacheSnapshot(user: SessionUser | null, maxAgeMs = 10 * 60 * 1000) {
  const key = inventoryCacheStorageKey(user);
  if (!key) return null as InventoryCacheSnapshot | null;
  const parsed = parseJsonSafe<Partial<InventoryCacheSnapshot> | null>(safeLocalGet(key), null);
  if (!parsed) return null as InventoryCacheSnapshot | null;
  const cachedAt = String(parsed.cachedAt || "");
  const cachedAtMs = Date.parse(cachedAt);
  if (Number.isFinite(cachedAtMs) && Date.now() - cachedAtMs > maxAgeMs) return null;
  const inventory = sanitizeInventoryRows(parsed.inventory);
  if (!inventory.length) return null;
  return {
    cachedAt,
    subscribed: Boolean(parsed.subscribed),
    inventory
  } as InventoryCacheSnapshot;
}

function writeInventoryCacheSnapshot(user: SessionUser | null, inventory: InventoryTournament[], subscribed: boolean) {
  const key = inventoryCacheStorageKey(user);
  if (!key || !inventory.length) return;
  const payload: InventoryCacheSnapshot = {
    cachedAt: new Date().toISOString(),
    subscribed: Boolean(subscribed),
    inventory
  };
  safeLocalSet(key, JSON.stringify(payload));
}

function isPlanWorkflowStatus(value: string | null | undefined): value is PlanWorkflowStatus {
  return value === "draft" || value === "pending_approval" || value === "approved";
}

function isTravelPlanItem(item: PlanItem) {
  return /^travel\s+\d+:/i.test(String(item.title || ""));
}

function recommendationItemTone(item: PlanItem) {
  const detail = String(item.detail || "").toLowerCase();
  if (/not feasible within next|cannot reach|same-day scouting may be impossible/.test(detail)) return "blocked";
  if (/live quote unavailable|credentials are not configured|did not return a bookable fare|endpoint is not configured/.test(detail)) return "limited";
  if (isTravelPlanItem(item)) return "ready";
  return "neutral";
}

function getBookingBlockReasonFromPlan(plan: PlanItem[]) {
  const travelItems = plan.filter((item) => isTravelPlanItem(item));
  if (!travelItems.length) return "No travel legs are available yet.";
  const blocked = travelItems.some((item) => recommendationItemTone(item) === "blocked");
  if (blocked) return "No feasible route is available for this destination right now.";
  const hasReadyTravel = travelItems.some((item) => recommendationItemTone(item) === "ready");
  if (!hasReadyTravel) return "No live bookable option is available right now.";
  return "";
}

function localScheduleFallbackKey(
  user: SessionUser | null,
  company: "PG" | "PBR",
  inventorySlug?: string,
  tournamentId?: string
) {
  if (!user) return "";
  const companyScope = normalizeStorageScope(company || "pg");
  const eventScope = normalizeStorageScope(inventorySlug || tournamentId || "global");
  return `${LOCAL_SCHEDULE_FALLBACK_KEY}:${user.orgId}:${user.userId}:${companyScope}:${eventScope}`;
}

function latestScheduleTimestampMs(schedule: CoachSchedule | null | undefined) {
  if (!schedule) return NaN;
  const planTimes = Array.isArray(schedule.generated_plan)
    ? schedule.generated_plan
      .map((item) => Date.parse(String(item?.at || "")))
      .filter((value) => Number.isFinite(value))
    : [];
  if (planTimes.length) return Math.max(...planTimes);
  const flightAt = Date.parse(String(schedule.flight_arrival_time || ""));
  if (Number.isFinite(flightAt)) return flightAt;
  return NaN;
}

function isScheduleExpired(schedule: CoachSchedule | null | undefined) {
  const latestAt = latestScheduleTimestampMs(schedule);
  if (!Number.isFinite(latestAt)) return false;
  return latestAt < Date.now();
}

function normalizeStorageScope(value: string) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "na";
}

function rosterCartStorageKey(input: {
  company: "PG" | "PBR";
  inventorySlug?: string;
  tournamentId?: string;
}) {
  const scopeSeed = input.inventorySlug || input.tournamentId || "";
  const scoped = normalizeStorageScope(scopeSeed);
  if (scopeSeed) {
    return `${ROSTER_CART_STORAGE_KEY_PREFIX}:scope:${scoped}`;
  }
  const companyScope = normalizeStorageScope(input.company);
  return `${ROSTER_CART_STORAGE_KEY_PREFIX}:${companyScope}`;
}

function legacyRosterCartStorageKey(company: "PG" | "PBR", inventorySlug?: string) {
  const companyScope = normalizeStorageScope(company);
  const inventoryScope = normalizeStorageScope(inventorySlug || "");
  if (inventorySlug) {
    return `${ROSTER_CART_STORAGE_KEY_PREFIX}:${companyScope}:${inventoryScope}`;
  }
  return `${ROSTER_CART_STORAGE_KEY_PREFIX}:${companyScope}`;
}

function normalizePlayerIdentityPart(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function desiredPlayerIdentityKey(item: DesiredPlayer) {
  const name = normalizePlayerIdentityPart(item.name || "");
  const hometown = normalizePlayerIdentityPart(item.hometown || "");
  if (name && hometown) return `${name}::${hometown}`;
  if (name) return name;
  return String(item.selectionKey || item.playerId);
}

function desiredPlayerDedupeKey(item: DesiredPlayer) {
  const stable = String(item.selectionKey || item.playerId || "").trim();
  if (stable) return `id:${stable}`;
  const identity = desiredPlayerIdentityKey(item);
  return identity ? `identity:${identity}` : "";
}

function dedupeDesiredPlayersByIdentity(rows: DesiredPlayer[]) {
  const deduped = new Map<string, DesiredPlayer>();
  rows.forEach((item) => {
    const key = desiredPlayerDedupeKey(item) || desiredPlayerIdentityKey(item);
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  });
  return Array.from(deduped.values());
}

function sanitizeDesiredPlayer(item: DesiredPlayer | null | undefined): DesiredPlayer | null {
  if (!item) return null;
  const playerId = String(item.playerId || "").trim();
  const selectionKey = String(item.selectionKey || "").trim();
  const stableSelectionKey = selectionKey || playerId;
  const name = String(item.name || "").trim();
  const team = String(item.team || "").trim();
  const hasMeaningfulToken = (value: string) => !isPlaceholderCellValue(value);
  const hasTeamSelectionSignal = () => {
    if (!stableSelectionKey.toLowerCase().startsWith("team:")) return true;
    if (hasMeaningfulToken(String(item.hometown || ""))) return true;
    if (hasMeaningfulToken(String(item.sourceGameId || ""))) return true;
    const selectionPayload = stableSelectionKey.split(":").slice(2).join(":");
    if (!selectionPayload) return false;
    if (selectionPayload.includes("|")) {
      const tokens = selectionPayload.split("|");
      const noToken = String(tokens[0] || "").trim();
      const hometownToken = String(tokens[2] || "").trim();
      const schoolToken = String(tokens[3] || "").trim();
      return hasMeaningfulToken(noToken) || hasMeaningfulToken(hometownToken) || hasMeaningfulToken(schoolToken);
    }
    if (selectionPayload.includes("::")) {
      const noToken = String(selectionPayload.split("::")[0] || "").trim();
      return hasMeaningfulToken(noToken);
    }
    return false;
  };
  if (!playerId || !name || !team) return null;
  if (!looksLikeRosterPlayerName(name)) return null;
  if (isRosterPlaceholderTeamName(team)) return null;
  if (!hasTeamSelectionSignal()) return null;
  return {
    playerId,
    selectionKey: selectionKey || undefined,
    name,
    team,
    hometown: String(item.hometown || "").trim() || undefined,
    sourceTeamId: String(item.sourceTeamId || "").trim() || undefined,
    sourceTeamName: String(item.sourceTeamName || "").trim() || undefined,
    sourceGameId: String(item.sourceGameId || "").trim() || undefined,
    sourceGameStartAt: String(item.sourceGameStartAt || "").trim() || undefined,
    sourceGameTimeLabel: String(item.sourceGameTimeLabel || "").trim() || undefined,
    sourceGameOpponent: String(item.sourceGameOpponent || "").trim() || undefined,
    sourceGameField: String(item.sourceGameField || "").trim() || undefined
  };
}

function sanitizeDesiredPlayers(rows: DesiredPlayer[]) {
  const clean = rows
    .map((item) => sanitizeDesiredPlayer(item))
    .filter((item): item is DesiredPlayer => Boolean(item));
  return dedupeDesiredPlayersByIdentity(clean);
}

function mergeRosterCartStorage(keys: string[]) {
  const merged = new Map<string, DesiredPlayer>();
  keys.forEach((key) => {
    if (!key) return;
    const rows = readRosterCartStorage(key);
    rows.forEach((item) => {
      const dedupeKey = desiredPlayerDedupeKey(item) || desiredPlayerIdentityKey(item);
      if (!merged.has(dedupeKey)) {
        merged.set(dedupeKey, item);
      }
    });
  });
  return Array.from(merged.values());
}

function desiredPlayersScopedStorageKey(input: {
  orgId: string;
  userId: string;
  company: "PG" | "PBR";
  inventorySlug?: string;
  tournamentId?: string;
}) {
  const orgScope = normalizeStorageScope(input.orgId || "org");
  const userScope = normalizeStorageScope(input.userId || "user");
  const companyScope = normalizeStorageScope(input.company || "pg");
  const inventoryScope = normalizeStorageScope(input.inventorySlug || input.tournamentId || "global");
  return `${DESIRED_PLAYERS_STORAGE_KEY_PREFIX}:${orgScope}:${userScope}:${companyScope}:${inventoryScope}`;
}

function coachTravelInputsStorageKey(input: {
  orgId: string;
  userId: string;
  company: "PG" | "PBR";
  inventorySlug?: string;
  tournamentId?: string;
}) {
  const orgScope = normalizeStorageScope(input.orgId || "org");
  const userScope = normalizeStorageScope(input.userId || "user");
  const companyScope = normalizeStorageScope(input.company || "pg");
  const inventoryScope = normalizeStorageScope(input.inventorySlug || input.tournamentId || "global");
  return `${COACH_TRAVEL_INPUTS_STORAGE_KEY_PREFIX}:${orgScope}:${userScope}:${companyScope}:${inventoryScope}`;
}

function sanitizeStateArrivalInputs(
  value: unknown
): Record<string, StateArrivalInput> {
  if (!value || typeof value !== "object") return {};
  const next: Record<string, StateArrivalInput> = {};
  Object.entries(value as Record<string, unknown>).forEach(([stateCode, raw]) => {
    const normalized = String(stateCode || "").trim().toUpperCase();
    if (!normalized) return;
    const row = (raw || {}) as Record<string, unknown>;
    const arrivalLocation = String(row.arrivalLocation || "").trim();
    const arrivalTime = String(row.arrivalTime || "").trim();
    if (!arrivalLocation && !arrivalTime) return;
    next[normalized] = { arrivalLocation, arrivalTime };
  });
  return next;
}

function sanitizeStateHotelInputs(
  value: unknown
): Record<string, StateHotelInput> {
  if (!value || typeof value !== "object") return {};
  const next: Record<string, StateHotelInput> = {};
  Object.entries(value as Record<string, unknown>).forEach(([stateCode, raw]) => {
    const normalized = String(stateCode || "").trim().toUpperCase();
    if (!normalized) return;
    const row = (raw || {}) as Record<string, unknown>;
    const hotelName = String(row.hotelName || "").trim();
    const checkIn = String(row.checkIn || "").trim();
    const checkOut = String(row.checkOut || "").trim();
    if (!hotelName && !checkIn && !checkOut) return;
    next[normalized] = { hotelName, checkIn, checkOut };
  });
  return next;
}

function readRosterCartStorage(key: string) {
  const raw = safeLocalGet(key);
  const parsed = parseJsonSafe<Array<Record<string, unknown>>>(raw, []);
  if (!Array.isArray(parsed)) return [] as DesiredPlayer[];
  const rows = parsed
    .map((item) => ({
      playerId: String(item?.playerId || ""),
      selectionKey: item?.selectionKey ? String(item.selectionKey) : undefined,
      name: String(item?.name || ""),
      team: String(item?.team || ""),
      hometown: item?.hometown ? String(item.hometown) : undefined,
      sourceTeamId: item?.sourceTeamId ? String(item.sourceTeamId) : undefined,
      sourceTeamName: item?.sourceTeamName ? String(item.sourceTeamName) : undefined,
      sourceGameId: item?.sourceGameId ? String(item.sourceGameId) : undefined,
      sourceGameStartAt: item?.sourceGameStartAt ? String(item.sourceGameStartAt) : undefined,
      sourceGameTimeLabel: item?.sourceGameTimeLabel ? String(item.sourceGameTimeLabel) : undefined,
      sourceGameOpponent: item?.sourceGameOpponent ? String(item.sourceGameOpponent) : undefined,
      sourceGameField: item?.sourceGameField ? String(item.sourceGameField) : undefined
    }))
    .filter((item) => item.playerId && item.name && item.team);
  return sanitizeDesiredPlayers(rows);
}

function writeRosterCartStorage(key: string, rows: DesiredPlayer[]) {
  safeLocalSet(key, JSON.stringify(sanitizeDesiredPlayers(rows)));
}

function readLegacyRosterCartStorage() {
  if (typeof window === "undefined") return [] as DesiredPlayer[];
  const merged = new Map<string, DesiredPlayer>();
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith("bird_dog:roster_cart:v1:")) continue;
      const rows = readRosterCartStorage(key);
      rows.forEach((item) => {
        merged.set(String(item.selectionKey || item.playerId), item);
      });
    }
  } catch {
    return [] as DesiredPlayer[];
  }
  return Array.from(merged.values());
}

function readDesiredPlayersStorage(key: string) {
  if (!key) return null as DesiredPlayer[] | null;
  const raw = safeLocalGet(key);
  if (raw == null) return null as DesiredPlayer[] | null;
  const parsed = parseJsonSafe<Array<Record<string, unknown>>>(raw, []);
  if (!Array.isArray(parsed)) return [] as DesiredPlayer[];
  const rows = parsed
    .map((item) => ({
      playerId: String(item?.playerId || ""),
      selectionKey: item?.selectionKey ? String(item.selectionKey) : undefined,
      name: String(item?.name || ""),
      team: String(item?.team || ""),
      hometown: item?.hometown ? String(item.hometown) : undefined,
      sourceTeamId: item?.sourceTeamId ? String(item.sourceTeamId) : undefined,
      sourceTeamName: item?.sourceTeamName ? String(item.sourceTeamName) : undefined,
      sourceGameId: item?.sourceGameId ? String(item.sourceGameId) : undefined,
      sourceGameStartAt: item?.sourceGameStartAt ? String(item.sourceGameStartAt) : undefined,
      sourceGameTimeLabel: item?.sourceGameTimeLabel ? String(item.sourceGameTimeLabel) : undefined,
      sourceGameOpponent: item?.sourceGameOpponent ? String(item.sourceGameOpponent) : undefined,
      sourceGameField: item?.sourceGameField ? String(item.sourceGameField) : undefined
    }))
    .filter((item) => item.playerId && item.name && item.team);
  return sanitizeDesiredPlayers(rows);
}

function writeDesiredPlayersStorage(key: string, rows: DesiredPlayer[]) {
  if (!key) return;
  safeLocalSet(key, JSON.stringify(sanitizeDesiredPlayers(rows)));
}

function readLegacyDesiredPlayersStorage(orgId: string, userId: string) {
  if (typeof window === "undefined") return [] as DesiredPlayer[];
  const orgScope = normalizeStorageScope(orgId || "org");
  const userScope = normalizeStorageScope(userId || "user");
  const prefix = `${DESIRED_PLAYERS_STORAGE_KEY_PREFIX}:${orgScope}:${userScope}:`;
  const merged = new Map<string, DesiredPlayer>();
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(prefix) || key.endsWith(":global")) continue;
      const rows = readDesiredPlayersStorage(key) || [];
      rows.forEach((item) => {
        merged.set(String(item.selectionKey || item.playerId), item);
      });
    }
  } catch {
    return [] as DesiredPlayer[];
  }
  return Array.from(merged.values());
}

function splitNameParts(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: "Scout", lastName: "User" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function profileStorageKey(user: SessionUser | null) {
  if (!user) return "";
  return `${PROFILE_FORM_STORAGE_KEY_PREFIX}:${user.orgId}:${user.userId}`;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function hexToRgb(hex: string) {
  const raw = hex.replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((ch) => `${ch}${ch}`).join("") : raw;
  if (!/^[\da-f]{6}$/i.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  };
}

function alphaColor(hex: string, alpha: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(31,58,95,${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function schoolColorPair(seed: string) {
  const palette = [
    { primary: "#5b1832", accent: "#f1d26a" },
    { primary: "#0f2d52", accent: "#d7a316" },
    { primary: "#5a1f07", accent: "#f6c46b" },
    { primary: "#11402d", accent: "#bfe28d" },
    { primary: "#10263f", accent: "#8dc7ff" },
    { primary: "#2f193f", accent: "#c4a4ff" }
  ];
  const raw = seed.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const earthRadius = 6371;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function eventIdFromHint(hint?: string) {
  if (!hint) return "";
  const match = hint.match(/[?&]event=(\d+)/i);
  return match ? `pg-${match[1]}` : "";
}

function normalizeLocationText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeVenueLabel(value: string) {
  const normalized = normalizeLocationText(value);
  if (!normalized) return false;
  return /\b(field|homefield|complex|park|stadium|little league|sports|academy|school|campus|diamond|baseball|softball|court|rink|arena)\b/.test(normalized)
    || /\b[a-z]{1,4}\d+\b/.test(normalized)
    || /\b\w*field\b/.test(normalized);
}

function looksLikeStreetSegment(value: string) {
  const normalized = normalizeLocationText(value);
  if (!normalized) return false;
  if (/\d/.test(normalized)) return true;
  return /\b(st|street|ave|avenue|blvd|boulevard|rd|road|ln|lane|dr|drive|hwy|highway|parkway|pkwy|suite|ste|unit|apt)\b/.test(normalized);
}

function extractCityToken(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const firstSegmentRaw = normalizeLocationText(raw.split(",")[0] || "");
  const segments = raw
    .split(",")
    .map((segment) => normalizeLocationText(segment))
    .filter(Boolean);
  if (!segments.length) return "";
  if (segments.length === 1) return segments[0];

  const hasStateInRaw = Boolean(extractUsStateCode(raw));
  const firstLooksLikeVenue = looksLikeVenueLabel(firstSegmentRaw);
  if (firstLooksLikeVenue) {
    for (let i = 1; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!segment) continue;
      if (segment === "united states" || segment === "usa") continue;
      if (US_STATE_CODES.has(segment.toUpperCase())) continue;
      if (Object.prototype.hasOwnProperty.call(US_STATE_NAME_TO_CODE, segment)) continue;
      if (looksLikeStreetSegment(segment)) continue;
      return segment;
    }
  }
  if (hasStateInRaw) {
    for (let i = 1; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!segment) continue;
      if (segment === "united states" || segment === "usa") continue;
      if (US_STATE_CODES.has(segment.toUpperCase())) continue;
      if (Object.prototype.hasOwnProperty.call(US_STATE_NAME_TO_CODE, segment)) continue;
      if (looksLikeStreetSegment(segment)) continue;
      return segment;
    }
  }

  if (looksLikeStreetSegment(firstSegmentRaw)) {
    for (let i = 1; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!segment) continue;
      if (segment === "united states" || segment === "usa") continue;
      if (US_STATE_CODES.has(segment.toUpperCase())) continue;
      if (Object.prototype.hasOwnProperty.call(US_STATE_NAME_TO_CODE, segment)) continue;
      if (looksLikeStreetSegment(segment)) continue;
      return segment;
    }
  }

  return firstSegmentRaw || segments[0];
}

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC"
]);

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC"
};

function extractUsStateCode(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  const codeMatch = upper.match(/(?:,|\s)([A-Z]{2})(?:\b|$)/);
  if (codeMatch?.[1] && US_STATE_CODES.has(codeMatch[1])) {
    return codeMatch[1];
  }
  const normalized = normalizeLocationText(raw);
  for (const [name, code] of Object.entries(US_STATE_NAME_TO_CODE)) {
    if (normalized.includes(name)) return code;
  }
  return "";
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractedPlanLocation(item: PlanItem): string {
  const title = (item.title || "").trim();
  const detail = (item.detail || "").trim();
  if (/^go to /i.test(title)) return title.replace(/^go to /i, "").trim();
  if (/^travel /i.test(title) && title.includes("->")) {
    return title.split("->").slice(-1)[0]?.trim() || "";
  }
  const fieldMatch = detail.match(/field:\s*([^·]+)/i);
  if (fieldMatch?.[1]) return fieldMatch[1].trim();
  if (/^return to hotel$/i.test(title) && detail) return detail;
  return "";
}

function scheduleCandidates(schedule: CoachSchedule) {
  const out: Array<{ atMs: number; atIso: string; label: string; norm: string }> = [];
  for (const item of schedule.generated_plan || []) {
    const label = extractedPlanLocation(item);
    const atMs = Date.parse(item.at || "");
    const norm = normalizeLocationText(label);
    if (label && norm && Number.isFinite(atMs)) {
      out.push({ atMs, atIso: item.at, label, norm });
    }
  }
  const fallbackLocation = schedule.hotel_name || schedule.flight_destination || "";
  const fallbackAt = schedule.flight_arrival_time || "";
  const fallbackMs = Date.parse(fallbackAt);
  const fallbackNorm = normalizeLocationText(fallbackLocation);
  if (fallbackLocation && fallbackNorm && Number.isFinite(fallbackMs)) {
    out.push({ atMs: fallbackMs, atIso: fallbackAt, label: fallbackLocation, norm: fallbackNorm });
  }
  return out;
}

function isPlanStepInfeasible(item: PlanItem) {
  return String(item.detail || "").toLowerCase().includes("not feasible within next");
}

function isShareableSchedule(schedule: CoachSchedule | null | undefined) {
  if (!schedule) return false;
  const plan = Array.isArray(schedule.generated_plan) ? schedule.generated_plan : [];
  if (!plan.length) return false;
  return !plan.some((item) => isPlanStepInfeasible(item));
}

function buildCoachMeetSuggestion(
  mine: CoachSchedule | null,
  other: CoachSchedule,
  myLive: CoachLiveLocation | null,
  otherLive: CoachLiveLocation | null
): CoachMeetSuggestion {
  if (myLive && otherLive) {
    const km = distanceKm(myLive.latitude, myLive.longitude, otherLive.latitude, otherLive.longitude);
    if (km <= 150) {
      const midLat = (myLive.latitude + otherLive.latitude) / 2;
      const midLng = (myLive.longitude + otherLive.longitude) / 2;
      return {
        kind: "midpoint",
        label: "Live midpoint available",
        detail: `You are ~${km.toFixed(1)} km apart. Meet now at midpoint.`,
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${midLat},${midLng}`
      };
    }
  }

  if (mine) {
    const mineCandidates = scheduleCandidates(mine);
    const otherCandidates = scheduleCandidates(other);
    let best:
      | { location: string; atMs: number; gapMs: number }
      | null = null;
    for (const a of mineCandidates) {
      for (const b of otherCandidates) {
        if (a.norm !== b.norm) continue;
        const gapMs = Math.abs(a.atMs - b.atMs);
        if (gapMs > 3 * 60 * 60 * 1000) continue;
        const chosen = Math.min(a.atMs, b.atMs);
        if (!best || gapMs < best.gapMs) {
          best = { location: a.label, atMs: chosen, gapMs };
        }
      }
    }
    if (best) {
      return {
        kind: "common",
        label: best.location,
        detail: `Common point around ${new Date(best.atMs).toLocaleString()}`,
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(best.location)}`
      };
    }
  }

  return {
    kind: "none",
    label: "No common point",
    detail: "No shared location/time window found yet."
  };
}

function normalizeTournamentName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tournamentGameCount(value: Tournament | null | undefined) {
  return Array.isArray(value?.games) ? value.games.length : 0;
}

function tournamentTeamCount(value: Tournament | null | undefined) {
  return Array.isArray(value?.teams) ? value.teams.length : 0;
}

function chooseStableTournamentSnapshot(existing: Tournament | null | undefined, incoming: Tournament) {
  if (!existing) return incoming;
  const existingGames = tournamentGameCount(existing);
  const incomingGames = tournamentGameCount(incoming);
  const existingTeams = tournamentTeamCount(existing);
  const incomingTeams = tournamentTeamCount(incoming);

  const keepExistingGames = existingGames > 0 && incomingGames === 0;
  const keepExistingTeams = existingTeams > 0 && incomingTeams === 0;

  if (!keepExistingGames && !keepExistingTeams) return incoming;
  return {
    ...incoming,
    games: keepExistingGames ? existing.games : incoming.games,
    teams: keepExistingTeams ? existing.teams : incoming.teams
  };
}

function mergeTournamentSnapshotList(existingList: Tournament[], incoming: Tournament) {
  const existing = existingList.find((item) => item.id === incoming.id);
  const stable = chooseStableTournamentSnapshot(existing, incoming);
  const filtered = existingList.filter((item) => item.id !== incoming.id);
  return {
    tournament: stable,
    list: [stable, ...filtered]
  };
}

function normalizeSmartSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function smartSearchFallbackTeamId(name: string, teamId?: string) {
  const explicitId = String(teamId || "").trim();
  if (explicitId) return explicitId;
  const normalizedName = normalizeSmartSearch(name);
  if (!normalizedName) return "";
  return `smart-team-${normalizedName.replace(/\s+/g, "-")}`;
}

function smartSearchTeamCacheKey(input: { id?: string; name?: string; href?: string }) {
  const id = String(input.id || "").trim().toLowerCase();
  if (id) return `id:${id}`;
  const href = String(input.href || "").trim().toLowerCase();
  if (href) return `href:${href}`;
  const normalizedName = normalizeSmartSearch(String(input.name || ""));
  if (normalizedName) return `name:${normalizedName}`;
  return "";
}

function buildSmartSearchFallbackTeamRef(
  teamName: string,
  teamId?: string,
  teamHref?: string
): TeamRef | null {
  const cleanedName = String(teamName || "").trim();
  if (!cleanedName || isRosterPlaceholderTeamName(cleanedName)) return null;
  const id = smartSearchFallbackTeamId(cleanedName, teamId);
  if (!id && !String(teamHref || "").trim()) return null;
  const href = String(teamHref || "").trim();
  const stableFallbackId = id || `smart-team-${encodeURIComponent(cleanedName.toLowerCase())}`;
  return {
    id: stableFallbackId,
    name: cleanedName,
    from: "",
    href: href || undefined
  };
}

function teamNameTokens(value: string) {
  const generic = new Set([
    "team",
    "baseball",
    "club",
    "academy",
    "elite",
    "prime",
    "national",
    "select",
    "sports",
    "varsity",
    "junior",
    "jr",
    "the"
  ]);
  return normalizeSmartSearch(value)
    .split(" ")
    .filter((token) => {
      if (!token || token.length < 2) return false;
      if (/^\d+u$/.test(token)) return false;
      if (/^\d+$/.test(token)) return false;
      if (generic.has(token)) return false;
      return true;
    });
}

function isRosterPlaceholderTeamName(value: string) {
  const normalized = normalizeSmartSearch(value);
  if (!normalized) return true;
  if (normalized === "tbd" || normalized === "home field") return true;
  if (/^seed\s*#?\s*\d+$/i.test(normalized)) return true;
  if (/^(winner|loser)\s*#?\d+$/i.test(normalized)) return true;
  if (/^(winner|loser)\s+of\s+(game|match)\s*#?\d+$/i.test(normalized)) return true;
  if (/^(winner|loser)\s+(game|match)\s*#?\d+$/i.test(normalized)) return true;
  if (/^(pool|division|overall)\s+[a-z0-9]+\s+place\s+\d+$/i.test(normalized)) return true;
  return false;
}

function smartPlayerSelectionKey(teamId: string, playerId: string) {
  return `${teamId}::${playerId}`;
}

function desiredPlayerSelectionKey(item: DesiredPlayer) {
  return item.selectionKey || item.playerId;
}

function coachNoteMatchesPlayer(note: CoachSharedNote, player: DesiredPlayer) {
  if (note.player_id && note.player_id === player.playerId) return true;
  const transcriptNorm = normalizeSearchText(note.transcript || "");
  const playerNorm = normalizeSearchText(player.name || "");
  if (!transcriptNorm || !playerNorm) return false;
  return transcriptNorm.includes(playerNorm);
}

function withHotelReturnLeg(plan: PlanItem[], hotelName: string) {
  const cleanHotel = hotelName.trim();
  if (!cleanHotel) return plan;
  if (plan.some((step) => /^return to hotel$/i.test(step.title))) return plan;
  const lastAt = plan[plan.length - 1]?.at || "";
  const lastMs = Date.parse(lastAt);
  const returnAt = Number.isFinite(lastMs)
    ? new Date(lastMs + 30 * 60 * 1000).toISOString()
    : new Date().toISOString();
  return [
    ...plan,
    {
      at: returnAt,
      title: "Return to hotel",
      detail: cleanHotel
    }
  ];
}

type TravelEstimate = {
  mode: string;
  minutes: number;
  advisory?: string;
  distanceKm?: number;
  delayMinutes?: number;
};
const MAX_FEASIBLE_TRAVEL_HOURS = 12;
const MAX_FEASIBLE_TRAVEL_MINUTES = MAX_FEASIBLE_TRAVEL_HOURS * 60;

function looksLikeUsLocation(value: string) {
  const v = normalizeLocationText(value);
  return /\b(united states|usa|tx|ms|fl|ga|al|ca|ny|nj|pa|nc|sc|va|wa|or|il|in|oh|mi|az|co|tn|ky|la|ok|nm|ut|nv|id|mt|wy|nd|sd|ne|ks|ia|mo|ar|me|vt|nh|ma|ct|ri|de|md|wv|dc)\b/.test(v);
}

function looksLikeIndiaLocation(value: string) {
  const v = normalizeLocationText(value);
  return /\b(india|bihar|karnataka|maharashtra|delhi|tamil nadu|telangana|andhra|uttar pradesh|west bengal|gujarat|kerala|rajasthan|odisha|punjab|haryana)\b/.test(v);
}

function formatEta(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
}

function formatPlanClock(valueMs: number) {
  return new Date(valueMs).toLocaleTimeString(undefined, {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function mapsDirectionsUrl(fromLabel: string, toLabel: string, fromPoint?: GeoLocation | null, toPoint?: GeoLocation | null) {
  const origin = fromPoint?.lat != null && fromPoint?.lng != null
    ? `${fromPoint.lat},${fromPoint.lng}`
    : fromLabel;
  const destination = toPoint?.lat != null && toPoint?.lng != null
    ? `${toPoint.lat},${toPoint.lng}`
    : toLabel;
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving"
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function mapsSearchUrl(label: string, point?: GeoLocation | null) {
  const query = point?.lat != null && point?.lng != null
    ? `${point.lat},${point.lng}`
    : label;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function mapsSearchUrlForHotel(hotel: HotelSuggestion) {
  const query = [hotel.name, hotel.address].filter(Boolean).join(", ").trim() || "hotel";
  const params = new URLSearchParams({ api: "1", query });
  if (hotel.placeId) {
    params.set("query_place_id", hotel.placeId);
  }
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function hasReasonableHotelWindow(plan: PlanItem[]) {
  if (!plan.length) return false;
  const scoutTimes = plan
    .filter((item) => /^scout game/i.test(String(item.title || "")))
    .map((item) => Date.parse(String(item.at || "")))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!scoutTimes.length) return false;

  const travelTimes = plan
    .filter((item) => /^travel\s+\d+:/i.test(String(item.title || "")))
    .map((item) => Date.parse(String(item.at || "")))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const firstReference = Number.isFinite(travelTimes[0]) ? travelTimes[0] : scoutTimes[0];
  if (scoutTimes[0] - firstReference >= 45 * 60 * 1000) {
    return true;
  }
  for (let index = 1; index < scoutTimes.length; index += 1) {
    if (scoutTimes[index] - scoutTimes[index - 1] >= 90 * 60 * 1000) {
      return true;
    }
  }
  return false;
}

function sanitizePlanMapUrl(value: string | undefined) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (!/^https:\/\/www\.google\.com\/maps\//i.test(clean)) return "";
  return clean;
}

const MONTH_TOKEN_TO_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

function monthTokenToIndex(token: string) {
  return MONTH_TOKEN_TO_INDEX[String(token || "").trim().slice(0, 3).toLowerCase()] ?? null;
}

function parseTournamentDateStartMs(dateValue: string) {
  const raw = String(dateValue || "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return new Date(year, month - 1, day, 9, 0, 0, 0).getTime();
  }
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    return new Date(year, month - 1, day, 9, 0, 0, 0).getTime();
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0, 0).getTime();
  }
  return null;
}

function parseDisplayDateStartMs(displayDate: string, fallbackYear: number) {
  const raw = String(displayDate || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const usDate = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usDate) {
    const month = Number(usDate[1]);
    const day = Number(usDate[2]);
    const year = Number(usDate[3]);
    return new Date(year, month - 1, day, 9, 0, 0, 0).getTime();
  }

  const range = raw.match(/^([A-Za-z]+)\s*(\d{1,2})\s*-\s*([A-Za-z]+)?\s*(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (range) {
    const monthToken = range[1];
    const day = Number(range[2]);
    const explicitYear = range[5] ? Number(range[5]) : fallbackYear;
    const monthIdx = monthTokenToIndex(monthToken);
    if (monthIdx != null && Number.isFinite(day)) {
      return new Date(explicitYear, monthIdx, day, 9, 0, 0, 0).getTime();
    }
  }

  const single = raw.match(/^([A-Za-z]+)\s*(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (single) {
    const monthIdx = monthTokenToIndex(single[1]);
    const day = Number(single[2]);
    const year = single[3] ? Number(single[3]) : fallbackYear;
    if (monthIdx != null && Number.isFinite(day)) {
      return new Date(year, monthIdx, day, 9, 0, 0, 0).getTime();
    }
  }

  return null;
}

function extractYearFromTournamentLabel(nameOrDate: string, fallbackYear: number) {
  const match = String(nameOrDate || "").match(/\b(20\d{2})\b/);
  if (!match) return fallbackYear;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : fallbackYear;
}

function travelModeByText(from: string, to: string): TravelEstimate {
  const fromCity = extractCityToken(from);
  const toCity = extractCityToken(to);
  const fromState = extractUsStateCode(from);
  const toState = extractUsStateCode(to);
  if (fromCity && toCity && fromCity === toCity && fromState && toState && fromState === toState) {
    return {
      mode: "Local Transfer",
      minutes: 22,
      advisory: `Same-city route (${fromState}).`
    };
  }
  if (fromState && toState && fromState === toState) {
    return {
      mode: "Drive / Cab",
      minutes: 40,
      advisory: `Same-state fallback route (${fromState}). Live map ETA will be used when available.`
    };
  }
  const indiaUs = (looksLikeIndiaLocation(from) && looksLikeUsLocation(to))
    || (looksLikeIndiaLocation(to) && looksLikeUsLocation(from));
  if (indiaUs) {
    return {
      mode: "Long-distance transfer",
      minutes: 12 * 60,
      advisory: "Long cross-region route. Leave early to stay on schedule."
    };
  }
  if (looksLikeUsLocation(from) && looksLikeUsLocation(to)) {
    return {
      mode: "Intercity transfer",
      minutes: 4 * 60 + 30
    };
  }
  return {
    mode: "Ground transfer",
    minutes: 75
  };
}

function travelModeByDistance(km: number): TravelEstimate {
  if (km >= 9000) {
    return {
      mode: "Long-distance transfer",
      minutes: Math.round((km / 420) * 60 + 240),
      advisory: "Very long route; prioritize early-start games first."
    };
  }
  if (km >= 5500) {
    return {
      mode: "Long-distance transfer",
      minutes: Math.round((km / 320) * 60 + 180),
      advisory: "Long route across regions."
    };
  }
  if (km >= 1200) return { mode: "Intercity transfer", minutes: Math.round((km / 110) * 60 + 90) };
  if (km >= 300) return { mode: "Drive / Cab", minutes: Math.round((km / 85) * 60 + 50) };
  if (km >= 45) return { mode: "Cab / Car", minutes: Math.round((km / 45) * 60 + 20) };
  return { mode: "Local Transfer", minutes: Math.max(20, Math.round((km / 22) * 60 + 10)) };
}

function perfectGameUrlForItem(item: InventoryTournament) {
  const rawHint = (item.harvestHint || "").trim();
  if (/^https?:\/\/www\.perfectgame\.org\//i.test(rawHint)) return rawHint;
  return `https://www.perfectgame.org/search.aspx?search=${encodeURIComponent(item.name)}`;
}

function tournamentDateBadge(name: string, liveDate?: string) {
  if (liveDate) return liveDate;
  const low = name.toLowerCase();
  if (low.includes("underclass world")) return "Oct 1-5";
  if (low.includes("freshman world")) return "Oct 8-12";
  if (low.includes("wwba world championship") && !low.includes("freshman") && !low.includes("underclass")) return "Oct 8-12";
  if (low.includes("13u & 14u world")) return "Oct 16-19";
  if (low.includes("sophomore world")) return "Sep 24-28";
  return "";
}

function inventorySortStartMs(item: InventoryTournament) {
  const fallbackYear = extractYearFromTournamentLabel(
    `${item.name || ""} ${item.displayDate || ""}`,
    new Date().getFullYear()
  );
  return parseDisplayDateStartMs(String(item.displayDate || ""), fallbackYear) ?? Number.MAX_SAFE_INTEGER;
}

function tournamentAgeGroups(item: InventoryTournament) {
  const rawName = String(item.name || "");
  const text = `${rawName} ${item.harvestHint || ""}`;
  const values: number[] = [];
  const pushAge = (raw: string) => {
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 1 && value <= 22) values.push(value);
  };

  const leading = rawName.match(/^\s*(\d{1,2})(?:\s*\/\s*(\d{1,2}))?(?:\s*u)?\b/i);
  if (leading) {
    pushAge(leading[1]);
    if (leading[2]) pushAge(leading[2]);
  }

  Array.from(text.matchAll(/\b(\d{1,2})\s*u\b/gi)).forEach((m) => pushAge(m[1]));
  Array.from(text.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*u\b/gi)).forEach((m) => {
    pushAge(m[1]);
    pushAge(m[2]);
  });
  Array.from(text.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*u)?\b/gi)).forEach((m) => {
    pushAge(m[1]);
    pushAge(m[2]);
  });
  Array.from(text.matchAll(/\b(\d{1,2})\s*u?\s*[&/,-]\s*(\d{1,2})\s*u\b/gi)).forEach((m) => {
    pushAge(m[1]);
    pushAge(m[2]);
  });
  Array.from(
    text.matchAll(/\b(8|9|1[0-9]|2[0-2])\b(?=\s*(?:u\b|open\b|classic\b|showdown\b|battle\b|world\b|series\b|games\b|invite\b|invitational\b|championships?\b|amateur\b|underclass\b|freshman\b|sophomore\b))/gi)
  ).forEach((m) => pushAge(m[1]));

  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function hasUnder15AgeSignal(item: InventoryTournament) {
  const text = [
    String(item.name || ""),
    String(item.slug || ""),
    String(item.harvestHint || "")
  ].join(" ").toLowerCase();
  if (!text.trim()) return false;

  if (/\b(?:0?[1-9]|1[0-4])\s*u\b/.test(text)) return true;
  if (/\b(?:0?[1-9]|1[0-4])\s*\/\s*(?:0?[1-9]|1[0-4])\s*u?\b/.test(text)) return true;
  if (/(?:^|[^0-9])(?:[1-9]u|10u|11u|12u|13u|14u)(?:[^0-9]|$)/.test(text)) return true;
  return false;
}

function isTournamentAtLeast15U(item: InventoryTournament) {
  if (hasUnder15AgeSignal(item)) return false;
  const ages = tournamentAgeGroups(item);
  if (!ages.length) return true;
  return ages.every((age) => age >= 15);
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...(init || {}),
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function inventoryMatchesAgeFilter(item: InventoryTournament, filter: string) {
  const normalized = String(filter || "").trim().toUpperCase();
  if (!normalized || normalized === "ALL") {
    return true;
  }
  if (normalized === "15U+") {
    return isTournamentAtLeast15U(item);
  }
  const wantedAge = Number(normalized.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(wantedAge)) return true;
  const ages = tournamentAgeGroups(item);
  if (!ages.length) return false;
  return ages.includes(wantedAge);
}

function notesRosterRowSelectionKey(row: TeamDetailsRosterRow) {
  const base = [
    normalizeSmartSearch(row.no || ""),
    normalizeSmartSearch(row.name || ""),
    normalizeSmartSearch(row.hometown || ""),
    normalizeSmartSearch(row.school || "")
  ].join("|");
  return base || normalizeSmartSearch(`${row.name}-${row.no}`) || "player";
}

function mergeTeamDetailsRosterRows(groups: TeamDetailsRosterRow[][], targetTeamName = "") {
  const merged = new Map<string, TeamDetailsRosterRow>();
  const canonicalByName = new Map<string, string>();
  const pickValue = (nextValue?: string, currentValue?: string) => {
    const cleanNext = String(nextValue || "").trim();
    if (cleanNext && cleanNext !== "-") return cleanNext;
    const cleanCurrent = String(currentValue || "").trim();
    return cleanCurrent;
  };

  groups.forEach((rows) => {
    rows.forEach((row) => {
      if (!looksLikeRosterPlayerName(row.name || "")) return;
      const rawPosition = String(row.position || "").trim();
      if (/roster\s*schedule|advanced search|state rankings|tournament/i.test(rawPosition)) return;
      if (!hasTeamDetailsRosterSignal(row, targetTeamName)) return;
      const normalizedName = normalizeSmartSearch(row.name || "");
      if (!normalizedName) return;
      const normalizedNo = normalizeSmartSearch(row.no || "");
      const proposedKey = normalizedNo ? `${normalizedNo}|${normalizedName}` : normalizedName;
      if (!proposedKey) return;
      const canonicalKey = canonicalByName.get(normalizedName) || proposedKey;
      const existing = merged.get(canonicalKey);
      if (!existing) {
        merged.set(canonicalKey, row);
        canonicalByName.set(normalizedName, canonicalKey);
        return;
      }
      const mergedRow: TeamDetailsRosterRow = {
        ...existing,
        ...row,
        no: pickValue(row.no, existing.no),
        name: pickValue(row.name, existing.name),
        position: pickValue(row.position, existing.position),
        school: pickValue(row.school, existing.school),
        hometown: pickValue(row.hometown, existing.hometown),
        commitment: pickValue(row.commitment, existing.commitment),
        team: pickValue(row.team, existing.team)
      };
      const mergedNo = normalizeSmartSearch(mergedRow.no || "");
      const nextKey = mergedNo ? `${mergedNo}|${normalizedName}` : canonicalKey;
      if (nextKey !== canonicalKey) {
        merged.delete(canonicalKey);
      }
      merged.set(nextKey, mergedRow);
      canonicalByName.set(normalizedName, nextKey);
    });
  });
  return Array.from(merged.values());
}

function sortInventoryForDisplay(rows: InventoryTournament[]) {
  const bySlug = new Map<string, InventoryTournament>();
  rows.forEach((row) => {
    const key = `${row.company}:${row.slug}`;
    const existing = bySlug.get(key);
    if (!existing) {
      bySlug.set(key, row);
      return;
    }
    const score = (item: InventoryTournament) => {
      let value = 0;
      if (String(item.displayDate || "").trim()) value += 4;
      if (String(item.displayTeams || "").trim()) value += 3;
      if (String(item.displayCity || "").trim()) value += 2;
      if (String(item.harvestHint || "").trim()) value += 1;
      if (/\b(8|9|1[0-9]|2[0-2])\s*u\b/i.test(String(item.name || ""))) value += 5;
      return value;
    };
    if (score(row) >= score(existing)) {
      bySlug.set(key, row);
    }
  });

  return Array.from(bySlug.values()).sort((a, b) => {
    const aStart = inventorySortStartMs(a);
    const bStart = inventorySortStartMs(b);
    if (aStart !== bStart) return aStart - bStart;
    return a.name.localeCompare(b.name);
  });
}

function uniquePlayers(games: Game[]): Player[] {
  const map = new Map<string, Player>();
  games.forEach((g) => g.players.forEach((p) => map.set(p.id, p)));
  return Array.from(map.values());
}

function buildPath(games: Game[], watchlistIds: Set<string>): ItineraryStop[] {
  const GAME_MINUTES = 120;
  const MIN_VIEW_MINUTES = 25;
  const PRE_GAME_BUFFER_MINUTES = 10;
  const DEFAULT_TRAVEL_MINUTES = 12;

  const candidates = games
    .map((game) => {
      const targets = game.players.filter((p) => watchlistIds.has(p.id));
      if (!targets.length) return null;
      const startMs = new Date(game.startTime).getTime();
      const endMs = startMs + GAME_MINUTES * 60 * 1000;
      return {
        game,
        targetPlayers: targets,
        targetIds: targets.map((p) => p.id),
        startMs,
        endMs
      };
    })
    .filter((item): item is {
      game: Game;
      targetPlayers: Player[];
      targetIds: string[];
      startMs: number;
      endMs: number;
    } => Boolean(item))
    .sort((a, b) => a.startMs - b.startMs);

  if (!candidates.length) return [];

  const usedGameIds = new Set<string>();
  const coveredPlayerIds = new Set<string>();
  const result: OptimizedStop[] = [];

  let currentEndMs = 0;
  let prevField: Game["fieldLocation"] | null = null;

  const travelMinutesBetween = (from: Game["fieldLocation"] | null, to: Game["fieldLocation"]) => {
    if (!from) return 0;
    const hasValid =
      Number.isFinite(from.x) && Number.isFinite(from.y) && Number.isFinite(to.x) && Number.isFinite(to.y);
    if (!hasValid) return DEFAULT_TRAVEL_MINUTES;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    return Math.max(2, Math.round(distance * 4));
  };

  while (usedGameIds.size < candidates.length) {
    let best: OptimizedStop | null = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      if (usedGameIds.has(candidate.game.id)) continue;

      const travelMins = travelMinutesBetween(prevField, candidate.game.fieldLocation);
      const earliestArrivalMs = currentEndMs
        ? currentEndMs + (travelMins + PRE_GAME_BUFFER_MINUTES) * 60 * 1000
        : candidate.startMs;
      const arrivalMs = Math.max(candidate.startMs, earliestArrivalMs);
      const remainingMinutes = Math.floor((candidate.endMs - arrivalMs) / (60 * 1000));
      if (remainingMinutes < MIN_VIEW_MINUTES) continue;

      const lateByMinutes = Math.max(0, Math.floor((arrivalMs - candidate.startMs) / (60 * 1000)));
      const newCoverage = candidate.targetIds.filter((id) => !coveredPlayerIds.has(id)).length;
      const totalCoverage = candidate.targetIds.length;
      const waitMinutes = Math.max(0, Math.floor((candidate.startMs - earliestArrivalMs) / (60 * 1000)));

      // Weighted score favors new target coverage, then total targets,
      // while penalizing long travel, wait, and late arrival.
      const score =
        newCoverage * 20
        + totalCoverage * 6
        - travelMins * 0.8
        - waitMinutes * 0.2
        - lateByMinutes * 1.2;

      if (score > bestScore) {
        bestScore = score;
        best = {
          gameId: candidate.game.id,
          field: candidate.game.field,
          at: new Date(arrivalMs).toISOString(),
          watchlistCount: totalCoverage,
          players: candidate.targetPlayers.map((p) => p.name),
          walkFromPrevMinutes: travelMins,
          gameStartAt: new Date(candidate.startMs).toISOString(),
          gameEndAt: new Date(candidate.endMs).toISOString(),
          arrivalAt: new Date(arrivalMs).toISOString(),
          coveredPlayerIds: candidate.targetIds,
          lateByMinutes
        };
      }
    }

    if (!best) break;

    usedGameIds.add(best.gameId);
    best.coveredPlayerIds.forEach((id) => coveredPlayerIds.add(id));
    currentEndMs = new Date(best.gameEndAt).getTime();
    const chosen = candidates.find((c) => c.game.id === best.gameId);
    prevField = chosen?.game.fieldLocation || null;
    result.push(best);
  }

  return result.map((item) => ({
    gameId: item.gameId,
    field: item.field,
    at: item.at,
    watchlistCount: item.watchlistCount,
    players: item.players,
    walkFromPrevMinutes: item.walkFromPrevMinutes
  }));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read audio blob."));
    reader.readAsDataURL(blob);
  });
}

function chooseRecorderMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  const candidates = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus"
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export default function BirdDogPage() {
  const router = useRouter();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const [companies, setCompanies] = useState<("PG" | "PBR")[]>([]);
  const [company, setCompany] = useState<"PG" | "PBR">("PG");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [loadingHarvest, setLoadingHarvest] = useState(false);

  const [jobs, setJobs] = useState<HarvestJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobHint, setJobHint] = useState("PG Spring Showdown");

  const [inventory, setInventory] = useState<InventoryTournament[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [unlockingSlug, setUnlockingSlug] = useState("");
  const [openingSlug, setOpeningSlug] = useState("");
  const [inventoryRefreshing, setInventoryRefreshing] = useState(false);
  const [openError, setOpenError] = useState("");
  const [selectedInventorySlug, setSelectedInventorySlug] = useState("");
  const [activeTab, setActiveTab] = useState<BirdDogTab>("tournaments");
  const [inlineTeamNoteDrafts, setInlineTeamNoteDrafts] = useState<Record<string, InlineTeamNoteDraft>>({});
  const [inlineTeamNoteStatuses, setInlineTeamNoteStatuses] = useState<Record<string, string>>({});
  const [inlineTeamNoteRecorderState, setInlineTeamNoteRecorderState] = useState<RecorderState>("idle");
  const [inlineTeamNoteRecordingKey, setInlineTeamNoteRecordingKey] = useState<string | null>(null);
  const [inlineTeamNoteRecordingTarget, setInlineTeamNoteRecordingTarget] = useState<InlineTeamNoteTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const [queryStateApplied, setQueryStateApplied] = useState(false);
  const selectedTournamentIdRef = useRef("");
  const selectedInventorySlugRef = useRef("");
  const companyRef = useRef<"PG" | "PBR">("PG");
  const inventoryRef = useRef<InventoryTournament[]>([]);
  const inventoryFetchSeqRef = useRef(0);
  const schedulesFetchSeqRef = useRef(0);
  const tournamentMutationSeqRef = useRef(0);
  const tabHistoryRef = useRef<BirdDogTab[]>([]);

  const [schedules, setSchedules] = useState<CoachSchedule[]>([]);
  const [coachSharedNotesByUser, setCoachSharedNotesByUser] = useState<Map<string, CoachSharedNote[]>>(new Map());
  const [coachSharedNotesLoading, setCoachSharedNotesLoading] = useState(false);
  const [liveLocations, setLiveLocations] = useState<CoachLiveLocation[]>([]);
  const [locationSharingEnabled, setLocationSharingEnabled] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [coachFilterQuery, setCoachFilterQuery] = useState("");
  const [coachFilterDate, setCoachFilterDate] = useState("");
  const [coachFilterMeetMode, setCoachFilterMeetMode] = useState<"all" | "common" | "none">("all");
  const [scheduleForm, setScheduleForm] = useState({
    flightSource: "Current location",
    flightDestination: "",
    flightArrivalTime: "",
    hotelName: "",
    notes: ""
  });
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceSuggestion[]>([]);
  const [hotelSuggestions, setHotelSuggestions] = useState<HotelSuggestion[]>([]);
  const [stateArrivalSuggestions, setStateArrivalSuggestions] = useState<Record<string, PlaceSuggestion[]>>({});
  const [stateHotelNameSuggestions, setStateHotelNameSuggestions] = useState<Record<string, PlaceSuggestion[]>>({});
  const [stateArrivalSuggestionsLoading, setStateArrivalSuggestionsLoading] = useState<Record<string, boolean>>({});
  const [stateHotelNameSuggestionsLoading, setStateHotelNameSuggestionsLoading] = useState<Record<string, boolean>>({});
  const [activeStateArrivalInput, setActiveStateArrivalInput] = useState("");
  const [activeStateHotelInput, setActiveStateHotelInput] = useState("");
  const stateArrivalSuggestionSeqRef = useRef<Record<string, number>>({});
  const stateHotelSuggestionSeqRef = useRef<Record<string, number>>({});
  const [tournamentSearchQuery, setTournamentSearchQuery] = useState("");
  const [tournamentAgeFilter, setTournamentAgeFilter] = useState("ALL");
  const [tournamentAgeFilterOpen, setTournamentAgeFilterOpen] = useState(false);
  const [teamsSearchQuery, setTeamsSearchQuery] = useState("");
  const [teamsSearchStableQuery, setTeamsSearchStableQuery] = useState("");
  const [teamListSearchQuery, setTeamListSearchQuery] = useState("");
  const [tournamentTeamSearchMode, setTournamentTeamSearchMode] = useState<"team" | "player">("team");
  const [notesSelectedTeam, setNotesSelectedTeam] = useState<TeamRef | null>(null);
  const [notesTeamScheduleRows, setNotesTeamScheduleRows] = useState<TeamDetailsScheduleRow[]>([]);
  const [notesTeamRosterRows, setNotesTeamRosterRows] = useState<TeamDetailsRosterRow[]>([]);
  const [notesSelectedRosterRowKeys, setNotesSelectedRosterRowKeys] = useState<string[]>([]);
  const [notesTeamLoading, setNotesTeamLoading] = useState(false);
  const [notesTeamStatus, setNotesTeamStatus] = useState("");
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");
  const [scheduleSearchPlayerTeamIds, setScheduleSearchPlayerTeamIds] = useState<string[]>([]);
  const [scheduleSearchPlayerTeamNames, setScheduleSearchPlayerTeamNames] = useState<string[]>([]);
  const [scheduleSearchLoading, setScheduleSearchLoading] = useState(false);
  const [playerSearchResults, setPlayerSearchResults] = useState<SmartPlayerResult[]>([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);
  const [playerSearchStatus, setPlayerSearchStatus] = useState("");
  const [playerSearchCanDeepScan, setPlayerSearchCanDeepScan] = useState(false);
  const [desiredPlayers, setDesiredPlayers] = useState<DesiredPlayer[]>([]);
  const [teamRosterCartPlayers, setTeamRosterCartPlayers] = useState<DesiredPlayer[]>([]);
  const [desiredPlayerId, setDesiredPlayerId] = useState("");
  const [myGeneratedPlan, setMyGeneratedPlan] = useState<PlanItem[]>([]);
  const [smartRouteHint, setSmartRouteHint] = useState("");
  const [flightBooked, setFlightBooked] = useState<"yes" | "no">("no");
  const [stateArrivalInputs, setStateArrivalInputs] = useState<Record<string, StateArrivalInput>>({});
  const [hotelBooked, setHotelBooked] = useState<"yes" | "no">("no");
  const [stateHotelInputs, setStateHotelInputs] = useState<Record<string, StateHotelInput>>({});
  const [questionOpen, setQuestionOpen] = useState({
    flight: false,
    arrival: false,
    hotel: false
  });
  const [planWorkflowStatus, setPlanWorkflowStatus] = useState<PlanWorkflowStatus>("draft");
  const [planWorkflowNote, setPlanWorkflowNote] = useState("");
  const [focusGeneratedScheduleRequested, setFocusGeneratedScheduleRequested] = useState(false);
  const [latestBookingSummary, setLatestBookingSummary] = useState<BookingSummarySnapshot | null>(null);
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [draggingDesiredPlayerKey, setDraggingDesiredPlayerKey] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    firstName: "Scout",
    lastName: "User",
    universityEmail: "",
    gender: "UNSPECIFIED",
    countryCallingCode: "1",
    mobileNumber: "",
    dateOfBirth: "1990-01-01"
  });
  const [profileStatus, setProfileStatus] = useState("");

  const selectedTournament = useMemo(
    () => tournaments.find((t) => t.id === selectedTournamentId) || null,
    [tournaments, selectedTournamentId]
  );
  const displayInventory = useMemo(() => inventory, [inventory]);
  const selectedInventory = useMemo(
    () => displayInventory.find((item) => item.slug === selectedInventorySlug) || null,
    [displayInventory, selectedInventorySlug]
  );
  const eventLocationHint = useMemo(() => {
    const candidates = [
      String(selectedInventory?.displayCity || "").trim(),
      String(selectedTournament?.city || "").trim(),
      ...((selectedTournament?.teams || []).map((team) => String(team.from || "").trim()).filter(Boolean)),
      String(selectedTournament?.name || "").trim()
    ].filter(Boolean);
    return candidates[0] || "";
  }, [selectedInventory?.displayCity, selectedTournament?.city, selectedTournament?.name, selectedTournament?.teams]);
  const airportStartLabel = useMemo(() => {
    const base = String(eventLocationHint || "Event City").trim();
    if (!base) return "Event City Airport";
    if (/\bairport\b/i.test(base)) return base;
    return `${base} Airport`;
  }, [eventLocationHint]);
  const tournamentPlanningStartMs = useMemo(() => {
    const gameStarts = (selectedTournament?.games || [])
      .map((game) => Date.parse(String(game.startTime || "")))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    if (gameStarts.length) return gameStarts[0];

    const fallbackYear = extractYearFromTournamentLabel(
      `${selectedInventory?.name || ""} ${selectedTournament?.name || ""} ${selectedInventory?.displayDate || ""}`,
      new Date().getFullYear()
    );
    const fromTournamentDate = parseTournamentDateStartMs(String(selectedTournament?.date || ""));
    if (fromTournamentDate != null) return fromTournamentDate;
    const fromInventoryDate = parseDisplayDateStartMs(String(selectedInventory?.displayDate || ""), fallbackYear);
    if (fromInventoryDate != null) return fromInventoryDate;
    return Date.now() + 2 * 60 * 60 * 1000;
  }, [selectedInventory?.displayDate, selectedInventory?.name, selectedTournament?.date, selectedTournament?.games, selectedTournament?.name]);

  useEffect(() => {
    if (!airportStartLabel) return;
    setScheduleForm((prev) => {
      if (prev.flightSource === airportStartLabel) return prev;
      return { ...prev, flightSource: airportStartLabel };
    });
  }, [airportStartLabel]);
  const bookingBlockReason = useMemo(
    () => getBookingBlockReasonFromPlan(myGeneratedPlan),
    [myGeneratedPlan]
  );
  const canBookRecommendation = myGeneratedPlan.length > 0 && !bookingBlockReason;
  const isAdminUser = Boolean(user?.isAdmin) || isPrivilegedAdminEmail(String(user?.email || ""));
  const canAccessLockedPages = Boolean(selectedInventory && !isTournamentLocked(selectedInventory, { forceUnlocked: isAdminUser }));
  const planWorkflowStatusKey = useMemo(() => {
    if (!user) return "";
    const scopeSlug = selectedInventorySlug || "inventory";
    const scopeTournament = selectedTournamentId || "tournament";
    return `${PLAN_WORKFLOW_STATUS_KEY_PREFIX}:${user.orgId}:${user.userId}:${scopeSlug}:${scopeTournament}`;
  }, [selectedInventorySlug, selectedTournamentId, user]);
  const teamRosterCartStorageKey = useMemo(
    () => rosterCartStorageKey({
      company,
      inventorySlug: selectedInventorySlug,
      tournamentId: selectedTournamentId
    }),
    [company, selectedInventorySlug, selectedTournamentId]
  );
  const teamRosterCartLegacyKeys = useMemo(() => {
    const scopedInventoryKey = selectedInventorySlug
      ? rosterCartStorageKey({ company, inventorySlug: selectedInventorySlug })
      : "";
    const scopedTournamentKey = selectedTournamentId
      ? rosterCartStorageKey({ company, tournamentId: selectedTournamentId })
      : "";
    const hasScopedContext = Boolean(selectedInventorySlug || selectedTournamentId);
    const candidates = hasScopedContext
      ? [
        scopedInventoryKey,
        scopedTournamentKey,
        legacyRosterCartStorageKey(company, selectedInventorySlug)
      ]
      : [
        scopedInventoryKey,
        scopedTournamentKey,
        rosterCartStorageKey({ company }),
        ROSTER_CART_GLOBAL_KEY,
        legacyRosterCartStorageKey(company, selectedInventorySlug),
        legacyRosterCartStorageKey(company)
      ];
    return Array.from(new Set(candidates.filter(Boolean)));
  }, [company, selectedInventorySlug, selectedTournamentId]);
  const desiredPlayersStorageKey = useMemo(() => {
    if (!user) return "";
    return desiredPlayersScopedStorageKey({
      orgId: user.orgId,
      userId: user.userId,
      company,
      inventorySlug: selectedInventorySlug,
      tournamentId: selectedTournamentId
    });
  }, [company, selectedInventorySlug, selectedTournamentId, user]);
  const coachTravelInputsKey = useMemo(() => {
    if (!user) return "";
    return coachTravelInputsStorageKey({
      orgId: user.orgId,
      userId: user.userId,
      company,
      inventorySlug: selectedInventorySlug,
      tournamentId: selectedTournamentId
    });
  }, [company, selectedInventorySlug, selectedTournamentId, user]);

  useEffect(() => {
    selectedTournamentIdRef.current = selectedTournamentId;
  }, [selectedTournamentId]);

  useEffect(() => {
    selectedInventorySlugRef.current = selectedInventorySlug;
  }, [selectedInventorySlug]);

  useEffect(() => {
    companyRef.current = company;
  }, [company]);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  const games = selectedTournament?.games || [];
  const players = useMemo(() => uniquePlayers(games), [games]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const tournamentScheduleGroups = useMemo(() => {
    if (!games.length) return [] as Array<{ dayLabel: string; daySort: number; rows: TournamentScheduleRowView[] }>;

    const rows: TournamentScheduleRowView[] = games.map((game, index) => {
      const start = new Date(String(game.startTime || ""));
      const hasValidStart = Number.isFinite(start.getTime());
      const dayKey = hasValidStart ? start.toISOString().slice(0, 10) : `tbd-${index}`;
      const sortAt = hasValidStart ? start.getTime() : Number.MAX_SAFE_INTEGER - (games.length - index);
      const rawGame = game as unknown as Record<string, unknown>;
      const time = gameTimeLabelFromGame(game, hasValidStart ? start.getTime() : NaN) || "-";
      const homeTeam = String(game.homeTeam || "TBD");
      const awayTeam = String(game.awayTeam || "TBD");
      const explicitDayLabel = String(rawGame.dayLabel || "").trim();
      const dayLabel = explicitDayLabel
        ? `${explicitDayLabel} ${hasValidStart ? `- ${start.toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric", timeZone: "UTC" })}` : ""}`.trim().toUpperCase()
        : (hasValidStart ? formatScheduleDayLabel(start) : "DATE TBD");

      return {
        key: `${game.id || "game"}-${index}`,
        gameId: String(game.id || "").trim() || undefined,
        startAt: String(game.startTime || "").trim() || undefined,
        dayKey,
        dayLabel,
        sortAt,
        time,
        gameNo: extractGameNoLabel(game, index),
        location: String(game.field || "Field TBD"),
        ageDiv: pickAgeDivision(game),
        homeTeam,
        homeTeamId: String(rawGame.homeTeamId || "").trim() || undefined,
        homeTeamHref: String(rawGame.homeTeamHref || "").trim() || undefined,
        homeScore: pickGameScore(game, "home"),
        awayScore: pickGameScore(game, "away"),
        awayTeam,
        awayTeamId: String(rawGame.awayTeamId || "").trim() || undefined,
        awayTeamHref: String(rawGame.awayTeamHref || "").trim() || undefined
      };
    });

    rows.sort((left, right) => left.sortAt - right.sortAt || left.gameNo.localeCompare(right.gameNo));

    const grouped = new Map<string, { dayLabel: string; daySort: number; rows: TournamentScheduleRowView[] }>();
    rows.forEach((row) => {
      const existing = grouped.get(row.dayKey);
      if (existing) {
        existing.rows.push(row);
        return;
      }
      grouped.set(row.dayKey, {
        dayLabel: row.dayLabel,
        daySort: row.sortAt,
        rows: [row]
      });
    });

    return Array.from(grouped.values()).sort((left, right) => left.daySort - right.daySort);
  }, [games]);
  const scheduleSearchNormalized = useMemo(
    () => normalizeSmartSearch(teamsSearchQuery),
    [teamsSearchQuery]
  );
  const scheduleSearchPendingInput = useMemo(
    () => normalizeSmartSearch(teamsSearchQuery) !== normalizeSmartSearch(teamsSearchStableQuery),
    [teamsSearchQuery, teamsSearchStableQuery]
  );
  const scheduleSearchTokens = useMemo(
    () => scheduleSearchNormalized.split(" ").filter(Boolean),
    [scheduleSearchNormalized]
  );
  const filteredTournamentScheduleGroups = useMemo(() => {
    if (!scheduleSearchNormalized) return tournamentScheduleGroups;

    const teamIdSet = new Set(
      scheduleSearchPlayerTeamIds
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const teamNameSet = new Set(
      scheduleSearchPlayerTeamNames
        .map((value) => normalizeSmartSearch(value))
        .filter(Boolean)
    );
    const matchesQuery = (teamName: string) => {
      const normalized = normalizeSmartSearch(teamName);
      if (!normalized) return false;
      return scheduleSearchTokens.every((token) => normalized.includes(token));
    };

    const filtered = tournamentScheduleGroups
      .map((group) => {
        const rows = group.rows.filter((row) => {
          const homeId = String(row.homeTeamId || "").trim().toLowerCase();
          const awayId = String(row.awayTeamId || "").trim().toLowerCase();
          const homeName = normalizeSmartSearch(row.homeTeam);
          const awayName = normalizeSmartSearch(row.awayTeam);
          const directTeamMatch = matchesQuery(row.homeTeam) || matchesQuery(row.awayTeam);
          const playerTeamMatch = (homeId && teamIdSet.has(homeId))
            || (awayId && teamIdSet.has(awayId))
            || teamNameSet.has(homeName)
            || teamNameSet.has(awayName);
          return directTeamMatch || playerTeamMatch;
        });
        return { ...group, rows };
      })
      .filter((group) => group.rows.length > 0);

    return filtered;
  }, [
    scheduleSearchNormalized,
    scheduleSearchPlayerTeamIds,
    scheduleSearchPlayerTeamNames,
    scheduleSearchTokens,
    tournamentScheduleGroups
  ]);
  const filteredTournamentScheduleRowsCount = useMemo(
    () => filteredTournamentScheduleGroups.reduce((total, group) => total + group.rows.length, 0),
    [filteredTournamentScheduleGroups]
  );
  const playerTeamTimingBySelectionKey = useMemo(() => {
    const map = new Map<string, string>();
    const nowMs = Date.now();
    const gameById = new Map<string, Game>();
    games.forEach((game) => {
      const gameId = String(game.id || "").trim();
      if (gameId) gameById.set(gameId, game);
    });
    const formatMatchLine = (input: { startMs: number; timeLabel: string; opponent: string; field: string }) =>
      `${formatTournamentGameDisplay(input.startMs, input.timeLabel)} · vs ${input.opponent} · ${input.field}`;
    desiredPlayers.forEach((player) => {
      const key = desiredPlayerSelectionKey(player);
      const sourceGameId = String(player.sourceGameId || "").trim();
      const sourceGame = sourceGameId ? gameById.get(sourceGameId) : undefined;
      const sourceStartMs = Date.parse(String(player.sourceGameStartAt || ""));
      const matches = games
        .map((game) => {
          const startMs = Date.parse(String(game.startTime || ""));
          if (!Number.isFinite(startMs)) return null;
          const side = playerMatchSideForGame(player, game);
          if (!side) return null;
          const opponent = side === "home" ? game.awayTeam : game.homeTeam;
          return {
            gameId: String(game.id || "").trim(),
            startMs,
            timeLabel: gameTimeLabelFromGame(game, startMs),
            opponent: String(opponent || "TBD"),
            field: String(game.field || "Field TBD")
          };
        })
        .filter((item): item is { gameId: string; startMs: number; timeLabel: string; opponent: string; field: string } => Boolean(item))
        .sort((a, b) => a.startMs - b.startMs);

      const sourceMatch = (sourceGame || Number.isFinite(sourceStartMs) || String(player.sourceGameTimeLabel || "").trim())
        ? (() => {
          const gameStartMs = Date.parse(String(sourceGame?.startTime || ""));
          const startMs = Number.isFinite(gameStartMs) ? gameStartMs : sourceStartMs;
          const side = sourceGame ? playerMatchSideForGame(player, sourceGame) : null;
          const opponentFromGame = sourceGame
            ? String((side === "home" ? sourceGame.awayTeam : side === "away" ? sourceGame.homeTeam : "") || "").trim()
            : "";
          const opponent = String(player.sourceGameOpponent || opponentFromGame || "TBD");
          const field = String(player.sourceGameField || sourceGame?.field || "Field TBD");
          const timeLabel = String(
            player.sourceGameTimeLabel
            || (sourceGame ? gameTimeLabelFromGame(sourceGame, startMs) : "")
            || ""
          ).trim();
          return {
            gameId: sourceGameId,
            startMs,
            timeLabel,
            opponent,
            field
          };
        })()
        : null;

      if (sourceMatch) {
        const hasSourceAlready = matches.some((item) =>
          (sourceMatch.gameId && item.gameId && item.gameId === sourceMatch.gameId)
          || (
            item.startMs === sourceMatch.startMs
            && normalizeSmartSearch(item.opponent) === normalizeSmartSearch(sourceMatch.opponent)
            && normalizeSmartSearch(item.field) === normalizeSmartSearch(sourceMatch.field)
          )
        );
        if (!hasSourceAlready) {
          matches.unshift(sourceMatch);
        }
      }

      if (!matches.length) {
        map.set(key, "Time TBD");
        return;
      }

      const primary = sourceMatch
        ? (matches.find((item) =>
          (sourceMatch.gameId && item.gameId && item.gameId === sourceMatch.gameId)
          || (
            item.startMs === sourceMatch.startMs
            && normalizeSmartSearch(item.opponent) === normalizeSmartSearch(sourceMatch.opponent)
            && normalizeSmartSearch(item.field) === normalizeSmartSearch(sourceMatch.field)
          )
        ) || sourceMatch)
        : (matches.find((item) => item.startMs >= nowMs) || matches[0]);

      const alternateDates = matches
        .filter((item) => item !== primary)
        .slice(0, 4)
        .map((item) => formatTournamentGameDisplay(item.startMs, item.timeLabel));
      const altLabel = alternateDates.length ? ` · Alt: ${alternateDates.join(" | ")}` : "";
      map.set(key, `${formatMatchLine(primary)}${altLabel}`);
    });
    return map;
  }, [desiredPlayers, games]);
  const eventStateCode = useMemo(
    () => extractUsStateCode(String(selectedInventory?.displayCity || selectedTournament?.city || "")),
    [selectedInventory?.displayCity, selectedTournament?.city]
  );
  const requiredStateCodes = useMemo(() => {
    const states = new Set<string>();
    desiredPlayers.forEach((player) => {
      const matchedGame = games.find((game) =>
        Boolean(playerMatchSideForGame(player, game))
      );
      const fromGame = matchedGame
        ? extractUsStateCode(
          `${normalizedVenueLabel(matchedGame)}, ${String(selectedInventory?.displayCity || selectedTournament?.city || "").trim()}`
        )
        : "";
      const fromHometown = extractUsStateCode(player.hometown || "");
      const resolved = fromGame || fromHometown || eventStateCode;
      if (resolved) states.add(resolved);
    });
    if (!states.size && eventStateCode) states.add(eventStateCode);
    return Array.from(states.values());
  }, [desiredPlayers, games, selectedInventory?.displayCity, selectedTournament?.city, eventStateCode]);
  const arrivalAnswersComplete = useMemo(
    () => requiredStateCodes.length > 0 && requiredStateCodes.every((stateCode) => {
      const row = stateArrivalInputs[stateCode];
      return Boolean(String(row?.arrivalLocation || "").trim() && String(row?.arrivalTime || "").trim());
    }),
    [requiredStateCodes, stateArrivalInputs]
  );
  const hotelAnswersComplete = useMemo(
    () => hotelBooked !== "yes"
      || (requiredStateCodes.length > 0 && requiredStateCodes.every((stateCode) => {
        const row = stateHotelInputs[stateCode];
        return Boolean(
          String(row?.hotelName || "").trim()
          && String(row?.checkIn || "").trim()
          && String(row?.checkOut || "").trim()
        );
      })),
    [hotelBooked, requiredStateCodes, stateHotelInputs]
  );
  const primaryRequiredStateCode = requiredStateCodes[0] || "";
  const hotelSuggestionDestination = useMemo(() => {
    const fromEvent = String(selectedInventory?.displayCity || selectedTournament?.city || eventLocationHint || "").trim();
    const withEventFallback = (value: string) => {
      const clean = String(value || "").trim();
      if (clean.length < 2) return "";
      if (!fromEvent || clean.toLowerCase().includes(fromEvent.toLowerCase())) return clean;
      return looksLikeVenueLabel(clean) ? `${clean}, ${fromEvent}` : clean;
    };

    const fromFlight = String(scheduleForm.flightDestination || "").trim();
    if (fromFlight.length >= 2) return withEventFallback(fromFlight);
    if (primaryRequiredStateCode) {
      const fromArrival = String(stateArrivalInputs[primaryRequiredStateCode]?.arrivalLocation || "").trim();
      if (fromArrival.length >= 2) return withEventFallback(fromArrival);
    }
    if (fromEvent.length >= 2) return fromEvent;
    return "";
  }, [
    eventLocationHint,
    primaryRequiredStateCode,
    scheduleForm.flightDestination,
    selectedInventory?.displayCity,
    selectedTournament?.city,
    stateArrivalInputs
  ]);
  const selectedTournamentTeams = selectedTournament?.teams || [];
  const teamsById = useMemo(() => {
    const map = new Map<string, TeamRef>();
    selectedTournamentTeams.forEach((team) => {
      const key = String(team.id || "").trim().toLowerCase();
      if (!key) return;
      if (!map.has(key)) map.set(key, team);
    });
    return map;
  }, [selectedTournamentTeams]);
  const teamsByHref = useMemo(() => {
    const map = new Map<string, TeamRef>();
    selectedTournamentTeams.forEach((team) => {
      const key = String(team.href || "").trim().toLowerCase();
      if (!key) return;
      if (!map.has(key)) map.set(key, team);
    });
    return map;
  }, [selectedTournamentTeams]);
  const teamsByNormalizedName = useMemo(() => {
    const map = new Map<string, TeamRef>();
    selectedTournamentTeams.forEach((team) => {
      const normalized = normalizeSmartSearch(team.name || "");
      if (!normalized) return;
      if (!map.has(normalized)) map.set(normalized, team);
    });
    return map;
  }, [selectedTournamentTeams]);
  const scheduleSearchFallbackTeams = useMemo(() => {
    const list: TeamRef[] = [];
    const seen = new Set<string>();
    const add = (team: TeamRef | null | undefined) => {
      if (!team) return;
      const key = smartSearchTeamCacheKey(team);
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push(team);
    };

    selectedTournamentTeams.forEach((team) => add(team));
    tournamentScheduleGroups.forEach((group) => {
      group.rows.forEach((row) => {
        const homeTeam = (
          (row.homeTeamId ? teamsById.get(String(row.homeTeamId || "").trim().toLowerCase()) : undefined)
          || (row.homeTeamHref ? teamsByHref.get(String(row.homeTeamHref || "").trim().toLowerCase()) : undefined)
          || teamsByNormalizedName.get(normalizeSmartSearch(row.homeTeam))
          || buildSmartSearchFallbackTeamRef(row.homeTeam, row.homeTeamId, row.homeTeamHref)
        );
        const awayTeam = (
          (row.awayTeamId ? teamsById.get(String(row.awayTeamId || "").trim().toLowerCase()) : undefined)
          || (row.awayTeamHref ? teamsByHref.get(String(row.awayTeamHref || "").trim().toLowerCase()) : undefined)
          || teamsByNormalizedName.get(normalizeSmartSearch(row.awayTeam))
          || buildSmartSearchFallbackTeamRef(row.awayTeam, row.awayTeamId, row.awayTeamHref)
        );
        add(homeTeam);
        add(awayTeam);
      });
    });

    return list;
  }, [selectedTournamentTeams, teamsByHref, teamsById, teamsByNormalizedName, tournamentScheduleGroups]);
  const tournamentTeamsForNotes = useMemo(() => {
    const list: TeamRef[] = [];
    const seen = new Set<string>();
    const add = (team: TeamRef | null | undefined) => {
      if (!team) return;
      const cleanName = String(team.name || "").trim();
      if (!cleanName || isRosterPlaceholderTeamName(cleanName)) return;
      const key = smartSearchTeamCacheKey(team) || `name:${normalizeSmartSearch(cleanName)}`;
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push({
        ...team,
        name: cleanName
      });
    };

    selectedTournamentTeams.forEach((team) => add(team));
    scheduleSearchFallbackTeams.forEach((team) => add(team));

    return list.sort((left, right) => left.name.localeCompare(right.name));
  }, [scheduleSearchFallbackTeams, selectedTournamentTeams]);
  const scheduleSearchFallbackTeamsScopeKey = useMemo(
    () => scheduleSearchFallbackTeams.map((team) => smartSearchTeamCacheKey(team)).join("|"),
    [scheduleSearchFallbackTeams]
  );

  const [watchlist, setWatchlist] = useState<string[]>([]);
  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);

  const [notes, setNotes] = useState<ScoutNote[]>([]);
  const [pulses, setPulses] = useState<PulseEvent[]>([]);

  const [selectedGameId, setSelectedGameId] = useState("");
  const [pulseMessage, setPulseMessage] = useState("Pitcher change");
  const [pulseStatus, setPulseStatus] = useState("");

  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [transcript, setTranscript] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("");
  const [tournamentViewTitle, setTournamentViewTitle] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const pullStartYRef = useRef<number | null>(null);
  const pullTriggeredRef = useRef(false);
  const bottomRefreshAtRef = useRef(0);
  const teamRosterSearchCacheRef = useRef<Map<string, TeamRosterSearchRow[]>>(new Map());
  const notesTeamDetailsCacheRef = useRef<Map<string, TeamDetailsSnapshot>>(new Map());
  const notesTeamLoadSeqRef = useRef(0);
  const geocodeCacheRef = useRef<Map<string, GeoLocation | null>>(new Map());
  const tournamentPlayerIndexRef = useRef<TournamentPlayerIndexRow[]>([]);
  const tournamentPlayerIndexKeyRef = useRef("");
  const tournamentPlayerIndexLoadingRef = useRef<Promise<TournamentPlayerIndexRow[]> | null>(null);
  const schedulePlayerTeamQueryCacheRef = useRef<Map<string, { teamIds: string[]; teamNames: string[] }>>(new Map());
  const selectedTournamentHydrationKeyRef = useRef("");
  const selectedTournamentHydrationAttemptAtRef = useRef<Record<string, number>>({});
  const autoPlannerRef = useRef<{ busy: boolean; key: string }>({ busy: false, key: "" });
  const autoCreateScheduleRunKeyRef = useRef("");
  const coachTravelInputsReadyKeyRef = useRef("");
  const generatedSchedulePanelRef = useRef<HTMLDivElement | null>(null);
  const inlineTeamNoteMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const inlineTeamNoteMediaStreamRef = useRef<MediaStream | null>(null);
  const inlineTeamNoteAudioChunksRef = useRef<Blob[]>([]);
  const inlineTeamNoteSpeechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  function setAndPersistPlanWorkflowStatus(next: PlanWorkflowStatus) {
    setPlanWorkflowStatus(next);
    if (!planWorkflowStatusKey) return;
    if (next === "draft") {
      safeLocalRemove(planWorkflowStatusKey);
      return;
    }
    safeLocalSet(planWorkflowStatusKey, next);
  }

  function keepDesiredPlayersInScope(rows: DesiredPlayer[]) {
    const activeTeamIds = new Set(
      selectedTournamentTeams
        .map((team) => String(team.id || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const activeTeamNames = new Set(
      selectedTournamentTeams
        .map((team) => normalizeSmartSearch(team.name || ""))
        .filter(Boolean)
    );
    if (!activeTeamIds.size && !activeTeamNames.size) return rows;
    return rows.filter((item) => {
      const stableSelectionKey = String(desiredPlayerSelectionKey(item) || item.playerId || "").trim();
      const sourceTeamId = String(item.sourceTeamId || "").trim().toLowerCase();
      const sourceTeamName = normalizeSmartSearch(String(item.sourceTeamName || ""));
      const teamName = normalizeSmartSearch(String(item.team || ""));
      const isTeamSelection = stableSelectionKey.toLowerCase().startsWith("team:");
      if (isTeamSelection) {
        const keyTeamId = String(stableSelectionKey.split(":")[1] || "").trim().toLowerCase();
        if (keyTeamId && activeTeamIds.has(keyTeamId)) return true;
        if (sourceTeamId && activeTeamIds.has(sourceTeamId)) return true;
        if (sourceTeamName && activeTeamNames.has(sourceTeamName)) return true;
        if (teamName && activeTeamNames.has(teamName)) return true;
        return false;
      }
      if (sourceTeamId && !activeTeamIds.has(sourceTeamId)) return false;
      if (sourceTeamName && !activeTeamNames.has(sourceTeamName)) return false;
      return true;
    });
  }

  function setDesiredPlayersAndPersist(nextState: SetStateAction<DesiredPlayer[]>) {
    setDesiredPlayers((prev) => {
      const nextRaw = typeof nextState === "function"
        ? (nextState as (previous: DesiredPlayer[]) => DesiredPlayer[])(prev)
        : nextState;
      const next = keepDesiredPlayersInScope(sanitizeDesiredPlayers(nextRaw));
      writeDesiredPlayersStorage(desiredPlayersStorageKey, next);
      return next;
    });
  }

  function pruneLegacyTeamRosterCartAliases() {
    teamRosterCartLegacyKeys.forEach((key) => {
      if (!key || key === teamRosterCartStorageKey) return;
      safeLocalRemove(key);
    });
  }

  function readTeamRosterCartCanonical() {
    if (!teamRosterCartStorageKey) return [] as DesiredPlayer[];
    const canonicalRows = readRosterCartStorage(teamRosterCartStorageKey);
    const aliasRows = mergeRosterCartStorage(teamRosterCartLegacyKeys);
    const merged = keepDesiredPlayersInScope(sanitizeDesiredPlayers([...canonicalRows, ...aliasRows]));
    writeRosterCartStorage(teamRosterCartStorageKey, merged);
    pruneLegacyTeamRosterCartAliases();
    return merged;
  }

  function setTeamRosterCartAndPersist(nextState: SetStateAction<DesiredPlayer[]>) {
    setTeamRosterCartPlayers((prev) => {
      const nextRaw = typeof nextState === "function"
        ? (nextState as (previous: DesiredPlayer[]) => DesiredPlayer[])(prev)
        : nextState;
      const next = keepDesiredPlayersInScope(sanitizeDesiredPlayers(nextRaw));
      if (teamRosterCartStorageKey) {
        writeRosterCartStorage(teamRosterCartStorageKey, next);
      }
      pruneLegacyTeamRosterCartAliases();
      return next;
    });
  }

  function navigateTab(
    nextTab: BirdDogTab,
    options?: { rememberCurrent?: boolean; closeMenu?: boolean }
  ) {
    const rememberCurrent = options?.rememberCurrent !== false;
    setActiveTab((current) => {
      if (current === nextTab) return current;
      if (rememberCurrent) {
        const history = tabHistoryRef.current;
        if (history[history.length - 1] !== current) {
          history.push(current);
        }
      }
      return nextTab;
    });
    if (options?.closeMenu) setMenuOpen(false);
  }

  function popPreviousTab(currentTab: BirdDogTab): BirdDogTab | null {
    const history = tabHistoryRef.current;
    while (history.length) {
      const previous = history.pop();
      if (previous && previous !== currentTab) return previous;
    }
    return null;
  }

  function refreshBookingSummaryFromStorage() {
    const raw = safeLocalGet(BOOKING_SUMMARY_KEY);
    const parsed = parseJsonSafe<BookingSummarySnapshot | null>(raw, null);
    if (!parsed || !Array.isArray(parsed.results)) {
      setLatestBookingSummary(null);
      return;
    }
    setLatestBookingSummary(parsed);
  }

  function clearAutoCreateScheduleQueryFlag() {
    if (typeof window === "undefined") return;
    const current = new URL(window.location.href);
    if (!current.searchParams.has("autoCreateSchedule")) return;
    current.searchParams.delete("autoCreateSchedule");
    if (current.searchParams.get("focus") === "generatedSchedule") {
      current.searchParams.delete("focus");
    }
    const next = `${current.pathname}${current.searchParams.toString() ? `?${current.searchParams.toString()}` : ""}`;
    window.history.replaceState({}, "", next);
  }

  function focusGeneratedSchedulePanel() {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      generatedSchedulePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setFocusGeneratedScheduleRequested(false);
    }, 120);
  }

  useEffect(() => {
    refreshBookingSummaryFromStorage();
    if (typeof window === "undefined") return;
    const onFocus = () => refreshBookingSummaryFromStorage();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!isAdminUser) return;
    if (/locked for your organization/i.test(openError)) {
      setOpenError("");
    }
  }, [isAdminUser, openError]);

  useEffect(() => {
    let mounted = true;
    async function loadSession() {
      try {
        const res = await fetch("/api/session/me");
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const data = await res.json();
        if (!mounted) return;
        setUser(data.user);
      } catch {
        if (!mounted) return;
        router.replace("/login");
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void loadSession();
    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!user) return;
    const cached = readInventoryCacheSnapshot(user, 3 * 60 * 1000);
    if (!cached?.inventory.length) return;
    setInventory((prev) => (prev.length ? prev : cached.inventory));
    if (cached.subscribed) {
      setSubscribed(true);
    }
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    async function boot() {
      const params = new URLSearchParams(window.location.search);
      const requestedCompany = parseCompanyParam(params.get("company") || params.get("provider"));
      try {
        const overview = await loadHarvestOverview();
        if (!mounted) return;
        const nextCompanies: ("PG" | "PBR")[] = overview.companies?.length
          ? overview.companies
          : ["PG", "PBR"];
        setCompanies(nextCompanies);

        const defaultCompany: "PG" | "PBR" = requestedCompany && nextCompanies.includes(requestedCompany)
          ? requestedCompany
          : (nextCompanies[0] || "PG");
        const requestedTournamentId = String(params.get("tournamentId") || "").trim();
        await Promise.allSettled([
          loadCompanyData(defaultCompany, false, requestedTournamentId),
          fetchJobs(),
          fetchInventory(),
          fetchSchedules(),
          fetchLiveLocations()
        ]);
      } catch {
        if (!mounted) return;
        setCompanies(["PG", "PBR"]);
        setOpenError("");
        await Promise.allSettled([
          fetchInventory(),
          fetchJobs(),
          fetchSchedules(),
          fetchLiveLocations()
        ]);
      }
    }
    void boot();
    return () => {
      mounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const saved = safeLocalGet(`${COACH_LOCATION_SHARING_KEY}:${user.userId}`);
    setLocationSharingEnabled(saved === "1");
  }, [user]);

  useEffect(() => {
    if (!user) return;
    safeLocalSet(`${COACH_LOCATION_SHARING_KEY}:${user.userId}`, locationSharingEnabled ? "1" : "0");
  }, [locationSharingEnabled, user]);

  useEffect(() => {
    if (!user || !locationSharingEnabled) return;
    void pingCurrentLocation();
    const id = window.setInterval(() => {
      void pingCurrentLocation();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [locationSharingEnabled, user]);

  useEffect(() => {
    if (!user) return;
    void fetchLiveLocations();
    const id = window.setInterval(() => {
      void fetchLiveLocations();
    }, 45_000);
    return () => window.clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (queryStateApplied) return;
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const requestedCompany = parseCompanyParam(params.get("company") || params.get("provider"));
    const inventorySlug = params.get("inventorySlug");
    const tournamentId = params.get("tournamentId");
    const focus = params.get("focus");
    if (tab === "coaches" || tab === "schedule" || tab === "bestPlayers" || tab === "myPlayers" || tab === "myPlayersSchedule") {
      navigateTab("myPlayersSchedule", { rememberCurrent: false });
    } else if (tab === "tournaments" || tab === "notes" || tab === "profile") {
      navigateTab(tab, { rememberCurrent: false });
    }
    if (focus === "generatedSchedule") {
      setFocusGeneratedScheduleRequested(true);
    }
    if (inventorySlug) {
      setSelectedInventorySlug(inventorySlug);
    }
    if (requestedCompany) {
      setCompany(requestedCompany);
      setJobHint(requestedCompany === "PBR" ? "Prep Baseball Tournament" : "PG Spring Showdown");
    }
    if (tournamentId) {
      setSelectedTournamentId(tournamentId);
    }
    const cleanParams = new URLSearchParams(params);
    [
      "teamId",
      "teamName",
      "teamUrl",
      "teamView",
      "eventId",
      "returnTab",
      "returnInventorySlug",
      "returnTournamentId",
      "returnCompany"
    ].forEach((key) => cleanParams.delete(key));
    const nextQuery = cleanParams.toString();
    const currentQuery = params.toString();
    if (nextQuery !== currentQuery) {
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
      window.history.replaceState({}, "", nextUrl);
    }
    setQueryStateApplied(true);
  }, [queryStateApplied, user]);

  useEffect(() => {
    if (!user) return;
    const names = splitNameParts(user.name);
    const baseProfile: ProfileFormState = {
      firstName: names.firstName,
      lastName: names.lastName || "",
      universityEmail: String(user.email || "").trim().toLowerCase(),
      gender: (user.gender || "UNSPECIFIED") as "MALE" | "FEMALE" | "UNSPECIFIED",
      countryCallingCode: String(user.countryCallingCode || "1"),
      mobileNumber: String(user.phone || "").replace(/[^\d]/g, ""),
      dateOfBirth: "1990-01-01"
    };
    const raw = safeLocalGet(profileStorageKey(user));
    const saved = parseJsonSafe<Partial<ProfileFormState> | null>(raw, null);
    if (!saved) {
      setProfileForm(baseProfile);
      return;
    }
    setProfileForm({
      firstName: String(saved.firstName || baseProfile.firstName),
      lastName: String(saved.lastName || baseProfile.lastName),
      universityEmail: String(saved.universityEmail || baseProfile.universityEmail).trim().toLowerCase(),
      gender: saved.gender === "MALE" || saved.gender === "FEMALE" ? saved.gender : "UNSPECIFIED",
      countryCallingCode: String(saved.countryCallingCode || baseProfile.countryCallingCode).replace(/[^\d]/g, "") || "1",
      mobileNumber: String(saved.mobileNumber || baseProfile.mobileNumber).replace(/[^\d]/g, ""),
      dateOfBirth: String(saved.dateOfBirth || baseProfile.dateOfBirth || "1990-01-01")
    });
  }, [user]);

  useEffect(() => {
    if (!coachTravelInputsKey) {
      coachTravelInputsReadyKeyRef.current = "";
      return;
    }
    const raw = safeLocalGet(coachTravelInputsKey);
    const saved = parseJsonSafe<CoachTravelInputsSnapshot | null>(raw, null);
    if (!saved) {
      setFlightBooked("no");
      setHotelBooked("no");
      setStateArrivalInputs({});
      setStateHotelInputs({});
      coachTravelInputsReadyKeyRef.current = coachTravelInputsKey;
      return;
    }
    setFlightBooked(saved.flightBooked === "yes" ? "yes" : "no");
    setHotelBooked(saved.hotelBooked === "yes" ? "yes" : "no");
    setStateArrivalInputs(sanitizeStateArrivalInputs(saved.stateArrivalInputs));
    setStateHotelInputs(sanitizeStateHotelInputs(saved.stateHotelInputs));
    coachTravelInputsReadyKeyRef.current = coachTravelInputsKey;
  }, [coachTravelInputsKey]);

  useEffect(() => {
    if (!coachTravelInputsKey) return;
    if (coachTravelInputsReadyKeyRef.current !== coachTravelInputsKey) return;
    const payload: CoachTravelInputsSnapshot = {
      flightBooked,
      hotelBooked,
      stateArrivalInputs,
      stateHotelInputs
    };
    safeLocalSet(coachTravelInputsKey, JSON.stringify(payload));
  }, [coachTravelInputsKey, flightBooked, hotelBooked, stateArrivalInputs, stateHotelInputs]);

  useEffect(() => {
    const ctor = (window as unknown as { SpeechRecognition?: BrowserSpeechConstructor; webkitSpeechRecognition?: BrowserSpeechConstructor }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: BrowserSpeechConstructor }).webkitSpeechRecognition;
    setSpeechSupported(Boolean(ctor));
  }, []);

  useEffect(() => () => {
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    inlineTeamNoteMediaRecorderRef.current?.stop();
    inlineTeamNoteMediaRecorderRef.current = null;
    inlineTeamNoteMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    inlineTeamNoteMediaStreamRef.current = null;
  }, []);

  useEffect(() => {
    if (!players.length) {
      setDesiredPlayerId("");
      return;
    }
    if (!desiredPlayerId || !playersById.has(desiredPlayerId)) {
      setDesiredPlayerId(players[0].id);
    }
  }, [players, playersById, desiredPlayerId]);

  useEffect(() => {
    setPlayerSearchResults([]);
    setPlayerSearchStatus("");
    setTeamsSearchQuery("");
    setTeamsSearchStableQuery("");
    setTeamListSearchQuery("");
    setTournamentTeamSearchMode("team");
    setScheduleSearchPlayerTeamIds([]);
    setScheduleSearchPlayerTeamNames([]);
    setScheduleSearchLoading(false);
    setNotesSelectedTeam(null);
    setNotesTeamScheduleRows([]);
    setNotesTeamRosterRows([]);
    setNotesSelectedRosterRowKeys([]);
    setNotesTeamStatus("");
    setNotesTeamLoading(false);
    notesTeamLoadSeqRef.current += 1;
    teamRosterSearchCacheRef.current.clear();
    notesTeamDetailsCacheRef.current.clear();
    tournamentPlayerIndexRef.current = [];
    tournamentPlayerIndexKeyRef.current = "";
    tournamentPlayerIndexLoadingRef.current = null;
    schedulePlayerTeamQueryCacheRef.current.clear();
  }, [selectedTournamentId, selectedInventorySlug]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTeamsSearchStableQuery(teamsSearchQuery);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [teamsSearchQuery]);

  useEffect(() => {
    if (tournamentTeamSearchMode !== "player") {
      setScheduleSearchPlayerTeamIds([]);
      setScheduleSearchPlayerTeamNames([]);
      setScheduleSearchLoading(false);
      return;
    }
    const normalizedQuery = normalizeSmartSearch(teamsSearchStableQuery);
    if (!normalizedQuery) {
      setScheduleSearchPlayerTeamIds([]);
      setScheduleSearchPlayerTeamNames([]);
      setScheduleSearchLoading(false);
      return;
    }

    const tokens = normalizedQuery.split(" ").filter(Boolean);
    if (!tokens.length) {
      setScheduleSearchPlayerTeamIds([]);
      setScheduleSearchPlayerTeamNames([]);
      setScheduleSearchLoading(false);
      return;
    }
    const cacheKey = `${selectedInventorySlug}:${selectedTournamentId}:${scheduleSearchFallbackTeamsScopeKey}:${normalizedQuery}`;
    const cached = schedulePlayerTeamQueryCacheRef.current.get(cacheKey);
    if (cached) {
      setScheduleSearchPlayerTeamIds(cached.teamIds);
      setScheduleSearchPlayerTeamNames(cached.teamNames);
      setScheduleSearchLoading(false);
      return;
    }

    let cancelled = false;
    setScheduleSearchLoading(true);
    void (async () => {
      try {
        const tournamentIndexCacheKey = `${selectedInventorySlug}:${selectedTournamentId}`;
        const deepIndexMap = new Map<string, TournamentPlayerIndexRow>();
        if (tournamentPlayerIndexKeyRef.current === tournamentIndexCacheKey) {
          tournamentPlayerIndexRef.current.forEach((row) => {
            const key = `${String(row.teamId || "").trim().toLowerCase()}::${normalizeSmartSearch(row.name)}`;
            if (!key.endsWith("::")) deepIndexMap.set(key, row);
          });
        }
        const rows = await loadTournamentPlayerIndex();
        if (cancelled) return;
        const matched = rows.filter((row) => {
          const playerBlob = normalizeSmartSearch(row.name);
          if (!playerBlob) return false;
          return tokens.every((token) => playerBlob.includes(token));
        });
        const matchedTeamIds = Array.from(new Set(
          matched.map((row) => String(row.teamId || "").trim()).filter(Boolean)
        ));
        const matchedTeamNames = Array.from(new Set(
          matched.map((row) => String(row.teamName || "").trim()).filter(Boolean)
        ));
        if (!matchedTeamIds.length && normalizedQuery.length >= 2 && scheduleSearchFallbackTeams.length) {
          const fallbackTeamIds = new Set(matchedTeamIds.map((value) => String(value || "").trim()).filter(Boolean));
          const fallbackTeamNames = new Set(matchedTeamNames.map((value) => String(value || "").trim()).filter(Boolean));
          const chunkSize = 14;
          for (let start = 0; start < scheduleSearchFallbackTeams.length; start += chunkSize) {
            const chunk = scheduleSearchFallbackTeams.slice(start, start + chunkSize);
            const loaded = await Promise.all(chunk.map(async (team) => ({
              team,
              roster: await loadRosterForSmartSearch(team).catch(() => [])
            })));
            loaded.forEach(({ team, roster }) => {
              const teamIdForIndex = smartSearchFallbackTeamId(team.name, team.id);
              const teamNameForIndex = String(team.name || "").trim();
              roster.forEach((row) => {
                const name = String(row.name || "").trim();
                const normalizedName = normalizeSmartSearch(name);
                if (!name || !normalizedName || !teamIdForIndex || !teamNameForIndex) return;
                deepIndexMap.set(`${teamIdForIndex.toLowerCase()}::${normalizedName}`, {
                  playerId: resolvePlayerIdByName(name, teamIdForIndex),
                  name,
                  hometown: String(row.hometown || team.from || ""),
                  teamId: teamIdForIndex,
                  teamName: teamNameForIndex
                });
              });
              const hasMatch = roster.some((row) => {
                const nameBlob = normalizeSmartSearch(row.name);
                if (!nameBlob) return false;
                return tokens.every((token) => nameBlob.includes(token));
              });
              if (!hasMatch) return;
              const teamId = String(team.id || "").trim();
              const teamName = String(team.name || "").trim();
              if (teamId) fallbackTeamIds.add(teamId);
              if (teamName) fallbackTeamNames.add(teamName);
            });
            if (cancelled) return;
          }
          matchedTeamIds.splice(0, matchedTeamIds.length, ...Array.from(fallbackTeamIds));
          matchedTeamNames.splice(0, matchedTeamNames.length, ...Array.from(fallbackTeamNames));
        }
        if (deepIndexMap.size) {
          tournamentPlayerIndexKeyRef.current = tournamentIndexCacheKey;
          tournamentPlayerIndexRef.current = Array.from(deepIndexMap.values());
        }
        setScheduleSearchPlayerTeamIds(matchedTeamIds);
        setScheduleSearchPlayerTeamNames(matchedTeamNames);
        schedulePlayerTeamQueryCacheRef.current.set(cacheKey, {
          teamIds: matchedTeamIds,
          teamNames: matchedTeamNames
        });
      } catch {
        if (!cancelled) {
          setScheduleSearchPlayerTeamIds([]);
          setScheduleSearchPlayerTeamNames([]);
        }
      } finally {
        if (!cancelled) setScheduleSearchLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    scheduleSearchFallbackTeams,
    scheduleSearchFallbackTeamsScopeKey,
    selectedInventorySlug,
    selectedTournamentId,
    teamsSearchStableQuery,
    tournamentTeamSearchMode
  ]);

  useEffect(() => {
    const merged = readTeamRosterCartCanonical();
    setTeamRosterCartPlayers(merged);
    // Keep only canonical key active so removed players cannot be resurrected by stale aliases.
    pruneLegacyTeamRosterCartAliases();
  }, [teamRosterCartLegacyKeys, teamRosterCartStorageKey]);

  useEffect(() => {
    const persisted = desiredPlayersStorageKey
      ? readDesiredPlayersStorage(desiredPlayersStorageKey)
      : null;
    setDesiredPlayers((prev) => {
      const manual = prev.filter((item) => !String(desiredPlayerSelectionKey(item)).startsWith("team:"));
      const merged = new Map<string, DesiredPlayer>();
      teamRosterCartPlayers.forEach((item) => {
        merged.set(desiredPlayerSelectionKey(item), item);
      });
      (persisted || []).forEach((item) => {
        const key = desiredPlayerSelectionKey(item);
        if (!merged.has(key)) merged.set(key, item);
      });
      manual.forEach((item) => {
        const key = desiredPlayerSelectionKey(item);
        if (!merged.has(key)) merged.set(key, item);
      });
      return keepDesiredPlayersInScope(sanitizeDesiredPlayers(Array.from(merged.values())));
    });
  }, [desiredPlayersStorageKey, teamRosterCartPlayers]);

  useEffect(() => {
    setDesiredPlayersAndPersist((prev) => {
      const manual = prev.filter((item) => !String(desiredPlayerSelectionKey(item)).startsWith("team:"));
      const merged = new Map<string, DesiredPlayer>();
      teamRosterCartPlayers.forEach((item) => {
        merged.set(desiredPlayerSelectionKey(item), item);
      });
      manual.forEach((item) => {
        const key = desiredPlayerSelectionKey(item);
        if (!merged.has(key)) {
          merged.set(key, item);
        }
      });
      return Array.from(merged.values());
    });
  }, [desiredPlayersStorageKey, teamRosterCartPlayers]);

  useEffect(() => {
    if (!requiredStateCodes.length) {
      setStateArrivalInputs({});
      setStateHotelInputs({});
      return;
    }
    setStateArrivalInputs((prev) => {
      const next: Record<string, StateArrivalInput> = {};
      requiredStateCodes.forEach((stateCode) => {
        const existing = prev[stateCode];
        next[stateCode] = existing || {
          arrivalLocation: String(selectedInventory?.displayCity || selectedTournament?.city || "").trim(),
          arrivalTime: ""
        };
      });
      return next;
    });
    setStateHotelInputs((prev) => {
      const next: Record<string, StateHotelInput> = {};
      requiredStateCodes.forEach((stateCode) => {
        const existing = prev[stateCode];
        next[stateCode] = existing || {
          hotelName: "",
          checkIn: "",
          checkOut: ""
        };
      });
      return next;
    });
  }, [requiredStateCodes, selectedInventory?.displayCity, selectedTournament?.city]);

  useEffect(() => {
    if (arrivalAnswersComplete) {
      setQuestionOpen((prev) => (prev.arrival ? { ...prev, arrival: false } : prev));
    }
  }, [arrivalAnswersComplete]);

  useEffect(() => {
    if (hotelBooked === "yes" && hotelAnswersComplete) {
      setQuestionOpen((prev) => (prev.hotel ? { ...prev, hotel: false } : prev));
    }
  }, [hotelAnswersComplete, hotelBooked]);

  useEffect(() => {
    if (!queryStateApplied || !user || loadingHarvest || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoCreateSchedule") !== "1") return;
    if (!selectedTournamentId && !selectedInventorySlug) return;

    const sourcePlayers = teamRosterCartPlayers.length ? teamRosterCartPlayers : desiredPlayers;
    if (!sourcePlayers.length) {
      setPlanWorkflowNote("Select players first, then create schedule.");
      clearAutoCreateScheduleQueryFlag();
      return;
    }

    const runScope = selectedTournamentId || selectedInventorySlug || "no-tournament";
    const runKey = `${runScope}:${company}:${sourcePlayers.map((item) => desiredPlayerSelectionKey(item)).join("|")}`;
    if (autoCreateScheduleRunKeyRef.current === runKey) return;
    autoCreateScheduleRunKeyRef.current = runKey;

    navigateTab("myPlayersSchedule");
    setDesiredPlayersAndPersist(sourcePlayers);
    void generateScheduleFromSmartPlayers({
      keepActiveTab: true,
      autoRun: true,
      targetPlayers: sourcePlayers
    }).finally(() => {
      focusGeneratedSchedulePanel();
      clearAutoCreateScheduleQueryFlag();
    });
  }, [
    company,
    desiredPlayers,
    loadingHarvest,
    queryStateApplied,
    selectedInventorySlug,
    selectedTournamentId,
    teamRosterCartPlayers,
    user
  ]);

  useEffect(() => {
    if (!focusGeneratedScheduleRequested) return;
    if (activeTab !== "myPlayersSchedule") return;
    if (!myGeneratedPlan.length && !desiredPlayers.length) return;
    focusGeneratedSchedulePanel();
  }, [activeTab, desiredPlayers.length, focusGeneratedScheduleRequested, myGeneratedPlan.length]);

  useEffect(() => {
    if (!user || !selectedTournamentId || loadingHarvest) return;
    const current = tournaments.find((item) => item.id === selectedTournamentId);
    if (!current) return;
    const hasTeams = Array.isArray(current.teams) && current.teams.length > 0;
    if (hasTeams) return;
    const hydrationKey = `${company}:${selectedTournamentId}`;
    const now = Date.now();
    const lastAttempt = selectedTournamentHydrationAttemptAtRef.current[hydrationKey] || 0;
    if (now - lastAttempt < 15000) return;
    if (selectedTournamentHydrationKeyRef.current === hydrationKey) return;
    selectedTournamentHydrationAttemptAtRef.current[hydrationKey] = now;
    selectedTournamentHydrationKeyRef.current = hydrationKey;
    const hydrate = async () => {
      if (selectedInventory && !isTournamentLocked(selectedInventory, { forceUnlocked: isAdminUser })) {
        await refreshTournamentByInventory(selectedInventory, { onlyIfSelected: true, background: true });
        return;
      }
      await loadTournamentDetails(company, selectedTournamentId, true);
    };
    void hydrate().finally(() => {
      if (selectedTournamentHydrationKeyRef.current === hydrationKey) {
        selectedTournamentHydrationKeyRef.current = "";
      }
    });
  }, [company, isAdminUser, loadingHarvest, selectedInventory, selectedTournamentId, tournaments, user]);

  useEffect(() => {
    if (!canAccessLockedPages) {
      setDestinationSuggestions([]);
      setHotelSuggestions([]);
      setStateArrivalSuggestions({});
      setStateHotelNameSuggestions({});
      setStateArrivalSuggestionsLoading({});
      setStateHotelNameSuggestionsLoading({});
      return;
    }
    const destinationQuery = String(scheduleForm.flightDestination || "").trim();
    const hotelQuery = String(hotelSuggestionDestination || "").trim();
    if (destinationQuery.length < 2 && hotelQuery.length < 2) {
      setDestinationSuggestions([]);
      setHotelSuggestions([]);
      return;
    }
    const id = window.setTimeout(() => {
      if (destinationQuery.length >= 2) {
        void fetch(`/api/maps/autocomplete?q=${encodeURIComponent(destinationQuery)}`)
          .then((res) => (res.ok ? res.json() : { suggestions: [] }))
          .then((data) => setDestinationSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []))
          .catch(() => setDestinationSuggestions([]));
      } else {
        setDestinationSuggestions([]);
      }

      if (hotelQuery.length >= 2) {
        void fetch(`/api/maps/hotels?destination=${encodeURIComponent(hotelQuery)}`)
          .then((res) => (res.ok ? res.json() : { hotels: [] }))
          .then((data) => setHotelSuggestions(Array.isArray(data?.hotels) ? data.hotels : []))
          .catch(() => setHotelSuggestions([]));
      } else {
        setHotelSuggestions([]);
      }
    }, 320);
    return () => window.clearTimeout(id);
  }, [canAccessLockedPages, hotelSuggestionDestination, scheduleForm.flightDestination]);

  useEffect(() => {
    if (!canAccessLockedPages || !questionOpen.arrival || !requiredStateCodes.length) {
      setStateArrivalSuggestions({});
      setStateArrivalSuggestionsLoading({});
      return;
    }

    const timers: number[] = [];
    requiredStateCodes.forEach((stateCode) => {
      const query = String(stateArrivalInputs[stateCode]?.arrivalLocation || "").trim();
      if (query.length < 2) {
        setStateArrivalSuggestions((prev) => {
          if (!prev[stateCode]) return prev;
          const next = { ...prev };
          delete next[stateCode];
          return next;
        });
        setStateArrivalSuggestionsLoading((prev) => {
          if (!prev[stateCode]) return prev;
          const next = { ...prev };
          delete next[stateCode];
          return next;
        });
        return;
      }

      const seq = (stateArrivalSuggestionSeqRef.current[stateCode] || 0) + 1;
      stateArrivalSuggestionSeqRef.current[stateCode] = seq;
      setStateArrivalSuggestionsLoading((prev) => ({ ...prev, [stateCode]: true }));

      const timer = window.setTimeout(() => {
        const params = new URLSearchParams({
          q: query,
          kind: "arrival",
          state: stateCode
        });
        void fetch(`/api/maps/autocomplete?${params.toString()}`)
          .then((res) => (res.ok ? res.json() : { suggestions: [] }))
          .then((data) => {
            if (stateArrivalSuggestionSeqRef.current[stateCode] !== seq) return;
            const suggestions = Array.isArray(data?.suggestions) ? data.suggestions as PlaceSuggestion[] : [];
            setStateArrivalSuggestions((prev) => ({ ...prev, [stateCode]: suggestions.slice(0, 8) }));
          })
          .catch(() => {
            if (stateArrivalSuggestionSeqRef.current[stateCode] !== seq) return;
            setStateArrivalSuggestions((prev) => ({ ...prev, [stateCode]: [] }));
          })
          .finally(() => {
            if (stateArrivalSuggestionSeqRef.current[stateCode] !== seq) return;
            setStateArrivalSuggestionsLoading((prev) => ({ ...prev, [stateCode]: false }));
          });
      }, 280);
      timers.push(timer);
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [canAccessLockedPages, questionOpen.arrival, requiredStateCodes, stateArrivalInputs]);

  useEffect(() => {
    if (!canAccessLockedPages || hotelBooked !== "yes" || !questionOpen.hotel || !requiredStateCodes.length) {
      setStateHotelNameSuggestions({});
      setStateHotelNameSuggestionsLoading({});
      return;
    }

    const timers: number[] = [];
    requiredStateCodes.forEach((stateCode) => {
      const query = String(stateHotelInputs[stateCode]?.hotelName || "").trim();
      if (query.length < 2) {
        setStateHotelNameSuggestions((prev) => {
          if (!prev[stateCode]) return prev;
          const next = { ...prev };
          delete next[stateCode];
          return next;
        });
        setStateHotelNameSuggestionsLoading((prev) => {
          if (!prev[stateCode]) return prev;
          const next = { ...prev };
          delete next[stateCode];
          return next;
        });
        return;
      }

      const seq = (stateHotelSuggestionSeqRef.current[stateCode] || 0) + 1;
      stateHotelSuggestionSeqRef.current[stateCode] = seq;
      setStateHotelNameSuggestionsLoading((prev) => ({ ...prev, [stateCode]: true }));

      const timer = window.setTimeout(() => {
        const params = new URLSearchParams({
          q: query,
          kind: "hotel",
          state: stateCode
        });
        void fetch(`/api/maps/autocomplete?${params.toString()}`)
          .then((res) => (res.ok ? res.json() : { suggestions: [] }))
          .then((data) => {
            if (stateHotelSuggestionSeqRef.current[stateCode] !== seq) return;
            const suggestions = Array.isArray(data?.suggestions) ? data.suggestions as PlaceSuggestion[] : [];
            setStateHotelNameSuggestions((prev) => ({ ...prev, [stateCode]: suggestions.slice(0, 8) }));
          })
          .catch(() => {
            if (stateHotelSuggestionSeqRef.current[stateCode] !== seq) return;
            setStateHotelNameSuggestions((prev) => ({ ...prev, [stateCode]: [] }));
          })
          .finally(() => {
            if (stateHotelSuggestionSeqRef.current[stateCode] !== seq) return;
            setStateHotelNameSuggestionsLoading((prev) => ({ ...prev, [stateCode]: false }));
          });
      }, 280);
      timers.push(timer);
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [canAccessLockedPages, hotelBooked, questionOpen.hotel, requiredStateCodes, stateHotelInputs]);

  useEffect(() => {
    if (!user) return;
    const rawWatch = safeLocalGet(makeOrgKey(user.orgId, user.userId, "watchlist"));
    const rawNotes = safeLocalGet(makeOrgKey(user.orgId, user.userId, "notes"));
    const rawPulses = safeLocalGet(makeOrgKey(user.orgId, user.userId, "pulses"));
    const rawSync = safeLocalGet(makeOrgKey(user.orgId, user.userId, "lastSyncAt"));

    const parsedWatch = parseJsonSafe<unknown>(rawWatch, []);
    const parsedNotes = parseJsonSafe<unknown>(rawNotes, []);
    const parsedPulses = parseJsonSafe<unknown>(rawPulses, []);

    setWatchlist(Array.isArray(parsedWatch) ? parsedWatch as string[] : []);
    setNotes(Array.isArray(parsedNotes) ? parsedNotes as ScoutNote[] : []);
    setPulses(Array.isArray(parsedPulses) ? parsedPulses as PulseEvent[] : []);
    setLastSyncAt(rawSync || null);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    safeLocalSet(makeOrgKey(user.orgId, user.userId, "watchlist"), JSON.stringify(watchlist));
  }, [user, watchlist]);

  useEffect(() => {
    if (!user) return;
    safeLocalSet(makeOrgKey(user.orgId, user.userId, "notes"), JSON.stringify(notes));
  }, [user, notes]);

  useEffect(() => {
    if (!user) return;
    safeLocalSet(makeOrgKey(user.orgId, user.userId, "pulses"), JSON.stringify(pulses));
  }, [user, pulses]);

  useEffect(() => {
    if (!user || !selectedTournament) return;
    cacheTournamentOffline();
  }, [company, selectedTournament, user]);

  useEffect(() => {
    if (!online || !user) return;
    const id = window.setInterval(() => {
      void syncNow();
    }, 15000);
    return () => window.clearInterval(id);
  }, [online, user, notes, pulses, syncing]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "success") return;

    const checkoutSessionId = params.get("session_id") || "";
    const returnInventorySlug = params.get("inventorySlug") || "";
    const finalize = async () => {
      let confirmedInventorySlug = returnInventorySlug;
      if (checkoutSessionId) {
        const confirmRes = await fetch("/api/payments/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: checkoutSessionId })
        }).catch(() => null);
        if (confirmRes && !confirmRes.ok) {
          const data = await confirmRes.json().catch(() => ({}));
          const detail = typeof data?.detail === "string" && data.detail ? ` (${data.detail})` : "";
          setOpenError(`${data?.error || "Payment confirmation failed."}${detail}`);
        } else if (confirmRes) {
          const data = await confirmRes.json().catch(() => ({}));
          if (typeof data?.inventorySlug === "string" && data.inventorySlug.trim()) {
            confirmedInventorySlug = data.inventorySlug.trim();
          }
        }
      }
      const nextInventory = await fetchInventory();
      let unlockedByPayment = false;
      if (confirmedInventorySlug) {
        const paidItem = nextInventory.find((item) => item.slug === confirmedInventorySlug);
        if (paidItem && !isTournamentLocked(paidItem, { forceUnlocked: isAdminUser })) {
          setSelectedInventorySlug(confirmedInventorySlug);
          unlockedByPayment = true;
        }
      }
      if (unlockedByPayment) {
        safeLocalSet(TOURNAMENT_UNLOCK_EVENT_KEY, JSON.stringify({
          slug: confirmedInventorySlug,
          at: Date.now()
        }));
        window.alert("Payment successful. Please return to the tournament page. This tournament is now unlocked for your organization.");
      }
      navigateTab("tournaments", { rememberCurrent: false });
      const next = new URL(window.location.href);
      next.searchParams.delete("payment");
      next.searchParams.delete("session_id");
      window.history.replaceState({}, "", next.pathname + (next.search ? `?${next.searchParams.toString()}` : ""));
    };
    void finalize();
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== TOURNAMENT_UNLOCK_EVENT_KEY || !event.newValue) return;
      let slug = "";
      try {
        const parsed = JSON.parse(event.newValue) as { slug?: string };
        slug = String(parsed?.slug || "").trim();
      } catch {
        slug = "";
      }
      const message = slug
        ? "Payment successful. Please return to the tournament page. The selected tournament is now unlocked."
        : "Payment successful. Please return to the tournament page. The tournament is now unlocked.";
      window.alert(message);
      window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function chooseTournamentIdForCompanyLoad(
    nextCompany: "PG" | "PBR",
    nextTournaments: Tournament[],
    preferredTournamentId?: string
  ) {
    const preferred = String(preferredTournamentId || "").trim();
    if (preferred) {
      return preferred;
    }

    const currentCompany = companyRef.current;
    const currentTournamentId = String(selectedTournamentIdRef.current || "").trim();
    if (
      currentCompany === nextCompany
      && currentTournamentId
      && nextTournaments.some((item) => item.id === currentTournamentId)
    ) {
      return currentTournamentId;
    }

    return nextTournaments[0]?.id || "";
  }

  function nextTournamentMutationSeq() {
    const next = tournamentMutationSeqRef.current + 1;
    tournamentMutationSeqRef.current = next;
    return next;
  }

  function isTournamentMutationCurrent(seq: number) {
    return seq === tournamentMutationSeqRef.current;
  }

  async function loadCompanyData(nextCompany: "PG" | "PBR", forceRefresh = false, preferredTournamentId = "") {
    const mutationSeq = nextTournamentMutationSeq();
    const isCurrentMutation = () => isTournamentMutationCurrent(mutationSeq);
    setLoadingHarvest(true);
    setCompany(nextCompany);
    try {
      const dataset = await loadHarvestDataset(nextCompany, forceRefresh);
      if (!isCurrentMutation()) return;
      const nextTournaments: Tournament[] = dataset.tournaments || [];
      setTournaments(nextTournaments);
      const nextTournamentId = chooseTournamentIdForCompanyLoad(nextCompany, nextTournaments, preferredTournamentId);
      if (!isCurrentMutation()) return;
      setSelectedTournamentId(nextTournamentId);
      if (nextTournamentId) {
        const loaded = await loadTournamentDetails(nextCompany, nextTournamentId, forceRefresh, mutationSeq);
        if (!loaded && String(preferredTournamentId || "").trim()) {
          const fallbackTournamentId = chooseTournamentIdForCompanyLoad(nextCompany, nextTournaments, "");
          if (fallbackTournamentId && fallbackTournamentId !== nextTournamentId) {
            if (!isCurrentMutation()) return;
            setSelectedTournamentId(fallbackTournamentId);
            await loadTournamentDetails(nextCompany, fallbackTournamentId, forceRefresh, mutationSeq);
          } else if (!fallbackTournamentId) {
            setSelectedGameId("");
          }
        }
      } else {
        setSelectedGameId("");
      }
    } catch {
      if (isCurrentMutation()) {
        setOpenError(`Unable to load ${companyLabel(nextCompany)} tournaments right now. Please refresh in a moment.`);
      }
    } finally {
      if (isCurrentMutation()) {
        setLoadingHarvest(false);
      }
    }
  }

  async function loadTournamentDetails(
    nextCompany: "PG" | "PBR",
    nextTournamentId: string,
    forceRefresh = false,
    mutationSeq?: number
  ) {
    const activeMutationSeq = Number.isFinite(mutationSeq) ? Number(mutationSeq) : nextTournamentMutationSeq();
    const isCurrentMutation = () => isTournamentMutationCurrent(activeMutationSeq);
    try {
      const tournament = await loadHarvestTournament(nextCompany, nextTournamentId, forceRefresh);
      if (!isCurrentMutation()) return null;
      let stableTournament = tournament;
      setTournaments((prev) => {
        const exists = prev.some((item) => item.id === nextTournamentId);
        if (!exists) {
          const merged = mergeTournamentSnapshotList(prev, tournament);
          stableTournament = merged.tournament;
          return merged.list;
        }
        return prev.map((item) => {
          if (item.id !== nextTournamentId) return item;
          stableTournament = chooseStableTournamentSnapshot(item, tournament);
          return stableTournament;
        });
      });
      if (!isCurrentMutation()) return stableTournament;
      setSelectedTournamentId(nextTournamentId);
      setSelectedGameId(stableTournament.games?.[0]?.id || "");
      return stableTournament;
    } catch {
      // Keep existing shallow tournament record.
      return null;
    }
  }

  async function fetchJobs() {
    setLoadingJobs(true);
    try {
      const res = await fetch("/api/harvest/jobs");
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs || []);
    } finally {
      setLoadingJobs(false);
    }
  }

  async function fetchInventory() {
    const requestSeq = inventoryFetchSeqRef.current + 1;
    inventoryFetchSeqRef.current = requestSeq;
    const isLatestRequest = () => requestSeq === inventoryFetchSeqRef.current;

    if (isLatestRequest()) setOpenError("");
    const cachedSnapshot = readInventoryCacheSnapshot(user);
    const inMemoryInventory = inventoryRef.current;
    const keepStableInventory = (message: string) => {
      const baseRows = inMemoryInventory.length
        ? inMemoryInventory
        : (cachedSnapshot?.inventory?.length ? cachedSnapshot.inventory : []);
      if (isLatestRequest()) {
        setInventory(baseRows);
        if (cachedSnapshot?.subscribed) {
          setSubscribed(true);
        }
        setOpenError(message);
      }
      return baseRows;
    };

    let res: Response;
    try {
      res = await fetch("/api/inventory", { cache: "no-store" });
    } catch {
      return keepStableInventory("Tournament sync is temporarily unavailable. Showing last synced tournaments.");
    }

    if (res.status === 401) {
      const sessionCheck = await fetch("/api/session/me", { cache: "no-store" }).catch(() => null);
      if (!sessionCheck || !sessionCheck.ok) {
        if (isLatestRequest()) {
          setOpenError("Session expired. Please sign in again.");
        }
        router.replace("/login");
        return keepStableInventory("Session expired. Please sign in again.");
      }
      res = await fetch("/api/inventory", { cache: "no-store" }).catch(() => res);
    }

    if (!res.ok) {
      return keepStableInventory(`Unable to sync tournaments right now (${res.status}). Showing last synced tournaments.`);
    }

    const data = await res.json().catch(() => ({}));
    const nextInventory = sanitizeInventoryRows(data?.inventory);
    const nextSubscribed = Boolean(data?.subscribed);

    if (!nextInventory.length) {
      return keepStableInventory("Tournament sync returned no rows. Showing last synced tournaments.");
    }

    if (!isLatestRequest()) {
      return nextInventory;
    }

    setSubscribed(nextSubscribed);
    setInventory(nextInventory);
    writeInventoryCacheSnapshot(user, nextInventory, nextSubscribed);
    if (data?.warning) {
      setOpenError(String(data.warning));
    } else {
      setOpenError("");
    }
    return nextInventory;
  }

  async function refreshTournamentByInventory(
    item: InventoryTournament,
    options?: { mutationSeq?: number; onlyIfSelected?: boolean; background?: boolean }
  ) {
    const activeMutationSeq = Number.isFinite(options?.mutationSeq)
      ? Number(options?.mutationSeq)
      : options?.background
        ? (tournamentMutationSeqRef.current || nextTournamentMutationSeq())
      : nextTournamentMutationSeq();
    const isCurrentMutation = () => isTournamentMutationCurrent(activeMutationSeq);
    try {
      if (options?.onlyIfSelected && selectedInventorySlugRef.current !== item.slug) return;
      const preferredTournamentId = (
        selectedInventorySlugRef.current === item.slug
        && companyRef.current === item.company
      ) ? selectedTournamentIdRef.current : "";
      const targetTournamentId = await resolveTournamentIdForItem(item, preferredTournamentId);
      if (!isCurrentMutation()) return;
      if (options?.onlyIfSelected && selectedInventorySlugRef.current !== item.slug) return;
      const payload = {
        company: item.company,
        inventorySlug: item.slug,
        tournamentHint: item.harvestHint || item.name,
        tournamentId: targetTournamentId || undefined
      };
      const attemptOpen = () =>
        fetchWithTimeout("/api/harvest/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }, 30000);
      let liveOpen = await attemptOpen();
      if (!isCurrentMutation()) return;
      if (liveOpen.status === 401) {
        const sessionCheck = await fetch("/api/session/me", { cache: "no-store" });
        if (!sessionCheck.ok) {
          if (isCurrentMutation() && !options?.background) {
            setOpenError("Session expired. Please sign in again.");
          }
          router.replace("/login");
          return;
        }
        liveOpen = await attemptOpen();
        if (!isCurrentMutation()) return;
      }
      if (!liveOpen.ok) return;
      const data = await liveOpen.json();
      const openedTournament = data?.tournament as Tournament | undefined;
      if (!openedTournament) return;
      if (!isCurrentMutation()) return;
      if (options?.onlyIfSelected && selectedInventorySlugRef.current !== item.slug) return;
      let stableTournament = openedTournament;
      setTournaments((prev) => {
        const merged = mergeTournamentSnapshotList(prev, openedTournament);
        stableTournament = merged.tournament;
        return merged.list;
      });
      if (!isCurrentMutation()) return;
      setSelectedTournamentId(stableTournament.id);
      setSelectedGameId(stableTournament.games?.[0]?.id || "");
      setTournamentViewTitle(stableTournament.name);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      if (isCurrentMutation() && !options?.background) {
        setOpenError(
          detail && !/<html|<body|gateway|timeout/i.test(detail)
            ? detail
            : "Unable to refresh tournament details right now. Please retry in a few seconds."
        );
      }
    }
  }

  function findInMemoryTournamentForItem(item: InventoryTournament) {
    const canUseCurrentList = companyRef.current === item.company || company === item.company;
    if (!canUseCurrentList) return null;

    if (item.company === "PBR") {
      const bySlug = tournaments.find((t) => String(t.id || "").trim() === item.slug) || null;
      if (bySlug) return bySlug;
    }

    const wanted = normalizeTournamentName(item.name);
    const exactMatches = tournaments.filter((t) => normalizeTournamentName(t.name) === wanted);
    if (exactMatches.length === 1) return exactMatches[0];

    const selectedId = String(selectedTournamentIdRef.current || selectedTournamentId || "").trim();
    if (selectedId) {
      const selectedMatch = tournaments.find((t) => String(t.id || "").trim() === selectedId) || null;
      if (selectedMatch && normalizeTournamentName(selectedMatch.name) === wanted) {
        return selectedMatch;
      }
    }

    return exactMatches[0] || null;
  }

  async function resolveTournamentIdForItem(item: InventoryTournament, preferredTournamentId = "") {
    const preferredId = String(preferredTournamentId || "").trim();
    if (preferredId) return preferredId;

    const inMemoryMatch = findInMemoryTournamentForItem(item);
    if (inMemoryMatch?.id) return inMemoryMatch.id;

    const currentlySelectedId = String(selectedTournamentIdRef.current || "").trim();
    if (
      currentlySelectedId
      && selectedInventorySlugRef.current === item.slug
      && companyRef.current === item.company
    ) {
      return currentlySelectedId;
    }

    if (item.company === "PBR") {
      const bySameSlug = company === item.company
        ? tournaments.find((t) => String(t.id || "").trim() === item.slug)?.id || ""
        : "";
      if (bySameSlug) return bySameSlug;

      const wantedExact = normalizeTournamentName(item.name);
      const exactCurrentMatches = company === item.company
        ? tournaments.filter((t) => normalizeTournamentName(t.name) === wantedExact)
        : [];
      if (exactCurrentMatches.length === 1) {
        return exactCurrentMatches[0].id;
      }

      try {
        const dataset = await loadHarvestDataset(item.company);
        const bySlug = dataset.tournaments.find((t) => String(t.id || "").trim() === item.slug);
        if (bySlug?.id) return bySlug.id;
        const exactMatches = dataset.tournaments.filter((t) => normalizeTournamentName(t.name) === wantedExact);
        if (exactMatches.length === 1) return exactMatches[0].id;
        return "";
      } catch {
        return "";
      }
    }

    const wanted = normalizeTournamentName(item.name);
    const exactCurrentMatches = company === item.company
      ? tournaments.filter((t) => normalizeTournamentName(t.name) === wanted)
      : [];
    if (exactCurrentMatches.length === 1) {
      return exactCurrentMatches[0].id;
    }

    try {
      const dataset = await loadHarvestDataset(item.company);
      const exactMatches = dataset.tournaments.filter((t) => normalizeTournamentName(t.name) === wanted);
      if (exactMatches.length === 1) return exactMatches[0].id;
      return "";
    } catch {
      return "";
    }
  }

  function applyOpenedTournament(openedTournament: Tournament, mutationSeq?: number) {
    if (Number.isFinite(mutationSeq) && !isTournamentMutationCurrent(Number(mutationSeq))) return;
    let stableTournament = openedTournament;
    setTournaments((prev) => {
      const merged = mergeTournamentSnapshotList(prev, openedTournament);
      stableTournament = merged.tournament;
      return merged.list;
    });
    if (Number.isFinite(mutationSeq) && !isTournamentMutationCurrent(Number(mutationSeq))) return;
    setSelectedTournamentId(stableTournament.id);
    setSelectedGameId(stableTournament.games?.[0]?.id || "");
    setTournamentViewTitle(stableTournament.name);
    navigateTab("notes");
  }

  async function openTournamentFromExistingData(
    item: InventoryTournament,
    targetTournamentId?: string,
    mutationSeq?: number
  ) {
    if (Number.isFinite(mutationSeq) && !isTournamentMutationCurrent(Number(mutationSeq))) return false;
    const wanted = normalizeTournamentName(item.name);
    const inMemoryMatch = findInMemoryTournamentForItem(item);
    if (inMemoryMatch) {
      applyOpenedTournament(inMemoryMatch, mutationSeq);
      return true;
    }

    const tryOpenById = async (candidateId: string) => {
      const details = await loadHarvestTournament(item.company, candidateId).catch(() => null);
      if (Number.isFinite(mutationSeq) && !isTournamentMutationCurrent(Number(mutationSeq))) return false;
      if (details) {
        applyOpenedTournament(details, mutationSeq);
        return true;
      }
      return false;
    };

    if (targetTournamentId) {
      const opened = await tryOpenById(targetTournamentId);
      if (opened) return true;
    }

    const dataset = await loadHarvestDataset(item.company).catch(() => null);
    if (Number.isFinite(mutationSeq) && !isTournamentMutationCurrent(Number(mutationSeq))) return false;
    if (!dataset?.tournaments?.length) return false;
    const match = dataset.tournaments.find((t) => {
      const normalized = normalizeTournamentName(t.name);
      if (item.company === "PBR") {
        if (String(t.id || "").trim() === item.slug) return true;
        return normalized === wanted;
      }
      return normalized === wanted;
    });
    if (!match) return false;

    const opened = await tryOpenById(match.id);
    if (opened) return true;
    applyOpenedTournament(match, mutationSeq);
    return true;
  }

  async function refreshFromPerfectGame(includeOpenedTournament: boolean) {
    if (inventoryRefreshing) return;
    setInventoryRefreshing(true);
    try {
      const nextInventory = await fetchInventory();
      if (!includeOpenedTournament) return;
      const selectedSlug = selectedInventorySlug;
      if (!selectedSlug) return;
      const selectedItem = nextInventory.find((item) => item.slug === selectedSlug);
      if (!selectedItem) return;
      if (isTournamentLocked(selectedItem, { forceUnlocked: isAdminUser })) return;
      await refreshTournamentByInventory(selectedItem, { onlyIfSelected: true, background: true });
    } finally {
      setInventoryRefreshing(false);
    }
  }

  useEffect(() => {
    if (!online || !user) return;
    const tick = () => {
      const shouldRefreshOpenedTournament = activeTab !== "tournaments";
      void refreshFromPerfectGame(shouldRefreshOpenedTournament);
    };
    const onFocus = () => tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const id = window.setInterval(tick, 30000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [online, user, activeTab, selectedInventorySlug, isAdminUser]);

  function onPullStart(event: TouchEvent<HTMLElement>) {
    if (activeTab !== "tournaments" || window.scrollY > 0) return;
    pullStartYRef.current = event.touches[0]?.clientY ?? null;
    pullTriggeredRef.current = false;
  }

  function onPullMove(event: TouchEvent<HTMLElement>) {
    if (activeTab !== "tournaments") return;
    if (pullTriggeredRef.current) return;
    const startY = pullStartYRef.current;
    if (startY == null || window.scrollY > 0) return;
    const delta = (event.touches[0]?.clientY ?? startY) - startY;
    if (delta >= 84) {
      pullTriggeredRef.current = true;
      void refreshFromPerfectGame(true);
    }
  }

  function onPullEnd() {
    pullStartYRef.current = null;
    pullTriggeredRef.current = false;
  }

  function readLocalFallbackSchedule(): CoachSchedule | null {
    const key = localScheduleFallbackKey(user, company, selectedInventorySlug, selectedTournamentId);
    if (!key) return null;
    const raw = safeLocalGet(key);
    if (!raw) return null;
    const parsed = parseJsonSafe<CoachSchedule | null>(raw, null);
    if (!parsed || typeof parsed !== "object") return null;
    const next = {
      id: String(parsed.id || `local-${user?.userId || "coach"}`),
      user_id: String(parsed.user_id || user?.userId || ""),
      coach_name: String(parsed.coach_name || user?.name || "Coach"),
      coach_email: String(parsed.coach_email || user?.email || ""),
      flight_source: parsed.flight_source ? String(parsed.flight_source) : null,
      flight_destination: parsed.flight_destination ? String(parsed.flight_destination) : null,
      flight_arrival_time: parsed.flight_arrival_time ? String(parsed.flight_arrival_time) : null,
      hotel_name: parsed.hotel_name ? String(parsed.hotel_name) : null,
      notes: parsed.notes ? String(parsed.notes) : null,
      desired_players: Array.isArray(parsed.desired_players) ? parsed.desired_players : [],
      generated_plan: Array.isArray(parsed.generated_plan) ? parsed.generated_plan : [],
      updated_at: String(parsed.updated_at || new Date().toISOString())
    };
    if (isScheduleExpired(next)) {
      safeLocalRemove(key);
      return null;
    }
    return next;
  }

  function writeLocalFallbackSchedule(schedule: CoachSchedule) {
    const key = localScheduleFallbackKey(user, company, selectedInventorySlug, selectedTournamentId);
    if (!key) return;
    safeLocalSet(key, JSON.stringify(schedule));
  }

  function buildLocalFallbackSchedule(
    formState = scheduleForm,
    desiredState = desiredPlayers,
    generatedState = myGeneratedPlan
  ): CoachSchedule | null {
    if (!user) return null;
    const rawArrival = String(formState.flightArrivalTime || "").trim();
    const normalizedArrival = rawArrival ? localInputToOffsetIso(rawArrival) : null;
    return {
      id: `local-${user.userId}`,
      user_id: user.userId,
      coach_name: user.name,
      coach_email: user.email,
      flight_source: formState.flightSource?.trim() || null,
      flight_destination: formState.flightDestination?.trim() || null,
      flight_arrival_time: normalizedArrival,
      hotel_name: formState.hotelName?.trim() || null,
      notes: formState.notes?.trim() || null,
      desired_players: sanitizeDesiredPlayers(desiredState),
      generated_plan: generatedState,
      updated_at: new Date().toISOString()
    };
  }

  useEffect(() => {
    if (!online || !user || activeTab !== "tournaments") return;
    function onScroll() {
      const doc = document.documentElement;
      const nearBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 56;
      if (!nearBottom) return;
      const now = Date.now();
      if (now - bottomRefreshAtRef.current < 30000) return;
      bottomRefreshAtRef.current = now;
      void refreshFromPerfectGame(false);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [activeTab, online, user, selectedInventorySlug]);

  function hydrateMySchedule(data: CoachSchedule[]) {
    const mine = data.find((item) => item.user_id === user?.userId);
    if (!mine) {
      setMyGeneratedPlan([]);
      setAndPersistPlanWorkflowStatus("draft");
      setPlanWorkflowNote("");
      setScheduleForm((prev) => ({
        ...prev,
        flightSource: airportStartLabel || prev.flightSource || "Event arrival hub",
        flightDestination: "",
        flightArrivalTime: "",
        hotelName: "",
        notes: ""
      }));
      return;
    }

    setScheduleForm({
      flightSource: mine.flight_source || airportStartLabel || "Event arrival hub",
      flightDestination: mine.flight_destination || "",
      flightArrivalTime: toInputDateTime(mine.flight_arrival_time),
      hotelName: mine.hotel_name || "",
      notes: mine.notes || ""
    });
    const desiredStorageRaw = desiredPlayersStorageKey ? safeLocalGet(desiredPlayersStorageKey) : null;
    const hasLocalDesiredState = desiredStorageRaw !== null;
    const persistedDesired = readDesiredPlayersStorage(desiredPlayersStorageKey) || [];
    const cartDesired = readTeamRosterCartCanonical();
    const remoteDesired = Array.isArray(mine.desired_players)
      ? sanitizeDesiredPlayers(
        mine.desired_players
        .map((item) => ({
          playerId: String(item?.playerId || ""),
          selectionKey: item?.selectionKey ? String(item.selectionKey) : undefined,
          name: String(item?.name || ""),
          team: String(item?.team || ""),
          hometown: item?.hometown ? String(item.hometown) : undefined,
          sourceTeamId: item?.sourceTeamId ? String(item.sourceTeamId) : undefined,
          sourceTeamName: item?.sourceTeamName ? String(item.sourceTeamName) : undefined,
          sourceGameId: item?.sourceGameId ? String(item.sourceGameId) : undefined,
          sourceGameStartAt: item?.sourceGameStartAt ? String(item.sourceGameStartAt) : undefined,
          sourceGameTimeLabel: item?.sourceGameTimeLabel ? String(item.sourceGameTimeLabel) : undefined,
          sourceGameOpponent: item?.sourceGameOpponent ? String(item.sourceGameOpponent) : undefined,
          sourceGameField: item?.sourceGameField ? String(item.sourceGameField) : undefined
        }))
      )
      : [];
    const mergedDesired = new Map<string, DesiredPlayer>();
    cartDesired.forEach((item) => mergedDesired.set(desiredPlayerSelectionKey(item), item));
    persistedDesired.forEach((item) => {
      const key = desiredPlayerSelectionKey(item);
      if (!mergedDesired.has(key)) mergedDesired.set(key, item);
    });
    if (!hasLocalDesiredState && mergedDesired.size === 0) {
      remoteDesired.forEach((item) => {
        const key = desiredPlayerSelectionKey(item);
        if (!mergedDesired.has(key)) mergedDesired.set(key, item);
      });
    }
    const hydratedDesired = Array.from(mergedDesired.values());
    setDesiredPlayersAndPersist(hydratedDesired);
    const generated = hydratedDesired.length ? (mine.generated_plan || []) : [];
    setMyGeneratedPlan(generated);
    const persistedRaw = planWorkflowStatusKey ? safeLocalGet(planWorkflowStatusKey) : null;
    const persisted = isPlanWorkflowStatus(persistedRaw) ? persistedRaw : null;
    const nextStatus: PlanWorkflowStatus = generated.length
      ? (persisted === "approved" ? "approved" : "pending_approval")
      : "draft";
    setPlanWorkflowStatus(nextStatus);
    if (nextStatus === "draft" && planWorkflowStatusKey) {
      safeLocalRemove(planWorkflowStatusKey);
    }
  }

  async function fetchSchedules() {
    const fetchSeq = schedulesFetchSeqRef.current + 1;
    schedulesFetchSeqRef.current = fetchSeq;
    const scopeParams = new URLSearchParams();
    scopeParams.set("company", company);
    if (selectedInventorySlug) scopeParams.set("inventorySlug", selectedInventorySlug);
    if (selectedTournamentId) scopeParams.set("tournamentId", selectedTournamentId);
    const res = await fetch(`/api/schedules?${scopeParams.toString()}`);
    if (fetchSeq !== schedulesFetchSeqRef.current) return;
    if (!res.ok) {
      const local = readLocalFallbackSchedule();
      if (local) {
        if (fetchSeq !== schedulesFetchSeqRef.current) return;
        setSchedules([local]);
        hydrateMySchedule([local]);
        setPlanWorkflowNote("Cloud schedule sync is unavailable. Showing your local saved recommendation.");
      }
      return;
    }
    const data = await res.json();
    const remoteList: CoachSchedule[] = data.schedules || [];
    const remoteMine = remoteList.find((item) => item.user_id === user?.userId) || null;
    if (!remoteMine) {
      const key = localScheduleFallbackKey(user, company, selectedInventorySlug, selectedTournamentId);
      if (key) safeLocalRemove(key);
    }
    const local = readLocalFallbackSchedule();
    const scheduleList = local && !remoteList.some((item) => item.user_id === local.user_id)
      ? [local, ...remoteList]
      : remoteList;
    if (fetchSeq !== schedulesFetchSeqRef.current) return;
    setSchedules(scheduleList);
    hydrateMySchedule(scheduleList);
  }

  useEffect(() => {
    if (!queryStateApplied || !user) return;
    void fetchSchedules();
  }, [company, queryStateApplied, selectedInventorySlug, selectedTournamentId, user]);

  async function removeMySchedule() {
    const key = localScheduleFallbackKey(user, company, selectedInventorySlug, selectedTournamentId);
    const local = readLocalFallbackSchedule();
    const hasServerSchedule = schedules.some((item) => item.user_id === user?.userId);
    if (!hasServerSchedule && !local && !myGeneratedPlan.length) {
      setPlayerSearchStatus("No schedule found to remove.");
      return;
    }
    const scopeParams = new URLSearchParams();
    scopeParams.set("company", company);
    if (selectedInventorySlug) scopeParams.set("inventorySlug", selectedInventorySlug);
    if (selectedTournamentId) scopeParams.set("tournamentId", selectedTournamentId);
    const res = await fetch(`/api/schedules?${scopeParams.toString()}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setPlayerSearchStatus(body?.error || `Unable to remove schedule (${res.status}).`);
      return;
    }
    if (key) safeLocalRemove(key);
    const data = await res.json().catch(() => ({}));
    const nextList: CoachSchedule[] = Array.isArray(data?.schedules) ? data.schedules : [];
    setSchedules(nextList);
    hydrateMySchedule(nextList);
    setPlayerSearchStatus("Schedule removed.");
  }

  async function fetchLiveLocations() {
    const res = await fetch("/api/location", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    const rows = Array.isArray(data?.locations) ? data.locations as Array<Record<string, unknown>> : [];
    const normalized = rows.map((row) => ({
      id: String(row?.id || ""),
      org_id: String(row?.org_id || ""),
      user_id: String(row?.user_id || ""),
      coach_name: String(row?.coach_name || ""),
      latitude: Number(row?.latitude || 0),
      longitude: Number(row?.longitude || 0),
      accuracy_meters: row?.accuracy_meters == null ? null : Number(row.accuracy_meters),
      captured_at: String(row?.captured_at || ""),
      updated_at: String(row?.updated_at || "")
    })) as CoachLiveLocation[];
    setLiveLocations(normalized.filter((row) => row.user_id && Number.isFinite(row.latitude) && Number.isFinite(row.longitude)));
  }

  async function pingCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("Live location unsupported in this browser.");
      return;
    }
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 9000,
        maximumAge: 20000
      });
    }).catch(() => null);
    if (!position) {
      setLocationStatus("Location permission denied or unavailable.");
      return;
    }

    const payload = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy
    };
    const res = await fetch("/api/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setLocationStatus(body?.error || `Location update failed (${res.status})`);
      return;
    }
    setLocationStatus(`Live location synced at ${new Date().toLocaleTimeString()}.`);
    await fetchLiveLocations();
  }

  function createGeneratedPlan(targetPlayers: DesiredPlayer[] = desiredPlayers): PlanItem[] {
    const plan: PlanItem[] = [];
    const targetIds = targetPlayers.length ? new Set(targetPlayers.map((item) => item.playerId)) : watchlistSet;

    if (scheduleForm.flightArrivalTime) {
      plan.push({
        at: new Date(scheduleForm.flightArrivalTime).toISOString(),
        title: "Arrive",
        detail: `${scheduleForm.flightSource || "Unknown source"} -> ${scheduleForm.flightDestination || "Unknown destination"}`
      });
    }

    const stops = buildPath(games, targetIds);
    if (stops.length) {
      stops.forEach((stop) => {
        plan.push({
          at: stop.at,
          title: `Go to ${stop.field}`,
          detail: `${stop.watchlistCount} player(s): ${stop.players.join(", ")} · walk ${stop.walkFromPrevMinutes} min`
        });
      });
    } else {
      games.slice(0, 5).forEach((game) => {
        plan.push({
          at: game.startTime,
          title: `Scout ${game.field}`,
          detail: `${game.homeTeam} vs ${game.awayTeam}`
        });
      });
    }

    if (scheduleForm.hotelName) {
      const lastTime = plan[plan.length - 1]?.at || new Date().toISOString();
      plan.push({
        at: lastTime,
        title: "Return to hotel",
        detail: scheduleForm.hotelName
      });
    }

    return plan;
  }

  async function saveSchedule(
    generatedPlan?: PlanItem[],
    desiredOverride?: DesiredPlayer[],
    formOverride?: typeof scheduleForm
  ) {
    const activeForm = formOverride ?? scheduleForm;
    const desiredPayload = sanitizeDesiredPlayers(desiredOverride ?? desiredPlayers);
    const normalizedFlightArrival = activeForm.flightArrivalTime
      ? localInputToOffsetIso(activeForm.flightArrivalTime)
      : "";
    const payload = {
      ...activeForm,
      flightArrivalTime: normalizedFlightArrival,
      company,
      inventorySlug: selectedInventorySlug,
      tournamentId: selectedTournamentId,
      desiredPlayers: desiredPayload,
      generatedPlan: generatedPlan ?? myGeneratedPlan
    };

    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const local = buildLocalFallbackSchedule(
        activeForm,
        desiredPayload,
        generatedPlan ?? myGeneratedPlan
      );
      if (local) {
        writeLocalFallbackSchedule(local);
        setSchedules((prev) => [local, ...prev.filter((item) => item.user_id !== local.user_id)]);
        hydrateMySchedule([local]);
        setPlanWorkflowNote("Saved locally. Cloud sync is unavailable, but your recommendation is ready.");
      }
      return;
    }

    const data = await res.json();
    const scheduleList: CoachSchedule[] = data.schedules || [];
    const local = buildLocalFallbackSchedule(
      activeForm,
      desiredPayload,
      generatedPlan ?? myGeneratedPlan
    );
    if (local) {
      writeLocalFallbackSchedule(local);
    }
    setSchedules(scheduleList);
    hydrateMySchedule(scheduleList);
  }

  async function addSchedule(desiredOverride?: DesiredPlayer[]) {
    const activeDesired = sanitizeDesiredPlayers(desiredOverride ?? desiredPlayers);
    const nextPlan = createGeneratedPlan(activeDesired);
    const mergedPlan = [...myGeneratedPlan, ...nextPlan];
    if (desiredOverride) {
      setDesiredPlayersAndPersist(activeDesired);
    }
    setMyGeneratedPlan(mergedPlan);
    await saveSchedule(mergedPlan, activeDesired);
  }

  async function saveProfile() {
    if (!user) return;
    const firstName = profileForm.firstName.trim();
    const lastName = profileForm.lastName.trim();
    const normalizedEmail = profileForm.universityEmail.trim().toLowerCase();
    const normalizedCode = profileForm.countryCallingCode.replace(/[^\d]/g, "");
    const normalizedPhone = profileForm.mobileNumber.replace(/[^\d]/g, "");
    const fullName = `${firstName} ${lastName}`.trim();
    if (!firstName) {
      setProfileStatus("First name is required.");
      return;
    }
    if (!normalizedEmail.includes("@")) {
      setProfileStatus("Enter a valid email address.");
      return;
    }
    if (!normalizedCode || normalizedCode.length > 4) {
      setProfileStatus("Enter a valid country code.");
      return;
    }
    if (!normalizedPhone || normalizedPhone.length < 7 || normalizedPhone.length > 15) {
      setProfileStatus("Enter a valid mobile number.");
      return;
    }
    setProfileStatus("Saving profile...");
    try {
      const res = await fetch("/api/session/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fullName || user.name,
          email: normalizedEmail,
          gender: profileForm.gender,
          phone: normalizedPhone,
          countryCallingCode: normalizedCode
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfileStatus(String(data?.error || "Unable to update profile right now."));
        return;
      }
      const nextUser = data?.user as SessionUser | undefined;
      if (nextUser) {
        const oldKey = profileStorageKey(user);
        const nextKey = profileStorageKey(nextUser);
        setUser(nextUser);
        if (oldKey && nextKey && oldKey !== nextKey) {
          safeLocalRemove(oldKey);
        }
        if (nextKey) {
          safeLocalSet(nextKey, JSON.stringify({
            firstName,
            lastName,
            universityEmail: normalizedEmail,
            gender: profileForm.gender,
            countryCallingCode: normalizedCode,
            mobileNumber: normalizedPhone,
            dateOfBirth: profileForm.dateOfBirth || "1990-01-01"
          } satisfies ProfileFormState));
        }
      }
      setProfileStatus("Profile updated.");
    } catch {
      setProfileStatus("Unable to update profile right now.");
    }
  }

  function currentEventNumber() {
    const fromTournament = selectedTournament?.id?.match(/(\d+)/)?.[1] || "";
    if (fromTournament && Number(fromTournament) > 10000) return fromTournament;
    const fromHint = selectedInventory?.harvestHint?.match(/[?&]event=(\d+)/i)?.[1] || "";
    return fromHint || "";
  }

  function inlineTeamNoteStorageKey(target: InlineTeamNoteTarget) {
    const scope = [selectedInventorySlug || "inventory", selectedTournamentId || "tournament", target.teamId, target.selectionKey || target.playerId || "team"];
    return `bird_dog:inline_team_note:v1:${scope.join(":")}`;
  }

  function inlineTeamNoteKey(target: InlineTeamNoteTarget) {
    return target.selectionKey || target.playerId || `team:${target.teamId}`;
  }

  function inlineTeamNoteTargetFromInput(input: { team: TeamRef; player?: DesiredPlayer }) {
    return {
      teamId: input.team.id,
      teamName: input.team.name,
      playerId: input.player?.playerId,
      playerName: input.player?.name,
      selectionKey: input.player ? desiredPlayerSelectionKey(input.player) : undefined
    } satisfies InlineTeamNoteTarget;
  }

  function readInlineTeamNoteDraft(target: InlineTeamNoteTarget): InlineTeamNoteDraft {
    const raw = safeLocalGet(inlineTeamNoteStorageKey(target));
    const parsed = parseJsonSafe<InlineTeamNoteDraft | null>(raw, null);
    return {
      text: parsed?.text || "",
      audioUrl: parsed?.audioUrl || "",
      updatedAt: parsed?.updatedAt || ""
    };
  }

  function inlineTeamNoteDraftForTarget(target: InlineTeamNoteTarget) {
    return inlineTeamNoteDrafts[inlineTeamNoteKey(target)] || readInlineTeamNoteDraft(target);
  }

  function updateInlineTeamNoteDraft(target: InlineTeamNoteTarget, patch: Partial<InlineTeamNoteDraft>) {
    const key = inlineTeamNoteKey(target);
    setInlineTeamNoteDrafts((prev) => {
      const base = prev[key] || readInlineTeamNoteDraft(target);
      const next = { ...base, ...patch };
      return { ...prev, [key]: next };
    });
  }

  function updateInlineTeamNoteStatus(target: InlineTeamNoteTarget, message: string) {
    const key = inlineTeamNoteKey(target);
    setInlineTeamNoteStatuses((prev) => ({ ...prev, [key]: message }));
  }

  function openInlineTeamNote(target: InlineTeamNoteTarget) {
    const key = inlineTeamNoteKey(target);
    setInlineTeamNoteDrafts((prev) => {
      if (prev[key]) return prev;
      return { ...prev, [key]: readInlineTeamNoteDraft(target) };
    });
    updateInlineTeamNoteStatus(target, "");
  }

  function viewTeamScheduleAndRoster(
    team: TeamRef,
    returnTab: "notes" | "schedule" = "notes",
    teamView: "schedule" | "roster" = "roster",
    gameContext?: {
      gameId?: string;
      startAt?: string;
      timeLabel?: string;
      opponent?: string;
      field?: string;
    }
  ) {
    const currentSearch = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const returnInventorySlug = String(
      selectedInventorySlug
      || currentSearch.get("inventorySlug")
      || ""
    ).trim();
    const returnTournamentId = String(
      selectedTournamentId
      || currentSearch.get("tournamentId")
      || ""
    ).trim();

    const params = new URLSearchParams();
    params.set("inventorySlug", returnInventorySlug);
    params.set("teamId", team.id);
    params.set("teamName", team.name);
    params.set("teamUrl", team.href || "");
    params.set("eventId", currentEventNumber());
    params.set("tournamentName", selectedTournament?.name || tournamentViewTitle || "");
    params.set("returnTab", returnTab);
    params.set("returnInventorySlug", returnInventorySlug);
    params.set("returnTournamentId", returnTournamentId);
    params.set("returnCompany", company);
    params.set("teamView", teamView);
    if (gameContext?.gameId) params.set("sourceGameId", gameContext.gameId);
    if (gameContext?.startAt) params.set("sourceGameStartAt", gameContext.startAt);
    if (gameContext?.timeLabel) params.set("sourceGameTimeLabel", gameContext.timeLabel);
    if (gameContext?.opponent) params.set("sourceGameOpponent", gameContext.opponent);
    if (gameContext?.field) params.set("sourceGameField", gameContext.field);
    router.push(`/bird-dog/team?${params.toString()}`);
  }

  function notesTeamCacheKey(team: TeamRef) {
    return smartSearchTeamCacheKey(team) || `name:${normalizeSmartSearch(team.name || "")}`;
  }

  function teamNameCoreTokens(value: string) {
    const ignore = new Set(["team", "baseball", "softball", "club", "academy", "the"]);
    return normalizeSmartSearch(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => {
        if (!token) return false;
        if (ignore.has(token)) return false;
        return true;
      });
  }

  function isAgeTeamToken(token: string) {
    const clean = String(token || "").trim().toLowerCase();
    if (!clean) return false;
    if (/^\d{1,2}u$/.test(clean)) return true;
    if (/^\d{1,2}$/.test(clean)) {
      const age = Number(clean);
      return Number.isFinite(age) && age >= 8 && age <= 22;
    }
    return false;
  }

  function teamNameMatchesTarget(candidate: string, team: TeamRef) {
    const normalized = normalizeSmartSearch(candidate);
    if (!normalized || isRosterPlaceholderTeamName(normalized)) return false;
    const wanted = normalizeSmartSearch(team.name || "");
    if (!wanted) return false;
    if (normalized === wanted) return true;

    const compact = normalized.replace(/\s+/g, "");
    const wantedCompact = wanted.replace(/\s+/g, "");
    if (compact && wantedCompact && compact === wantedCompact) return true;

    const candidateTokens = teamNameCoreTokens(normalized);
    const wantedTokens = teamNameCoreTokens(wanted);
    if (!candidateTokens.length || !wantedTokens.length) return false;

    const candidateSet = new Set(candidateTokens);
    const wantedSet = new Set(wantedTokens);
    const missingFromCandidate = wantedTokens.filter((token) => !candidateSet.has(token));
    const missingFromWanted = candidateTokens.filter((token) => !wantedSet.has(token));
    if (!missingFromCandidate.length && !missingFromWanted.length) return true;
    const wantedOnlyAgeTokens = missingFromCandidate.length > 0
      && missingFromCandidate.every((token) => isAgeTeamToken(token))
      && missingFromWanted.length === 0;
    const candidateOnlyAgeTokens = missingFromWanted.length > 0
      && missingFromWanted.every((token) => isAgeTeamToken(token))
      && missingFromCandidate.length === 0;
    return wantedOnlyAgeTokens || candidateOnlyAgeTokens;
  }

  function scheduleRowBelongsToTeam(row: TournamentScheduleRowView, team: TeamRef) {
    const teamId = String(team.id || "").trim().toLowerCase();
    const teamHref = String(team.href || "").trim().toLowerCase();

    if (teamId) {
      const homeId = String(row.homeTeamId || "").trim().toLowerCase();
      const awayId = String(row.awayTeamId || "").trim().toLowerCase();
      if (homeId === teamId || awayId === teamId) return true;
    }

    if (teamHref) {
      const homeHref = String(row.homeTeamHref || "").trim().toLowerCase();
      const awayHref = String(row.awayTeamHref || "").trim().toLowerCase();
      if (homeHref === teamHref || awayHref === teamHref) return true;
    }

    return teamNameMatchesTarget(row.homeTeam, team) || teamNameMatchesTarget(row.awayTeam, team);
  }

  function fallbackScheduleRowsForTeam(team: TeamRef) {
    const out: TeamDetailsScheduleRow[] = [];
    const seen = new Set<string>();
    tournamentScheduleGroups.forEach((group) => {
      group.rows.forEach((row, index) => {
        if (!scheduleRowBelongsToTeam(row, team)) return;
        const dedupeKey = [
          String(row.dayKey || "").trim(),
          String(row.gameNo || "").trim(),
          String(row.time || "").trim().toLowerCase(),
          String(row.location || "").trim().toLowerCase(),
          normalizeSmartSearch(row.homeTeam),
          normalizeSmartSearch(row.awayTeam)
        ].join("|");
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        const parsedStart = Date.parse(String(row.startAt || ""));
        out.push({
          gameNo: String(row.gameNo || `#${index + 1}`),
          date: Number.isFinite(parsedStart)
            ? new Date(parsedStart).toLocaleDateString("en-US", { timeZone: "UTC" })
            : "",
          dayLabel: String(row.dayLabel || "").trim() || undefined,
          time: String(row.time || "-"),
          field: String(row.location || "Field TBD"),
          ageDiv: String(row.ageDiv || "").trim() || undefined,
          homeTeam: String(row.homeTeam || "TBD"),
          awayTeam: String(row.awayTeam || "TBD"),
          homeScore: String(row.homeScore || "").trim() || undefined,
          awayScore: String(row.awayScore || "").trim() || undefined
        });
      });
    });
    out.sort((left, right) =>
      parseTeamDetailsScheduleSortMs(left, 0) - parseTeamDetailsScheduleSortMs(right, 0)
      || left.gameNo.localeCompare(right.gameNo)
    );
    return out;
  }

  function fallbackRosterRowsForTeam(team: TeamRef) {
    const rows = new Map<string, TeamDetailsRosterRow>();
    games.forEach((game) => {
      if (!teamNameMatchesTarget(game.homeTeam, team) && !teamNameMatchesTarget(game.awayTeam, team)) {
        return;
      }
      game.players.forEach((player) => {
        const name = String(player.name || "").trim();
        if (!looksLikeRosterPlayerName(name)) return;
        const key = String(player.id || "").trim() || `name:${normalizeSmartSearch(name)}`;
        if (rows.has(key)) return;
        rows.set(key, {
          no: "",
          name,
          position: String(player.position || "").trim(),
          school: String(player.school || "").trim(),
          hometown: "",
          commitment: ""
        });
      });
    });
    return Array.from(rows.values());
  }

  function fallbackRosterRowsFromPlayerIndex(team: TeamRef, rows: TournamentPlayerIndexRow[]) {
    const out = new Map<string, TeamDetailsRosterRow>();
    const teamId = String(team.id || "").trim().toLowerCase();
    rows.forEach((row) => {
      const rowName = String(row.name || "").trim();
      if (!looksLikeRosterPlayerName(rowName)) return;
      const rowTeamId = String(row.teamId || "").trim().toLowerCase();
      const rowTeamName = String(row.teamName || "").trim();
      const matchesById = Boolean(teamId && rowTeamId && teamId === rowTeamId);
      const matchesByName = teamNameMatchesTarget(rowTeamName || team.name || "", team);
      if (!matchesById && !matchesByName) return;
      const key = String(row.playerId || "").trim() || `name:${normalizeSmartSearch(rowName)}`;
      if (out.has(key)) return;
      out.set(key, {
        no: "",
        name: rowName,
        position: "",
        school: "",
        hometown: String(row.hometown || "").trim(),
        commitment: "",
        team: rowTeamName || team.name
      });
    });
    return Array.from(out.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  async function openTeamDetailsInline(team: TeamRef) {
    const cleanName = String(team.name || "").trim();
    if (!cleanName) return;
    setNotesSelectedTeam({ ...team, name: cleanName });
    setNotesTeamStatus("");
    setNotesSelectedRosterRowKeys([]);

    const cacheKey = notesTeamCacheKey(team);
    const cached = notesTeamDetailsCacheRef.current.get(cacheKey);
    if (cached) {
      setNotesTeamScheduleRows(cached.schedule);
      setNotesTeamRosterRows(cached.roster);
      setNotesTeamLoading(false);
      return;
    }

    setNotesTeamLoading(true);
    setNotesTeamScheduleRows([]);
    setNotesTeamRosterRows([]);
    const loadSeq = notesTeamLoadSeqRef.current + 1;
    notesTeamLoadSeqRef.current = loadSeq;
    try {
      const res = await fetch("/api/harvest/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventorySlug: selectedInventorySlug,
          teamId: smartSearchFallbackTeamId(cleanName, team.id),
          teamUrl: team.href || "",
          teamName: cleanName,
          tournamentName: selectedTournament?.name || tournamentViewTitle || "",
          eventId: currentEventNumber(),
          tournamentId: selectedTournamentId
        })
      });
      const data = await res.json().catch(() => ({}));
      if (loadSeq !== notesTeamLoadSeqRef.current) return;

      const importedSchedule = fallbackScheduleRowsForTeam(team);
      const liveSchedule = normalizeTeamDetailsScheduleRows(data?.schedule);
      const fallbackSchedule = liveSchedule.length ? liveSchedule : importedSchedule;
      const liveRoster = normalizeTeamDetailsRosterRows(data?.roster, cleanName);
      const fallbackRoster = mergeTeamDetailsRosterRows([liveRoster], cleanName);
      const snapshot: TeamDetailsSnapshot = {
        schedule: fallbackSchedule,
        roster: fallbackRoster
      };
      notesTeamDetailsCacheRef.current.set(cacheKey, snapshot);
      setNotesTeamScheduleRows(snapshot.schedule);
      setNotesTeamRosterRows(snapshot.roster);

      if (!res.ok) {
        const message = String(data?.error || "").trim();
        setNotesTeamStatus(message || "Team details are still syncing. Showing best available schedule.");
      } else if (!snapshot.schedule.length && !snapshot.roster.length) {
        setNotesTeamStatus("No schedule or roster found for this team yet.");
      } else if (!snapshot.roster.length) {
        setNotesTeamStatus("Schedule loaded. Team roster is not available yet.");
      } else {
        setNotesTeamStatus("");
      }
    } catch {
      if (loadSeq !== notesTeamLoadSeqRef.current) return;
      const fallbackSchedule = fallbackScheduleRowsForTeam(team);
      setNotesTeamScheduleRows(fallbackSchedule);
      setNotesTeamRosterRows([]);
      setNotesTeamStatus("Unable to load live team details right now. Showing imported schedule only.");
    } finally {
      if (loadSeq === notesTeamLoadSeqRef.current) {
        setNotesTeamLoading(false);
      }
    }
  }

  function resolveTeamForRosterOpen(teamName: string, teamId?: string, teamHref?: string) {
    const cleaned = String(teamName || "").trim();
    if (!cleaned || isRosterPlaceholderTeamName(cleaned)) return null;

    const cleanHref = String(teamHref || "").trim().toLowerCase();
    if (cleanHref) {
      const byHref = teamsByHref.get(cleanHref);
      if (byHref) return byHref;
    }

    const cleanId = String(teamId || "").trim().toLowerCase();
    if (cleanId) {
      const byId = teamsById.get(cleanId);
      if (byId) return byId;
    }

    const normalized = normalizeSmartSearch(cleaned);
    if (!normalized) return null;

    const exact = teamsByNormalizedName.get(normalized);
    if (exact) return exact;

    const compactWanted = normalized.replace(/\s+/g, "");
    const wantedTokens = teamNameTokens(normalized);
    let best: { team: TeamRef; score: number } | null = null;
    for (const team of selectedTournamentTeams) {
      const candidate = normalizeSmartSearch(team.name || "");
      if (!candidate) continue;
      const compactCandidate = candidate.replace(/\s+/g, "");
      if (compactCandidate && compactWanted && compactCandidate === compactWanted) {
        return team;
      }

      const candidateTokens = teamNameTokens(candidate);
      if (!wantedTokens.length || !candidateTokens.length) continue;
      const candidateSet = new Set(candidateTokens);
      const overlap = wantedTokens.filter((token) => candidateSet.has(token)).length;
      if (!overlap) continue;
      const score = overlap / Math.max(wantedTokens.length, candidateTokens.length);
      if (!best || score > best.score) best = { team, score };
    }

    if (best && best.score >= 0.5) return best.team;
    if (cleanHref || cleanId) {
      return {
        id: cleanId || `pbr-team-${normalized.replace(/\s+/g, "-")}`,
        name: cleaned,
        from: "",
        href: cleanHref || undefined
      } satisfies TeamRef;
    }
    return null;
  }

  function resolvePlayerIdByName(playerName: string, teamId: string) {
    const wanted = normalizeSmartSearch(playerName);
    const exact = players.find((player) => normalizeSmartSearch(player.name) === wanted);
    if (exact) return exact.id;
    const fuzzy = players.find((player) => {
      const candidate = normalizeSmartSearch(player.name);
      return candidate.includes(wanted) || wanted.includes(candidate);
    });
    if (fuzzy) return fuzzy.id;
    return `smart:${teamId}:${wanted}`;
  }

  async function loadRosterForSmartSearch(team: TeamRef): Promise<TeamRosterSearchRow[]> {
    const cacheKey = smartSearchTeamCacheKey(team) || smartSearchFallbackTeamId(team.name, team.id);
    const cached = teamRosterSearchCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const runFetch = async (searchOnly: boolean) => {
      const res = await fetch("/api/harvest/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventorySlug: selectedInventorySlug,
          teamId: smartSearchFallbackTeamId(team.name, team.id),
          teamUrl: team.href || "",
          teamName: team.name,
          tournamentName: selectedTournament?.name || tournamentViewTitle || "",
          eventId: currentEventNumber(),
          tournamentId: selectedTournamentId,
          searchOnly
        })
      });
      if (!res.ok) return [] as TeamRosterSearchRow[];
      const data = await res.json().catch(() => ({}));
      const roster = Array.isArray(data?.roster) ? data.roster as Array<Record<string, unknown>> : [];
      return roster
        .map((row) => ({
          no: String(row?.no || ""),
          name: String(row?.name || ""),
          hometown: String(row?.hometown || team.from || "")
        }))
        .filter((row) => row.name.trim().length > 1);
    };

    let normalized = await runFetch(true);
    if (!normalized.length) {
      normalized = await runFetch(false);
    }
    teamRosterSearchCacheRef.current.set(cacheKey, normalized);
    return normalized;
  }

  async function loadTournamentPlayerIndex(): Promise<TournamentPlayerIndexRow[]> {
    const cacheKey = `${selectedInventorySlug}:${selectedTournamentId}`;
    if (!selectedInventorySlug || !selectedTournamentId) return [];
    if (tournamentPlayerIndexKeyRef.current === cacheKey && tournamentPlayerIndexRef.current.length) {
      return tournamentPlayerIndexRef.current;
    }
    if (tournamentPlayerIndexLoadingRef.current) {
      return tournamentPlayerIndexLoadingRef.current;
    }

    const pending = fetch("/api/harvest/team-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inventorySlug: selectedInventorySlug,
        tournamentId: selectedTournamentId
      })
    })
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((data) => {
        const rows = Array.isArray(data?.rows) ? data.rows as Array<Record<string, unknown>> : [];
        const normalized: TournamentPlayerIndexRow[] = rows
          .map((row) => ({
            playerId: String(row?.playerId || ""),
            name: String(row?.name || ""),
            hometown: String(row?.hometown || ""),
            teamId: String(row?.teamId || ""),
            teamName: String(row?.teamName || "")
          }))
          .filter((row) => row.playerId && row.name && row.teamId && row.teamName);
        tournamentPlayerIndexRef.current = normalized;
        tournamentPlayerIndexKeyRef.current = cacheKey;
        return normalized;
      })
      .catch(() => []);

    tournamentPlayerIndexLoadingRef.current = pending;
    const rows = await pending;
    tournamentPlayerIndexLoadingRef.current = null;
    return rows;
  }

  async function runTournamentPlayerSearch(forceDeepScan = false) {
    const query = normalizeSmartSearch(playerSearchQuery);
    if (query.length < 2) {
      setPlayerSearchStatus("Type at least 2 characters to search players.");
      setPlayerSearchResults([]);
      setPlayerSearchCanDeepScan(false);
      return;
    }
    const teams = selectedTournament?.teams || [];
    if (!teams.length) {
      setPlayerSearchStatus("Open a tournament first to search players.");
      setPlayerSearchResults([]);
      setPlayerSearchCanDeepScan(false);
      return;
    }

    setPlayerSearchLoading(true);
    setPlayerSearchStatus("Searching players...");
    setPlayerSearchCanDeepScan(false);

    try {
      const queryTokens = query.split(" ").filter(Boolean);
      const quickRows = await loadTournamentPlayerIndex();
      const cacheKey = `${selectedInventorySlug}:${selectedTournamentId}`;
      const deepIndexMap = new Map<string, TournamentPlayerIndexRow>(
        quickRows.map((row) => [`${row.teamId}::${row.playerId}`, row])
      );
      if (quickRows.length) {
        const fast = quickRows
          .filter((row) => {
            const blob = normalizeSmartSearch(row.name);
            return queryTokens.every((token) => blob.includes(token));
          })
          .map((row) => ({
            key: `${row.teamId}::${normalizeSmartSearch(row.name)}::${row.playerId}`,
            playerId: row.playerId,
            name: row.name,
            hometown: row.hometown || "-",
            teamId: row.teamId,
            teamName: row.teamName
          }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.teamName.localeCompare(b.teamName))
          .slice(0, 300);
        setPlayerSearchResults(fast);
        setPlayerSearchStatus(
          fast.length
            ? `Found ${fast.length} players instantly.`
            : "No instant match yet. Running deep scan..."
        );
        if (fast.length) return;
        if (!forceDeepScan) {
          setPlayerSearchStatus("No instant match yet. Click Run Deep Scan for exhaustive search.");
          setPlayerSearchResults([]);
          setPlayerSearchCanDeepScan(true);
          return;
        }
      }

      const matches = new Map<string, SmartPlayerResult>();
      const scanList = teams;
      const chunkSize = 20;

      for (let start = 0; start < scanList.length; start += chunkSize) {
        const chunk = scanList.slice(start, start + chunkSize);
        const loaded = await Promise.all(chunk.map((team) => loadRosterForSmartSearch(team).then((roster) => ({ team, roster }))));
        loaded.forEach(({ team, roster }) => {
          roster.forEach((row) => {
            const normalizedName = normalizeSmartSearch(row.name);
            const playerId = resolvePlayerIdByName(row.name, team.id);
            deepIndexMap.set(`${team.id}::${playerId}`, {
              playerId,
              name: row.name,
              hometown: row.hometown || team.from || "-",
              teamId: team.id,
              teamName: team.name
            });

            const blob = normalizeSmartSearch(row.name);
            if (!queryTokens.every((token) => blob.includes(token))) return;
            const key = `${team.id}::${normalizedName}::${row.no || ""}`;
            if (matches.has(key)) return;
            matches.set(key, {
              key,
              playerId,
              name: row.name,
              hometown: row.hometown || team.from || "-",
              teamId: team.id,
              teamName: team.name
            });
          });
        });

        const scanned = Math.min(start + chunk.length, scanList.length);
        setPlayerSearchStatus(`Deep scan ${scanned}/${scanList.length} teams...`);
        if (matches.size >= 300 && scanned >= 20) break;
      }

      tournamentPlayerIndexRef.current = Array.from(deepIndexMap.values());
      tournamentPlayerIndexKeyRef.current = cacheKey;

      const result = Array.from(matches.values())
        .sort((a, b) => a.name.localeCompare(b.name) || a.teamName.localeCompare(b.teamName))
        .slice(0, 300);
      setPlayerSearchResults(result);
      setPlayerSearchStatus(
        result.length
          ? `Found ${result.length} players. Select players to build your final list.`
          : "No player match found. Try another player name."
      );
    } finally {
      setPlayerSearchLoading(false);
    }
  }

  function clearSmartScheduleInsights() {
    setSmartRouteHint("");
    setScheduleForm((prev) => {
      if (!prev.hotelName) return prev;
      return { ...prev, hotelName: "" };
    });
  }

  function clearArrivalValidationWarnings() {
    const isArrivalFeasibilityMessage = (value: string) =>
      /schedule cannot be created\./i.test(value)
      && /arriving/i.test(value)
      && /missed players/i.test(value);
    setPlayerSearchStatus((prev) => (isArrivalFeasibilityMessage(prev) ? "" : prev));
    setPlanWorkflowNote((prev) => (isArrivalFeasibilityMessage(prev) ? "" : prev));
  }

  function updateStateArrivalInput(stateCode: string, patch: Partial<StateArrivalInput>) {
    const normalized = String(stateCode || "").trim().toUpperCase();
    if (!normalized) return;
    clearArrivalValidationWarnings();
    setStateArrivalInputs((prev) => ({
      ...prev,
      [normalized]: {
        arrivalLocation: String(prev[normalized]?.arrivalLocation || "").trim(),
        arrivalTime: String(prev[normalized]?.arrivalTime || "").trim(),
        ...patch
      }
    }));
  }

  function updateStateHotelInput(stateCode: string, patch: Partial<StateHotelInput>) {
    const normalized = String(stateCode || "").trim().toUpperCase();
    if (!normalized) return;
    setStateHotelInputs((prev) => ({
      ...prev,
      [normalized]: {
        hotelName: String(prev[normalized]?.hotelName || "").trim(),
        checkIn: String(prev[normalized]?.checkIn || "").trim(),
        checkOut: String(prev[normalized]?.checkOut || "").trim(),
        ...patch
      }
    }));
  }

  function applyStateArrivalSuggestion(stateCode: string, suggestion: PlaceSuggestion) {
    updateStateArrivalInput(stateCode, { arrivalLocation: String(suggestion.label || "").trim() });
    setActiveStateArrivalInput("");
    setStateArrivalSuggestions((prev) => ({ ...prev, [stateCode]: [] }));
  }

  function applyStateHotelSuggestion(stateCode: string, suggestion: PlaceSuggestion) {
    updateStateHotelInput(stateCode, { hotelName: String(suggestion.label || "").trim() });
    setActiveStateHotelInput("");
    setStateHotelNameSuggestions((prev) => ({ ...prev, [stateCode]: [] }));
  }

  function applyHotelSuggestion(hotel: HotelSuggestion) {
    const cleanName = String(hotel.name || "").trim();
    if (!cleanName) return;
    setScheduleForm((prev) => ({ ...prev, hotelName: cleanName }));
    setPlayerSearchStatus(`Nearby stay selected: ${cleanName}`);
    setPlanWorkflowNote("Nearby stay selected. Recreate schedule to include this recommendation.");
  }

  function toggleSmartPlayerSelection(item: SmartPlayerResult) {
    const selectionKey = smartPlayerSelectionKey(item.teamId, item.playerId);
    setDesiredPlayersAndPersist((prev) => {
      if (prev.some((row) => desiredPlayerSelectionKey(row) === selectionKey)) {
        return prev.filter((row) => desiredPlayerSelectionKey(row) !== selectionKey);
      }
      return [...prev, {
        playerId: item.playerId,
        selectionKey,
        name: item.name,
        team: item.teamName,
        hometown: item.hometown,
        sourceTeamId: item.teamId,
        sourceTeamName: item.teamName
      }];
    });
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Player selection updated. Recommendation is regenerating.");
  }

  async function geocodeForRoute(address: string): Promise<GeoLocation | null> {
    const normalized = normalizeSmartSearch(address);
    if (!normalized) return null;
    if (geocodeCacheRef.current.has(normalized)) {
      return geocodeCacheRef.current.get(normalized) || null;
    }
    const rawAddress = String(address || "").trim();
    const eventCity = String(selectedInventory?.displayCity || selectedTournament?.city || eventLocationHint || "").trim();
    const afterAt = rawAddress.includes("@")
      ? rawAddress.split("@").slice(-1)[0]?.trim() || ""
      : "";
    const trimmedPrefix = rawAddress
      .replace(/^[a-z]?\d+\s*@\s*/i, "")
      .replace(/^(?:field|diamond|court|site)\s*[a-z0-9-]*\s*@?\s*/i, "")
      .trim();
    const strippedSlot = rawAddress
      .replace(/^[a-z]?\d+\s*@\s*/i, "")
      .replace(/^field\s*[a-z0-9-]*\s*@?\s*/i, "")
      .replace(/^diamond\s*[a-z0-9-]*\s*@?\s*/i, "")
      .trim();
    const noGateLabels = rawAddress
      .replace(/\b(?:field|diamond|court|site)\s*[a-z0-9-]*\b/ig, " ")
      .replace(/\s+/g, " ")
      .trim();
    const trailingCityState = rawAddress.split(",").slice(-2).join(",").trim();
    const candidates = Array.from(new Set([
      rawAddress,
      afterAt,
      trimmedPrefix,
      strippedSlot,
      noGateLabels,
      rawAddress.replace(/\bfield\s*[a-z0-9-]*\b/ig, "").replace(/\s+/g, " ").trim(),
      rawAddress.split(",").slice(1).join(",").trim(),
      trailingCityState,
      eventCity ? `${rawAddress}, ${eventCity}` : "",
      eventCity ? `${afterAt || strippedSlot}, ${eventCity}` : "",
      eventCity ? `${trimmedPrefix || strippedSlot}, ${eventCity}` : "",
      eventCity ? `${noGateLabels || strippedSlot}, ${eventCity}` : "",
      eventCity ? `${afterAt || strippedSlot}, ${eventCity}, United States` : ""
    ].filter(Boolean)));
    for (const query of candidates) {
      try {
        const res = await fetch(`/api/maps/geocode?address=${encodeURIComponent(query)}`, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json().catch(() => ({}));
        const lat = data?.location?.lat;
        const lng = data?.location?.lng;
        if (typeof lat !== "number" || typeof lng !== "number") continue;
        const point: GeoLocation = {
          lat,
          lng,
          label: String(data?.location?.label || query || address)
        };
        geocodeCacheRef.current.set(normalized, point);
        return point;
      } catch {
        // Try next geocode query candidate.
      }
    }
    geocodeCacheRef.current.set(normalized, null);
    return null;
  }

  async function fetchLiveRouteEstimate(origin: GeoLocation, destination: GeoLocation, departAtMs?: number): Promise<TravelEstimate | null> {
    try {
      const url = new URL("/api/maps/route-time", window.location.origin);
      url.searchParams.set("originLat", String(origin.lat));
      url.searchParams.set("originLng", String(origin.lng));
      url.searchParams.set("destLat", String(destination.lat));
      url.searchParams.set("destLng", String(destination.lng));
      if (Number.isFinite(departAtMs)) {
        url.searchParams.set("departAt", new Date(Number(departAtMs)).toISOString());
      }
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      const minutes = Number(data?.minutes || NaN);
      if (!Number.isFinite(minutes) || minutes <= 0) return null;
      const mode = String(data?.mode || "").trim() || "Drive / Cab";
      const advisory = String(data?.advisory || "").trim();
      const distanceKm = Number(data?.distanceKm || NaN);
      const delayMinutes = Number(data?.delayMinutes || NaN);
      return {
        mode,
        minutes: Math.max(1, Math.round(minutes)),
        advisory: advisory || "Live route ETA",
        distanceKm: Number.isFinite(distanceKm) ? distanceKm : undefined,
        delayMinutes: Number.isFinite(delayMinutes) ? Math.max(0, Math.round(delayMinutes)) : undefined
      } satisfies TravelEstimate;
    } catch {
      return null;
    }
  }

  async function detectCoachStartPoint() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return null;
    const location = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 20000 }
      );
    });
    if (!location) return null;

    let label = "Current location";
    try {
      const reverse = await fetch(`/api/maps/reverse-geocode?lat=${location.coords.latitude}&lng=${location.coords.longitude}`, {
        cache: "no-store"
      });
      if (reverse.ok) {
        const data = await reverse.json().catch(() => ({}));
        if (data?.location?.label) {
          label = String(data.location.label);
        }
      }
    } catch {
      // Keep fallback label.
    }

    return {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      label
    } satisfies GeoLocation;
  }

  function destinationForPlayer(player: DesiredPlayer) {
    const hometown = String(player.hometown || "").trim();
    if (hometown && hometown !== "-") return hometown;

    const teamName = normalizeSmartSearch(player.team || "");
    const teamMatch = (selectedTournament?.teams || []).find((team) => {
      const normalized = normalizeSmartSearch(team.name || "");
      return normalized === teamName || normalized.includes(teamName) || teamName.includes(normalized);
    });
    const teamFrom = String(teamMatch?.from || "").trim();
    const eventCity = String(selectedInventory?.displayCity || selectedTournament?.city || "").trim();
    if (teamFrom && extractUsStateCode(teamFrom)) return teamFrom;
    if (eventCity) return eventCity;
    return "Tournament Venue";
  }

  function teamsLookEquivalent(a: string, b: string) {
    const left = normalizeSmartSearch(a);
    const right = normalizeSmartSearch(b);
    if (!left || !right) return false;
    if (left === right) return true;

    const variantTokens = new Set([
      "red", "blue", "black", "white", "gold", "silver", "green", "orange", "navy", "maroon",
      "elite", "prime", "prospects", "platinum", "royal", "gray", "grey",
      "major", "minor", "open", "aaa", "aa", "a"
    ]);
    const tokenize = (value: string) => value
      .split(" ")
      .map((token) => token.trim().toLowerCase())
      .filter((token) => {
        if (!token) return false;
        return true;
      });
    const compactLeft = left.replace(/\s+/g, "");
    const compactRight = right.replace(/\s+/g, "");
    if (compactLeft && compactRight && compactLeft === compactRight) return true;

    const leftTokens = tokenize(left);
    const rightTokens = tokenize(right);
    if (!leftTokens.length || !rightTokens.length) return false;

    const rightSet = new Set(rightTokens);
    const leftSet = new Set(leftTokens);
    const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
    if (!overlap) return false;

    const leftOnly = leftTokens.filter((token) => !rightSet.has(token));
    const rightOnly = rightTokens.filter((token) => !leftSet.has(token));
    const ignorableDelta = (token: string) => isAgeTeamToken(token) || variantTokens.has(token);
    const leftSignificantOnly = leftOnly.filter((token) => !ignorableDelta(token));
    const rightSignificantOnly = rightOnly.filter((token) => !ignorableDelta(token));

    // Prevent sibling squads with different suffixes from being treated as the same team
    // (for example: "CBU 2028 United Merrell" vs "CBU 2028 United Severidt").
    if (leftSignificantOnly.length > 0 && rightSignificantOnly.length > 0) return false;

    if (!leftOnly.length && !rightOnly.length) return true;
    if (left.includes(right) || right.includes(left)) {
      return leftSignificantOnly.length === 0 || rightSignificantOnly.length === 0;
    }

    const ratio = overlap / Math.max(leftTokens.length, rightTokens.length);
    return ratio >= 0.9 && (leftSignificantOnly.length === 0 || rightSignificantOnly.length === 0);
  }

  function normalizeTeamIdValue(value: unknown) {
    return String(value ?? "").trim().toLowerCase();
  }

  function gameTeamId(game: Game, side: "home" | "away") {
    const raw = game as unknown as Record<string, unknown>;
    if (side === "home") {
      return normalizeTeamIdValue(raw.homeTeamId || raw.home_team_id || raw.team1Id || raw.team_1_id);
    }
    return normalizeTeamIdValue(raw.awayTeamId || raw.away_team_id || raw.team2Id || raw.team_2_id);
  }

  function playerMatchSideForGame(player: DesiredPlayer, game: Game): "home" | "away" | null {
    const playerTeamId = normalizeTeamIdValue(player.sourceTeamId || "");
    if (playerTeamId) {
      const homeId = gameTeamId(game, "home");
      const awayId = gameTeamId(game, "away");
      if (homeId && playerTeamId === homeId) return "home";
      if (awayId && playerTeamId === awayId) return "away";
    }

    const strictSource = normalizeSmartSearch(player.sourceTeamName || "");
    const strictTeam = normalizeSmartSearch(player.team || "");
    const home = normalizeSmartSearch(game.homeTeam || "");
    const away = normalizeSmartSearch(game.awayTeam || "");
    if (strictSource && strictSource === home) return "home";
    if (strictSource && strictSource === away) return "away";
    if (strictTeam && strictTeam === home) return "home";
    if (strictTeam && strictTeam === away) return "away";

    const homeMatch = teamsLookEquivalent(player.team, game.homeTeam)
      || teamsLookEquivalent(player.sourceTeamName || "", game.homeTeam);
    const awayMatch = teamsLookEquivalent(player.team, game.awayTeam)
      || teamsLookEquivalent(player.sourceTeamName || "", game.awayTeam);
    if (homeMatch && !awayMatch) return "home";
    if (awayMatch && !homeMatch) return "away";
    if (homeMatch && awayMatch) return null;
    return null;
  }

  function gameLocationQuery(game: Game) {
    const field = normalizedVenueLabel(game);
    const city = String(selectedInventory?.displayCity || selectedTournament?.city || "").trim();
    return city ? `${field}, ${city}` : field;
  }

  function normalizedVenueLabel(game: Game) {
    const rawField = String(game.field || "").trim();
    const eventCity = String(selectedInventory?.displayCity || selectedTournament?.city || "").trim();
    if (!rawField) return eventCity || "Tournament Venue";
    const rawNorm = normalizeSmartSearch(rawField);
    const homeNorm = normalizeSmartSearch(String(game.homeTeam || ""));
    const awayNorm = normalizeSmartSearch(String(game.awayTeam || ""));
    const sameAsHome = rawNorm && homeNorm && (rawNorm === homeNorm || rawNorm.includes(homeNorm) || homeNorm.includes(rawNorm));
    const sameAsAway = rawNorm && awayNorm && (rawNorm === awayNorm || rawNorm.includes(awayNorm) || awayNorm.includes(rawNorm));
    if (sameAsHome || sameAsAway || /^(team|pool|winner|loser)\b/i.test(rawField)) {
      return eventCity || "Tournament Venue";
    }
    return rawField;
  }

  function buildCoachGameCandidates(targetPlayers: DesiredPlayer[]): CoachGameCandidate[] {
    const games = selectedTournament?.games || [];
    const now = Date.now();
    const baselineStartMs = Math.max(tournamentPlanningStartMs, now);
    const GAME_MINUTES = 125;

    if (!games.length) {
      const grouped = new Map<string, { destination: string; players: DesiredPlayer[] }>();
      targetPlayers.forEach((player) => {
        const destination = destinationForPlayer(player);
        const key = normalizeSmartSearch(destination) || desiredPlayerSelectionKey(player);
        const existing = grouped.get(key);
        if (existing) {
          existing.players.push(player);
        } else {
          grouped.set(key, { destination, players: [player] });
        }
      });
      return Array.from(grouped.values()).slice(0, 24).map((item, index) => {
        const startMs = baselineStartMs + index * 75 * 60 * 1000;
        const fallbackState = extractUsStateCode(item.destination)
          || extractUsStateCode(String(selectedInventory?.displayCity || selectedTournament?.city || ""));
        return {
          key: `fallback:${index}`,
          gameNo: `#${index + 1}`,
          startMs,
          endMs: startMs + GAME_MINUTES * 60 * 1000,
          stateCode: fallbackState,
          locationLabel: item.destination,
          locationQuery: item.destination,
          homeTeam: item.players[0]?.team || "Team A",
          awayTeam: "Team B",
          matchedPlayers: item.players,
          point: null
        } satisfies CoachGameCandidate;
      });
    }

    const matchedPlayerKeys = new Set<string>();
    const mapped: Array<CoachGameCandidate | null> = games.map((game, index): CoachGameCandidate | null => {
      const matchedPlayers = targetPlayers.filter((player) =>
        Boolean(playerMatchSideForGame(player, game))
      );
      if (!matchedPlayers.length) return null;
      matchedPlayers.forEach((player) => matchedPlayerKeys.add(desiredPlayerSelectionKey(player)));
      const startAt = Date.parse(String(game.startTime || ""));
      const hasValidStart = Number.isFinite(startAt);
      const startMs = hasValidStart ? startAt : (baselineStartMs + index * 90 * 60 * 1000);
      const venueLabel = normalizedVenueLabel(game);
      const stateCode = extractUsStateCode(
        `${venueLabel}, ${String(selectedInventory?.displayCity || selectedTournament?.city || "").trim()}`
      ) || extractUsStateCode(String(selectedInventory?.displayCity || selectedTournament?.city || ""));
      return {
        key: String(game.id || `game:${index}`),
        gameNo: extractGameNoLabel(game, index),
        startMs,
        endMs: startMs + GAME_MINUTES * 60 * 1000,
        stateCode,
        locationLabel: venueLabel,
        locationQuery: gameLocationQuery(game),
        homeTeam: String(game.homeTeam || "Team A"),
        awayTeam: String(game.awayTeam || "Team B"),
        matchedPlayers,
        point: null
      };
    });
    const candidates = mapped.filter((item): item is CoachGameCandidate => Boolean(item));

    const fallbackUnmatched = targetPlayers.filter((player) => !matchedPlayerKeys.has(desiredPlayerSelectionKey(player)));
    const candidatesBaseline = candidates.length
      ? Math.min(...candidates.map((item) => item.startMs))
      : baselineStartMs;
    const groupedFallback = new Map<string, { destination: string; team: string; players: DesiredPlayer[] }>();
    fallbackUnmatched.forEach((player) => {
      const destination = destinationForPlayer(player);
      const key = `${normalizeSmartSearch(destination)}::${normalizeSmartSearch(player.team)}`;
      const existing = groupedFallback.get(key);
      if (existing) {
        existing.players.push(player);
      } else {
        groupedFallback.set(key, {
          destination,
          team: player.team || "Team A",
          players: [player]
        });
      }
    });
    Array.from(groupedFallback.values()).forEach((group, index) => {
      const startMs = candidatesBaseline + (index + 1) * 85 * 60 * 1000;
      candidates.push({
        key: `unmatched:${normalizeSmartSearch(group.team)}:${index}`,
        gameNo: `#U${index + 1}`,
        startMs,
        endMs: startMs + GAME_MINUTES * 60 * 1000,
        stateCode: extractUsStateCode(group.destination) || extractUsStateCode(String(selectedInventory?.displayCity || selectedTournament?.city || "")),
        locationLabel: group.destination,
        locationQuery: group.destination,
        homeTeam: group.team,
        awayTeam: "Team B",
        matchedPlayers: group.players,
        point: null
      });
    });

    return candidates.sort((a, b) => a.startMs - b.startMs);
  }

  async function buildOptimizedCoachPlan(
    targetPlayers: DesiredPlayer[],
    preferredSourceText?: string,
    arrivalByStateInput?: Record<string, StateArrivalInput>
  ) {
    const candidates = buildCoachGameCandidates(targetPlayers).slice(0, 48);
    const geocoded = await Promise.all(candidates.map(async (candidate) => ({
      ...candidate,
      point: await geocodeForRoute(candidate.locationQuery)
    })));

    const startLabel = String(preferredSourceText || airportStartLabel || scheduleForm.flightSource || "Event arrival hub").trim();
    const startPoint = await geocodeForRoute(startLabel);
    const arrivalStateRows = Object.entries(arrivalByStateInput || {})
      .map(([stateCode, value]) => ({
        stateCode: String(stateCode || "").trim().toUpperCase(),
        arrivalLocation: String(value?.arrivalLocation || "").trim(),
        arrivalMs: parsePlannerDateTimeInputMs(String(value?.arrivalTime || ""))
      }))
      .filter((row) => row.stateCode && row.arrivalLocation && Number.isFinite(row.arrivalMs));
    const arrivalRowsWithGeo = await Promise.all(arrivalStateRows.map(async (row) => ({
      ...row,
      point: await geocodeForRoute(row.arrivalLocation)
    })));
    const arrivalByState = new Map(
      arrivalRowsWithGeo.map((row) => [row.stateCode, row])
    );
    const parsedArrival = parsePlannerDateTimeInputMs(String(scheduleForm.flightArrivalTime || ""));
    const gameStarts = geocoded
      .map((candidate) => candidate.startMs)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const firstGameStartMs = gameStarts[0] ?? tournamentPlanningStartMs;
    const lastGameStartMs = gameStarts.length ? gameStarts[gameStarts.length - 1] : firstGameStartMs;
    const defaultArrivalMs = Math.max(Date.now() + 30 * 60 * 1000, firstGameStartMs - 120 * 60 * 1000);
    let cursorMs = Number.isFinite(parsedArrival) ? parsedArrival : defaultArrivalMs;
    const tooEarly = cursorMs < (firstGameStartMs - 24 * 60 * 60 * 1000);
    const tooLate = cursorMs > (lastGameStartMs + 24 * 60 * 60 * 1000);
    if (tooEarly || tooLate) {
      cursorMs = defaultArrivalMs;
    }
    const travelPlan: PlanItem[] = [];
    const liveRouteCache = new Map<string, TravelEstimate | null>();
    const unseenPlayers = new Set(targetPlayers.map((player) => desiredPlayerSelectionKey(player)));
    const usedGameKeys = new Set<string>();
    const visitedStops: Array<CoachGameCandidate & { watchStartMs: number; reason: string }> = [];

    let prevLabel = startPoint?.label || startLabel;
    let prevPoint = startPoint;
    let prevStateCode = extractUsStateCode(prevLabel) || eventStateCode;
    let blockedReason = "";
    let smartReorderHint = "";
    const MIN_VIEW_MINUTES = 20;
    const PRE_GAME_BUFFER_MINUTES = 10;
    const TARGET_PRE_GAME_WAIT_MINUTES = 30;
    const MAX_PRE_GAME_WAIT_MINUTES = 120;

    while (unseenPlayers.size > 0 && usedGameKeys.size < geocoded.length) {
      let best: {
        candidate: CoachGameCandidate;
        travel: TravelEstimate;
        fromLabel: string;
        fromPoint: GeoLocation | null;
        fromStateCode: string;
        arrivalGateMs: number;
        switchedState: boolean;
        departMs: number;
        arriveMs: number;
        watchStartMs: number;
        waitMinutes: number;
        lateByMinutes: number;
        newCoverageKeys: string[];
        reason: string;
        score: number;
      } | null = null;

      for (const candidate of geocoded) {
        if (usedGameKeys.has(candidate.key)) continue;

        const newCoverage = candidate.matchedPlayers
          .map((player) => desiredPlayerSelectionKey(player))
          .filter((key) => unseenPlayers.has(key));
        if (!newCoverage.length) continue;

        const candidateStateCode = candidate.stateCode || extractUsStateCode(candidate.locationQuery) || extractUsStateCode(candidate.locationLabel) || eventStateCode;
        let fromLabel = prevLabel;
        let fromPoint = prevPoint;
        let fromStateCode = prevStateCode;
        let arrivalGateMs = cursorMs;
        let switchedState = false;
        const stateArrival = candidateStateCode ? arrivalByState.get(candidateStateCode) : null;
        if (stateArrival && candidateStateCode && fromStateCode && candidateStateCode !== fromStateCode) {
          fromLabel = stateArrival.point?.label || stateArrival.arrivalLocation;
          fromPoint = stateArrival.point || null;
          fromStateCode = candidateStateCode;
          arrivalGateMs = Math.max(cursorMs, stateArrival.arrivalMs);
          switchedState = true;
        } else if (stateArrival) {
          arrivalGateMs = Math.max(cursorMs, stateArrival.arrivalMs);
        }

        const destinationLabel = candidate.point?.label || candidate.locationLabel;
        let travelEstimate: TravelEstimate = {
          mode: "Ground transfer",
          minutes: 120,
          advisory: "Estimated from fallback routing."
        };

        const sameLocationByText = normalizeLocationText(fromLabel) === normalizeLocationText(destinationLabel);
        if (sameLocationByText) {
          travelEstimate = { mode: "On-site", minutes: 0, advisory: "Already at this venue." };
        } else if (fromPoint?.lat != null && fromPoint?.lng != null && candidate.point?.lat != null && candidate.point?.lng != null) {
          const km = distanceKm(fromPoint.lat, fromPoint.lng, candidate.point.lat, candidate.point.lng);
          if (km <= 0.6) {
            travelEstimate = { mode: "On-site", minutes: 0, advisory: "Already at this venue." };
          } else {
            const departBucket = Math.floor(arrivalGateMs / (15 * 60 * 1000));
            const routeKey = `${fromPoint.lat.toFixed(4)},${fromPoint.lng.toFixed(4)}=>${candidate.point.lat.toFixed(4)},${candidate.point.lng.toFixed(4)}@${departBucket}`;
            if (!liveRouteCache.has(routeKey)) {
              const liveEstimate = await fetchLiveRouteEstimate(fromPoint, candidate.point, arrivalGateMs);
              liveRouteCache.set(routeKey, liveEstimate);
            }
            const cachedLive = liveRouteCache.get(routeKey);
            travelEstimate = cachedLive || travelModeByDistance(km);
          }
        } else {
          travelEstimate = travelModeByText(
            fromLabel,
            candidate.locationQuery || destinationLabel
          );
        }

        if (travelEstimate.minutes > MAX_FEASIBLE_TRAVEL_MINUTES) continue;
        const latestReasonableDepartMs = candidate.startMs
          - (PRE_GAME_BUFFER_MINUTES + travelEstimate.minutes) * 60 * 1000;
        const targetDepartMs = candidate.startMs
          - (TARGET_PRE_GAME_WAIT_MINUTES + travelEstimate.minutes) * 60 * 1000;
        const preferredDepartMs = Math.min(latestReasonableDepartMs, targetDepartMs);
        let departMs = Math.max(arrivalGateMs, preferredDepartMs);
        let arriveMs = departMs + travelEstimate.minutes * 60 * 1000;
        let waitMinutes = Math.max(0, Math.floor((candidate.startMs - arriveMs) / (60 * 1000)));
        if (waitMinutes > MAX_PRE_GAME_WAIT_MINUTES) {
          const cappedArriveMs = candidate.startMs - MAX_PRE_GAME_WAIT_MINUTES * 60 * 1000;
          const cappedDepartMs = cappedArriveMs - travelEstimate.minutes * 60 * 1000;
          if (cappedDepartMs >= arrivalGateMs) {
            departMs = cappedDepartMs;
            arriveMs = cappedArriveMs;
            waitMinutes = MAX_PRE_GAME_WAIT_MINUTES;
          }
        }
        const watchStartMs = Math.max(arriveMs, candidate.startMs - PRE_GAME_BUFFER_MINUTES * 60 * 1000);
        const remainingMinutes = Math.floor((candidate.endMs - watchStartMs) / (60 * 1000));
        if (remainingMinutes < MIN_VIEW_MINUTES) continue;

        const lateByMinutes = Math.max(0, Math.floor((watchStartMs - candidate.startMs) / (60 * 1000)));
        waitMinutes = Math.max(0, Math.floor((candidate.startMs - arriveMs) / (60 * 1000)));
        const minutesToEndAtArrival = Math.max(0, Math.floor((candidate.endMs - arriveMs) / (60 * 1000)));
        const urgency = Math.max(0, 240 - minutesToEndAtArrival);
        const startsSoon = Math.max(0, 120 - Math.max(0, Math.floor((candidate.startMs - arriveMs) / (60 * 1000))));
        const score =
          newCoverage.length * 140
          + urgency * 2.2
          + startsSoon * 1.5
          - travelEstimate.minutes * 1.15
          - waitMinutes * 0.25
          - lateByMinutes * 3.2;

        const reason = minutesToEndAtArrival <= 90
          ? "match window ends soon, so this stop is time-critical"
          : travelEstimate.minutes <= 35
            ? "this is the nearest next stop from your current point"
            : "this stop gives the best timing and travel balance";

        if (!best || score > best.score) {
          best = {
            candidate,
            travel: travelEstimate,
            fromLabel,
            fromPoint,
            fromStateCode,
            arrivalGateMs,
            switchedState,
            departMs,
            arriveMs,
            watchStartMs,
            waitMinutes,
            lateByMinutes,
            newCoverageKeys: newCoverage,
            reason,
            score
          };
        }
      }

      if (!best) break;
      usedGameKeys.add(best.candidate.key);
      best.newCoverageKeys.forEach((key) => unseenPlayers.delete(key));

      const destinationLabel = best.candidate.point?.label || best.candidate.locationLabel;
      const coveragePlayers = best.candidate.matchedPlayers
        .filter((player) => best.newCoverageKeys.includes(desiredPlayerSelectionKey(player)))
        .map((player) => `${player.name} (${player.team})`);
      const travelDistanceKm = typeof best.travel.distanceKm === "number" && Number.isFinite(best.travel.distanceKm)
        ? best.travel.distanceKm
        : null;
      const etaAndDistance = travelDistanceKm != null
        ? `${formatEta(best.travel.minutes)}, ${travelDistanceKm.toFixed(travelDistanceKm >= 10 ? 0 : 1)} km`
        : formatEta(best.travel.minutes);
      const trafficHint = Number.isFinite(best.travel.delayMinutes)
        ? `Traffic +${best.travel.delayMinutes} min vs free-flow`
        : "";
      const travelDetail = [
        `Leave by ${formatPlanClock(best.departMs)}`,
        `Reach by ${formatPlanClock(best.arriveMs)} (${best.travel.mode}, ${etaAndDistance})`,
        trafficHint,
        best.travel.advisory || ""
      ].filter(Boolean).join(" · ");
      const isSameStop = normalizeLocationText(best.fromLabel) === normalizeLocationText(destinationLabel);

      if (best.switchedState && best.fromStateCode) {
        travelPlan.push({
          at: new Date(best.arrivalGateMs).toISOString(),
          title: `Arrive in ${best.fromStateCode}`,
          detail: best.fromLabel
        });
      }

      const legNo = travelPlan.filter((step) => /^Travel\s+\d+:/i.test(String(step.title || ""))).length + 1;
      if (!(isSameStop && best.travel.minutes === 0)) {
        travelPlan.push({
          at: new Date(best.departMs).toISOString(),
          title: `Travel ${legNo}: ${best.fromLabel} -> ${destinationLabel}`,
          detail: travelDetail,
          mapUrl: mapsDirectionsUrl(best.fromLabel, destinationLabel, best.fromPoint, best.candidate.point)
        });
      }

      if (best.waitMinutes >= 20) {
        const onSiteBuffer = isSameStop && best.travel.minutes === 0;
        travelPlan.push({
          at: new Date(best.arriveMs).toISOString(),
          title: onSiteBuffer
            ? `Stay on-site at ${destinationLabel}`
            : `Arrive early at ${destinationLabel}`,
          detail: onSiteBuffer
            ? `On-site buffer ~${best.waitMinutes} min before first pitch. No additional travel needed.`
            : `Early buffer ~${best.waitMinutes} min before first pitch.`
        });
      }

      travelPlan.push({
        at: new Date(best.watchStartMs).toISOString(),
        title: `Scout Game ${best.candidate.gameNo}: ${best.candidate.homeTeam} vs ${best.candidate.awayTeam}`,
        detail: `Prioritize players: ${coveragePlayers.join(", ") || "Selected players"} · Venue: ${best.candidate.locationLabel} · First pitch ${formatPlanClock(best.candidate.startMs)}`,
        mapUrl: mapsSearchUrl(best.candidate.locationLabel, best.candidate.point)
      });

      const watchMinutes = Math.min(60, Math.max(25, Math.floor((best.candidate.endMs - best.watchStartMs) / (60 * 1000) * 0.45)));
      const departVenueMs = Math.min(best.candidate.endMs, best.watchStartMs + watchMinutes * 60 * 1000);
      cursorMs = departVenueMs + 15 * 60 * 1000;
      prevLabel = destinationLabel;
      prevPoint = best.candidate.point || null;
      prevStateCode = best.candidate.stateCode || extractUsStateCode(destinationLabel) || prevStateCode;

      visitedStops.push({ ...best.candidate, watchStartMs: best.watchStartMs, reason: best.reason });
    }

    if (unseenPlayers.size > 0) {
      blockedReason = `Could not fit ${unseenPlayers.size} selected player(s) in feasible game windows.`;
      const unresolvedNames = targetPlayers
        .filter((player) => unseenPlayers.has(desiredPlayerSelectionKey(player)))
        .map((player) => player.name)
        .slice(0, 6);
      if (unresolvedNames.length) {
        travelPlan.push({
          at: new Date(cursorMs).toISOString(),
          title: "Uncovered players",
          detail: `No feasible window found yet for: ${unresolvedNames.join(", ")}.`
        });
      }
    }

    if (visitedStops.length) {
      const firstStop = visitedStops[0];
      const firstPlayers = firstStop.matchedPlayers.map((player) => player.name).slice(0, 3).join(", ");
      smartReorderHint = `Recommended first stop: ${firstPlayers || "first selected players"} (based on match timing and travel).`;
    }

    const stopsWithPoints = visitedStops.filter((stop) => Boolean(stop.point));
    let hotelHubDestination = visitedStops[0]?.point?.label || visitedStops[0]?.locationLabel || eventLocationHint || "";
    if (stopsWithPoints.length >= 2) {
      let best = stopsWithPoints[0];
      let bestScore = Number.POSITIVE_INFINITY;
      for (const candidate of stopsWithPoints) {
        const point = candidate.point!;
        const sum = stopsWithPoints.reduce((total, other) => {
          if (!other.point) return total;
          return total + distanceKm(point.lat, point.lng, other.point.lat, other.point.lng);
        }, 0);
        if (sum < bestScore) {
          bestScore = sum;
          best = candidate;
        }
      }
      hotelHubDestination = best.point?.label || best.locationLabel || hotelHubDestination;
    }

    if (!blockedReason && scheduleForm.hotelName.trim()) {
      travelPlan.push({
        at: new Date(cursorMs).toISOString(),
        title: "Return to hotel",
        detail: scheduleForm.hotelName.trim()
      });
    }

    const unresolvedStops = geocoded.filter((stop) => !stop.point).length;
    const completedStops = targetPlayers.length - unseenPlayers.size;
    return {
      plan: travelPlan,
      sourceLabel: startPoint?.label || startLabel,
      firstDestination: visitedStops[0]?.point?.label || visitedStops[0]?.locationLabel || "",
      usedLiveLocation: false,
      unresolvedStops,
      blockedReason,
      completedStops,
      smartReorderHint,
      hotelHubDestination
    };
  }

  async function suggestHotelForDestination(destination: string): Promise<HotelSuggestion | null> {
    const cleanDestination = destination.trim();
    if (!cleanDestination) return null;
    const eventFallback = String(selectedInventory?.displayCity || selectedTournament?.city || eventLocationHint || "").trim();
    const attempts = new Set<string>();
    const pushAttempt = (value: string) => {
      const clean = String(value || "").trim();
      if (clean.length < 2) return;
      attempts.add(clean);
    };

    pushAttempt(cleanDestination);
    if (looksLikeVenueLabel(cleanDestination) && eventFallback && !cleanDestination.toLowerCase().includes(eventFallback.toLowerCase())) {
      pushAttempt(`${cleanDestination}, ${eventFallback}`);
    }
    pushAttempt(eventFallback);
    if (eventFallback) {
      const cityOnly = String(eventFallback.split(",")[0] || "").trim();
      pushAttempt(cityOnly);
    }

    for (const candidate of attempts) {
      try {
        const res = await fetch(`/api/maps/hotels?destination=${encodeURIComponent(candidate)}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const hotels = Array.isArray(data?.hotels) ? data.hotels as HotelSuggestion[] : [];
        if (hotels.length) {
          setHotelSuggestions(hotels);
          return hotels[0] || null;
        }
      } catch {
        // Try next fallback candidate.
      }
    }
    return null;
  }

  function buildInstantRecommendation(targetPlayers: DesiredPlayer[], sourceOverride?: string): PlanItem[] {
    const now = Math.max(Date.now() + 10 * 60 * 1000, tournamentPlanningStartMs - 90 * 60 * 1000);
    const source = String(sourceOverride || scheduleForm.flightSource || "").trim() || airportStartLabel || "Event arrival hub";
    const destination = scheduleForm.flightDestination.trim()
      || destinationForPlayer(targetPlayers[0])
      || "Tournament Venue";
    const travel: PlanItem = {
      at: new Date(now).toISOString(),
      title: `Travel: ${source} -> ${destination}`,
      detail: "Instant recommendation preview generated from selected players."
    };
    const scoutStops = targetPlayers.slice(0, 8).map((player, index) => ({
      at: new Date(now + (index + 1) * 75 * 60 * 1000).toISOString(),
      title: `Scout ${player.name} (${player.team})`,
      detail: `Target location: ${destinationForPlayer(player) || player.team || "Tournament Venue"}`
    }));
    return [travel, ...scoutStops];
  }

  function applyHotelStayMilestones(plan: PlanItem[], milestones: Array<{ stateCode: string; hotelName: string; checkIn?: string; checkOut?: string }>) {
    if (!plan.length || !milestones.length) return plan;
    const extras: PlanItem[] = [];
    milestones.forEach((item) => {
      const cleanName = String(item.hotelName || "").trim();
      if (!cleanName) return;
      const checkInMs = Date.parse(String(item.checkIn || ""));
      if (Number.isFinite(checkInMs)) {
        extras.push({
          at: new Date(checkInMs).toISOString(),
          title: `Hotel check-in (${item.stateCode})`,
          detail: cleanName
        });
      }
      const checkOutMs = Date.parse(String(item.checkOut || ""));
      if (Number.isFinite(checkOutMs)) {
        extras.push({
          at: new Date(checkOutMs).toISOString(),
          title: `Hotel check-out (${item.stateCode})`,
          detail: cleanName
        });
      }
    });
    if (!extras.length) return plan;
    return [...plan, ...extras].sort((a, b) => Date.parse(String(a.at || "")) - Date.parse(String(b.at || "")));
  }

  function validateArrivalFeasibility(
    targetPlayers: DesiredPlayer[],
    arrivalPayloadByState: Record<string, StateArrivalInput>,
    fallbackArrivalInput: string
  ) {
    const games = selectedTournament?.games || [];
    if (!games.length) return null as { message: string } | null;

    const arrivalByStateMs = new Map<string, number>();
    Object.entries(arrivalPayloadByState).forEach(([stateCode, row]) => {
      const normalized = String(stateCode || "").trim().toUpperCase();
      const arrivalMs = parsePlannerDateTimeInputMs(String(row?.arrivalTime || ""));
      if (normalized && Number.isFinite(arrivalMs)) {
        arrivalByStateMs.set(normalized, arrivalMs);
      }
    });
    const fallbackArrivalMs = parsePlannerDateTimeInputMs(String(fallbackArrivalInput || ""));

    let evaluablePlayers = 0;
    const missedRows: Array<{
      playerName: string;
      arrivalMs: number;
      firstGameStartMs: number;
      lastGameStartMs: number;
    }> = [];
    targetPlayers.forEach((player) => {
      const matches = games
        .map((game) => {
          const startMs = Date.parse(String(game.startTime || ""));
          if (!Number.isFinite(startMs)) return null;
          if (!playerMatchSideForGame(player, game)) return null;
          const venueLabel = normalizedVenueLabel(game);
          const stateCode = extractUsStateCode(
            `${venueLabel}, ${String(selectedInventory?.displayCity || selectedTournament?.city || "").trim()}`
          ) || extractUsStateCode(String(selectedInventory?.displayCity || selectedTournament?.city || ""));
          return { startMs, stateCode };
        })
        .filter((item): item is { startMs: number; stateCode: string } => Boolean(item))
        .sort((a, b) => a.startMs - b.startMs);

      if (!matches.length) return;

      const windows = matches
        .map((match) => {
          const arrivalMs = (match.stateCode && arrivalByStateMs.has(match.stateCode))
            ? Number(arrivalByStateMs.get(match.stateCode))
            : fallbackArrivalMs;
          if (!Number.isFinite(arrivalMs)) return null;
          return {
            startMs: match.startMs,
            arrivalMs
          };
        })
        .filter((item): item is { startMs: number; arrivalMs: number } => Boolean(item));
      if (!windows.length) return;
      evaluablePlayers += 1;

      const hasFeasibleWindow = windows.some((window) => window.arrivalMs <= window.startMs);
      if (hasFeasibleWindow) return;

      missedRows.push({
        playerName: player.name,
        arrivalMs: Math.max(...windows.map((window) => window.arrivalMs)),
        firstGameStartMs: Math.min(...windows.map((window) => window.startMs)),
        lastGameStartMs: Math.max(...windows.map((window) => window.startMs))
      });
    });

    if (!evaluablePlayers || missedRows.length !== evaluablePlayers) return null;

    const latestRelevantGameStartMs = Math.max(...missedRows.map((row) => row.lastGameStartMs));
    const latestArrivalMs = Math.max(...missedRows.map((row) => row.arrivalMs));
    const previewPlayers = missedRows.map((row) => row.playerName).slice(0, 3).join(", ");
    const suffix = missedRows.length > 3 ? " and more" : "";
    return {
      message: `Schedule cannot be created. You are arriving at ${formatTournamentGameDateTime(latestArrivalMs)}, after selected players' available game windows (latest start ${formatTournamentGameDateTime(latestRelevantGameStartMs)}). Missed players: ${previewPlayers}${suffix}.`
    };
  }

  function isSelectedTournamentPast() {
    const selectedName = selectedInventory?.name || selectedTournament?.name || "";
    const selectedDateLabel = selectedInventory?.displayDate || selectedTournament?.date || "";
    if (selectedName && isPastTournament({ name: selectedName, displayDate: selectedDateLabel })) {
      return true;
    }

    const gameTimes = (selectedTournament?.games || [])
      .map((game) => Date.parse(String(game.startTime || "")))
      .filter((value) => Number.isFinite(value));
    if (!gameTimes.length) return false;
    const latestGameStart = Math.max(...gameTimes);
    return latestGameStart < Date.now();
  }

  async function generateScheduleFromSmartPlayers(options?: { keepActiveTab?: boolean; autoRun?: boolean; targetPlayers?: DesiredPlayer[] }) {
    const selectedPlayers = options?.targetPlayers?.length ? options.targetPlayers : desiredPlayers;
    if (!selectedPlayers.length) {
      const msg = "Select at least one player, then generate schedule.";
      setPlayerSearchStatus(msg);
      setPlanWorkflowNote(msg);
      return;
    }
    const isPast = isSelectedTournamentPast();
    if (isPast) {
      const msg = "Tournament date has passed. Generating route preview from selected players.";
      setPlayerSearchStatus(msg);
      setPlanWorkflowNote(msg);
    }
    if (options?.keepActiveTab !== false) {
      navigateTab("myPlayersSchedule");
    }
    const requiredStates = requiredStateCodes.length ? requiredStateCodes : (eventStateCode ? [eventStateCode] : []);
    const currentCoachState = extractUsStateCode(String(airportStartLabel || scheduleForm.flightSource || ""));
    const needsArrivalAnswers = flightBooked === "yes" || requiredStates.some((code) => code && code !== currentCoachState);
    const arrivalPayloadByState: Record<string, StateArrivalInput> = {};
    const hotelPayloadByState: Record<string, StateHotelInput> = {};
    if (needsArrivalAnswers) {
      for (const stateCode of requiredStates) {
        const row = stateArrivalInputs[stateCode];
        const arrivalLocation = String(row?.arrivalLocation || "").trim();
        const arrivalTime = String(row?.arrivalTime || "").trim();
        if (!arrivalLocation || !arrivalTime) {
          const msg = `Please enter arrival city and arrival time for ${stateCode} before creating schedule.`;
          setPlayerSearchStatus(msg);
          setPlanWorkflowNote(msg);
          return;
        }
        arrivalPayloadByState[stateCode] = { arrivalLocation, arrivalTime };
      }
    }
    if (hotelBooked === "yes") {
      for (const stateCode of requiredStates) {
        const row = stateHotelInputs[stateCode];
        const hotelName = String(row?.hotelName || "").trim();
        const checkIn = String(row?.checkIn || "").trim();
        const checkOut = String(row?.checkOut || "").trim();
        if (!hotelName || !checkIn || !checkOut) {
          const msg = `Please enter hotel name, check-in, and check-out for ${stateCode}.`;
          setPlayerSearchStatus(msg);
          setPlanWorkflowNote(msg);
          return;
        }
        hotelPayloadByState[stateCode] = { hotelName, checkIn, checkOut };
      }
    }
    const earliestArrival = Object.entries(arrivalPayloadByState)
      .map(([stateCode, row]) => ({
        stateCode,
        ...row,
        atMs: parsePlannerDateTimeInputMs(String(row.arrivalTime || ""))
      }))
      .filter((row) => Number.isFinite(row.atMs))
      .sort((a, b) => a.atMs - b.atMs)[0];
    const firstPlayerStart = destinationForPlayer(selectedPlayers[0]) || "";
    const primaryState = earliestArrival?.stateCode || requiredStates[0] || "";
    const bookedHotelSource = primaryState
      ? String(hotelPayloadByState[primaryState]?.hotelName || "").trim()
      : "";
    const resolvedSource = String(
      bookedHotelSource
      || scheduleForm.flightSource
      || airportStartLabel
      || earliestArrival?.arrivalLocation
      || firstPlayerStart
      || "Event arrival hub"
    ).trim();
    const plannedArrivalInput = String(earliestArrival?.arrivalTime || scheduleForm.flightArrivalTime || "").trim();
    const arrivalValidation = validateArrivalFeasibility(selectedPlayers, arrivalPayloadByState, plannedArrivalInput);
    if (arrivalValidation) {
      setAndPersistPlanWorkflowStatus("draft");
      setPlanWorkflowNote(arrivalValidation.message);
      setPlayerSearchStatus(arrivalValidation.message);
      setMyGeneratedPlan([]);
      return;
    }
    clearSmartScheduleInsights();
    const instantFlightDestination = scheduleForm.flightDestination
      || String(selectedInventory?.displayCity || selectedTournament?.city || eventLocationHint || "").trim()
      || firstPlayerStart;
    const instantForm = {
      ...scheduleForm,
      flightSource: resolvedSource,
      flightDestination: instantFlightDestination,
      flightArrivalTime: plannedArrivalInput,
      hotelName: ""
    };
    const instantPlan = buildInstantRecommendation(selectedPlayers, resolvedSource);
    setScheduleForm(instantForm);
    setMyGeneratedPlan(instantPlan);
    setAndPersistPlanWorkflowStatus("pending_approval");
    setPlanWorkflowNote("Generating recommendation...");
    setPlayerSearchStatus(`Generating schedule for ${selectedPlayers.length} selected players...`);
    try {
      const optimized = await buildOptimizedCoachPlan(selectedPlayers, resolvedSource, arrivalPayloadByState);
      const hotelHubDestination = optimized.hotelHubDestination || optimized.firstDestination || firstPlayerStart || "";
      setSmartRouteHint("");
      if (!optimized.plan.length) {
        const msg = "Live route data is limited right now. Showing instant recommendation preview.";
        setScheduleForm(instantForm);
        setMyGeneratedPlan(instantPlan);
        setAndPersistPlanWorkflowStatus("pending_approval");
        await saveSchedule(instantPlan, selectedPlayers, instantForm);
        setPlayerSearchStatus(msg);
        setPlanWorkflowNote(msg);
        return;
      }

      const destination = (
        scheduleForm.flightDestination
        || String(selectedInventory?.displayCity || selectedTournament?.city || eventLocationHint || "").trim()
        || optimized.firstDestination
        || ""
      ).trim();
      const isFeasible = !optimized.blockedReason;
      const primaryState = earliestArrival?.stateCode || requiredStates[0] || "";
      const bookedHotelName = primaryState ? String(hotelPayloadByState[primaryState]?.hotelName || "").trim() : "";
      const wantsHotelRouting = isFeasible && hotelBooked === "yes";
      const canSuggestOptionalHotel = isFeasible && hotelBooked === "no" && hasReasonableHotelWindow(optimized.plan);
      const activeHotelName = String(scheduleForm.hotelName || "").trim();
      const activeHotelSuggestion = activeHotelName
        ? hotelSuggestions.find((item) => normalizeSmartSearch(item.name) === normalizeSmartSearch(activeHotelName)) || null
        : null;
      const suggestedBookedHotel = wantsHotelRouting
        ? await suggestHotelForDestination(hotelHubDestination || destination)
        : null;
      const suggestedOptionalHotel = canSuggestOptionalHotel
        ? (activeHotelSuggestion || await suggestHotelForDestination(hotelHubDestination || destination))
        : null;
      const hotelName = wantsHotelRouting
        ? (bookedHotelName || activeHotelName || suggestedBookedHotel?.name || "")
        : (canSuggestOptionalHotel ? (activeHotelName || suggestedOptionalHotel?.name || "") : "");
      const withHotelPlan = wantsHotelRouting
        ? withHotelReturnLeg(optimized.plan, hotelName)
        : optimized.plan;
      const withOptionalHotelPlan = (!wantsHotelRouting && canSuggestOptionalHotel && hotelName)
        ? [
          ...withHotelPlan,
          {
            at: withHotelPlan[0]?.at || new Date().toISOString(),
            title: "Optional nearby hotel",
            detail: suggestedOptionalHotel?.address
              ? `${hotelName} · ${suggestedOptionalHotel.address}. If you need rest between games, this is a nearby stay option.`
              : `${hotelName}. If you need rest between games, this is a nearby stay option.`,
            mapUrl: mapsSearchUrlForHotel({
              name: hotelName,
              address: suggestedOptionalHotel?.address || "",
              placeId: suggestedOptionalHotel?.placeId || ""
            })
          }
        ]
        : withHotelPlan;
      const finalPlanBase = withOptionalHotelPlan;
      const finalPlan = applyHotelStayMilestones(
        finalPlanBase,
        Object.entries(hotelPayloadByState).map(([stateCode, row]) => ({
          stateCode,
          hotelName: row.hotelName,
          checkIn: row.checkIn,
          checkOut: row.checkOut
        }))
      );

      const nextForm = {
        ...scheduleForm,
        flightSource: resolvedSource || optimized.sourceLabel || "Event arrival hub",
        flightDestination: destination,
        flightArrivalTime: plannedArrivalInput || scheduleForm.flightArrivalTime || toInputDateTime(finalPlan[0]?.at || new Date().toISOString()),
        hotelName,
        notes: scheduleForm.notes || (
          isFeasible
            ? (wantsHotelRouting && hotelName
              ? "Auto-generated coach route with travel + hotel recommendation."
              : (canSuggestOptionalHotel && hotelName
                ? "Auto-generated coach route with optional nearby stay recommendation."
                : "Auto-generated coach route from selected players."))
            : ""
        )
      };
      setScheduleForm(nextForm);
      setMyGeneratedPlan(finalPlan);
      if (isFeasible) {
        setAndPersistPlanWorkflowStatus("pending_approval");
        setPlanWorkflowNote(
          options?.autoRun
            ? "Schedule auto-created from selected player order."
            : "Schedule created from selected player order."
        );
        await saveSchedule(finalPlan, selectedPlayers, nextForm);
      } else {
        setAndPersistPlanWorkflowStatus("draft");
        setPlanWorkflowNote(optimized.blockedReason || "Recommendation generated, but this route is not feasible within the next 12 hours.");
      }
      if (!isFeasible) {
        setPlayerSearchStatus(
          `Recommendation generated with feasibility warning. ${optimized.blockedReason || "At least one leg is not feasible in the next 12 hours."}`
        );
      } else {
        const resolvedHotel = String(hotelName || "").trim();
        setPlayerSearchStatus(
          wantsHotelRouting && resolvedHotel
            ? `Schedule created. Recommended hotel: ${resolvedHotel}.`
            : (canSuggestOptionalHotel && resolvedHotel
              ? `Schedule created. Nearby stay option found: ${resolvedHotel}.`
              : "Schedule created.")
        );
      }
    } catch {
      const emergencyPlan: PlanItem[] = instantPlan;
      if (emergencyPlan.length) {
        const fallbackForm = {
          ...instantForm,
          flightSource: instantForm.flightSource || resolvedSource || "Event arrival hub",
          flightDestination: instantForm.flightDestination || destinationForPlayer(selectedPlayers[0]),
          notes: scheduleForm.notes || "Fallback recommendation generated while map services are unavailable."
        };
        setScheduleForm(fallbackForm);
        setMyGeneratedPlan(emergencyPlan);
        setAndPersistPlanWorkflowStatus("pending_approval");
        setPlanWorkflowNote("Fallback recommendation generated. Open booking to approve or modify options.");
        await saveSchedule(emergencyPlan, selectedPlayers, fallbackForm);
        setPlayerSearchStatus("Fallback recommendation generated from selected players.");
        return;
      }
      const msg = "Route generation failed. Please retry.";
      setPlayerSearchStatus(msg);
      setPlanWorkflowNote(msg);
    }
  }

  function extractTravelLegsFromPlan(plan: PlanItem[]) {
    return plan
      .map((item) => {
        const match = String(item.title || "").match(/^Travel\s+\d+:\s*(.+?)\s*->\s*(.+)$/i);
        if (!match) return null;
        const from = match[1]?.trim() || "";
        const to = match[2]?.trim() || "";
        const mode = String(item.detail || "").split("·")[0]?.trim() || "Ground transfer";
        if (!from || !to) return null;
        return {
          at: item.at || new Date().toISOString(),
          from,
          to,
          mode
        };
      })
      .filter((item): item is { at: string; from: string; to: string; mode: string } => Boolean(item));
  }

  async function bookApprovedRecommendation() {
    if (bookingBlockReason) {
      setPlanWorkflowNote(`Booking unavailable: ${bookingBlockReason}`);
      return;
    }
    const travelLegs = extractTravelLegsFromPlan(myGeneratedPlan);
    if (!travelLegs.length) {
      setPlanWorkflowNote("No valid travel legs found in this recommendation.");
      return;
    }
    const fullName = String(user?.name || "").trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const traveler: BookingReviewDraft["traveler"] = {
      firstName: parts[0] || "Coach",
      lastName: parts.slice(1).join(" ") || "User",
      dateOfBirth: "1990-01-01",
      gender: (user?.gender || "UNSPECIFIED") as "MALE" | "FEMALE" | "UNSPECIFIED",
      email: String(user?.email || ""),
      phone: String(user?.phone || "0000000000"),
      countryCallingCode: String(user?.countryCallingCode || "1"),
      nationality: "US"
    };
    const reviewDraft: BookingReviewDraft = {
      teamName: selectedTournament?.name || "",
      tournamentName: selectedTournament?.name || tournamentViewTitle || "",
      travelLegs,
      planItems: myGeneratedPlan,
      traveler
    };
    try {
      safeLocalSet(BOOKING_REVIEW_DRAFT_KEY, JSON.stringify(reviewDraft));
      safeLocalRemove(BOOKING_SUMMARY_KEY);
      setAndPersistPlanWorkflowStatus("pending_approval");
      setPlanWorkflowNote("Opening booking review in a new tab...");
      const url = `/bookings/review?returnTo=${encodeURIComponent("/bird-dog?tab=myPlayersSchedule")}`;
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        router.push(url);
      }
    } catch {
      setPlanWorkflowNote("Unable to open booking review. Please refresh the page and retry.");
    }
  }

  function downloadPdfLikeReport(title: string, headers: string[], rows: string[][]) {
    const safe = (value: string) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;");
    const tableHeader = headers.map((h) => `<th>${safe(h)}</th>`).join("");
    const tableRows = rows.map((row) => `<tr>${row.map((c) => `<td>${safe(c || "-")}</td>`).join("")}</tr>`).join("");
    const html = `
      <html>
        <head>
          <title>${safe(title)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: #111; }
            h1 { margin: 0 0 12px; }
            p { margin: 0 0 12px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #bbb; padding: 8px; text-align: left; vertical-align: top; }
            th { background: #f2f2f2; }
          </style>
        </head>
        <body>
          <h1>${safe(title)}</h1>
          <p>Press Cmd/Ctrl + P and choose "Save as PDF".</p>
          <table>
            <thead><tr>${tableHeader}</tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
      </html>
    `;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const popup = window.open(blobUrl, "_blank");
    if (!popup) {
      URL.revokeObjectURL(blobUrl);
      window.alert("Popup blocked. Please allow popups to open report.");
      return;
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  async function openCheckoutForTournament(inventorySlug: string) {
    setOpenError("");
    setUnlockingSlug(inventorySlug);
    try {
      const returnToParams = new URLSearchParams({
        tab: "tournaments"
      });
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventorySlug,
          returnTo: `/bird-dog?${returnToParams.toString()}`
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOpenError(data?.error || `Unable to open checkout (${res.status})`);
        return;
      }
      if (data?.checkoutUrl) {
        const popup = window.open(data.checkoutUrl, "_blank");
        if (!popup) {
          setOpenError("Popup was blocked. Please allow popups for this site and try Subscribe to Unlock again.");
          return;
        }
        popup.focus();
        return;
      }
      if (data?.alreadyUnlocked) {
        if (typeof data?.redirectTo === "string" && data.redirectTo.startsWith("/")) {
          window.location.assign(data.redirectTo);
          return;
        }
        await fetchInventory();
        setOpenError(data?.freeUnlock ? "Test mode active: tournament unlocked at $0." : "No payment needed. This tournament is already unlocked or available as archive access.");
        return;
      }
      setOpenError("Checkout URL missing.");
    } finally {
      setUnlockingSlug("");
    }
  }

  async function queueHarvestJob(inventorySlug: string, overrideHint?: string, overrideCompany?: "PG" | "PBR") {
    const effectiveHint = (overrideHint ?? jobHint).trim();
    const effectiveCompany = overrideCompany ?? company;
    if (!effectiveHint) return;

    const res = await fetch("/api/harvest/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: effectiveCompany,
        tournamentHint: effectiveHint,
        inventorySlug
      })
    });

    if (!res.ok) return;
  }

  async function openUnlockedTournament(item: InventoryTournament) {
    const mutationSeq = nextTournamentMutationSeq();
    const isCurrentMutation = () => isTournamentMutationCurrent(mutationSeq);
    const clearOpeningState = () => {
      setOpeningSlug((prev) => (prev === item.slug ? "" : prev));
    };
    setOpenError("");
    setOpeningSlug(item.slug);
    setSelectedInventorySlug(item.slug);
    setCompany(item.company);
    setJobHint(item.name);
    // Re-opening the same tournament should not depend on another live open request.
    // Switch to Notes immediately from in-memory state, then refresh in background.
    const sameInventorySelected = selectedInventorySlugRef.current === item.slug
      && companyRef.current === item.company;
    const currentTournamentId = String(selectedTournamentIdRef.current || "").trim();
    const currentTournament = sameInventorySelected && currentTournamentId
      ? tournaments.find((t) => String(t.id || "").trim() === currentTournamentId) || null
      : null;
    if (currentTournament) {
      applyOpenedTournament(currentTournament, mutationSeq);
      window.setTimeout(() => {
        void refreshTournamentByInventory(item, {
          mutationSeq,
          onlyIfSelected: true,
          background: true
        });
      }, 50);
      setOpeningSlug((prev) => (prev === item.slug ? "" : prev));
      return;
    }
    const inMemoryMatch = findInMemoryTournamentForItem(item);
    if (inMemoryMatch) {
      applyOpenedTournament(inMemoryMatch, mutationSeq);
      window.setTimeout(() => {
        void refreshTournamentByInventory(item, {
          mutationSeq,
          onlyIfSelected: true,
          background: true
        });
      }, 50);
      setOpeningSlug((prev) => (prev === item.slug ? "" : prev));
      return;
    }
    let targetTournamentId = "";
    try {
      targetTournamentId = await resolveTournamentIdForItem(item);
      if (!isCurrentMutation()) return;
      const payload = {
        company: item.company,
        inventorySlug: item.slug,
        tournamentHint: item.harvestHint || item.name,
        tournamentId: targetTournamentId || undefined
      };
      const attemptOpen = () =>
        fetchWithTimeout("/api/harvest/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }, 30000);
      let liveOpen = await attemptOpen();
      if (!isCurrentMutation()) return;
      if (liveOpen.status === 401) {
        const sessionCheck = await fetch("/api/session/me", { cache: "no-store" });
        if (!sessionCheck.ok) {
          if (isCurrentMutation()) {
            setOpenError("Session expired. Please sign in again.");
          }
          router.replace("/login");
          return;
        }
        liveOpen = await attemptOpen();
        if (!isCurrentMutation()) return;
      }
      if (!liveOpen.ok) {
        const data = await liveOpen.json().catch(() => ({}));
        if (!isCurrentMutation()) return;
        const openedFromLocal = await openTournamentFromExistingData(item, targetTournamentId || undefined, mutationSeq);
        if (openedFromLocal) {
          if (isCurrentMutation()) {
            setOpenError("");
          }
          return;
        }
        const detailText = typeof data?.detail === "string" ? data.detail : "";
        const missingSupabaseConfig = liveOpen.status === 503
          && /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/i.test(detailText);
        if (missingSupabaseConfig) {
          // already tried fallback from existing data above.
        }
        if (liveOpen.status === 409) {
          await queueHarvestJob(item.slug, item.harvestHint || item.name, item.company).catch(() => undefined);
          if (isCurrentMutation()) {
            setOpenError(scheduleNotUploadedMessage(item.company));
          }
          return;
        }
        const detail = typeof data?.detail === "string" && data.detail ? ` (${data.detail})` : "";
        if (liveOpen.status === 401) {
          throw new Error(`Session verification failed. Please sign in again.${detail}`);
        }
        throw new Error(data?.error ? `${data.error}${detail}` : `Unable to load tournament details (${liveOpen.status}).${detail}`);
      }
      const data = await liveOpen.json();
      if (!isCurrentMutation()) return;
      const openedTournament = data?.tournament as Tournament | undefined;
      if (!openedTournament) {
        throw new Error("Tournament data was empty.");
      }
      applyOpenedTournament(openedTournament, mutationSeq);
      const gameCount = Array.isArray(openedTournament.games) ? openedTournament.games.length : 0;
      const teamCount = Array.isArray(openedTournament.teams) ? openedTournament.teams.length : 0;
      if (gameCount === 0) {
        if (isCurrentMutation()) {
          setOpenError(scheduleNotUploadedMessage(item.company));
        }
        await queueHarvestJob(item.slug, item.harvestHint || item.name, item.company).catch(() => undefined);
        window.setTimeout(() => {
          void refreshTournamentByInventory(item, { onlyIfSelected: true, background: true });
        }, 6000);
      } else if (teamCount === 0) {
        if (isCurrentMutation()) {
          setOpenError("Tournament details are syncing. Rechecking shortly...");
        }
        await queueHarvestJob(item.slug, item.harvestHint || item.name, item.company).catch(() => undefined);
        window.setTimeout(() => {
          void refreshTournamentByInventory(item, { onlyIfSelected: true, background: true });
        }, 6000);
      } else {
        if (isCurrentMutation()) {
          setOpenError("");
        }
      }
    } catch (error) {
      const openedFromLocal = await openTournamentFromExistingData(item, targetTournamentId || undefined, mutationSeq);
      if (openedFromLocal) {
        if (isCurrentMutation()) {
          setOpenError("");
        }
        clearOpeningState();
        return;
      }
      const rawErrorMessage = error instanceof Error ? error.message : "Failed to open tournament.";
      const normalizedErrorMessage = /fetch is aborted|aborted|aborterror|timed out|timeout/i.test(rawErrorMessage)
        ? "Tournament sync timed out. Please tap the tournament again."
        : rawErrorMessage;
      if (isCurrentMutation()) {
        setOpenError(normalizedErrorMessage);
      }
      clearOpeningState();
      void queueHarvestJob(item.slug, item.harvestHint || item.name, item.company).catch(() => undefined);
      if (isCurrentMutation()) {
        void loadCompanyData(item.company, true);
      }
    } finally {
      clearOpeningState();
    }
  }

  function cacheTournamentOffline() {
    if (!selectedTournament || !user) return;
    safeLocalSet(
      `${CACHE_KEY}:${user.orgId}`,
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        company,
        tournament: selectedTournament
      })
    );
  }

  function loadCachedTournament(options?: {
    requiredCompany?: "PG" | "PBR";
    requiredTournamentId?: string;
    maxAgeMs?: number;
  }) {
    if (!user) return;
    const raw = safeLocalGet(`${CACHE_KEY}:${user.orgId}`);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        cachedAt?: string;
        company: "PG" | "PBR";
        tournament: Tournament;
      };
      const requiredCompany = options?.requiredCompany;
      const requiredTournamentId = String(options?.requiredTournamentId || "").trim();
      if (requiredCompany && parsed.company !== requiredCompany) return;
      if (requiredTournamentId && parsed.tournament?.id !== requiredTournamentId) return;

      const maxAgeMs = options?.maxAgeMs ?? 12 * 60 * 60 * 1000;
      const cachedAtMs = Date.parse(String(parsed.cachedAt || ""));
      if (Number.isFinite(cachedAtMs) && Date.now() - cachedAtMs > maxAgeMs) {
        return;
      }
      if (!parsed.tournament?.id) return;

      setCompany(parsed.company);
      setTournaments([parsed.tournament]);
      setSelectedTournamentId(parsed.tournament.id);
      setSelectedGameId(parsed.tournament.games[0]?.id || "");
    } catch {
      safeLocalRemove(`${CACHE_KEY}:${user.orgId}`);
    }
  }

  function toggleWatch(playerId: string) {
    setWatchlist((prev) => (prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]));
  }

  function addDesiredPlayer() {
    if (!desiredPlayerId) return;
    const match = playersById.get(desiredPlayerId);
    if (!match) return;
    const selectionKey = `manual:${desiredPlayerId}`;
    setDesiredPlayersAndPersist((prev) => {
      if (prev.some((item) => item.playerId === desiredPlayerId || desiredPlayerSelectionKey(item) === selectionKey)) return prev;
      return [...prev, { playerId: desiredPlayerId, selectionKey, name: match.name, team: match.school || "Unknown Team" }];
    });
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Target player updated. Recommendation is regenerating.");
  }

  function removeDesiredPlayer(selectionKey: string) {
    setDesiredPlayersAndPersist((prev) => prev.filter((item) => desiredPlayerSelectionKey(item) !== selectionKey));
    setTeamRosterCartAndPersist((prev) =>
      prev.filter((item) => desiredPlayerSelectionKey(item) !== selectionKey)
    );
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Target player removed. Recommendation is regenerating.");
  }

  function moveDesiredPlayer(selectionKey: string, direction: -1 | 1) {
    setDesiredPlayersAndPersist((prev) => {
      const index = prev.findIndex((item) => desiredPlayerSelectionKey(item) === selectionKey);
      if (index < 0) return prev;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Player order updated. Recommendation will prioritize this order.");
  }

  function moveDesiredPlayerToIndex(selectionKey: string, targetIndex: number) {
    setDesiredPlayersAndPersist((prev) => {
      const sourceIndex = prev.findIndex((item) => desiredPlayerSelectionKey(item) === selectionKey);
      if (sourceIndex < 0) return prev;
      const boundedTarget = Math.max(0, Math.min(prev.length - 1, targetIndex));
      if (boundedTarget === sourceIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(boundedTarget, 0, moved);
      return next;
    });
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Player order updated by drag and drop.");
  }

  function onDesiredPlayerDragStart(selectionKey: string) {
    setDraggingDesiredPlayerKey(selectionKey);
  }

  function onDesiredPlayerDrop(targetSelectionKey: string) {
    const draggingKey = String(draggingDesiredPlayerKey || "").trim();
    setDraggingDesiredPlayerKey(null);
    if (!draggingKey || draggingKey === targetSelectionKey) return;
    const targetIndex = desiredPlayers.findIndex((item) => desiredPlayerSelectionKey(item) === targetSelectionKey);
    if (targetIndex < 0) return;
    moveDesiredPlayerToIndex(draggingKey, targetIndex);
  }

  function toggleNotesRosterSelection(selectionKey: string) {
    setNotesSelectedRosterRowKeys((prev) =>
      prev.includes(selectionKey)
        ? prev.filter((item) => item !== selectionKey)
        : [...prev, selectionKey]
    );
  }

  function clearNotesTeamSelection() {
    setNotesSelectedTeam(null);
    setNotesTeamScheduleRows([]);
    setNotesTeamRosterRows([]);
    setNotesSelectedRosterRowKeys([]);
    setNotesTeamStatus("");
    setNotesTeamLoading(false);
  }

  function addSelectedNotesRosterPlayersToCart() {
    const team = notesSelectedTeam;
    if (!team) {
      setNotesTeamStatus("Select a team first.");
      return;
    }
    const selectedSet = new Set(notesSelectedRosterRowKeys);
    const selectedRows = notesTeamRosterRows.filter((row) =>
      selectedSet.has(notesRosterRowSelectionKey(row))
    );
    if (!selectedRows.length) {
      setNotesTeamStatus("Select at least one player from this roster.");
      return;
    }

    const merged = new Map<string, DesiredPlayer>();
    const identitySet = new Set<string>();
    const duplicateNames: string[] = [];
    teamRosterCartPlayers.forEach((item) => {
      merged.set(desiredPlayerSelectionKey(item), item);
      const identity = desiredPlayerIdentityKey(item);
      if (identity) identitySet.add(identity);
    });
    let addedCount = 0;
    selectedRows.forEach((row) => {
      const rowKey = notesRosterRowSelectionKey(row);
      const selectionKey = `team:${team.id}:${rowKey}`;
      const candidate: DesiredPlayer = {
        playerId: selectionKey,
        selectionKey,
        name: String(row.name || "-").trim(),
        team: String(row.team || team.name || "Unknown Team").trim(),
        hometown: String(row.hometown || "").trim(),
        sourceTeamId: team.id,
        sourceTeamName: team.name
      };
      const identity = desiredPlayerIdentityKey(candidate);
      if (identity && identitySet.has(identity)) {
        duplicateNames.push(candidate.name);
        return;
      }
      if (identity) identitySet.add(identity);
      merged.set(selectionKey, candidate);
      addedCount += 1;
    });
    const next = Array.from(merged.values());
    setTeamRosterCartAndPersist(next);
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
    if (addedCount > 0 && duplicateNames.length > 0) {
      setNotesTeamStatus(`Added ${addedCount} player(s). ${duplicateNames.length} already existed and were skipped.`);
    } else if (duplicateNames.length > 0) {
      setNotesTeamStatus(`${duplicateNames.length} player(s) already existed in your players list.`);
    } else {
      setNotesTeamStatus(`Added ${addedCount} player(s) from ${team.name} to final cart.`);
    }
    if (duplicateNames.length > 0 && typeof window !== "undefined") {
      const preview = Array.from(new Set(duplicateNames)).slice(0, 3).join(", ");
      const suffix = duplicateNames.length > 3 ? " and more" : "";
      window.alert(
        `${duplicateNames.length} player(s) already exist in your players list${preview ? `: ${preview}${suffix}` : ""}.`
      );
    }
  }

  function persistTeamRosterCart(next: DesiredPlayer[]) {
    setTeamRosterCartAndPersist(next);
  }

  function removeTeamRosterCartPlayer(selectionKey: string) {
    setTeamRosterCartAndPersist((prev) =>
      prev.filter((item) => desiredPlayerSelectionKey(item) !== selectionKey)
    );
    setDesiredPlayersAndPersist((prev) => prev.filter((item) => desiredPlayerSelectionKey(item) !== selectionKey));
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
  }

  function moveTeamRosterCartPlayer(selectionKey: string, direction: -1 | 1) {
    const currentIndex = teamRosterCartPlayers.findIndex((item) => desiredPlayerSelectionKey(item) === selectionKey);
    if (currentIndex < 0) return;
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= teamRosterCartPlayers.length) return;

    const nextCart = [...teamRosterCartPlayers];
    const [moved] = nextCart.splice(currentIndex, 1);
    nextCart.splice(targetIndex, 0, moved);
    persistTeamRosterCart(nextCart);

    setDesiredPlayersAndPersist((prev) => {
      if (!prev.length) return prev;
      const desiredSet = new Set(prev.map((item) => desiredPlayerSelectionKey(item)));
      const reorderedFromCart = nextCart.filter((item) => desiredSet.has(desiredPlayerSelectionKey(item)));
      const remaining = prev.filter((item) => !desiredPlayerSelectionKey(item).startsWith("team:"));
      return [...reorderedFromCart, ...remaining];
    });
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
  }

  function clearTeamRosterCart() {
    persistTeamRosterCart([]);
    setDesiredPlayersAndPersist((prev) =>
      prev.filter((item) => !String(desiredPlayerSelectionKey(item)).startsWith("team:"))
    );
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Cross-team roster cart cleared.");
  }

  function useTeamRosterCartForSchedule(mode: "replace" | "merge" = "replace") {
    if (!teamRosterCartPlayers.length) {
      setPlanWorkflowNote("Roster cart is empty. Add players from team rosters first.");
      return;
    }

    setDesiredPlayersAndPersist((prev) => {
      if (mode === "replace") return teamRosterCartPlayers;
      const merged = new Map<string, DesiredPlayer>(
        prev.map((item) => [desiredPlayerSelectionKey(item), item])
      );
      teamRosterCartPlayers.forEach((item) => {
        merged.set(desiredPlayerSelectionKey(item), item);
      });
      return Array.from(merged.values());
    });
    autoPlannerRef.current.key = "";
    clearSmartScheduleInsights();
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote(
      mode === "replace"
        ? `Loaded ${teamRosterCartPlayers.length} cross-team cart players for final schedule generation.`
        : `Merged ${teamRosterCartPlayers.length} cross-team cart players into current selection.`
    );
  }

  function sendPulse() {
    if (!selectedGameId || !pulseMessage.trim()) return;
    setPulses((prev) => [
      {
        id: crypto.randomUUID(),
        gameId: selectedGameId,
        message: pulseMessage.trim(),
        createdAt: new Date().toISOString(),
        synced: false
      },
      ...prev
    ]);
    setPulseStatus(`Pulse sent at ${new Date().toLocaleTimeString()}.`);
  }

  async function startRecording() {
    if (recorderState === "recording") return;
    if (!selectedGameId) {
      setRecordingStatus("Select a game first, then start recording.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = chooseRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setRecordingStatus("Recording failed. Check microphone access and retry.");
      };
      recorder.start(500);
      mediaRecorderRef.current = recorder;

      const ctor = (window as unknown as { SpeechRecognition?: BrowserSpeechConstructor; webkitSpeechRecognition?: BrowserSpeechConstructor }).SpeechRecognition
        || (window as unknown as { webkitSpeechRecognition?: BrowserSpeechConstructor }).webkitSpeechRecognition;

      if (ctor) {
        try {
          const recognition = new ctor();
          recognition.lang = "en-US";
          recognition.interimResults = true;
          recognition.continuous = true;
          recognition.onresult = (event) => {
            let live = "";
            for (let i = 0; i < event.results.length; i += 1) {
              live += `${event.results[i][0].transcript} `;
            }
            setTranscript(live.trim());
          };
          recognition.onerror = () => {
            setRecordingStatus("Audio is recording, but speech-to-text is unavailable in this browser.");
          };
          recognition.onend = () => {
            if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
          };
          recognition.start();
          speechRecognitionRef.current = recognition;
        } catch {
          setRecordingStatus("Audio recording started. Speech-to-text is unavailable.");
        }
      } else {
        setRecordingStatus("Audio recording started. Speech-to-text is unavailable.");
      }

      setRecorderState("recording");
      setRecordingStatus("Recording...");
    } catch {
      setRecordingStatus("Microphone permission blocked. Allow access in Safari and try again.");
    }
  }

  async function stopRecording() {
    if (recorderState !== "recording") return;
    const recorder = mediaRecorderRef.current;
    const stream = mediaStreamRef.current;
    if (!recorder) {
      setRecorderState("idle");
      setRecordingStatus("Recorder was not active.");
      return;
    }
    const stoppedBlob = new Promise<Blob | null>((resolve) => {
      recorder.addEventListener("stop", () => {
        const mime = recorder.mimeType || "audio/webm";
        const blob = audioChunksRef.current.length
          ? new Blob(audioChunksRef.current, { type: mime })
          : null;
        resolve(blob);
      }, { once: true });
    });

    recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    setRecorderState("idle");
    const blob = await stoppedBlob;
    if (!blob || blob.size < 1024) {
      setRecordingStatus("No usable audio captured. Please retry and speak clearly.");
      return;
    }
    let audioDataUrl = "";
    try {
      audioDataUrl = await blobToDataUrl(blob);
    } catch {
      setRecordingStatus("Could not process audio file. Please retry.");
      return;
    }
    if (!selectedGameId) return;

    setNotes((prev) => [
      {
        id: crypto.randomUUID(),
        gameId: selectedGameId,
        transcript: transcript || "(No transcript captured)",
        audioUrl: audioDataUrl,
        createdAt: new Date().toISOString(),
        synced: false
      },
      ...prev
    ]);
    setRecordingStatus("Note saved.");
    setTranscript("");
  }

  async function startInlineTeamNoteRecording(target: InlineTeamNoteTarget) {
    const key = inlineTeamNoteKey(target);
    if (inlineTeamNoteRecorderState === "recording") {
      updateInlineTeamNoteStatus(target, "A recording is already in progress. Stop it first.");
      return;
    }
    openInlineTeamNote(target);
    setInlineTeamNoteRecordingKey(key);
    setInlineTeamNoteRecordingTarget(target);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      inlineTeamNoteMediaStreamRef.current = stream;
      const mimeType = chooseRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream);
      inlineTeamNoteAudioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) inlineTeamNoteAudioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => updateInlineTeamNoteStatus(target, "Recording failed. Please retry.");
      recorder.start(500);
      inlineTeamNoteMediaRecorderRef.current = recorder;
      const ctor = (window as unknown as { SpeechRecognition?: BrowserSpeechConstructor; webkitSpeechRecognition?: BrowserSpeechConstructor }).SpeechRecognition
        || (window as unknown as { webkitSpeechRecognition?: BrowserSpeechConstructor }).webkitSpeechRecognition;
      if (ctor) {
        try {
          const recognition = new ctor();
          recognition.lang = "en-US";
          recognition.interimResults = true;
          recognition.continuous = true;
          recognition.onresult = (event) => {
            let live = "";
            for (let i = 0; i < event.results.length; i += 1) {
              live += `${event.results[i][0].transcript} `;
            }
            updateInlineTeamNoteDraft(target, { text: live.trim(), updatedAt: new Date().toISOString() });
          };
          recognition.onerror = () => {
            updateInlineTeamNoteStatus(target, "Mic is recording, but speech-to-text is unavailable in this browser.");
          };
          recognition.onend = () => {
            if (inlineTeamNoteSpeechRecognitionRef.current === recognition) {
              inlineTeamNoteSpeechRecognitionRef.current = null;
            }
          };
          recognition.start();
          inlineTeamNoteSpeechRecognitionRef.current = recognition;
        } catch {
          // Continue with audio-only capture.
        }
      }
      setInlineTeamNoteRecorderState("recording");
      updateInlineTeamNoteStatus(target, "Listening... tap Stop to finish.");
    } catch {
      setInlineTeamNoteRecordingKey(null);
      setInlineTeamNoteRecordingTarget(null);
      updateInlineTeamNoteStatus(target, "Microphone permission denied or unavailable.");
    }
  }

  async function stopInlineTeamNoteRecording() {
    if (inlineTeamNoteRecorderState !== "recording") return;
    const target = inlineTeamNoteRecordingTarget;
    const recorder = inlineTeamNoteMediaRecorderRef.current;
    const stream = inlineTeamNoteMediaStreamRef.current;
    if (!recorder) {
      setInlineTeamNoteRecorderState("idle");
      setInlineTeamNoteRecordingKey(null);
      setInlineTeamNoteRecordingTarget(null);
      return;
    }
    const stoppedBlob = new Promise<Blob | null>((resolve) => {
      recorder.addEventListener("stop", () => {
        const mime = recorder.mimeType || "audio/webm";
        const blob = inlineTeamNoteAudioChunksRef.current.length
          ? new Blob(inlineTeamNoteAudioChunksRef.current, { type: mime })
          : null;
        resolve(blob);
      }, { once: true });
    });

    recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    inlineTeamNoteMediaStreamRef.current = null;
    inlineTeamNoteMediaRecorderRef.current = null;
    inlineTeamNoteSpeechRecognitionRef.current?.stop();
    inlineTeamNoteSpeechRecognitionRef.current = null;
    setInlineTeamNoteRecorderState("idle");
    setInlineTeamNoteRecordingKey(null);
    setInlineTeamNoteRecordingTarget(null);
    const blob = await stoppedBlob;
    if (!target) return;
    if (!blob || blob.size < 1024) {
      const existingText = inlineTeamNoteDraftForTarget(target).text.trim();
      if (existingText) {
        updateInlineTeamNoteDraft(target, { audioUrl: "", updatedAt: new Date().toISOString() });
        updateInlineTeamNoteStatus(target, "Voice note captured. Tap Save.");
      } else {
        updateInlineTeamNoteStatus(target, "No usable audio captured. Try again.");
      }
      return;
    }
    try {
      const audioDataUrl = await blobToDataUrl(blob);
      updateInlineTeamNoteDraft(target, { audioUrl: audioDataUrl, updatedAt: new Date().toISOString() });
      updateInlineTeamNoteStatus(target, "Voice note captured with audio. Tap Save.");
    } catch {
      updateInlineTeamNoteStatus(target, "Could not process audio recording.");
    }
  }

  function saveInlineTeamNote(target: InlineTeamNoteTarget) {
    const draft = inlineTeamNoteDraftForTarget(target);
    const cleanedText = draft.text.trim();
    if (!cleanedText && !draft.audioUrl) {
      updateInlineTeamNoteStatus(target, "Tap Speak, say your note, then Save.");
      return;
    }
    const nextDraft: InlineTeamNoteDraft = {
      text: cleanedText,
      audioUrl: draft.audioUrl,
      updatedAt: new Date().toISOString()
    };
    updateInlineTeamNoteDraft(target, nextDraft);
    safeLocalSet(inlineTeamNoteStorageKey(target), JSON.stringify(nextDraft));
    setNotes((prev) => [
      {
        id: crypto.randomUUID(),
        gameId: selectedGameId || `team:${target.teamId}`,
        playerId: target.playerId || undefined,
        transcript: cleanedText || "(Audio note only)",
        audioUrl: draft.audioUrl || undefined,
        createdAt: new Date().toISOString(),
        synced: false
      },
      ...prev
    ]);
    updateInlineTeamNoteStatus(target, "Saved.");
  }

  async function syncNow() {
    if (!user || syncing || !online) return;
    const pendingNotes = notes.filter((n) => !n.synced);
    const pendingPulses = pulses.filter((p) => !p.synced);
    if (!pendingNotes.length && !pendingPulses.length) return;

    setSyncing(true);
    setSyncError("");
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: user.orgId, notes: pendingNotes, pulses: pendingPulses })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSyncError(data?.error || "Sync failed");
        return;
      }
      const data = await res.json();
      const noteIds = new Set<string>(data.acceptedNoteIds || []);
      const pulseIds = new Set<string>(data.acceptedPulseIds || []);

      setNotes((prev) => prev.map((n) => (noteIds.has(n.id) ? { ...n, synced: true } : n)));
      setPulses((prev) => prev.map((p) => (pulseIds.has(p.id) ? { ...p, synced: true } : p)));
      const nowIso = new Date().toISOString();
      setLastSyncAt(nowIso);
      safeLocalSet(makeOrgKey(user.orgId, user.userId, "lastSyncAt"), nowIso);
    } finally {
      setSyncing(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/session/logout", { method: "POST", cache: "no-store" });
    } catch {
      // Even if API call fails, force user to login screen.
    } finally {
      window.location.href = "/login";
    }
  }

  const itinerary = useMemo(() => buildPath(games, watchlistSet), [games, watchlistSet]);
  const tournamentPlayerDashboard = useMemo(() => {
    if (!games.length) return [];
    return players.map((player) => {
      const playerGameIds = games.filter((g) => g.players.some((p) => p.id === player.id)).map((g) => g.id);
      const playerNotes = notes.filter((n) => playerGameIds.includes(n.gameId));
      return {
        player,
        notes: playerNotes
      };
    });
  }, [games, players, notes]);
  const filteredTeams = useMemo(() => {
    const normalized = normalizeSmartSearch(teamListSearchQuery);
    if (!normalized) return tournamentTeamsForNotes;
    const teamIdMatches = new Set(
      scheduleSearchPlayerTeamIds
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const teamNameMatches = new Set(
      scheduleSearchPlayerTeamNames
        .map((value) => normalizeSmartSearch(value))
        .filter(Boolean)
    );
    const tokens = normalized.split(" ").filter(Boolean);

    if (tournamentTeamSearchMode === "player") {
      return tournamentTeamsForNotes.filter((team) => {
        const id = String(team.id || "").trim().toLowerCase();
        const name = normalizeSmartSearch(team.name || "");
        if (!name) return false;
        if (id && teamIdMatches.has(id)) return true;
        if (teamNameMatches.has(name)) return true;
        return false;
      });
    }

    return tournamentTeamsForNotes.filter((team) => {
      const name = normalizeSmartSearch(team.name || "");
      if (!name) return false;
      return tokens.every((token) => name.includes(token));
    });
  }, [
    scheduleSearchPlayerTeamIds,
    scheduleSearchPlayerTeamNames,
    teamListSearchQuery,
    tournamentTeamSearchMode,
    tournamentTeamsForNotes
  ]);
  const notesPlayerSearchResults = useMemo(() => {
    if (tournamentTeamSearchMode !== "player") return [] as SmartPlayerResult[];
    if (!scheduleSearchNormalized) return [] as SmartPlayerResult[];
    const rows = tournamentPlayerIndexRef.current;
    if (!rows.length) return [] as SmartPlayerResult[];
    const seen = new Set<string>();
    const out: SmartPlayerResult[] = [];
    rows.forEach((row) => {
      const blob = normalizeSmartSearch(row.name);
      if (!blob) return;
      if (!scheduleSearchTokens.every((token) => blob.includes(token))) return;
      const key = `${row.teamId}::${row.playerId || normalizeSmartSearch(row.name)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        key,
        playerId: row.playerId,
        name: row.name,
        hometown: row.hometown || "-",
        teamId: row.teamId,
        teamName: row.teamName
      });
    });
    return out
      .sort((left, right) => left.name.localeCompare(right.name) || left.teamName.localeCompare(right.teamName))
      .slice(0, 60);
  }, [
    scheduleSearchNormalized,
    scheduleSearchPlayerTeamIds,
    scheduleSearchPlayerTeamNames,
    scheduleSearchTokens,
    tournamentTeamSearchMode
  ]);
  const selectedNotesTeamScheduleGroups = useMemo(() => {
    if (!notesTeamScheduleRows.length) {
      return [] as Array<{ dayLabel: string; daySort: number; rows: TeamDetailsScheduleRow[] }>;
    }
    const rowsWithSort = notesTeamScheduleRows.map((row, index) => {
      const sortAt = parseTeamDetailsScheduleSortMs(row, index);
      const dayLabel = String(row.dayLabel || "").trim()
        || String(row.date || "").trim().toUpperCase()
        || "DATE TBD";
      return { row, sortAt, dayLabel };
    });
    rowsWithSort.sort((left, right) => left.sortAt - right.sortAt || left.row.gameNo.localeCompare(right.row.gameNo));
    const grouped = new Map<string, { dayLabel: string; daySort: number; rows: TeamDetailsScheduleRow[] }>();
    rowsWithSort.forEach(({ row, sortAt, dayLabel }) => {
      const key = normalizeSmartSearch(dayLabel) || dayLabel;
      const existing = grouped.get(key);
      if (existing) {
        existing.rows.push(row);
      } else {
        grouped.set(key, {
          dayLabel,
          daySort: sortAt,
          rows: [row]
        });
      }
    });
    return Array.from(grouped.values()).sort((left, right) => left.daySort - right.daySort);
  }, [notesTeamScheduleRows]);
  const companyTournamentInventory = useMemo(
    () => sortInventoryForDisplay(displayInventory.filter((item) => item.company === company)),
    [company, displayInventory]
  );
  const tournamentAgeFilterOptions = useMemo(() => {
    const ages = new Set<number>();
    companyTournamentInventory.forEach((item) => {
      tournamentAgeGroups(item).forEach((age) => {
        ages.add(age);
      });
    });
    return ["ALL", "15U+", ...Array.from(ages.values()).sort((a, b) => a - b).map((age) => `${age}U`)];
  }, [companyTournamentInventory]);
  const tournamentAgeFilterLabel = useMemo(
    () => (
      tournamentAgeFilter === "ALL"
        ? "All Ages"
        : (tournamentAgeFilter === "15U+" ? "15U & Over" : tournamentAgeFilter)
    ),
    [tournamentAgeFilter]
  );
  const filteredTournamentInventory = useMemo(() => {
    const query = tournamentSearchQuery.trim().toLowerCase();
    const byAge = companyTournamentInventory.filter((item) => inventoryMatchesAgeFilter(item, tournamentAgeFilter));
    if (!query) return byAge;
    return byAge.filter((item) => item.name.toLowerCase().includes(query));
  }, [companyTournamentInventory, tournamentAgeFilter, tournamentSearchQuery]);
  const desiredPlayerIdSet = useMemo(
    () => new Set(desiredPlayers.map((item) => desiredPlayerSelectionKey(item))),
    [desiredPlayers]
  );
  const myOwnSchedule = useMemo(
    () => schedules.find((item) => item.user_id === user?.userId) || null,
    [schedules, user?.userId]
  );
  const shareableSchedules = useMemo(
    () => schedules.filter((item) => isShareableSchedule(item)),
    [schedules]
  );
  const myCoachSchedule = useMemo(
    () => shareableSchedules.find((item) => item.user_id === user?.userId) || null,
    [shareableSchedules, user?.userId]
  );
  const liveByUserId = useMemo(() => new Map(liveLocations.map((item) => [item.user_id, item])), [liveLocations]);
  const otherCoachSchedules = useMemo(
    () => shareableSchedules.filter((item) => item.user_id !== user?.userId),
    [shareableSchedules, user?.userId]
  );
  const coachMeetSuggestionById = useMemo(() => {
    const map = new Map<string, CoachMeetSuggestion>();
    for (const item of otherCoachSchedules) {
      const suggestion = buildCoachMeetSuggestion(
        myCoachSchedule,
        item,
        user ? (liveByUserId.get(user.userId) || null) : null,
        liveByUserId.get(item.user_id) || null
      );
      map.set(item.id, suggestion);
    }
    return map;
  }, [liveByUserId, myCoachSchedule, otherCoachSchedules, user]);
  const filteredCoachSchedules = useMemo(() => {
    const query = coachFilterQuery.trim().toLowerCase();
    const dateFilter = coachFilterDate.trim();
    return otherCoachSchedules.filter((item) => {
      if (query) {
        const blob = `${item.coach_name} ${item.coach_email || ""} ${item.flight_source || ""} ${item.flight_destination || ""}`;
        if (!blob.toLowerCase().includes(query)) return false;
      }
      if (dateFilter) {
        const sourceDate = item.flight_arrival_time || item.generated_plan?.[0]?.at || "";
        if (!sourceDate || Number.isNaN(Date.parse(sourceDate))) return false;
        if (new Date(sourceDate).toISOString().slice(0, 10) !== dateFilter) return false;
      }
      const suggestion = coachMeetSuggestionById.get(item.id);
      if (coachFilterMeetMode === "common" && suggestion?.kind === "none") return false;
      if (coachFilterMeetMode === "none" && suggestion?.kind !== "none") return false;
      return true;
    });
  }, [coachFilterDate, coachFilterMeetMode, coachFilterQuery, coachMeetSuggestionById, otherCoachSchedules]);
  const shareableUserIds = useMemo(
    () => Array.from(new Set(shareableSchedules.map((item) => item.user_id).filter(Boolean))),
    [shareableSchedules]
  );
  const showTournaments = activeTab === "tournaments";
  const showNotes = activeTab === "notes";
  const showProfile = activeTab === "profile";
  const showMyPlayersSchedule = activeTab === "myPlayersSchedule";

  useEffect(() => {
    if (!user) return;
    if (!shareableUserIds.length) {
      setCoachSharedNotesByUser(new Map());
      return;
    }
    let cancelled = false;
    setCoachSharedNotesLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/coach-notes?userIds=${encodeURIComponent(shareableUserIds.join(","))}`, {
          cache: "no-store"
        });
        if (!res.ok) return;
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        const notes = Array.isArray(body?.notes) ? body.notes as CoachSharedNote[] : [];
        const grouped = new Map<string, CoachSharedNote[]>();
        notes.forEach((note) => {
          const userId = String(note.user_id || "").trim();
          if (!userId) return;
          const row: CoachSharedNote = {
            id: String(note.id || ""),
            user_id: userId,
            game_id: String(note.game_id || ""),
            player_id: note.player_id ? String(note.player_id) : null,
            transcript: String(note.transcript || ""),
            audio_url: note.audio_url ? String(note.audio_url) : null,
            observed_at: String(note.observed_at || "")
          };
          grouped.set(userId, [...(grouped.get(userId) || []), row]);
        });
        setCoachSharedNotesByUser(grouped);
      } finally {
        if (!cancelled) setCoachSharedNotesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareableUserIds, user]);
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (!menuContainerRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (tournamentAgeFilterOptions.includes(tournamentAgeFilter)) return;
    setTournamentAgeFilter("ALL");
  }, [tournamentAgeFilter, tournamentAgeFilterOptions]);
  useEffect(() => {
    if (!tournamentAgeFilterOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTournamentAgeFilterOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tournamentAgeFilterOpen]);
  const canGoBackInApp = !showTournaments;
  function goToTournamentDashboard(options?: { rememberCurrent?: boolean }) {
    navigateTab("tournaments", { rememberCurrent: options?.rememberCurrent, closeMenu: true });
    void fetchInventory();
  }
  function switchDashboardCompany(nextCompany: "PG" | "PBR") {
    if (company === nextCompany && showTournaments) {
      setMenuOpen(false);
      return;
    }
    setMenuOpen(false);
    navigateTab("tournaments");
    setCompany(nextCompany);
    setSelectedInventorySlug("");
    setSelectedTournamentId("");
    setTournamentSearchQuery("");
    setTournamentAgeFilter("ALL");
    setTournamentAgeFilterOpen(false);
    setOpenError("");
    setJobHint(nextCompany === "PBR" ? "Prep Baseball Tournament" : "PG Spring Showdown");
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.set("company", nextCompany);
      params.set("provider", nextCompany);
      window.history.replaceState({}, "", `/bird-dog?${params.toString()}`);
    }
    void Promise.allSettled([loadCompanyData(nextCompany, true), fetchInventory(), fetchJobs()]);
  }
  function goBackInApp() {
    const previous = popPreviousTab(activeTab);
    if (previous) {
      navigateTab(previous, { rememberCurrent: false });
      return;
    }
    if (activeTab === "myPlayersSchedule" && selectedTournamentId) {
      navigateTab("notes", { rememberCurrent: false });
      return;
    }
    goToTournamentDashboard({ rememberCurrent: false });
  }
  const orgPrimary = user?.orgPrimary || "#1f3a5f";
  const orgAccent = user?.orgAccent || "#d7a316";
  const orgDisplayName = user?.orgName || "Neutral Org";
  const bgValue = "#060b16";
  const bgImageValue = `radial-gradient(circle at 12% 14%, ${alphaColor(orgPrimary, 0.28)} 0%, transparent 33%), radial-gradient(circle at 88% 16%, ${alphaColor(orgAccent, 0.2)} 0%, transparent 28%), linear-gradient(175deg, #060b16 0%, #0a1326 46%, #0b1322 100%)`;
  const panelValue = `linear-gradient(155deg, ${alphaColor(orgPrimary, 0.22)} 0%, rgba(10, 18, 34, 0.92) 72%)`;
  const inkValue = "#edf3ff";
  const lineValue = alphaColor(orgAccent, 0.34);
  const cardInkValue = "#f8fbff";
  const cardMutedValue = "rgba(214, 226, 245, 0.8)";

  if (authLoading) {
    return <main className="bd-root"><p>Loading session...</p></main>;
  }

  return (
    <main
      className="bd-root app-like"
      style={{
        ["--org-primary" as string]: orgPrimary,
        ["--org-accent" as string]: orgAccent,
        ["--bd-bg" as string]: bgValue,
        ["--bd-bg-image" as string]: bgImageValue,
        ["--bd-panel" as string]: panelValue,
        ["--bd-ink" as string]: inkValue,
        ["--bd-line" as string]: lineValue,
        ["--bd-card-ink" as string]: cardInkValue,
        ["--bd-card-muted" as string]: cardMutedValue
      }}
      onTouchStart={onPullStart}
      onTouchMove={onPullMove}
      onTouchEnd={onPullEnd}
    >
      <section className="top-menu">
        {canGoBackInApp ? (
          <button className="secondary" type="button" onClick={goBackInApp}>
            Back
          </button>
        ) : null}
        <div className="menu-anchor" ref={menuContainerRef}>
          <button
            className="secondary menu-trigger"
            type="button"
            aria-label="Open navigation menu"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            ☰
          </button>
          {menuOpen ? (
            <div className="menu-dropdown">
              <div className="menu-brand">
                <img src="/branding/a-point-scout-icon.svg?v=20260508a" alt="APOINT SCOUT" />
                <div className="menu-brand-copy">
                  <p>APOINT SCOUT</p>
                  <p>{orgDisplayName}</p>
                </div>
              </div>
              <button
                type="button"
                className={activeTab === "tournaments" ? "active" : ""}
                onClick={() => {
                  goToTournamentDashboard();
                }}
              >
                {companyLabel(company)} Dashboard
              </button>
              {company === "PG" ? (
                <button
                  type="button"
                  onClick={() => switchDashboardCompany("PBR")}
                >
                  Login to PBR
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => switchDashboardCompany("PG")}
                >
                  Login to PG
                </button>
              )}
              <button
                type="button"
                className={activeTab === "notes" ? "active" : ""}
                onClick={() => {
                  navigateTab("notes", { closeMenu: true });
                }}
              >
                Tournament Schedule
              </button>
              <button
                type="button"
                className={activeTab === "myPlayersSchedule" ? "active" : ""}
                onClick={() => {
                  navigateTab("myPlayersSchedule", { closeMenu: true });
                }}
              >
                My Players & Schedule
              </button>
              <button
                type="button"
                className={activeTab === "profile" ? "active" : ""}
                onClick={() => {
                  navigateTab("profile", { closeMenu: true });
                }}
              >
                My Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void logout();
                }}
              >
                Log Out
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {showProfile ? (
        <section className="panel" style={{ maxWidth: 760 }}>
          <h2>My Profile</h2>
          <p className="muted">Update your account profile details. Date of birth is locked and cannot be edited.</p>
          <div className="grid2">
            <label>
              First Name
              <input
                value={profileForm.firstName}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, firstName: e.target.value }))}
              />
            </label>
            <label>
              Last Name
              <input
                value={profileForm.lastName}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, lastName: e.target.value }))}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={profileForm.universityEmail}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, universityEmail: e.target.value }))}
                placeholder="name@example.com"
              />
            </label>
            <label>
              Date of Birth (Locked)
              <input
                type="date"
                value={profileForm.dateOfBirth}
                readOnly
                disabled
              />
            </label>
            <label>
              Gender
              <select
                value={profileForm.gender}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, gender: e.target.value as ProfileFormState["gender"] }))}
              >
                <option value="UNSPECIFIED">Prefer not to say</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            </label>
            <label>
              Country Code
              <input
                value={profileForm.countryCallingCode}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, countryCallingCode: e.target.value.replace(/[^\d]/g, "") }))}
                inputMode="numeric"
                placeholder="91"
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Mobile Number
              <input
                value={profileForm.mobileNumber}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, mobileNumber: e.target.value.replace(/[^\d]/g, "") }))}
                inputMode="tel"
                placeholder="9876543210"
              />
            </label>
          </div>
          <div className="row wrap">
            <button type="button" onClick={() => void saveProfile()}>Save Profile</button>
          </div>
          {profileStatus ? <p className="muted" style={{ marginTop: 8 }}>{profileStatus}</p> : null}
        </section>
      ) : null}

      {showTournaments ? (
      <section className="panel">
        <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0 }}>{company === "PBR" ? "PBR Dashboard" : "Tournament Dashboard"}</h2>
          <div className="row wrap" style={{ gap: 8 }}>
            {company === "PG" ? (
              <button
                type="button"
                className="secondary"
                onClick={() => switchDashboardCompany("PBR")}
              >
                Login to PBR
              </button>
            ) : (
              <button
                type="button"
                className="secondary"
                onClick={() => switchDashboardCompany("PG")}
              >
                Login to PG
              </button>
            )}
          </div>
        </div>
        {inventoryRefreshing ? <p className="muted small">Syncing latest data from {sourceLabel(company)}...</p> : null}
        {openError ? <p className="muted">{openError}</p> : null}
        <div className="row wrap" style={{ gap: 8, alignItems: "flex-end", marginTop: 8 }}>
          <label style={{ display: "block", maxWidth: 420, flex: "1 1 320px", marginBottom: 0 }}>
            Search {companyLabel(company)} Tournament
            <input
              value={tournamentSearchQuery}
              onChange={(e) => setTournamentSearchQuery(e.target.value)}
              placeholder="Search by tournament name"
              style={{ fontSize: 14 }}
            />
          </label>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setTournamentAgeFilterOpen((prev) => !prev)}
              aria-expanded={tournamentAgeFilterOpen}
            >
              Filter: {tournamentAgeFilterLabel}
            </button>
            {tournamentAgeFilterOpen ? (
              <div className="bd-filter-popover">
                {tournamentAgeFilterOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === tournamentAgeFilter ? "" : "secondary"}
                    onClick={() => {
                      setTournamentAgeFilter(option);
                      setTournamentAgeFilterOpen(false);
                    }}
                  >
                    {option === "ALL" ? "All Ages" : (option === "15U+" ? "15U & Over" : option)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {tournamentAgeFilter === "15U+" ? (
          <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
            Showing only 15U and above tournaments.
          </p>
        ) : null}
        <div className="tournament-grid" style={{ marginTop: 12 }}>
          {filteredTournamentInventory.length ? filteredTournamentInventory.map((item) => {
            const locked = isTournamentLocked(item, { forceUnlocked: isAdminUser });
            const opened = selectedInventorySlug === item.slug;
            return (
              <article
                key={item.slug}
                className={`tile-card ${locked ? "locked-card" : "unlocked-card"} ${opened ? "opened-card" : ""}`}
                onClick={() => {
                  if (locked) {
                    void openCheckoutForTournament(item.slug);
                    return;
                  }
                  void openUnlockedTournament(item);
                }}
              >
                {tournamentDateBadge(item.name, item.displayDate) ? <p className="tile-date">{tournamentDateBadge(item.name, item.displayDate)}</p> : null}
                <p className="tile-title"><strong>{item.name}</strong></p>
                <p className="muted">{item.season.toUpperCase()} · {item.company}</p>
                {item.displayCity ? <p className="small">{item.displayCity}</p> : null}
                {item.displayTeams ? <p className="small">{item.displayTeams}</p> : null}
                {item.isArchive ? <p className="small">🗂️ Archive Access (Free)</p> : null}
                {locked ? <p className="small">🔒 Subscribe to Unlock</p> : null}
                {openingSlug === item.slug ? <p className="small">Opening...</p> : null}
                {unlockingSlug === item.slug ? <p className="small">Opening Checkout...</p> : null}
              </article>
            );
          }) : (
            (inventoryRefreshing || !companyTournamentInventory.length)
              ? <p className="muted">Syncing latest {companyLabel(company)} tournaments...</p>
              : <p className="muted">No {companyLabel(company)} tournaments matched your search.</p>
          )}
        </div>
      </section>
      ) : null}

      {showNotes ? (
      <section className="panel" id="teams-roster-section">
        <div style={{ width: "100%" }}>
          <div className="panel" style={{ marginBottom: 10 }}>
            <h3 style={{ marginTop: 0 }}>Tournament Teams</h3>
            <p className="muted" style={{ marginTop: 6, marginBottom: 8 }}>
              Click any team to load that team&apos;s full schedule and roster on this page.
            </p>
            <div style={{ marginBottom: 10 }}>
              <label htmlFor="tournament-team-search" className="muted" style={{ display: "block", marginBottom: 6 }}>
                Search Teams / Players
              </label>
              <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  className={tournamentTeamSearchMode === "team" ? "" : "secondary"}
                  onClick={() => setTournamentTeamSearchMode("team")}
                >
                  Team Name
                </button>
                <button
                  type="button"
                  className={tournamentTeamSearchMode === "player" ? "" : "secondary"}
                  onClick={() => setTournamentTeamSearchMode("player")}
                >
                  Player Name
                </button>
              </div>
              <input
                id="tournament-team-search"
                type="text"
                value={teamListSearchQuery}
                onChange={(event) => {
                  setTeamListSearchQuery(event.target.value);
                  setTeamsSearchQuery(event.target.value);
                }}
                placeholder={tournamentTeamSearchMode === "player" ? "Search player name" : "Search team name"}
                autoComplete="off"
              />
              {tournamentTeamSearchMode === "player" && teamListSearchQuery.trim().length >= 2 ? (
                <p className="muted small" style={{ marginTop: 6, marginBottom: 0 }}>
                  {scheduleSearchLoading ? "Searching players..." : `${notesPlayerSearchResults.length} player match${notesPlayerSearchResults.length === 1 ? "" : "es"} found`}
                </p>
              ) : null}
              {tournamentTeamSearchMode === "player" && notesPlayerSearchResults.length ? (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="roster-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Team</th>
                        <th>Hometown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notesPlayerSearchResults.slice(0, 15).map((row) => (
                        <tr key={row.key}>
                          <td>{row.name}</td>
                          <td>{row.teamName || "-"}</td>
                          <td>{row.hometown || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
            <p className="muted" style={{ marginTop: 0, marginBottom: 8 }}>
              {filteredTeams.length} team{filteredTeams.length === 1 ? "" : "s"} shown
            </p>
            {filteredTeams.length ? (
              <div className="row wrap" style={{ gap: 8 }}>
                {filteredTeams.map((team) => {
                  const selected = notesSelectedTeam
                    && notesTeamCacheKey(notesSelectedTeam) === notesTeamCacheKey(team);
                  return (
                    <button
                      key={notesTeamCacheKey(team)}
                      type="button"
                      className={selected ? "" : "secondary"}
                      onClick={() => {
                        if (selected) {
                          clearNotesTeamSelection();
                          return;
                        }
                        void openTeamDetailsInline(team);
                      }}
                      style={{ textAlign: "left", minWidth: 220, flex: "1 1 260px" }}
                    >
                      <span>{team.name}</span>
                      {team.from ? (
                        <span className="small muted" style={{ display: "block", marginTop: 3 }}>
                          {team.from}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 6 }}>
                {tournamentTeamsForNotes.length
                  ? "No teams matched your search."
                  : scheduleNotUploadedMessage(company)}
              </p>
            )}
          </div>

          {notesSelectedTeam ? (
            <div className="panel" style={{ marginBottom: 10 }}>
              <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div>
                  <h3 style={{ marginTop: 0, marginBottom: 0 }}>{notesSelectedTeam.name}</h3>
                  {notesSelectedTeam.from ? <p className="muted" style={{ marginTop: 4, marginBottom: 0 }}>{notesSelectedTeam.from}</p> : null}
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => navigateTab("myPlayersSchedule")}
                  >
                    Go To My Players & Schedule
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => viewTeamScheduleAndRoster(notesSelectedTeam, "notes", "roster")}
                  >
                    Open Full Team Roster Tools
                  </button>
                </div>
              </div>

              {notesTeamLoading ? <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>Loading team schedule and roster...</p> : null}
              {notesTeamStatus ? <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>{notesTeamStatus}</p> : null}

              <h4 style={{ marginTop: 12, marginBottom: 6 }}>Team Schedule</h4>
              <div className="table-wrap">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Game</th>
                      <th>Location</th>
                      <th>Age/Div</th>
                      <th>Team</th>
                      <th>Score</th>
                      <th>Team</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedNotesTeamScheduleGroups.length ? selectedNotesTeamScheduleGroups.map((group) => (
                      <Fragment key={`${group.dayLabel}-${group.daySort}`}>
                        <tr>
                          <td colSpan={7} style={{ fontWeight: 700 }}>{group.dayLabel}</td>
                        </tr>
                        {group.rows.map((row, index) => (
                          <tr key={`${group.dayLabel}-${row.gameNo}-${row.time}-${row.homeTeam}-${row.awayTeam}-${index}`}>
                            <td>{row.time || "-"}</td>
                            <td>{row.gameNo || "-"}</td>
                            <td>{row.field || "-"}</td>
                            <td>{row.ageDiv || "-"}</td>
                            <td>{row.homeTeam || "-"}</td>
                            <td>{`${row.homeScore || "00"} - ${row.awayScore || "00"}`}</td>
                            <td>{row.awayTeam || "-"}</td>
                          </tr>
                        ))}
                      </Fragment>
                    )) : (
                      <tr>
                        <td className="empty-cell" colSpan={7}>No schedule rows found for this team yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <h4 style={{ marginTop: 12, marginBottom: 6 }}>Team Roster</h4>
              <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => addSelectedNotesRosterPlayersToCart()}
                  disabled={!notesSelectedRosterRowKeys.length}
                >
                  View Selected Players List
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setNotesSelectedRosterRowKeys([])}
                  disabled={!notesSelectedRosterRowKeys.length}
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => navigateTab("myPlayersSchedule")}
                >
                  Go To My Players & Schedule
                </button>
              </div>
              <div className="table-wrap">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>No</th>
                      <th>Player</th>
                      <th>Position</th>
                      <th>School</th>
                      <th>Hometown</th>
                      <th>Commitment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notesTeamRosterRows.length ? notesTeamRosterRows.map((row, index) => {
                      const selectionKey = notesRosterRowSelectionKey(row);
                      const checked = notesSelectedRosterRowKeys.includes(selectionKey);
                      return (
                      <tr key={`${row.no || "-"}-${row.name}-${index}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleNotesRosterSelection(selectionKey)}
                            aria-label={`Select ${row.name}`}
                          />
                        </td>
                        <td>{row.no || "-"}</td>
                        <td>{row.name || "-"}</td>
                        <td>{row.position || "-"}</td>
                        <td>{row.school || "-"}</td>
                        <td>{row.hometown || "-"}</td>
                        <td>{row.commitment || "-"}</td>
                      </tr>
                      );
                    }) : (
                      <tr>
                        <td className="empty-cell" colSpan={7}>No roster rows found for this team yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 6 }}>
              Click a team above to view only that team&apos;s schedule and roster.
            </p>
          )}
        </div>
      </section>
      ) : null}

      {showMyPlayersSchedule ? (
      <section className="panel planner-shell" id="generated-schedule-panel" ref={generatedSchedulePanelRef}>
        <div className="row wrap planner-toolbar" style={{ alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>My Players & Schedule</h3>
          <div className="row wrap" style={{ gap: 8 }}>
            <button
              type="button"
              onClick={() => void generateScheduleFromSmartPlayers({ keepActiveTab: true })}
              disabled={!desiredPlayers.length}
            >
              Create Schedule
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void removeMySchedule()}
              disabled={!myGeneratedPlan.length && !myOwnSchedule}
              title={!myGeneratedPlan.length && !myOwnSchedule ? "No saved schedule yet." : "Remove current saved schedule."}
            >
              Remove Schedule
            </button>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Event location: {eventLocationHint || "Unknown"}
          </p>
          <p className="muted" style={{ marginTop: 0 }}>
            Selected players: {desiredPlayers.length}
          </p>
          <p className="muted small" style={{ marginTop: 0 }}>
            Drag and drop player rows to reorder scouting priority.
          </p>
          <div className="panel" style={{ marginTop: 8, marginBottom: 8 }}>
            <h4 style={{ marginTop: 0, marginBottom: 6 }}>Coach Travel Inputs</h4>
            <p className="muted" style={{ marginTop: 0, marginBottom: 8 }}>
              Planner builds route from your answers.
            </p>
            <div className="panel planner-question" style={{ marginBottom: 8 }}>
              <div
                className="row wrap planner-question-header"
                style={{ alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}
                role="button"
                tabIndex={0}
                aria-expanded={questionOpen.flight}
                onClick={() => setQuestionOpen((prev) => ({ ...prev, flight: !prev.flight }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setQuestionOpen((prev) => ({ ...prev, flight: !prev.flight }));
                  }
                }}
              >
                <strong>1. Is your flight booked?</strong>
                <button
                  type="button"
                  className="secondary planner-question-toggle"
                  onClick={(event) => {
                    event.stopPropagation();
                    setQuestionOpen((prev) => ({ ...prev, flight: !prev.flight }));
                  }}
                >
                  {questionOpen.flight ? "▲" : "▼"}
                </button>
              </div>
              {questionOpen.flight ? (
                <div className="planner-question-body" style={{ marginTop: 8 }}>
                  <select
                    id="flight-booked"
                    value={flightBooked}
                    onChange={(event) => {
                      const value = event.target.value === "yes" ? "yes" : "no";
                      setFlightBooked(value);
                      setQuestionOpen((prev) => ({ ...prev, flight: false }));
                    }}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
              ) : null}
            </div>
            {requiredStateCodes.length ? (
              <div className="panel planner-question" style={{ marginBottom: 8 }}>
                <div
                  className="row wrap planner-question-header"
                  style={{ alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={questionOpen.arrival}
                  onClick={() => setQuestionOpen((prev) => ({ ...prev, arrival: !prev.arrival }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setQuestionOpen((prev) => ({ ...prev, arrival: !prev.arrival }));
                    }
                  }}
                >
                  <strong>2. When will you reach each event state?</strong>
                  <button
                    type="button"
                    className="secondary planner-question-toggle"
                    onClick={(event) => {
                      event.stopPropagation();
                      setQuestionOpen((prev) => ({ ...prev, arrival: !prev.arrival }));
                    }}
                  >
                    {questionOpen.arrival ? "▲" : "▼"}
                  </button>
                </div>
                {questionOpen.arrival ? (
                  <div className="planner-question-body" style={{ marginTop: 8 }}>
                    {requiredStateCodes.map((stateCode) => (
                      <div key={stateCode} className="row wrap" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
                        <strong style={{ minWidth: 54 }}>{stateCode}</strong>
                        <div className="planner-autocomplete-shell" style={{ minWidth: 280, flex: "1 1 320px" }}>
                          <input
                            value={stateArrivalInputs[stateCode]?.arrivalLocation || ""}
                            onChange={(event) => {
                              updateStateArrivalInput(stateCode, { arrivalLocation: event.target.value });
                              setActiveStateArrivalInput(stateCode);
                            }}
                            onFocus={() => setActiveStateArrivalInput(stateCode)}
                            onBlur={() => {
                              window.setTimeout(() => {
                                setActiveStateArrivalInput((current) => (current === stateCode ? "" : current));
                              }, 120);
                            }}
                            placeholder={`Arrival city/airport for ${stateCode}`}
                          />
                          {activeStateArrivalInput === stateCode ? (
                            <div className="planner-autocomplete-list" role="listbox" aria-label={`Arrival suggestions for ${stateCode}`}>
                              {stateArrivalSuggestionsLoading[stateCode] ? (
                                <div className="planner-autocomplete-empty">Searching places...</div>
                              ) : (stateArrivalSuggestions[stateCode] || []).length ? (
                                (stateArrivalSuggestions[stateCode] || []).map((suggestion) => (
                                  <button
                                    type="button"
                                    key={`${stateCode}-arrival-${suggestion.placeId || suggestion.label}`}
                                    className="planner-autocomplete-option"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => applyStateArrivalSuggestion(stateCode, suggestion)}
                                  >
                                    {suggestion.label}
                                  </button>
                                ))
                              ) : String(stateArrivalInputs[stateCode]?.arrivalLocation || "").trim().length >= 2 ? (
                                <div className="planner-autocomplete-empty">No place options found.</div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <input
                          type="datetime-local"
                          value={stateArrivalInputs[stateCode]?.arrivalTime || ""}
                          onChange={(event) => {
                            updateStateArrivalInput(stateCode, { arrivalTime: event.target.value });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="panel planner-question" style={{ marginBottom: 0 }}>
              <div
                className="row wrap planner-question-header"
                style={{ alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}
                role="button"
                tabIndex={0}
                aria-expanded={questionOpen.hotel}
                onClick={() => setQuestionOpen((prev) => ({ ...prev, hotel: !prev.hotel }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setQuestionOpen((prev) => ({ ...prev, hotel: !prev.hotel }));
                  }
                }}
              >
                <strong>3. Is your hotel booked?</strong>
                <button
                  type="button"
                  className="secondary planner-question-toggle"
                  onClick={(event) => {
                    event.stopPropagation();
                    setQuestionOpen((prev) => ({ ...prev, hotel: !prev.hotel }));
                  }}
                >
                  {questionOpen.hotel ? "▲" : "▼"}
                </button>
              </div>
              {questionOpen.hotel ? (
                <div className="planner-question-body" style={{ marginTop: 8 }}>
                  <select
                    value={hotelBooked}
                    onChange={(event) => {
                      const value = event.target.value === "yes" ? "yes" : "no";
                      setHotelBooked(value);
                      if (value === "no") {
                        setScheduleForm((prev) => {
                          if (!prev.hotelName) return prev;
                          return { ...prev, hotelName: "" };
                        });
                        setStateHotelInputs((prev) => {
                          const next: Record<string, StateHotelInput> = {};
                          Object.keys(prev).forEach((stateCode) => {
                            next[stateCode] = { hotelName: "", checkIn: "", checkOut: "" };
                          });
                          return next;
                        });
                      }
                      setQuestionOpen((prev) => ({ ...prev, hotel: value === "no" ? false : prev.hotel }));
                    }}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                  {hotelBooked === "yes" ? (
                    <div style={{ marginTop: 8 }}>
                      {requiredStateCodes.map((stateCode) => (
                        <div key={`hotel-${stateCode}`} className="row wrap" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
                          <strong style={{ minWidth: 54 }}>{stateCode}</strong>
                          <div className="planner-autocomplete-shell" style={{ minWidth: 220, flex: "1 1 240px" }}>
                            <input
                              value={stateHotelInputs[stateCode]?.hotelName || ""}
                              onChange={(event) => {
                                updateStateHotelInput(stateCode, { hotelName: event.target.value });
                                setActiveStateHotelInput(stateCode);
                              }}
                              onFocus={() => setActiveStateHotelInput(stateCode)}
                              onBlur={() => {
                                window.setTimeout(() => {
                                  setActiveStateHotelInput((current) => (current === stateCode ? "" : current));
                                }, 120);
                              }}
                              placeholder={`Hotel name in ${stateCode}`}
                            />
                            {activeStateHotelInput === stateCode ? (
                              <div className="planner-autocomplete-list" role="listbox" aria-label={`Hotel suggestions for ${stateCode}`}>
                                {stateHotelNameSuggestionsLoading[stateCode] ? (
                                  <div className="planner-autocomplete-empty">Searching hotels...</div>
                                ) : (stateHotelNameSuggestions[stateCode] || []).length ? (
                                  (stateHotelNameSuggestions[stateCode] || []).map((suggestion) => (
                                    <button
                                      type="button"
                                      key={`${stateCode}-hotel-${suggestion.placeId || suggestion.label}`}
                                      className="planner-autocomplete-option"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => applyStateHotelSuggestion(stateCode, suggestion)}
                                    >
                                      {suggestion.label}
                                    </button>
                                  ))
                                ) : String(stateHotelInputs[stateCode]?.hotelName || "").trim().length >= 2 ? (
                                  <div className="planner-autocomplete-empty">No hotel options found.</div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <input
                            type="datetime-local"
                            value={stateHotelInputs[stateCode]?.checkIn || ""}
                            onChange={(event) => updateStateHotelInput(stateCode, { checkIn: event.target.value })}
                          />
                          <input
                            type="datetime-local"
                            value={stateHotelInputs[stateCode]?.checkOut || ""}
                            onChange={(event) => updateStateHotelInput(stateCode, { checkOut: event.target.value })}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="hotel-suggestion-panel" style={{ marginTop: 10 }}>
                      <p className="muted hotel-suggestion-intro" style={{ marginTop: 0, marginBottom: 8 }}>
                        Not booked yet? We can suggest nearby stays based on {hotelSuggestionDestination || "event location"}.
                      </p>
                      {hotelSuggestions.length ? (
                        <div className="hotel-suggestion-list">
                          {hotelSuggestions.slice(0, 4).map((hotel) => (
                            <article key={`${hotel.placeId || hotel.name}:${hotel.address}`} className="hotel-suggestion-card">
                              <div>
                                <strong>{hotel.name}</strong>
                                {hotel.address ? <p className="muted">{hotel.address}</p> : null}
                              </div>
                              <div className="hotel-suggestion-actions">
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => applyHotelSuggestion(hotel)}
                                >
                                  Use This Stay
                                </button>
                                <a href={mapsSearchUrlForHotel(hotel)} target="_blank" rel="noreferrer">
                                  Open in Maps
                                </a>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="muted" style={{ margin: 0 }}>
                          No nearby stays yet. Enter arrival city/state in question 2 if needed and try again.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          {scheduleForm.hotelName ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Recommended hotel: {scheduleForm.hotelName}
            </p>
          ) : null}
          <div className="table-wrap planner-table-wrap" style={{ marginTop: 6 }}>
            <table className="roster-table planner-player-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Player</th>
                  <th>Team</th>
                  <th>Playing Time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {desiredPlayers.length ? desiredPlayers.map((player, index) => (
                  <tr
                    key={desiredPlayerSelectionKey(player)}
                    className={draggingDesiredPlayerKey === desiredPlayerSelectionKey(player) ? "dragging-row" : ""}
                    draggable
                    onDragStart={() => onDesiredPlayerDragStart(desiredPlayerSelectionKey(player))}
                    onDragEnd={() => setDraggingDesiredPlayerKey(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => onDesiredPlayerDrop(desiredPlayerSelectionKey(player))}
                  >
                    <td data-label="Order">{index + 1}</td>
                    <td data-label="Player">{player.name}</td>
                    <td data-label="Team">{player.team}</td>
                    <td data-label="Playing Time">{playerTeamTimingBySelectionKey.get(desiredPlayerSelectionKey(player)) || "Time TBD"}</td>
                    <td className="action-cell" data-label="Action">
                      <span className="small muted" style={{ display: "block", marginBottom: 6 }}>Drag to reorder</span>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => removeDesiredPlayer(desiredPlayerSelectionKey(player))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td className="empty-cell" colSpan={5}>No players selected yet. Open any team from Tournament Schedule and add players from Team Roster.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {playerSearchStatus ? (
            <p className="muted" style={{ marginTop: 8 }}>
              {playerSearchStatus}
            </p>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <h4 style={{ marginTop: 0, marginBottom: 6 }}>Coach Schedule Preview</h4>
            {myGeneratedPlan.length ? (
              <div className="table-wrap planner-table-wrap">
                <table className="roster-table planner-preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Time</th>
                      <th>Step</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myGeneratedPlan.map((step, idx) => (
                      <tr key={`${step.at}-${idx}`}>
                        <td data-label="#">{idx + 1}</td>
                        <td data-label="Time">{formatTournamentGameDateTime(Date.parse(String(step.at || "")))}</td>
                        <td data-label="Step">{step.title}</td>
                        <td data-label="Details">
                          <span>{step.detail}</span>
                          {sanitizePlanMapUrl(step.mapUrl) ? (
                            <>
                              <br />
                              <a href={sanitizePlanMapUrl(step.mapUrl)} target="_blank" rel="noreferrer">
                                Open in Maps
                              </a>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>No schedule created yet.</p>
            )}
          </div>
        </div>
      </section>
      ) : null}

    </main>
  );
}
