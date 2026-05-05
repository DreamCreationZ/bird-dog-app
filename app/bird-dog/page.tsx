"use client";

import { TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Game, ItineraryStop, Player, PulseEvent, ScoutNote, SessionUser, Tournament } from "@/lib/birddog/types";
import { loadHarvestDataset, loadHarvestOverview, loadHarvestTournament } from "@/lib/birddog/clientHarvest";
import { INVENTORY_SEED, inventoryHarvestHint } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess, isPastTournament } from "@/lib/birddog/tournamentAccess";
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

const CACHE_KEY = "bird_dog_tournament_cache";
const PREVIEW_UNLOCK_ALL =
  process.env.NEXT_PUBLIC_BIRD_DOG_PREVIEW_UNLOCK_ALL === "true"
  && process.env.NODE_ENV !== "production";
const COACH_LOCATION_SHARING_KEY = "bird_dog:coach_location_sharing";
const LOCAL_SCHEDULE_FALLBACK_KEY = "bird_dog:local_schedule_fallback:v1";
const PLAN_WORKFLOW_STATUS_KEY_PREFIX = "bird_dog:plan_workflow_status:v1";
const BOOKING_REVIEW_DRAFT_KEY = "bird_dog:booking_review_draft:v1";
const BOOKING_SUMMARY_KEY = "bird_dog:booking_summary:v1";
const PROFILE_FORM_STORAGE_KEY_PREFIX = "bird_dog:profile_form:v1";
const DEMO_FREE_TOURNAMENT_SLUGS = new Set(["2025-pg-16u-wwba-national-championship"]);

function isTournamentLocked(item: InventoryTournament | null | undefined, options?: { forceUnlocked?: boolean }) {
  if (!item) return true;
  if (options?.forceUnlocked) return false;
  if (PREVIEW_UNLOCK_ALL) return false;
  if (item.isArchive) return false;
  if (DEMO_FREE_TOURNAMENT_SLUGS.has(item.slug)) return false;
  return item.locked;
}

function fallbackInventoryClient(): InventoryTournament[] {
  return INVENTORY_SEED.map((item) => {
    const isArchive = isFreeTournamentAccess({
      slug: item.slug,
      name: item.name,
      displayDate: item.displayDate || ""
    });
    return {
      slug: item.slug,
      name: item.name,
      season: item.season,
      company: item.company,
      locked: PREVIEW_UNLOCK_ALL ? false : !isArchive,
      isArchive,
      harvestHint: inventoryHarvestHint(item),
      displayDate: item.displayDate || "",
      displayTeams: item.displayTeams || "",
      displayCity: item.displayCity || ""
    };
  });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString();
}

function toInputDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToOffsetIso(localInput: string) {
  if (!localInput) return "";
  const date = new Date(localInput);
  if (Number.isNaN(date.getTime())) return localInput;
  const tzMin = -date.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${localInput}:00${sign}${hh}:${mm}`;
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

function localScheduleFallbackKey(user: SessionUser | null) {
  if (!user) return "";
  return `${LOCAL_SCHEDULE_FALLBACK_KEY}:${user.orgId}:${user.userId}`;
}

function normalizeStorageScope(value: string) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "na";
}

function rosterCartStorageKey(input: { inventorySlug: string; tournamentScope: string }) {
  const inventoryScope = normalizeStorageScope(input.inventorySlug || "inventory");
  const tournamentScope = normalizeStorageScope(input.tournamentScope || "tournament");
  return `bird_dog:roster_cart:v1:${inventoryScope}:${tournamentScope}`;
}

function readRosterCartStorage(key: string) {
  const raw = safeLocalGet(key);
  const parsed = parseJsonSafe<Array<Record<string, unknown>>>(raw, []);
  if (!Array.isArray(parsed)) return [] as DesiredPlayer[];
  return parsed
    .map((item) => ({
      playerId: String(item?.playerId || ""),
      selectionKey: item?.selectionKey ? String(item.selectionKey) : undefined,
      name: String(item?.name || ""),
      team: String(item?.team || ""),
      hometown: item?.hometown ? String(item.hometown) : undefined
    }))
    .filter((item) => item.playerId && item.name && item.team);
}

function writeRosterCartStorage(key: string, rows: DesiredPlayer[]) {
  safeLocalSet(key, JSON.stringify(rows));
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

function normalizeSmartSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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

function travelModeByText(from: string, to: string): TravelEstimate {
  const indiaUs = (looksLikeIndiaLocation(from) && looksLikeUsLocation(to))
    || (looksLikeIndiaLocation(to) && looksLikeUsLocation(from));
  if (indiaUs) {
    return {
      mode: "Multi-leg flight",
      minutes: 22 * 60,
      advisory: "No direct flight likely. Same-day scouting may be impossible."
    };
  }
  if (looksLikeUsLocation(from) && looksLikeUsLocation(to)) {
    return {
      mode: "Domestic flight + transfer",
      minutes: 6 * 60 + 30
    };
  }
  return {
    mode: "Flight + transfer",
    minutes: 11 * 60,
    advisory: "Estimated from location text; exact flight availability must be checked."
  };
}

function travelModeByDistance(km: number): TravelEstimate {
  if (km >= 9000) {
    return {
      mode: "Multi-leg international flight",
      minutes: Math.round((km / 820) * 60 + 540),
      advisory: "No direct flight likely. Same-day scouting may be impossible."
    };
  }
  if (km >= 5500) {
    return {
      mode: "Long-haul flight",
      minutes: Math.round((km / 800) * 60 + 420),
      advisory: "Likely includes connections and airport transfer time."
    };
  }
  if (km >= 1200) return { mode: "Flight + transfer", minutes: Math.round((km / 760) * 60 + 180) };
  if (km >= 300) return { mode: "Bus / Train + transfer", minutes: Math.round((km / 85) * 60 + 50) };
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
  const [activeTab, setActiveTab] = useState<"tournaments" | "schedule" | "notes" | "bestPlayers" | "profile">("tournaments");
  const [inlineTeamNoteDrafts, setInlineTeamNoteDrafts] = useState<Record<string, InlineTeamNoteDraft>>({});
  const [inlineTeamNoteStatuses, setInlineTeamNoteStatuses] = useState<Record<string, string>>({});
  const [inlineTeamNoteRecorderState, setInlineTeamNoteRecorderState] = useState<RecorderState>("idle");
  const [inlineTeamNoteRecordingKey, setInlineTeamNoteRecordingKey] = useState<string | null>(null);
  const [inlineTeamNoteRecordingTarget, setInlineTeamNoteRecordingTarget] = useState<InlineTeamNoteTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const [queryStateApplied, setQueryStateApplied] = useState(false);

  const [schedules, setSchedules] = useState<CoachSchedule[]>([]);
  const [viewingSchedule, setViewingSchedule] = useState<CoachSchedule | null>(null);
  const [viewingPanelMode, setViewingPanelMode] = useState<"schedule" | "notes">("schedule");
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
  const [sourceSuggestions, setSourceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceSuggestion[]>([]);
  const [hotelSuggestions, setHotelSuggestions] = useState<HotelSuggestion[]>([]);
  const [tournamentSearchQuery, setTournamentSearchQuery] = useState("");
  const [teamsSearchQuery, setTeamsSearchQuery] = useState("");
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");
  const [playerSearchResults, setPlayerSearchResults] = useState<SmartPlayerResult[]>([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);
  const [playerSearchStatus, setPlayerSearchStatus] = useState("");
  const [playerSearchCanDeepScan, setPlayerSearchCanDeepScan] = useState(false);
  const [desiredPlayers, setDesiredPlayers] = useState<DesiredPlayer[]>([]);
  const [teamRosterCartPlayers, setTeamRosterCartPlayers] = useState<DesiredPlayer[]>([]);
  const [desiredPlayerId, setDesiredPlayerId] = useState("");
  const [myGeneratedPlan, setMyGeneratedPlan] = useState<PlanItem[]>([]);
  const [planWorkflowStatus, setPlanWorkflowStatus] = useState<PlanWorkflowStatus>("draft");
  const [planWorkflowNote, setPlanWorkflowNote] = useState("");
  const [latestBookingSummary, setLatestBookingSummary] = useState<BookingSummarySnapshot | null>(null);
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
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
  const displayInventory = useMemo(
    () => (inventory.length ? inventory : fallbackInventoryClient()),
    [inventory]
  );
  const selectedInventory = useMemo(
    () => displayInventory.find((item) => item.slug === selectedInventorySlug) || null,
    [displayInventory, selectedInventorySlug]
  );
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
    () =>
      rosterCartStorageKey({
        inventorySlug: selectedInventorySlug || "inventory",
        tournamentScope: selectedTournamentId || selectedTournament?.name || "tournament"
      }),
    [selectedInventorySlug, selectedTournament?.name, selectedTournamentId]
  );

  const games = selectedTournament?.games || [];
  const players = useMemo(() => uniquePlayers(games), [games]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

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
  const geocodeCacheRef = useRef<Map<string, GeoLocation | null>>(new Map());
  const tournamentPlayerIndexRef = useRef<TournamentPlayerIndexRow[]>([]);
  const tournamentPlayerIndexKeyRef = useRef("");
  const tournamentPlayerIndexLoadingRef = useRef<Promise<TournamentPlayerIndexRow[]> | null>(null);
  const autoPlannerRef = useRef<{ busy: boolean; key: string }>({ busy: false, key: "" });
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

  function refreshBookingSummaryFromStorage() {
    const raw = safeLocalGet(BOOKING_SUMMARY_KEY);
    const parsed = parseJsonSafe<BookingSummarySnapshot | null>(raw, null);
    if (!parsed || !Array.isArray(parsed.results)) {
      setLatestBookingSummary(null);
      return;
    }
    setLatestBookingSummary(parsed);
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
      loadCachedTournament();
      try {
        const overview = await loadHarvestOverview();
        if (!mounted) return;
        const nextCompanies: ("PG" | "PBR")[] = overview.companies?.length
          ? overview.companies
          : ["PG", "PBR"];
        setCompanies(nextCompanies);

        const defaultCompany: "PG" | "PBR" = nextCompanies[0] || "PG";
        await Promise.allSettled([
          loadCompanyData(defaultCompany),
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
    const inventorySlug = params.get("inventorySlug");
    const tournamentId = params.get("tournamentId");
    if (tab === "coaches") {
      setActiveTab("schedule");
    } else if (tab === "tournaments" || tab === "schedule" || tab === "notes" || tab === "bestPlayers" || tab === "profile") {
      setActiveTab(tab);
    }
    if (inventorySlug) {
      setSelectedInventorySlug(inventorySlug);
    }
    if (tournamentId) {
      setSelectedTournamentId(tournamentId);
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
    teamRosterSearchCacheRef.current.clear();
    tournamentPlayerIndexRef.current = [];
    tournamentPlayerIndexKeyRef.current = "";
    tournamentPlayerIndexLoadingRef.current = null;
  }, [selectedTournamentId, selectedInventorySlug]);

  useEffect(() => {
    setTeamRosterCartPlayers(readRosterCartStorage(teamRosterCartStorageKey));
  }, [teamRosterCartStorageKey]);

  useEffect(() => {
    if (!teamRosterCartPlayers.length) return;
    setDesiredPlayers((prev) => {
      if (prev.length) return prev;
      return teamRosterCartPlayers;
    });
  }, [teamRosterCartPlayers]);

  useEffect(() => {
    if (activeTab !== "schedule") return;
    if (!desiredPlayers.length) {
      autoPlannerRef.current.key = "";
      return;
    }
    const planKey = desiredPlayers
      .map((item) => desiredPlayerSelectionKey(item))
      .sort()
      .join("|");
    if (!planKey) return;
    if (autoPlannerRef.current.busy) return;
    if (autoPlannerRef.current.key === planKey && myGeneratedPlan.length) return;
    autoPlannerRef.current.busy = true;
    autoPlannerRef.current.key = planKey;
    void generateScheduleFromSmartPlayers({ keepActiveTab: true, autoRun: true }).finally(() => {
      autoPlannerRef.current.busy = false;
    });
  }, [activeTab, desiredPlayers, myGeneratedPlan.length]);

  useEffect(() => {
    if (!canAccessLockedPages) {
      setSourceSuggestions([]);
      setDestinationSuggestions([]);
      setHotelSuggestions([]);
      return;
    }
    const sourceQuery = scheduleForm.flightSource.trim();
    if (sourceQuery.length < 2) {
      setSourceSuggestions([]);
      return;
    }
    const id = window.setTimeout(() => {
      void fetch(`/api/maps/autocomplete?q=${encodeURIComponent(sourceQuery)}`)
        .then((res) => (res.ok ? res.json() : { suggestions: [] }))
        .then((data) => setSourceSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []))
        .catch(() => setSourceSuggestions([]));
    }, 280);
    return () => window.clearTimeout(id);
  }, [scheduleForm.flightSource, canAccessLockedPages]);

  useEffect(() => {
    if (!canAccessLockedPages) {
      setDestinationSuggestions([]);
      setHotelSuggestions([]);
      return;
    }
    const destinationQuery = scheduleForm.flightDestination.trim();
    if (destinationQuery.length < 2) {
      setDestinationSuggestions([]);
      setHotelSuggestions([]);
      return;
    }
    const id = window.setTimeout(() => {
      void fetch(`/api/maps/autocomplete?q=${encodeURIComponent(destinationQuery)}`)
        .then((res) => (res.ok ? res.json() : { suggestions: [] }))
        .then((data) => setDestinationSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []))
        .catch(() => setDestinationSuggestions([]));

      void fetch(`/api/maps/hotels?destination=${encodeURIComponent(destinationQuery)}`)
        .then((res) => (res.ok ? res.json() : { hotels: [] }))
        .then((data) => setHotelSuggestions(Array.isArray(data?.hotels) ? data.hotels : []))
        .catch(() => setHotelSuggestions([]));
    }, 320);
    return () => window.clearTimeout(id);
  }, [scheduleForm.flightDestination, canAccessLockedPages]);

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
        }
      }
      const nextInventory = await fetchInventory();
      if (returnInventorySlug) {
        const paidItem = nextInventory.find((item) => item.slug === returnInventorySlug);
        if (paidItem && !isTournamentLocked(paidItem, { forceUnlocked: isAdminUser })) {
          setSelectedInventorySlug(returnInventorySlug);
        }
      }
      setActiveTab("tournaments");
      const next = new URL(window.location.href);
      next.searchParams.delete("payment");
      next.searchParams.delete("session_id");
      window.history.replaceState({}, "", next.pathname + (next.search ? `?${next.searchParams.toString()}` : ""));
    };
    void finalize();
  }, []);

  async function loadCompanyData(nextCompany: "PG" | "PBR", forceRefresh = false) {
    setLoadingHarvest(true);
    try {
      const dataset = await loadHarvestDataset(nextCompany, forceRefresh);
      const nextTournaments: Tournament[] = dataset.tournaments || [];
      setCompany(nextCompany);
      setTournaments(nextTournaments);
      setSelectedTournamentId(nextTournaments[0]?.id || "");
      if (nextTournaments[0]?.id) {
        await loadTournamentDetails(nextCompany, nextTournaments[0].id, forceRefresh);
      } else {
        setSelectedGameId("");
      }
    } catch {
      // Keep existing tournament state when data is temporarily unavailable.
    } finally {
      setLoadingHarvest(false);
    }
  }

  async function loadTournamentDetails(nextCompany: "PG" | "PBR", nextTournamentId: string, forceRefresh = false) {
    try {
      const tournament = await loadHarvestTournament(nextCompany, nextTournamentId, forceRefresh);
      setTournaments((prev) => prev.map((item) => (item.id === nextTournamentId ? tournament : item)));
      setSelectedTournamentId(nextTournamentId);
      setSelectedGameId(tournament.games?.[0]?.id || "");
    } catch {
      // Keep existing shallow tournament record.
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
    setOpenError("");
    const res = await fetch("/api/inventory");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      setOpenError(`Unable to load tournaments (${res.status}). ${text.slice(0, 180)}`);
      const fallback = fallbackInventoryClient();
      setInventory(fallback);
      return fallback;
    }
    const data = await res.json();
    const nextInventory: InventoryTournament[] = data.inventory || [];
    setSubscribed(Boolean(data.subscribed));
    if (!nextInventory.length) {
      const fallback = fallbackInventoryClient();
      setInventory(fallback);
      setOpenError("");
      return fallback;
    }
    setInventory(nextInventory);
    if (data?.warning && !data?.fallback) {
      setOpenError(String(data.warning));
    }
    return nextInventory;
  }

  async function refreshTournamentByInventory(item: InventoryTournament) {
    try {
      const targetTournamentId = await resolveTournamentIdForItem(item);
      const payload = {
        company: item.company,
        inventorySlug: item.slug,
        tournamentHint: item.harvestHint || item.name,
        tournamentId: targetTournamentId || undefined
      };
      const attemptOpen = () =>
        fetch("/api/harvest/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      let liveOpen = await attemptOpen();
      if (liveOpen.status === 401) {
        const sessionCheck = await fetch("/api/session/me", { cache: "no-store" });
        if (!sessionCheck.ok) {
          setOpenError("Session expired. Please sign in again.");
          router.replace("/login");
          return;
        }
        liveOpen = await attemptOpen();
      }
      if (!liveOpen.ok) return;
      const data = await liveOpen.json();
      const openedTournament = data?.tournament as Tournament | undefined;
      if (!openedTournament) return;
      setTournaments((prev) => {
        const filtered = prev.filter((t) => t.id !== openedTournament.id);
        return [openedTournament, ...filtered];
      });
      setSelectedTournamentId(openedTournament.id);
      setSelectedGameId(openedTournament.games?.[0]?.id || "");
      setTournamentViewTitle(openedTournament.name);
    } catch (error) {
      setOpenError(String(error));
    }
  }

  async function resolveTournamentIdForItem(item: InventoryTournament) {
    const wanted = normalizeTournamentName(item.name);
    const byCurrentState = tournaments.find((t) => {
      const name = normalizeTournamentName(t.name);
      return name === wanted || name.includes(wanted) || wanted.includes(name);
    })?.id;
    if (byCurrentState) return byCurrentState;

    try {
      const dataset = await loadHarvestDataset(item.company);
      const match = dataset.tournaments.find((t) => {
        const name = normalizeTournamentName(t.name);
        return name === wanted || name.includes(wanted) || wanted.includes(name);
      });
      return match?.id || "";
    } catch {
      return "";
    }
  }

  function applyOpenedTournament(openedTournament: Tournament) {
    setTournaments((prev) => {
      const filtered = prev.filter((t) => t.id !== openedTournament.id);
      return [openedTournament, ...filtered];
    });
    setSelectedTournamentId(openedTournament.id);
    setSelectedGameId(openedTournament.games?.[0]?.id || "");
    setTournamentViewTitle(openedTournament.name);
    setActiveTab("notes");
  }

  async function openTournamentFromExistingData(item: InventoryTournament, targetTournamentId?: string) {
    const wanted = normalizeTournamentName(item.name);
    const inMemoryMatch = tournaments.find((t) => {
      const normalized = normalizeTournamentName(t.name);
      return normalized === wanted || normalized.includes(wanted) || wanted.includes(normalized);
    });
    if (inMemoryMatch) {
      applyOpenedTournament(inMemoryMatch);
      return true;
    }

    const tryOpenById = async (candidateId: string) => {
      const details = await loadHarvestTournament(item.company, candidateId).catch(() => null);
      if (details) {
        applyOpenedTournament(details);
        return true;
      }
      return false;
    };

    if (targetTournamentId) {
      const opened = await tryOpenById(targetTournamentId);
      if (opened) return true;
    }

    const dataset = await loadHarvestDataset(item.company).catch(() => null);
    if (!dataset?.tournaments?.length) return false;
    const match = dataset.tournaments.find((t) => {
      const normalized = normalizeTournamentName(t.name);
      return normalized === wanted || normalized.includes(wanted) || wanted.includes(normalized);
    });
    if (!match) return false;

    const opened = await tryOpenById(match.id);
    if (opened) return true;
    applyOpenedTournament(match);
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
      await refreshTournamentByInventory(selectedItem);
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
    const key = localScheduleFallbackKey(user);
    if (!key) return null;
    const raw = safeLocalGet(key);
    if (!raw) return null;
    const parsed = parseJsonSafe<CoachSchedule | null>(raw, null);
    if (!parsed || typeof parsed !== "object") return null;
    return {
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
  }

  function writeLocalFallbackSchedule(schedule: CoachSchedule) {
    const key = localScheduleFallbackKey(user);
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
      desired_players: desiredState,
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
    if (!mine) return;

    setScheduleForm({
      flightSource: mine.flight_source || "Current location",
      flightDestination: mine.flight_destination || "",
      flightArrivalTime: toInputDateTime(mine.flight_arrival_time),
      hotelName: mine.hotel_name || "",
      notes: mine.notes || ""
    });
    setDesiredPlayers(mine.desired_players || []);
    const generated = mine.generated_plan || [];
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
    const res = await fetch("/api/schedules");
    if (!res.ok) {
      const local = readLocalFallbackSchedule();
      if (local) {
        setSchedules([local]);
        hydrateMySchedule([local]);
        setPlanWorkflowNote("Cloud schedule sync is unavailable. Showing your local saved recommendation.");
      }
      return;
    }
    const data = await res.json();
    const remoteList: CoachSchedule[] = data.schedules || [];
    const local = readLocalFallbackSchedule();
    const scheduleList = local && !remoteList.some((item) => item.user_id === local.user_id)
      ? [local, ...remoteList]
      : remoteList;
    setSchedules(scheduleList);
    hydrateMySchedule(scheduleList);
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
    const normalizedFlightArrival = activeForm.flightArrivalTime
      ? localInputToOffsetIso(activeForm.flightArrivalTime)
      : "";
    const payload = {
      ...activeForm,
      flightArrivalTime: normalizedFlightArrival,
      desiredPlayers: desiredOverride ?? desiredPlayers,
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
        desiredOverride ?? desiredPlayers,
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
      desiredOverride ?? desiredPlayers,
      generatedPlan ?? myGeneratedPlan
    );
    if (local) {
      writeLocalFallbackSchedule(local);
    }
    setSchedules(scheduleList);
    hydrateMySchedule(scheduleList);
  }

  async function addSchedule(desiredOverride?: DesiredPlayer[]) {
    const activeDesired = desiredOverride ?? desiredPlayers;
    const nextPlan = createGeneratedPlan(activeDesired);
    const mergedPlan = [...myGeneratedPlan, ...nextPlan];
    if (desiredOverride) {
      setDesiredPlayers(desiredOverride);
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
    const isAdminEmail = isPrivilegedAdminEmail(normalizedEmail);
    if (!firstName) {
      setProfileStatus("First name is required.");
      return;
    }
    if (!normalizedEmail.includes("@")) {
      setProfileStatus("Enter a valid university email.");
      return;
    }
    if (!isAdminEmail && !/\.edu$/i.test(normalizedEmail)) {
      setProfileStatus("Only university email addresses are allowed.");
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

  function editSchedule(item: CoachSchedule) {
    setActiveTab("schedule");
    setViewingSchedule(null);
    setScheduleForm({
      flightSource: item.flight_source || "Current location",
      flightDestination: item.flight_destination || "",
      flightArrivalTime: toInputDateTime(item.flight_arrival_time),
      hotelName: item.hotel_name || "",
      notes: item.notes || ""
    });
    setDesiredPlayers(item.desired_players || []);
    setMyGeneratedPlan(item.generated_plan || []);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function startMapForSchedule(schedule: CoachSchedule) {
    if (!schedule.hotel_name?.trim()) return;

    const openWithDestinationOnly = () => {
      const destination = encodeURIComponent(schedule.hotel_name as string);
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
      window.open(mapsUrl, "_blank", "noopener,noreferrer");
    };

    if (!navigator.geolocation) {
      openWithDestinationOnly();
      return;
    }

    const current = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

    if (!current) {
      openWithDestinationOnly();
      return;
    }

    const geo = await fetch(`/api/maps/geocode?address=${encodeURIComponent(schedule.hotel_name)}`)
      .then((res) => (res.ok ? res.json() : { location: null }))
      .catch(() => ({ location: null }));

    const destination = geo?.location as { lat: number; lng: number; label?: string } | null;
    if (!destination) {
      openWithDestinationOnly();
      return;
    }

    const km = distanceKm(current.lat, current.lng, destination.lat, destination.lng);
    if (km <= 0.2) {
      window.alert("Coach is already at destination (within ~200 meters).");
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${destination.lat},${destination.lng}`;
      window.open(mapsUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${current.lat},${current.lng}&destination=${destination.lat},${destination.lng}&travelmode=driving`;
    window.open(mapsUrl, "_blank", "noopener,noreferrer");
  }

  function openScheduleView(schedule: CoachSchedule, mode: "schedule" | "notes" = "schedule") {
    setActiveTab("schedule");
    setViewingPanelMode(mode);
    setViewingSchedule(schedule);
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

  function viewTeamScheduleAndRoster(team: TeamRef, returnTab: "notes" | "schedule" = "notes") {
    const params = new URLSearchParams();
    params.set("inventorySlug", selectedInventorySlug);
    params.set("teamId", team.id);
    params.set("teamName", team.name);
    params.set("teamUrl", team.href || "");
    params.set("eventId", currentEventNumber());
    params.set("tournamentName", selectedTournament?.name || tournamentViewTitle || "");
    params.set("returnTab", returnTab);
    params.set("returnInventorySlug", selectedInventorySlug);
    params.set("returnTournamentId", selectedTournamentId);
    router.push(`/bird-dog/team?${params.toString()}`);
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
    const cached = teamRosterSearchCacheRef.current.get(team.id);
    if (cached) return cached;
    const res = await fetch("/api/harvest/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inventorySlug: selectedInventorySlug,
        teamId: team.id,
        teamUrl: team.href || "",
        teamName: team.name,
        eventId: currentEventNumber(),
        tournamentId: selectedTournamentId,
        searchOnly: true
      })
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const roster = Array.isArray(data?.roster) ? data.roster as Array<Record<string, unknown>> : [];
    const normalized = roster
      .map((row) => ({
        no: String(row?.no || ""),
        name: String(row?.name || ""),
        hometown: String(row?.hometown || team.from || "")
      }))
      .filter((row) => row.name.trim().length > 1);
    teamRosterSearchCacheRef.current.set(team.id, normalized);
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
          ? `Found ${result.length} players. Select players and click Generate My Schedule.`
          : "No player match found. Try another player name."
      );
    } finally {
      setPlayerSearchLoading(false);
    }
  }

  function toggleSmartPlayerSelection(item: SmartPlayerResult) {
    const selectionKey = smartPlayerSelectionKey(item.teamId, item.playerId);
    setDesiredPlayers((prev) => {
      if (prev.some((row) => desiredPlayerSelectionKey(row) === selectionKey)) {
        return prev.filter((row) => desiredPlayerSelectionKey(row) !== selectionKey);
      }
      return [...prev, {
        playerId: item.playerId,
        selectionKey,
        name: item.name,
        team: item.teamName,
        hometown: item.hometown
      }];
    });
    autoPlannerRef.current.key = "";
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Player selection updated. Recommendation is regenerating.");
  }

  async function geocodeForRoute(address: string): Promise<GeoLocation | null> {
    const normalized = normalizeSmartSearch(address);
    if (!normalized) return null;
    if (geocodeCacheRef.current.has(normalized)) {
      return geocodeCacheRef.current.get(normalized) || null;
    }
    try {
      const res = await fetch(`/api/maps/geocode?address=${encodeURIComponent(address)}`, { cache: "no-store" });
      if (!res.ok) {
        geocodeCacheRef.current.set(normalized, null);
        return null;
      }
      const data = await res.json().catch(() => ({}));
      const lat = data?.location?.lat;
      const lng = data?.location?.lng;
      if (typeof lat !== "number" || typeof lng !== "number") {
        geocodeCacheRef.current.set(normalized, null);
        return null;
      }
      const point: GeoLocation = {
        lat,
        lng,
        label: String(data?.location?.label || address)
      };
      geocodeCacheRef.current.set(normalized, point);
      return point;
    } catch {
      geocodeCacheRef.current.set(normalized, null);
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
    return String(teamMatch?.from || player.team || "Tournament Venue").trim();
  }

  async function buildOptimizedCoachPlan(targetPlayers: DesiredPlayer[], preferredSourceText?: string) {
    const grouped = new Map<string, { destination: string; players: DesiredPlayer[]; point: GeoLocation | null }>();
    targetPlayers.forEach((player) => {
      const destination = destinationForPlayer(player);
      const key = normalizeSmartSearch(destination) || normalizeSmartSearch(player.team || "") || player.playerId;
      const existing = grouped.get(key);
      if (existing) {
        existing.players.push(player);
      } else {
        grouped.set(key, { destination, players: [player], point: null });
      }
    });

    const stops = Array.from(grouped.values()).slice(0, 16);
    const geocoded = await Promise.all(stops.map(async (stop) => ({
      ...stop,
      point: await geocodeForRoute(stop.destination)
    })));

    const manualSource = String(preferredSourceText || scheduleForm.flightSource || "").trim();
    const startPoint =
      await detectCoachStartPoint()
      || (manualSource ? await geocodeForRoute(manualSource) : null);

    const unvisited = [...geocoded];
    const ordered: typeof geocoded = [];
    let current = startPoint;
    while (unvisited.length) {
      if (current?.lat != null && current?.lng != null) {
        const currentPoint = current;
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        unvisited.forEach((stop, index) => {
          if (!stop.point) return;
          const km = distanceKm(currentPoint.lat, currentPoint.lng, stop.point.lat, stop.point.lng);
          if (km < bestDistance) {
            bestDistance = km;
            bestIndex = index;
          }
        });
        ordered.push(unvisited.splice(bestIndex, 1)[0]);
      } else {
        ordered.push(unvisited.shift() as (typeof geocoded)[number]);
      }
      const latest = ordered[ordered.length - 1];
      if (latest?.point) current = latest.point;
    }

    const fallbackStartLabel = manualSource || "Current location";
    let cursorMs = Date.now() + 15 * 60 * 1000;
    const travelPlan: PlanItem[] = [];
    let prevLabel = startPoint?.label || fallbackStartLabel;
    let prevPoint = startPoint;
    let blockedReason = "";
    let completedStops = 0;

    for (const [idx, stop] of ordered.entries()) {
      const destinationLabel = stop.point?.label || stop.destination;
      let travelEstimate: TravelEstimate = {
        mode: "Flight + transfer",
        minutes: 11 * 60,
        advisory: "Location data incomplete; flight availability must be checked."
      };

      if (prevPoint?.lat != null && prevPoint?.lng != null && stop.point?.lat != null && stop.point?.lng != null) {
        const km = distanceKm(prevPoint.lat, prevPoint.lng, stop.point.lat, stop.point.lng);
        travelEstimate = travelModeByDistance(km);
      } else {
        travelEstimate = travelModeByText(prevLabel, destinationLabel);
      }

      const departIso = new Date(cursorMs).toISOString();
      const arriveMs = cursorMs + travelEstimate.minutes * 60 * 1000;
      if (travelEstimate.minutes > MAX_FEASIBLE_TRAVEL_MINUTES) {
        const infeasibleDetail = [
          `${travelEstimate.mode} · ETA ${formatEta(travelEstimate.minutes)}`,
          `Not feasible within next ${MAX_FEASIBLE_TRAVEL_HOURS} hours.`,
          travelEstimate.advisory
        ].filter(Boolean).join(" · ");
        travelPlan.push({
          at: departIso,
          title: `Travel ${idx + 1}: ${prevLabel} -> ${destinationLabel}`,
          detail: infeasibleDetail
        });
        blockedReason = `Cannot reach ${destinationLabel} from ${prevLabel} in next ${MAX_FEASIBLE_TRAVEL_HOURS} hours.`;
        break;
      }
      const detail = [
        `${travelEstimate.mode} · ETA ${formatEta(travelEstimate.minutes)}`,
        travelEstimate.advisory
      ].filter(Boolean).join(" · ");

      travelPlan.push({
        at: departIso,
        title: `Travel ${idx + 1}: ${prevLabel} -> ${destinationLabel}`,
        detail
      });

      const airportTransferMinutes = travelEstimate.minutes >= 15 * 60
        ? 75
        : (travelEstimate.minutes >= 6 * 60 ? 45 : 20);
      const transferAtMs = arriveMs + airportTransferMinutes * 60 * 1000;
      travelPlan.push({
        at: new Date(transferAtMs).toISOString(),
        title: `Airport transfer at ${destinationLabel}`,
        detail: airportTransferMinutes >= 45
          ? `Pre-book cab from airport to hotel/venue (~${airportTransferMinutes} min).`
          : `Take local cab/ride-share from airport to venue (~${airportTransferMinutes} min).`
      });

      let scoutAtMs = transferAtMs;
      if (travelEstimate.minutes >= 15 * 60) {
        travelPlan.push({
          at: new Date(transferAtMs).toISOString(),
          title: `Hotel rest window at ${destinationLabel}`,
          detail: "Recommended rest buffer: 2-3 hours before scouting."
        });
        scoutAtMs += 180 * 60 * 1000;
      }

      const playerList = stop.players.map((player) => `${player.name} (${player.team})`).join(", ");
      travelPlan.push({
        at: new Date(scoutAtMs).toISOString(),
        title: `Scout Players at ${destinationLabel}`,
        detail: `Selected players: ${playerList}`
      });
      completedStops += 1;

      cursorMs = scoutAtMs + 30 * 60 * 1000;
      prevLabel = destinationLabel;
      prevPoint = stop.point || null;
    }

    if (!blockedReason && scheduleForm.hotelName.trim()) {
      travelPlan.push({
        at: new Date(cursorMs).toISOString(),
        title: "Return to hotel",
        detail: scheduleForm.hotelName.trim()
      });
    }

    const unresolvedStops = geocoded.filter((stop) => !stop.point).length;
    return {
      plan: travelPlan,
      sourceLabel: startPoint?.label || fallbackStartLabel,
      firstDestination: ordered[0]?.point?.label || ordered[0]?.destination || "",
      usedLiveLocation: Boolean(startPoint),
      unresolvedStops,
      blockedReason,
      completedStops
    };
  }

  async function suggestHotelForDestination(destination: string) {
    const cleanDestination = destination.trim();
    if (!cleanDestination) return "";
    try {
      const res = await fetch(`/api/maps/hotels?destination=${encodeURIComponent(cleanDestination)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const hotels = Array.isArray(data?.hotels) ? data.hotels as HotelSuggestion[] : [];
      if (hotels.length) {
        setHotelSuggestions(hotels);
        return hotels[0]?.name || "";
      }
    } catch {
      // Ignore and use fallback label.
    }
    return `Recommended hotel near ${cleanDestination}`;
  }

  function buildInstantRecommendation(targetPlayers: DesiredPlayer[]): PlanItem[] {
    const now = Date.now() + 10 * 60 * 1000;
    const source = scheduleForm.flightSource.trim() || "Current location";
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

  async function generateScheduleFromSmartPlayers(options?: { keepActiveTab?: boolean; autoRun?: boolean }) {
    if (!desiredPlayers.length) {
      const msg = "Select at least one player, then generate schedule.";
      setPlayerSearchStatus(msg);
      setPlanWorkflowNote(msg);
      return;
    }
    if (isSelectedTournamentPast()) {
      const msg = "The tournament is already over, can't create the schedule.";
      setPlayerSearchStatus(msg);
      setPlanWorkflowNote(msg);
      return;
    }
    if (options?.keepActiveTab !== false) {
      setActiveTab("schedule");
    }
    const instantFlightDestination = scheduleForm.flightDestination || destinationForPlayer(desiredPlayers[0]) || "";
    const instantForm = {
      ...scheduleForm,
      flightDestination: instantFlightDestination
    };
    const instantPlan = buildInstantRecommendation(desiredPlayers);
    setScheduleForm(instantForm);
    setMyGeneratedPlan(instantPlan);
    setAndPersistPlanWorkflowStatus("pending_approval");
    setPlanWorkflowNote("Generating recommendation...");
    setPlayerSearchStatus(`Generating optimized route for ${desiredPlayers.length} selected players...`);
    try {
      const rawSource = scheduleForm.flightSource.trim();
      const preferredSource = rawSource && !/^current location$/i.test(rawSource)
        ? rawSource
        : "";

      const optimized = await buildOptimizedCoachPlan(desiredPlayers, preferredSource);
      if (!optimized.plan.length) {
        const msg = "Live route data is limited right now. Showing instant recommendation preview.";
        setScheduleForm(instantForm);
        setMyGeneratedPlan(instantPlan);
        setAndPersistPlanWorkflowStatus("pending_approval");
        await saveSchedule(instantPlan, desiredPlayers, instantForm);
        setPlayerSearchStatus(msg);
        setPlanWorkflowNote(msg);
        return;
      }

      const destination = (scheduleForm.flightDestination || optimized.firstDestination || "").trim();
      const isFeasible = !optimized.blockedReason;
      const hotelName = isFeasible
        ? (scheduleForm.hotelName.trim() || await suggestHotelForDestination(destination))
        : "";
      const basePlan = isFeasible
        ? withHotelReturnLeg(optimized.plan, hotelName)
        : optimized.plan;
      const quotedPlan = await enrichPlanWithLiveQuotes(basePlan);
      const finalPlan = quotedPlan.plan;

      const nextForm = {
        ...scheduleForm,
        flightSource: optimized.usedLiveLocation ? optimized.sourceLabel : (preferredSource || "Current location"),
        flightDestination: destination,
        flightArrivalTime: scheduleForm.flightArrivalTime || toInputDateTime(finalPlan[0]?.at || new Date().toISOString()),
        hotelName,
        notes: scheduleForm.notes || (
          isFeasible
            ? "Auto-generated coach route with travel + hotel recommendation."
            : ""
        )
      };
      setScheduleForm(nextForm);
      setMyGeneratedPlan(finalPlan);
      if (isFeasible) {
        setAndPersistPlanWorkflowStatus("pending_approval");
        setPlanWorkflowNote(
          options?.autoRun
            ? "Recommendation auto-created. Open booking to approve or modify travel options."
            : "Recommendation created. Open booking to approve or modify travel options."
        );
      } else {
        setAndPersistPlanWorkflowStatus("draft");
        setPlanWorkflowNote(optimized.blockedReason || "Recommendation generated, but this route is not feasible within the next 12 hours.");
      }
      await saveSchedule(finalPlan, desiredPlayers, nextForm);
      if (!isFeasible) {
        setPlayerSearchStatus(
          `Recommendation generated with feasibility warning. ${optimized.blockedReason || "At least one leg is not feasible in the next 12 hours."}${quotedPlan.quoteSummary ? ` ${quotedPlan.quoteSummary}` : ""}`
        );
      } else {
        const locationStatus = optimized.usedLiveLocation
          ? "Current location detected."
          : "Using entered start city.";
        const unresolvedStatus = optimized.unresolvedStops
          ? ` ${optimized.unresolvedStops} destination(s) could not be geocoded; fallback travel estimates were used.`
          : "";
        setPlayerSearchStatus(`Optimized route generated. ${locationStatus}${unresolvedStatus} Hotel recommendation added.${quotedPlan.quoteSummary ? ` ${quotedPlan.quoteSummary}` : ""}`);
      }
    } catch {
      const emergencyPlan: PlanItem[] = instantPlan;
      if (emergencyPlan.length) {
        const fallbackForm = {
          ...instantForm,
          flightSource: instantForm.flightSource || "Current location",
          flightDestination: instantForm.flightDestination || destinationForPlayer(desiredPlayers[0]),
          notes: scheduleForm.notes || "Fallback recommendation generated while map services are unavailable."
        };
        setScheduleForm(fallbackForm);
        setMyGeneratedPlan(emergencyPlan);
        setAndPersistPlanWorkflowStatus("pending_approval");
        setPlanWorkflowNote("Fallback recommendation generated. Open booking to approve or modify options.");
        await saveSchedule(emergencyPlan, desiredPlayers, fallbackForm);
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
        const mode = String(item.detail || "").split("·")[0]?.trim() || "Flight / Bus";
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

  function quoteDetailLine(quote: BookingQuoteResult) {
    if (quote.status === "quoted" || quote.status === "booked") {
      const price = quote.price ? `Price ${quote.price}` : "Price not returned";
      const detail = String(quote.detail || "").trim();
      const provider = quote.provider ? ` via ${quote.provider}` : "";
      return detail
        ? `Live quote${provider}: ${price} · ${detail}`
        : `Live quote${provider}: ${price}`;
    }
    if (quote.status === "failed") {
      return `Live quote unavailable: ${String(quote.detail || "No offer found for this leg.")}`;
    }
    if (quote.status === "skipped") {
      return `Live quote unavailable: ${String(quote.detail || "Flight provider is not configured.")}`;
    }
    return "";
  }

  async function enrichPlanWithLiveQuotes(plan: PlanItem[]) {
    const travelLegs = extractTravelLegsFromPlan(plan);
    if (!travelLegs.length) return { plan, quoteSummary: "" };

    try {
      const fallbackName = String(user?.name || "Coach User").trim();
      const [firstName, ...rest] = fallbackName.split(/\s+/).filter(Boolean);
      const traveler = {
        firstName: firstName || "Coach",
        lastName: rest.join(" ") || "User",
        dateOfBirth: "1990-01-01",
        gender: (user?.gender || "UNSPECIFIED") as "MALE" | "FEMALE" | "UNSPECIFIED",
        email: String(user?.email || ""),
        phone: String(user?.phone || "9999999999"),
        countryCallingCode: String(user?.countryCallingCode || "1"),
        nationality: "US"
      };

      const quoteRes = await fetch("/api/bookings/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteOnly: true,
          teamName: "",
          tournamentName: selectedTournament?.name || "",
          traveler,
          travelLegs
        })
      });
      if (!quoteRes.ok) {
        return { plan, quoteSummary: "Live quote provider unavailable right now. Showing route estimate." };
      }
      const quoteData = await quoteRes.json().catch(() => ({}));
      const results = Array.isArray(quoteData?.results) ? quoteData.results as BookingQuoteResult[] : [];
      if (!results.length) {
        return { plan, quoteSummary: "No live quotes returned. Showing route estimate." };
      }

      let travelIdx = 0;
      const nextPlan = plan.map((item) => {
        if (!/^travel\s+\d+:/i.test(String(item.title || ""))) return item;
        const quote = results[travelIdx++];
        if (!quote) return item;
        const line = quoteDetailLine(quote);
        if (!line) return item;
        return {
          ...item,
          detail: `${item.detail} · ${line}`
        };
      });

      const quoted = results.filter((item) => item.status === "quoted" || item.status === "booked").length;
      const failed = results.filter((item) => item.status === "failed").length;
      if (quoted > 0) {
        return { plan: nextPlan, quoteSummary: `Live quote check complete: ${quoted} leg(s) priced${failed ? `, ${failed} leg(s) unavailable` : ""}.` };
      }
      return { plan: nextPlan, quoteSummary: "Live quote check complete. Flight provider did not return a bookable fare for selected legs." };
    } catch {
      return { plan, quoteSummary: "Live quote check failed. Showing route estimate." };
    }
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
      const url = `/bookings/review?returnTo=${encodeURIComponent("/bird-dog?tab=schedule")}`;
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

  async function useUnlockedTournament(item: InventoryTournament) {
    setOpenError("");
    setOpeningSlug(item.slug);
    setSelectedInventorySlug(item.slug);
    setCompany(item.company);
    setJobHint(item.name);
    try {
      const targetTournamentId = await resolveTournamentIdForItem(item);
      const payload = {
        company: item.company,
        inventorySlug: item.slug,
        tournamentHint: item.harvestHint || item.name,
        tournamentId: targetTournamentId || undefined
      };
      const attemptOpen = () =>
        fetch("/api/harvest/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      let liveOpen = await attemptOpen();
      if (liveOpen.status === 401) {
        const sessionCheck = await fetch("/api/session/me", { cache: "no-store" });
        if (!sessionCheck.ok) {
          setOpenError("Session expired. Please sign in again.");
          router.replace("/login");
          return;
        }
        liveOpen = await attemptOpen();
      }
      if (!liveOpen.ok) {
        const data = await liveOpen.json().catch(() => ({}));
        const detailText = typeof data?.detail === "string" ? data.detail : "";
        const missingSupabaseConfig = liveOpen.status === 503
          && /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/i.test(detailText);
        if (missingSupabaseConfig) {
          const openedFromLocal = await openTournamentFromExistingData(item, targetTournamentId || undefined);
          if (openedFromLocal) {
            setOpenError("");
            return;
          }
        }
        if (liveOpen.status === 409 && item.company === "PG") {
          await queueHarvestJob(item.slug, item.harvestHint || item.name, item.company).catch(() => undefined);
          setOpenError("Details are not yet available for this tournament. They will appear here once the upload is complete. Please tap Refresh in a few seconds.");
          return;
        }
        const detail = typeof data?.detail === "string" && data.detail ? ` (${data.detail})` : "";
        if (liveOpen.status === 401) {
          throw new Error(`Session verification failed. Please sign in again.${detail}`);
        }
        throw new Error(data?.error ? `${data.error}${detail}` : `Unable to load tournament details (${liveOpen.status}).${detail}`);
      }
      const data = await liveOpen.json();
      const openedTournament = data?.tournament as Tournament | undefined;
      if (!openedTournament) {
        throw new Error("Tournament data was empty.");
      }
      applyOpenedTournament(openedTournament);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Failed to open tournament.");
      await queueHarvestJob(item.slug, item.harvestHint || item.name, item.company).catch(() => undefined);
      await loadCompanyData(item.company, true);
    } finally {
      setOpeningSlug("");
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

  function loadCachedTournament() {
    if (!user) return;
    const raw = safeLocalGet(`${CACHE_KEY}:${user.orgId}`);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { company: "PG" | "PBR"; tournament: Tournament };
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
    setDesiredPlayers((prev) => {
      if (prev.some((item) => item.playerId === desiredPlayerId || desiredPlayerSelectionKey(item) === selectionKey)) return prev;
      return [...prev, { playerId: desiredPlayerId, selectionKey, name: match.name, team: match.school || "Unknown Team" }];
    });
    autoPlannerRef.current.key = "";
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Target player updated. Recommendation is regenerating.");
  }

  function removeDesiredPlayer(selectionKey: string) {
    setDesiredPlayers((prev) => prev.filter((item) => desiredPlayerSelectionKey(item) !== selectionKey));
    autoPlannerRef.current.key = "";
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Target player removed. Recommendation is regenerating.");
  }

  function persistTeamRosterCart(next: DesiredPlayer[]) {
    setTeamRosterCartPlayers(next);
    writeRosterCartStorage(teamRosterCartStorageKey, next);
  }

  function removeTeamRosterCartPlayer(selectionKey: string) {
    persistTeamRosterCart(
      teamRosterCartPlayers.filter((item) => desiredPlayerSelectionKey(item) !== selectionKey)
    );
    setDesiredPlayers((prev) => prev.filter((item) => desiredPlayerSelectionKey(item) !== selectionKey));
    autoPlannerRef.current.key = "";
    setAndPersistPlanWorkflowStatus("draft");
  }

  function clearTeamRosterCart() {
    persistTeamRosterCart([]);
    setDesiredPlayers((prev) =>
      prev.filter((item) => !String(desiredPlayerSelectionKey(item)).startsWith("team:"))
    );
    autoPlannerRef.current.key = "";
    setAndPersistPlanWorkflowStatus("draft");
    setPlanWorkflowNote("Cross-team roster cart cleared.");
  }

  function useTeamRosterCartForSchedule(mode: "replace" | "merge" = "replace") {
    if (!teamRosterCartPlayers.length) {
      setPlanWorkflowNote("Roster cart is empty. Add players from team rosters first.");
      return;
    }

    setDesiredPlayers((prev) => {
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
    const query = teamsSearchQuery.trim().toLowerCase();
    const teams = selectedTournament?.teams || [];
    if (!query) return teams;
    return teams.filter((team) => team.name.toLowerCase().includes(query));
  }, [selectedTournament?.teams, teamsSearchQuery]);
  const filteredTournamentInventory = useMemo(() => {
    const query = tournamentSearchQuery.trim().toLowerCase();
    if (!query) return displayInventory;
    return displayInventory.filter((item) => item.name.toLowerCase().includes(query));
  }, [displayInventory, tournamentSearchQuery]);
  const desiredPlayerIdSet = useMemo(
    () => new Set(desiredPlayers.map((item) => desiredPlayerSelectionKey(item))),
    [desiredPlayers]
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
  const mySharedNotes = useMemo(
    () => user ? (coachSharedNotesByUser.get(user.userId) || []) : [],
    [coachSharedNotesByUser, user]
  );
  const myBestPlayers = useMemo(() => {
    const source = desiredPlayers.length ? desiredPlayers : (myCoachSchedule?.desired_players || []);
    const deduped = new Map<string, DesiredPlayer>();
    source.forEach((item) => {
      deduped.set(desiredPlayerSelectionKey(item), item);
    });
    return Array.from(deduped.values());
  }, [desiredPlayers, myCoachSchedule?.desired_players]);
  const viewingScheduleSharedNotes = useMemo(
    () => viewingSchedule ? (coachSharedNotesByUser.get(viewingSchedule.user_id) || []) : [],
    [coachSharedNotesByUser, viewingSchedule]
  );
  const viewingScheduleMeetSuggestion = useMemo(() => {
    if (!viewingSchedule || viewingSchedule.user_id === user?.userId) return null;
    return coachMeetSuggestionById.get(viewingSchedule.id) || null;
  }, [coachMeetSuggestionById, user?.userId, viewingSchedule]);
  const showTournaments = activeTab === "tournaments";
  const showSchedule = activeTab === "schedule";
  const showNotes = activeTab === "notes";
  const showBestPlayers = activeTab === "bestPlayers";
  const showProfile = activeTab === "profile";

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
    if (!viewingSchedule) return;
    if (!shareableSchedules.some((item) => item.id === viewingSchedule.id)) {
      setViewingSchedule(null);
    }
  }, [shareableSchedules, viewingSchedule]);
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
  const canGoBackInApp = Boolean(viewingSchedule) || !showTournaments;
  function goToTournamentDashboard() {
    setActiveTab("tournaments");
    setMenuOpen(false);
    void fetchInventory();
  }
  function goBackInApp() {
    if (viewingSchedule) {
      setViewingSchedule(null);
      return;
    }
    if (showNotes || showSchedule || showBestPlayers || showProfile) {
      goToTournamentDashboard();
      return;
    }
    goToTournamentDashboard();
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
      className="bd-root"
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
                <img src="/branding/a-point-scout-icon.svg" alt="APOINT SCOUT" />
                <div className="menu-brand-copy">
                  <p>APOINT SCOUT</p>
                  <p>{orgDisplayName}</p>
                </div>
              </div>
              <button
                type="button"
                className={activeTab === "tournaments" ? "active" : ""}
                onClick={() => {
                  setActiveTab("tournaments");
                  setMenuOpen(false);
                }}
              >
                Tournament Dashboard
              </button>
              <button
                type="button"
                className={activeTab === "schedule" ? "active" : ""}
                onClick={() => {
                  setActiveTab("schedule");
                  setMenuOpen(false);
                  void fetchSchedules();
                }}
              >
                Schedules
              </button>
              <button
                type="button"
                className={activeTab === "bestPlayers" ? "active" : ""}
                onClick={() => {
                  setActiveTab("bestPlayers");
                  setMenuOpen(false);
                }}
              >
                My Players
              </button>
              <button
                type="button"
                className={activeTab === "profile" ? "active" : ""}
                onClick={() => {
                  setActiveTab("profile");
                  setMenuOpen(false);
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

      {showSchedule ? (
      <section className="panel">
        <div>
          <h2>Schedules Dashboard</h2>
          <p className="muted">Tournament: {selectedTournament?.name || tournamentViewTitle || "Select tournament from dashboard"}</p>
          {shareableSchedules.length ? (
            <>
              <div className="table-wrap">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>Coach Name</th>
                      <th>Email</th>
                      <th>Schedule</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shareableSchedules.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.coach_name}
                          {item.user_id === user?.userId ? " (You)" : ""}
                        </td>
                        <td>{item.coach_email || "-"}</td>
                        <td>
                          {item.generated_plan?.length
                            ? `${item.generated_plan.length} recommendation step(s)`
                            : "No schedule generated yet"}
                        </td>
                        <td>
                          <div className="row wrap">
                            <button className="secondary" onClick={() => openScheduleView(item, "schedule")}>View Schedule</button>
                            <button className="secondary" onClick={() => openScheduleView(item, "notes")}>View Notes</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="muted">No schedules available right now.</p>
          )}
        </div>
      </section>
      ) : null}

      {viewingSchedule ? (
        <section className="panel">
          <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h2>
              {viewingSchedule.coach_name} - {viewingPanelMode === "notes" ? "Favorite Player Notes" : "Schedule"}
            </h2>
            <button className="secondary" onClick={() => setViewingSchedule(null)}>Close</button>
          </div>
          <p>{viewingSchedule.flight_source || "-"} {"->"} {viewingSchedule.flight_destination || "-"}</p>
          <p>{viewingSchedule.flight_arrival_time ? new Date(viewingSchedule.flight_arrival_time).toLocaleString() : "No arrival time"}</p>
          <p>Hotel: {viewingSchedule.hotel_name || "-"}</p>
          {viewingScheduleMeetSuggestion ? (
            <p className="muted">
              Meet point: {viewingScheduleMeetSuggestion.label} · {viewingScheduleMeetSuggestion.detail}
            </p>
          ) : null}
          {viewingPanelMode === "schedule" ? (
            <>
              {viewingSchedule.notes && !/^auto-generated/i.test(viewingSchedule.notes.trim()) ? (
                <p>{viewingSchedule.notes}</p>
              ) : null}
              {viewingSchedule.desired_players?.length ? (
                <p>
                  <strong>Targets:</strong> {viewingSchedule.desired_players.map((p) => `${p.name} (${p.team})`).join(", ")}
                </p>
              ) : null}
              {viewingSchedule.generated_plan?.length ? (
                <div className="log-list" style={{ maxHeight: 220 }}>
                  {viewingSchedule.generated_plan.map((plan, idx) => (
                    <article key={`${plan.at}-${idx}`} className="log-card">
                      <p><strong>{dateLabel(plan.at)} {timeLabel(plan.at)} - {plan.title}</strong></p>
                      <p>{plan.detail}</p>
                    </article>
                  ))}
                </div>
              ) : null}
              <div className="row wrap">
                <button className="secondary" onClick={() => void startMapForSchedule(viewingSchedule)}>Start Map</button>
                <button className="secondary" onClick={() => setViewingPanelMode("notes")}>View Notes</button>
                {viewingSchedule.user_id === user?.userId ? (
                  <button className="secondary" onClick={() => editSchedule(viewingSchedule)}>Edit</button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              {viewingSchedule.desired_players?.length ? (
                <p>
                  <strong>Favorite players:</strong> {viewingSchedule.desired_players.map((p) => `${p.name} (${p.team})`).join(", ")}
                </p>
              ) : (
                <p className="muted">No favorite players selected for this coach yet.</p>
              )}
              {viewingSchedule.notes && !/^auto-generated/i.test(viewingSchedule.notes.trim()) ? (
                <p><strong>Coach note:</strong> {viewingSchedule.notes}</p>
              ) : null}
              {coachSharedNotesLoading ? <p className="muted">Loading coach notes...</p> : null}
              {viewingScheduleSharedNotes.length ? (
                <div className="log-list" style={{ maxHeight: 260 }}>
                  {viewingScheduleSharedNotes.map((note) => (
                    <article key={note.id} className="log-card">
                      <p>
                        <strong>{note.observed_at ? new Date(note.observed_at).toLocaleString() : "Observed note"}</strong>
                      </p>
                      <p>{note.transcript || "No text transcript."}</p>
                      {note.audio_url ? <audio controls preload="none" src={note.audio_url} style={{ width: "100%" }} /> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No notes for favorite players yet.</p>
              )}
              <div className="row wrap">
                <button className="secondary" onClick={() => setViewingPanelMode("schedule")}>View Schedule</button>
              </div>
            </>
          )}
        </section>
      ) : null}

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
              University Email
              <input
                type="email"
                value={profileForm.universityEmail}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, universityEmail: e.target.value }))}
                placeholder="name@university.edu"
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

      {showBestPlayers ? (
      <section className="panel">
        <h2>My Players</h2>
        <p className="muted">Tournament: {selectedTournament?.name || tournamentViewTitle || "Select tournament from dashboard"}</p>
        {myBestPlayers.length ? (
          <div className="log-list" style={{ maxHeight: 520 }}>
            {myBestPlayers.map((player) => {
              const notesForPlayer = mySharedNotes.filter((note) => coachNoteMatchesPlayer(note, player));
              const audioCount = notesForPlayer.filter((note) => Boolean(note.audio_url)).length;
              const team = (selectedTournament?.teams || []).find((item) => {
                const left = normalizeSmartSearch(item.name);
                const right = normalizeSmartSearch(player.team);
                return left === right || left.includes(right) || right.includes(left);
              }) || null;
              const selectionKey = desiredPlayerSelectionKey(player);
              const noteTarget: InlineTeamNoteTarget = team
                ? inlineTeamNoteTargetFromInput({ team, player })
                : {
                  teamId: `player:${selectionKey}`,
                  teamName: player.team || "Unknown Team",
                  playerId: player.playerId,
                  playerName: player.name,
                  selectionKey
                };
              const noteKey = inlineTeamNoteKey(noteTarget);
              const noteDraft = inlineTeamNoteDrafts[noteKey] || readInlineTeamNoteDraft(noteTarget);
              const noteStatus = inlineTeamNoteStatuses[noteKey] || "";
              const recordingOnThisCard = inlineTeamNoteRecorderState === "recording" && inlineTeamNoteRecordingKey === noteKey;
              const recordingOtherCard = inlineTeamNoteRecorderState === "recording" && inlineTeamNoteRecordingKey !== noteKey;
              return (
                <article key={selectionKey} className="log-card">
                  <p><strong>{player.name}</strong></p>
                  <p>Location: {player.hometown || "Unknown"}</p>
                  <p>Team: {player.team}</p>
                  <p>Tournament: {selectedTournament?.name || tournamentViewTitle || "Not selected"}</p>
                  <p>Notes: {notesForPlayer.length} · Audio clips: {audioCount}</p>
                  <label style={{ display: "block", marginTop: 8 }}>
                    Note for {player.name}
                    <textarea
                      rows={3}
                      value={noteDraft.text}
                      onFocus={() => openInlineTeamNote(noteTarget)}
                      onChange={(event) => {
                        updateInlineTeamNoteDraft(noteTarget, { text: event.target.value, updatedAt: new Date().toISOString() });
                        updateInlineTeamNoteStatus(noteTarget, "");
                      }}
                      placeholder="Tap Speak and talk, or type your player note here."
                    />
                  </label>
                  <div className="row wrap">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        if (recordingOnThisCard) {
                          void stopInlineTeamNoteRecording();
                        } else {
                          void startInlineTeamNoteRecording(noteTarget);
                        }
                      }}
                      disabled={recordingOtherCard}
                    >
                      {recordingOnThisCard ? "Stop" : "Speak"}
                    </button>
                    <button type="button" onClick={() => saveInlineTeamNote(noteTarget)}>
                      Save
                    </button>
                    {myCoachSchedule ? (
                      <button className="secondary" type="button" onClick={() => openScheduleView(myCoachSchedule, "notes")}>
                        View My Coach Notes
                      </button>
                    ) : null}
                  </div>
                  {noteDraft.audioUrl ? (
                    <audio controls preload="none" src={noteDraft.audioUrl} style={{ width: "100%", marginTop: 8 }} />
                  ) : null}
                  {noteStatus ? <p className="muted" style={{ marginTop: 8 }}>{noteStatus}</p> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="muted">No players selected yet.</p>
        )}
        <div className="row wrap">
          <button className="secondary" type="button" onClick={() => setActiveTab("notes")}>
            Go To Tournament Roster
          </button>
          <button className="secondary" type="button" onClick={() => setActiveTab("schedule")}>
            Go To My Schedule
          </button>
        </div>
      </section>
      ) : null}

      {showTournaments ? (
      <section className="panel">
        <h2>Tournament Dashboard</h2>
        {inventoryRefreshing ? <p className="muted small">Syncing latest data from Perfect Game...</p> : null}
        {openError ? <p className="muted">{openError}</p> : null}
        <label style={{ display: "block", maxWidth: 420, marginTop: 8 }}>
          Search Tournament
          <input
            value={tournamentSearchQuery}
            onChange={(e) => setTournamentSearchQuery(e.target.value)}
            placeholder="Search by tournament name"
            style={{ fontSize: 14 }}
          />
        </label>
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
                  void useUnlockedTournament(item);
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
          }) : <p className="muted">No tournaments matched your search.</p>}
        </div>
      </section>
      ) : null}

      {showNotes ? (
      <section className="panel" id="teams-roster-section">
        <div style={{ width: "100%" }}>
          <h2>Participating Teams</h2>
          <p className="muted">Teams in tournament: {selectedTournament?.teams?.length || 0}</p>
          <div className="row wrap" style={{ marginBottom: 8 }}>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                const rows = (selectedTournament?.teams || []).map((team) => [
                  team.name,
                  team.from || "-",
                  team.record || "-"
                ]);
                downloadPdfLikeReport(
                  `Participating Teams - ${selectedTournament?.name || "Tournament"}`,
                  ["Team", "From", "Record"],
                  rows
                );
              }}
            >
              Download Teams PDF
            </button>
          </div>
          <label>
            Search Participating Teams
            <input
              value={teamsSearchQuery}
              onChange={(e) => setTeamsSearchQuery(e.target.value)}
              placeholder="Search by team name"
            />
          </label>
          <div className="panel" style={{ marginTop: 10 }}>
            <h3 style={{ marginTop: 0 }}>Coach Player Search (Tournament-Wide)</h3>
            <p className="muted" style={{ marginTop: 4 }}>
              Search player name only. Select players and generate schedule from this same page.
            </p>
            <div className="row wrap" style={{ alignItems: "end" }}>
              <label style={{ flex: "0 1 560px", minWidth: 300 }}>
                Search Players
                <input
                  value={playerSearchQuery}
                  onChange={(e) => {
                    setPlayerSearchQuery(e.target.value);
                    setPlayerSearchCanDeepScan(false);
                  }}
                  placeholder="Example: max johnson"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runTournamentPlayerSearch();
                    }
                  }}
                />
              </label>
              <button
                className="secondary"
                type="button"
                onClick={() => void runTournamentPlayerSearch()}
                disabled={playerSearchLoading}
              >
                {playerSearchLoading ? "Searching..." : "Search Players"}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => void runTournamentPlayerSearch(true)}
                disabled={playerSearchLoading || !playerSearchCanDeepScan}
              >
                {playerSearchLoading && playerSearchCanDeepScan ? "Deep Scanning..." : "Run Deep Scan"}
              </button>
              <button
                type="button"
                onClick={() => void generateScheduleFromSmartPlayers()}
                disabled={!desiredPlayers.length}
              >
                Generate My Schedule
              </button>
            </div>
            <div className="row wrap" style={{ alignItems: "center", marginTop: 8 }}>
              <p className="muted" style={{ margin: 0 }}>
                Cart players from team rosters: {teamRosterCartPlayers.length}
              </p>
              <button
                className="secondary"
                type="button"
                onClick={() => useTeamRosterCartForSchedule("merge")}
                disabled={!teamRosterCartPlayers.length}
              >
                Merge Cart Into Current Selection
              </button>
              <button
                className="secondary"
                type="button"
                onClick={clearTeamRosterCart}
                disabled={!teamRosterCartPlayers.length}
              >
                Clear Cart
              </button>
            </div>
            {playerSearchStatus ? <p className="muted" style={{ marginTop: 8 }}>{playerSearchStatus}</p> : null}
            {playerSearchResults.length ? (
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Player</th>
                      <th>Team</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerSearchResults.map((item) => (
                      <tr key={item.key}>
                        <td>
                          <input
                            type="checkbox"
                            checked={desiredPlayerIdSet.has(smartPlayerSelectionKey(item.teamId, item.playerId))}
                            onChange={() => toggleSmartPlayerSelection(item)}
                          />
                        </td>
                        <td>{item.name}</td>
                        <td>{item.teamName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {desiredPlayers.length ? (
              <div style={{ marginTop: 8 }}>
                <p className="muted" style={{ marginTop: 0 }}>Selected players: {desiredPlayers.length}</p>
                <div className="table-wrap" style={{ marginTop: 6 }}>
                  <table className="roster-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Team</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {desiredPlayers.map((player) => (
                        <tr key={desiredPlayerSelectionKey(player)}>
                          <td>{player.name}</td>
                          <td>{player.team}</td>
                          <td className="action-cell">
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => removeDesiredPlayer(desiredPlayerSelectionKey(player))}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted" style={{ marginTop: 6 }}>Remove players here to finalize your selection before generating schedule.</p>
              </div>
            ) : null}
          </div>
          {selectedTournament?.teams?.length ? (
            <div className="table-wrap" style={{ marginBottom: 12 }}>
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>From</th>
                    <th>Record</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTeams.map((team) => (
                    <tr key={team.id} style={{ cursor: "pointer" }} onClick={() => viewTeamScheduleAndRoster(team)}>
                      <td>{team.name}</td>
                      <td>{team.from || "-"}</td>
                      <td>{team.record || "-"}</td>
                      <td className="action-cell">
                        <button className="secondary" type="button" onClick={(e) => { e.stopPropagation(); viewTeamScheduleAndRoster(team); }}>
                          View Schedule + Roster
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Participating teams appear after full tournament ingest.</p>}
        </div>
      </section>
      ) : null}

    </main>
  );
}
