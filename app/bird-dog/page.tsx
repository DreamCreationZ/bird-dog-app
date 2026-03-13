"use client";

import { TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrgByEmail } from "@/lib/birddog/mockData";
import { Game, ItineraryStop, Player, PulseEvent, ScoutNote, SessionUser, Tournament } from "@/lib/birddog/types";

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

type DesiredPlayer = {
  playerId: string;
  name: string;
  team: string;
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

type PlaceSuggestion = {
  label: string;
  placeId: string;
};

type HotelSuggestion = {
  name: string;
  address: string;
  placeId: string;
};

type OptimizedStop = ItineraryStop & {
  gameStartAt: string;
  gameEndAt: string;
  arrivalAt: string;
  coveredPlayerIds: string[];
  lateByMinutes: number;
};

const CACHE_KEY = "bird_dog_tournament_cache";
const PREVIEW_UNLOCK_ALL = process.env.NEXT_PUBLIC_BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";
const THEME_KEY = "bird_dog_theme";

type ThemePreset = {
  id: string;
  label: string;
  primary: string;
  accent: string;
  bg: string;
  panel: string;
  ink: string;
  line: string;
};

const THEME_PRESETS: ThemePreset[] = [
  { id: "field", label: "Field", primary: "#1f3a5f", accent: "#d7a316", bg: "#f3f0e7", panel: "#fffdf8", ink: "#0f0f0f", line: "#d8d2c4" },
  { id: "mint", label: "Mint", primary: "#0f4f4f", accent: "#2ca77f", bg: "#eef7f3", panel: "#fcfffd", ink: "#0f1f1c", line: "#c8ddd4" },
  { id: "sunset", label: "Sunset", primary: "#5a2f1f", accent: "#e17f32", bg: "#f8efe8", panel: "#fffaf6", ink: "#1d130f", line: "#ddc9ba" },
  { id: "night", label: "Night", primary: "#1d2f5e", accent: "#6aa8ff", bg: "#eef2fb", panel: "#f9fbff", ink: "#101621", line: "#ccd7ef" }
];

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

function toRadians(value: number) {
  return (value * Math.PI) / 180;
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

function tournamentIconByName(name: string) {
  const low = name.toLowerCase();
  if (low.includes("wwba")) return "https://0ebf220f63c8a281d66e-20abd5688b9423eda60643010803535a.ssl.cf1.rackcdn.com/GroupeEventLogo_wwba_national_event_page_logo.png";
  if (low.includes("regional")) return "https://0ebf220f63c8a281d66e-20abd5688b9423eda60643010803535a.ssl.cf1.rackcdn.com/GroupeEventLogo_wwba_regional_event_page_logo.png";
  if (low.includes("world")) return "https://0ebf220f63c8a281d66e-20abd5688b9423eda60643010803535a.ssl.cf1.rackcdn.com/GroupeEventLogo_PG%20National%20World%20Series.png";
  if (low.includes("showcase")) return "https://0ebf220f63c8a281d66e-20abd5688b9423eda60643010803535a.ssl.cf1.rackcdn.com/GroupEventLogo_PG_SHOWCASE_LOGO.png";
  if (low.includes("elite")) return "https://0ebf220f63c8a281d66e-20abd5688b9423eda60643010803535a.ssl.cf1.rackcdn.com/GroupEventLogo_necMk2.png";
  if (low.includes("select")) return "https://0ebf220f63c8a281d66e-20abd5688b9423eda60643010803535a.ssl.cf1.rackcdn.com/GroupEventLogo_nscmk2.png";
  return "https://0ebf220f63c8a281d66e-20abd5688b9423eda60643010803535a.ssl.cf1.rackcdn.com/GroupEventLogo_PG_LOGO_EVENT.png";
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

export default function BirdDogPage() {
  const router = useRouter();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const brand = useMemo(() => getOrgByEmail(user?.email || ""), [user?.email]);
  const [themeId, setThemeId] = useState("field");
  const activeTheme = useMemo(
    () => THEME_PRESETS.find((theme) => theme.id === themeId) || THEME_PRESETS[0],
    [themeId]
  );

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
  const [activeTab, setActiveTab] = useState<"tournaments" | "schedule" | "notes">("tournaments");
  const [menuOpen, setMenuOpen] = useState(false);

  const [schedules, setSchedules] = useState<CoachSchedule[]>([]);
  const [viewingSchedule, setViewingSchedule] = useState<CoachSchedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    flightSource: "",
    flightDestination: "",
    flightArrivalTime: "",
    hotelName: "",
    notes: ""
  });
  const [sourceSuggestions, setSourceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceSuggestion[]>([]);
  const [hotelSuggestions, setHotelSuggestions] = useState<HotelSuggestion[]>([]);
  const [selectedTeamName, setSelectedTeamName] = useState("");
  const [desiredPlayers, setDesiredPlayers] = useState<DesiredPlayer[]>([]);
  const [desiredPlayerId, setDesiredPlayerId] = useState("");
  const [myGeneratedPlan, setMyGeneratedPlan] = useState<PlanItem[]>([]);

  const selectedTournament = useMemo(
    () => tournaments.find((t) => t.id === selectedTournamentId) || null,
    [tournaments, selectedTournamentId]
  );
  const selectedInventory = useMemo(
    () => inventory.find((item) => item.slug === selectedInventorySlug) || null,
    [inventory, selectedInventorySlug]
  );
  const canAccessLockedPages = PREVIEW_UNLOCK_ALL || Boolean(selectedInventory && !selectedInventory.locked);

  const games = selectedTournament?.games || [];
  const players = useMemo(() => uniquePlayers(games), [games]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const [watchlist, setWatchlist] = useState<string[]>([]);
  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);

  const [notes, setNotes] = useState<ScoutNote[]>([]);
  const [pulses, setPulses] = useState<PulseEvent[]>([]);

  const [selectedGameId, setSelectedGameId] = useState("");
  const [pulseMessage, setPulseMessage] = useState("Pitcher change");

  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [transcript, setTranscript] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [tournamentViewTitle, setTournamentViewTitle] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const pullStartYRef = useRef<number | null>(null);
  const pullTriggeredRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    async function loadSession() {
      const res = await fetch("/api/session/me");
      if (!res.ok) {
        router.replace("/login");
        return;
      }
      const data = await res.json();
      if (!mounted) return;
      setUser(data.user);
      setAuthLoading(false);
    }

    void loadSession();
    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
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
      const res = await fetch("/api/harvest");
      if (!res.ok) return;
      const data = await res.json();
      if (!mounted) return;
      setCompanies(data.companies || ["PG", "PBR"]);
      await loadCompanyData("PG");
      await fetchJobs();
      await fetchInventory();
      await fetchSchedules();
    }
    void boot();
    return () => {
      mounted = false;
    };
  }, [user]);

  useEffect(() => {
    const ctor = (window as unknown as { SpeechRecognition?: BrowserSpeechConstructor; webkitSpeechRecognition?: BrowserSpeechConstructor }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: BrowserSpeechConstructor }).webkitSpeechRecognition;
    setSpeechSupported(Boolean(ctor));
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
    const firstTeam = selectedTournament?.teams?.[0]?.name || "";
    setSelectedTeamName(firstTeam);
  }, [selectedTournament?.id, selectedTournament?.teams]);

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
    const rawTheme = localStorage.getItem(`${THEME_KEY}:${user.orgId}:${user.userId}`) || localStorage.getItem(THEME_KEY);
    const rawWatch = localStorage.getItem(makeOrgKey(user.orgId, user.userId, "watchlist"));
    const rawNotes = localStorage.getItem(makeOrgKey(user.orgId, user.userId, "notes"));
    const rawPulses = localStorage.getItem(makeOrgKey(user.orgId, user.userId, "pulses"));
    const rawSync = localStorage.getItem(makeOrgKey(user.orgId, user.userId, "lastSyncAt"));

    if (rawTheme && THEME_PRESETS.some((theme) => theme.id === rawTheme)) {
      setThemeId(rawTheme);
    }
    setWatchlist(rawWatch ? JSON.parse(rawWatch) : []);
    setNotes(rawNotes ? JSON.parse(rawNotes) : []);
    setPulses(rawPulses ? JSON.parse(rawPulses) : []);
    setLastSyncAt(rawSync || null);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    localStorage.setItem(`${THEME_KEY}:${user.orgId}:${user.userId}`, themeId);
    localStorage.setItem(THEME_KEY, themeId);
  }, [user, themeId]);

  useEffect(() => {
    if (!user) return;
    localStorage.setItem(makeOrgKey(user.orgId, user.userId, "watchlist"), JSON.stringify(watchlist));
  }, [user, watchlist]);

  useEffect(() => {
    if (!user) return;
    localStorage.setItem(makeOrgKey(user.orgId, user.userId, "notes"), JSON.stringify(notes));
  }, [user, notes]);

  useEffect(() => {
    if (!user) return;
    localStorage.setItem(makeOrgKey(user.orgId, user.userId, "pulses"), JSON.stringify(pulses));
  }, [user, pulses]);

  useEffect(() => {
    if (!online || !user) return;
    const id = window.setInterval(() => {
      void syncNow();
    }, 15000);
    return () => window.clearInterval(id);
  }, [online, user, notes, pulses, syncing]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      void fetchInventory();
      setActiveTab("tournaments");
    }
  }, []);

  async function loadCompanyData(nextCompany: "PG" | "PBR") {
    setLoadingHarvest(true);
    try {
      const res = await fetch(`/api/harvest?company=${nextCompany}`);
      if (!res.ok) return;
      const data = await res.json();
      const nextTournaments: Tournament[] = data?.dataset?.tournaments || [];
      setCompany(nextCompany);
      setTournaments(nextTournaments);
      setSelectedTournamentId(nextTournaments[0]?.id || "");
      if (nextTournaments[0]?.id) {
        await loadTournamentDetails(nextCompany, nextTournaments[0].id);
      } else {
        setSelectedGameId("");
      }
    } finally {
      setLoadingHarvest(false);
    }
  }

  async function loadTournamentDetails(nextCompany: "PG" | "PBR", nextTournamentId: string) {
    const res = await fetch(`/api/harvest?company=${nextCompany}&tournamentId=${nextTournamentId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.tournament) return;

    setTournaments((prev) => prev.map((item) => (item.id === nextTournamentId ? data.tournament : item)));
    setSelectedTournamentId(nextTournamentId);
    setSelectedGameId(data.tournament.games?.[0]?.id || "");
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
    const res = await fetch("/api/inventory");
    if (!res.ok) return [] as InventoryTournament[];
    const data = await res.json();
    const nextInventory: InventoryTournament[] = data.inventory || [];
    setSubscribed(Boolean(data.subscribed));
    setInventory(nextInventory);
    return nextInventory;
  }

  async function refreshTournamentByInventory(item: InventoryTournament) {
    const harvestHint = item.harvestHint || item.name;
    const liveOpen = await fetch("/api/harvest/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: item.company,
        inventorySlug: item.slug,
        tournamentHint: harvestHint
      })
    });
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
      if (selectedItem.locked && !PREVIEW_UNLOCK_ALL) return;
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
    const id = window.setInterval(tick, 90000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [online, user, activeTab, selectedInventorySlug]);

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

  function hydrateMySchedule(data: CoachSchedule[]) {
    const mine = data.find((item) => item.user_id === user?.userId);
    if (!mine) return;

    setScheduleForm({
      flightSource: mine.flight_source || "",
      flightDestination: mine.flight_destination || "",
      flightArrivalTime: toInputDateTime(mine.flight_arrival_time),
      hotelName: mine.hotel_name || "",
      notes: mine.notes || ""
    });
    setDesiredPlayers(mine.desired_players || []);
    setMyGeneratedPlan(mine.generated_plan || []);
  }

  async function fetchSchedules() {
    const res = await fetch("/api/schedules");
    if (!res.ok) return;
    const data = await res.json();
    const scheduleList: CoachSchedule[] = data.schedules || [];
    setSchedules(scheduleList);
    hydrateMySchedule(scheduleList);
  }

  function createGeneratedPlan(): PlanItem[] {
    const plan: PlanItem[] = [];
    const targetIds = desiredPlayers.length ? new Set(desiredPlayers.map((item) => item.playerId)) : watchlistSet;

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

  async function saveSchedule(generatedPlan?: PlanItem[]) {
    const normalizedFlightArrival = scheduleForm.flightArrivalTime
      ? localInputToOffsetIso(scheduleForm.flightArrivalTime)
      : "";
    const payload = {
      ...scheduleForm,
      flightArrivalTime: normalizedFlightArrival,
      desiredPlayers,
      generatedPlan: generatedPlan ?? myGeneratedPlan
    };

    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return;

    const data = await res.json();
    const scheduleList: CoachSchedule[] = data.schedules || [];
    setSchedules(scheduleList);
    hydrateMySchedule(scheduleList);
  }

  async function addSchedule() {
    const nextPlan = createGeneratedPlan();
    const mergedPlan = [...myGeneratedPlan, ...nextPlan];
    setMyGeneratedPlan(mergedPlan);
    await saveSchedule(mergedPlan);
  }

  function editSchedule(item: CoachSchedule) {
    setActiveTab("schedule");
    setViewingSchedule(null);
    setScheduleForm({
      flightSource: item.flight_source || "",
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

  function openScheduleView(schedule: CoachSchedule) {
    setViewingSchedule(schedule);
  }

  async function openCheckoutForTournament(inventorySlug: string) {
    setUnlockingSlug(inventorySlug);
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventorySlug, returnTo: "/bird-dog" })
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.checkoutUrl) {
        window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
      }
      if (data?.alreadyUnlocked) {
        await fetchInventory();
      }
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
      const harvestHint = item.harvestHint || item.name;
      const liveOpen = await fetch("/api/harvest/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: item.company,
          inventorySlug: item.slug,
          tournamentHint: harvestHint
        })
      });
      if (!liveOpen.ok) {
        const data = await liveOpen.json().catch(() => ({}));
        throw new Error(data?.error || "Unable to load tournament details");
      }
      const data = await liveOpen.json();
      const openedTournament = data?.tournament as Tournament | undefined;
      if (!openedTournament) {
        throw new Error("Tournament data was empty.");
      }
      setTournaments((prev) => {
        const filtered = prev.filter((t) => t.id !== openedTournament.id);
        return [openedTournament, ...filtered];
      });
      setSelectedTournamentId(openedTournament.id);
      setSelectedGameId(openedTournament.games?.[0]?.id || "");
      setTournamentViewTitle(openedTournament.name);
      setActiveTab("notes");
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "Failed to open tournament.");
      await queueHarvestJob(item.slug, item.harvestHint || item.name, item.company).catch(() => undefined);
      await loadCompanyData(item.company);
    } finally {
      setOpeningSlug("");
    }
  }

  function cacheTournamentOffline() {
    if (!selectedTournament || !user) return;
    localStorage.setItem(
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
    const raw = localStorage.getItem(`${CACHE_KEY}:${user.orgId}`);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { company: "PG" | "PBR"; tournament: Tournament };
    setCompany(parsed.company);
    setTournaments([parsed.tournament]);
    setSelectedTournamentId(parsed.tournament.id);
    setSelectedGameId(parsed.tournament.games[0]?.id || "");
  }

  function toggleWatch(playerId: string) {
    setWatchlist((prev) => (prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]));
  }

  function addDesiredPlayer() {
    if (!desiredPlayerId) return;
    const match = playersById.get(desiredPlayerId);
    if (!match) return;
    setDesiredPlayers((prev) => {
      if (prev.some((item) => item.playerId === desiredPlayerId)) return prev;
      return [...prev, { playerId: desiredPlayerId, name: match.name, team: match.school || "Unknown Team" }];
    });
  }

  function removeDesiredPlayer(playerId: string) {
    setDesiredPlayers((prev) => prev.filter((item) => item.playerId !== playerId));
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
  }

  async function startRecording() {
    if (recorderState === "recording") return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    audioChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;

    const ctor = (window as unknown as { SpeechRecognition?: BrowserSpeechConstructor; webkitSpeechRecognition?: BrowserSpeechConstructor }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: BrowserSpeechConstructor }).webkitSpeechRecognition;

    if (ctor) {
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
      recognition.start();
      speechRecognitionRef.current = recognition;
    }

    setRecorderState("recording");
  }

  async function stopRecording() {
    if (recorderState !== "recording") return;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    speechRecognitionRef.current?.stop();
    setRecorderState("idle");

    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    const audioDataUrl = await blobToDataUrl(blob);
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
    setTranscript("");
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
      localStorage.setItem(makeOrgKey(user.orgId, user.userId, "lastSyncAt"), nowIso);
    } finally {
      setSyncing(false);
    }
  }

  async function logout() {
    await fetch("/api/session/logout", { method: "POST" });
    router.replace("/login");
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
  const teamDashboard = useMemo(() => {
    const teams = selectedTournament?.teams || [];
    return teams.map((team) => {
      const teamPlayers = players.filter((p) => p.school === team.name);
      const bestPlayer = teamPlayers[0] || null;
      return {
        team,
        teamPlayers,
        bestPlayer
      };
    });
  }, [selectedTournament?.teams, players]);
  const selectedTeamDashboard = useMemo(
    () => teamDashboard.find((row) => row.team.name === selectedTeamName) || null,
    [teamDashboard, selectedTeamName]
  );
  const showTournaments = activeTab === "tournaments";
  const showSchedule = activeTab === "schedule" && canAccessLockedPages;
  const showNotes = activeTab === "notes" && canAccessLockedPages;

  if (authLoading) {
    return <main className="bd-root"><p>Loading session...</p></main>;
  }

  return (
    <main
      className="bd-root"
      style={{
        ["--org-primary" as string]: activeTheme.primary || brand.primary,
        ["--org-accent" as string]: activeTheme.accent || brand.accent,
        ["--bd-bg" as string]: activeTheme.bg,
        ["--bd-panel" as string]: activeTheme.panel,
        ["--bd-ink" as string]: activeTheme.ink,
        ["--bd-line" as string]: activeTheme.line
      }}
      onTouchStart={onPullStart}
      onTouchMove={onPullMove}
      onTouchEnd={onPullEnd}
    >
      <div className="top-menu">
        <button
          type="button"
          className="menu-trigger secondary"
          aria-label="Open navigation menu"
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          ☰
        </button>
        {menuOpen ? (
          <div className="menu-dropdown">
            <button
              className={activeTab === "tournaments" ? "active" : ""}
              type="button"
              onClick={() => {
                setActiveTab("tournaments");
                setMenuOpen(false);
              }}
            >
              Tournaments
            </button>
            <button
              className={activeTab === "schedule" ? "active" : ""}
              type="button"
              disabled={!canAccessLockedPages}
              onClick={() => {
                setActiveTab("schedule");
                setMenuOpen(false);
              }}
            >
              Schedule
            </button>
            <button
              className={activeTab === "notes" ? "active" : ""}
              type="button"
              disabled={!canAccessLockedPages}
              onClick={() => {
                setActiveTab("notes");
                setMenuOpen(false);
              }}
            >
              Notes
            </button>
            <div className="menu-section-title">Themes</div>
            <div className="theme-grid">
              {THEME_PRESETS.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={`theme-pill ${themeId === theme.id ? "active" : ""}`}
                  onClick={() => setThemeId(theme.id)}
                  title={theme.label}
                >
                  <span className="theme-dot" style={{ backgroundColor: theme.primary }} />
                  <span>{theme.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="danger"
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

      {!canAccessLockedPages && (activeTab === "schedule" || activeTab === "notes") ? (
        <section className="panel">
          <h2>Tournament Locked</h2>
          <p className="muted">Subscribe and unlock a tournament from the dashboard first. Schedule and Notes become available only after unlock.</p>
          <button className="secondary" onClick={() => setActiveTab("tournaments")}>Back to Dashboard</button>
        </section>
      ) : null}

      {showSchedule ? (
      <section className="panel grid2">
        <div>
          <h2>Coach Schedule</h2>
          <label>
            Flight Source
            <input
              value={scheduleForm.flightSource}
              onChange={(e) => setScheduleForm((p) => ({ ...p, flightSource: e.target.value }))}
              placeholder="Type city or airport (example: Rotterdam)"
            />
            {sourceSuggestions.length ? (
              <div className="log-list" style={{ maxHeight: 130, marginTop: 6 }}>
                {sourceSuggestions.map((option) => (
                  <button
                    key={option.placeId || option.label}
                    type="button"
                    className="secondary"
                    style={{ textAlign: "left", width: "100%" }}
                    onClick={() => {
                      setScheduleForm((p) => ({ ...p, flightSource: option.label }));
                      setSourceSuggestions([]);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </label>
          <label>
            Flight Destination
            <input
              value={scheduleForm.flightDestination}
              onChange={(e) => setScheduleForm((p) => ({ ...p, flightDestination: e.target.value }))}
              placeholder="Type city or airport (example: Bangalore)"
            />
            {destinationSuggestions.length ? (
              <div className="log-list" style={{ maxHeight: 130, marginTop: 6 }}>
                {destinationSuggestions.map((option) => (
                  <button
                    key={option.placeId || option.label}
                    type="button"
                    className="secondary"
                    style={{ textAlign: "left", width: "100%" }}
                    onClick={() => {
                      setScheduleForm((p) => ({ ...p, flightDestination: option.label }));
                      setDestinationSuggestions([]);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </label>
          <label>
            Flight Arrival Time
            <input type="datetime-local" value={scheduleForm.flightArrivalTime} onChange={(e) => setScheduleForm((p) => ({ ...p, flightArrivalTime: e.target.value }))} />
          </label>
          <label>
            Hotel
            <input
              value={scheduleForm.hotelName}
              onChange={(e) => setScheduleForm((p) => ({ ...p, hotelName: e.target.value }))}
              placeholder="Select hotel or type custom name"
            />
          </label>
          {hotelSuggestions.length ? (
            <div className="panel" style={{ padding: 10 }}>
              <p><strong>Suggested Hotels</strong></p>
              <div className="log-list" style={{ maxHeight: 140 }}>
                {hotelSuggestions.map((hotel) => {
                  const checked = scheduleForm.hotelName === hotel.name;
                  return (
                    <label key={hotel.placeId || `${hotel.name}-${hotel.address}`} className="row" style={{ alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setScheduleForm((p) => ({ ...p, hotelName: checked ? "" : hotel.name }))}
                      />
                      <span>{hotel.name} - {hotel.address}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          <label>
            Notes
            <textarea rows={3} value={scheduleForm.notes} onChange={(e) => setScheduleForm((p) => ({ ...p, notes: e.target.value }))} />
          </label>
          <label>
            Target Player
            <div className="row wrap">
              <select value={desiredPlayerId} onChange={(e) => setDesiredPlayerId(e.target.value)}>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.school || "Unknown Team"})</option>
                ))}
              </select>
              <button className="secondary" type="button" onClick={addDesiredPlayer}>Add Player</button>
            </div>
          </label>
          {desiredPlayers.length ? (
            <div className="log-list" style={{ maxHeight: 140, marginTop: 8 }}>
              {desiredPlayers.map((item) => (
                <article className="log-card" key={item.playerId}>
                  <p><strong>{item.name}</strong></p>
                  <p>Team: {item.team}</p>
                  <button className="secondary" type="button" onClick={() => removeDesiredPlayer(item.playerId)}>Remove</button>
                </article>
              ))}
            </div>
          ) : <p className="muted">Add players to guide schedule generation.</p>}
          <div className="row wrap">
            <button onClick={() => void saveSchedule()}>Save My Schedule</button>
            <button className="secondary" onClick={() => void addSchedule()}>Add Schedule</button>
            <button className="secondary" onClick={() => void fetchSchedules()}>Refresh</button>
          </div>
        </div>

        <div>
          <h2>Team Schedule Board</h2>
          <p className="muted">Tournament: {selectedTournament?.name || tournamentViewTitle || "Select tournament from dashboard"}</p>
          {schedules.length ? (
            <>
              <div className="table-wrap">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>Coach</th>
                      <th>Email</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((item) => (
                      <tr key={item.id}>
                        <td>{item.coach_name}</td>
                        <td>{item.coach_email || "-"}</td>
                        <td>
                          <div className="row wrap">
                            <button className="secondary" onClick={() => openScheduleView(item)}>View Schedules</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="muted">No schedules shared yet.</p>}
        </div>
      </section>
      ) : null}

      {viewingSchedule ? (
        <section className="panel">
          <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h2>{viewingSchedule.coach_name} - Schedule</h2>
            <button className="secondary" onClick={() => setViewingSchedule(null)}>Close</button>
          </div>
          <p>{viewingSchedule.flight_source || "-"} {"->"} {viewingSchedule.flight_destination || "-"}</p>
          <p>{viewingSchedule.flight_arrival_time ? new Date(viewingSchedule.flight_arrival_time).toLocaleString() : "No arrival time"}</p>
          <p>Hotel: {viewingSchedule.hotel_name || "-"}</p>
          <p>{viewingSchedule.notes || ""}</p>
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
            {viewingSchedule.user_id === user?.userId ? (
              <button className="secondary" onClick={() => editSchedule(viewingSchedule)}>Edit</button>
            ) : null}
          </div>
        </section>
      ) : null}

      {showTournaments ? (
      <section className="panel">
        <h2>Tournament Dashboard</h2>
        <p className="muted">
          Scroll all tournaments below. Open one tournament to load its details, then move to Schedule or Notes.
        </p>
        <p className="muted small">{inventoryRefreshing ? "Syncing latest data from Perfect Game..." : "Pull down to refresh from Perfect Game."}</p>
        {openError ? <p className="muted">{openError}</p> : null}
        <div className="tournament-grid" style={{ marginTop: 12 }}>
          {inventory.length ? inventory.map((item) => {
            const locked = item.locked && !PREVIEW_UNLOCK_ALL;
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
                <img className="tile-icon" src={tournamentIconByName(item.name)} alt={item.name} />
                <p className="tile-title"><strong>{item.name}</strong></p>
                <p className="muted">{item.season.toUpperCase()} · {item.company}</p>
                {item.displayCity ? <p className="small">{item.displayCity}</p> : null}
                {item.displayTeams ? <p className="small">{item.displayTeams}</p> : null}
                {locked ? <p className="small">🔒 Subscribe to Unlock</p> : null}
                {openingSlug === item.slug ? <p className="small">Opening...</p> : null}
                {unlockingSlug === item.slug ? <p className="small">Opening Checkout...</p> : null}
              </article>
            );
          }) : <p className="muted">No tournaments found.</p>}
        </div>
      </section>
      ) : null}

      {showNotes ? (
      <section className="panel grid2">
        <div>
          <h2>Participating Teams</h2>
          <p className="muted">Teams in tournament: {selectedTournament?.teams?.length || 0}</p>
          {selectedTournament?.teams?.length ? (
            <div className="table-wrap" style={{ marginBottom: 12 }}>
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>From</th>
                    <th>Record</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTournament.teams.map((team) => (
                    <tr key={team.id} style={{ cursor: "pointer" }} onClick={() => setSelectedTeamName(team.name)}>
                      <td>{team.name}</td>
                      <td>{team.from || "-"}</td>
                      <td>{team.record || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Participating teams appear after full tournament ingest.</p>}
        </div>
        <div>
          <h2>Team Players</h2>
          {selectedTeamDashboard ? (
            <div className="table-wrap">
              <p className="muted"><strong>Team:</strong> {selectedTeamDashboard.team.name}</p>
              <p className="muted"><strong>Best Player:</strong> {selectedTeamDashboard.bestPlayer?.name || "N/A"}</p>
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Name</th>
                    <th>Pos</th>
                    <th>School</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTeamDashboard.teamPlayers.map((p, idx) => (
                    <tr key={p.id}>
                      <td>{idx + 1}</td>
                      <td>{p.name}</td>
                      <td>{p.position}</td>
                      <td>{p.school}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Click a team to view player roster.</p>}
        </div>
        <div>
          <h2>Tournament Matchups</h2>
          <div className="log-list" style={{ maxHeight: 220 }}>
            {games.length ? games.map((g) => (
              <article key={g.id} className="log-card">
                <p><strong>{timeLabel(g.startTime)}</strong> · {g.field}</p>
                <p>{g.homeTeam} vs {g.awayTeam}</p>
              </article>
            )) : <p className="muted">No matchups loaded yet. Open an unlocked tournament to ingest PG/PBR details.</p>}
          </div>
        </div>
      </section>
      ) : null}

      {showNotes ? (
      <section className="panel grid2">
        <div>
          <h2>Hands-Free Notes</h2>
          <div className="row wrap">
            {recorderState === "idle" ? (
              <button onClick={() => void startRecording()}>Start Mic</button>
            ) : (
              <button className="danger" onClick={() => void stopRecording()}>Stop + Save</button>
            )}
          </div>
          <label>
            Live Transcript
            <textarea rows={5} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Transcript appears here." />
          </label>
          {!speechSupported ? <p className="muted">Speech recognition is not available in this browser. Audio capture still works.</p> : null}
        </div>

        <div>
          <h2>Optimized Path</h2>
          <ol className="path-list">
            {itinerary.length ? itinerary.map((stop) => (
              <li key={stop.gameId}>
                <strong>{timeLabel(stop.at)} - {stop.field}</strong>
                <span>{stop.watchlistCount} target(s): {stop.players.join(", ")}</span>
                <span>{stop.walkFromPrevMinutes ? `Walk ${stop.walkFromPrevMinutes} min from previous field` : "Start point"}</span>
              </li>
            )) : <li>No watchlist overlap yet. Mark players to build route.</li>}
          </ol>
        </div>
      </section>
      ) : null}

      {showNotes ? (
      <section className="panel">
        <h2>Player Notes Dashboard</h2>
        <div className="log-list" style={{ maxHeight: 260 }}>
          {tournamentPlayerDashboard.length ? tournamentPlayerDashboard.map((entry) => (
            <article key={entry.player.id} className="log-card">
              <p><strong>{entry.player.name}</strong> ({entry.player.position})</p>
              <p>{entry.player.school}</p>
              <p>Notes: {entry.notes.length}</p>
              {entry.notes.slice(0, 3).map((note) => (
                <p key={note.id} className="small">{timeLabel(note.createdAt)} - {note.transcript}</p>
              ))}
            </article>
          )) : <p className="muted">No player notes yet for this tournament.</p>}
        </div>
      </section>
      ) : null}

      {showNotes ? (
      <section className="panel grid2">
        <div>
          <h2>Audio + Transcript Archive</h2>
          <div className="log-list">
            {notes.length ? notes.map((n) => (
              <article key={n.id} className="log-card">
                <p><strong>{dateLabel(n.createdAt)} {timeLabel(n.createdAt)}</strong> - {n.synced ? "Synced" : "Pending sync"}</p>
                <p>{n.transcript}</p>
                {n.audioUrl ? <audio controls src={n.audioUrl} /> : null}
              </article>
            )) : <p className="muted">No notes yet.</p>}
          </div>
        </div>

        <div>
          <h2>Pulse Feed</h2>
          <div className="log-list">
            {pulses.length ? pulses.map((p) => (
              <article key={p.id} className="log-card">
                <p><strong>{timeLabel(p.createdAt)}</strong> - {p.synced ? "Synced" : "Pending"}</p>
                <p>{p.message}</p>
              </article>
            )) : <p className="muted">No pulse events yet.</p>}
          </div>
        </div>
      </section>
      ) : null}

    </main>
  );
}
