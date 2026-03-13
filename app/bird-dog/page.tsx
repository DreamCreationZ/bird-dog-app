"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

const CACHE_KEY = "bird_dog_tournament_cache";
const PREVIEW_UNLOCK_ALL = process.env.NEXT_PUBLIC_BIRD_DOG_PREVIEW_UNLOCK_ALL === "true";

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

function uniquePlayers(games: Game[]): Player[] {
  const map = new Map<string, Player>();
  games.forEach((g) => g.players.forEach((p) => map.set(p.id, p)));
  return Array.from(map.values());
}

function buildPath(games: Game[], watchlistIds: Set<string>): ItineraryStop[] {
  const filtered = games
    .map((game) => {
      const targets = game.players.filter((p) => watchlistIds.has(p.id));
      if (!targets.length) return null;
      return {
        game,
        stop: {
          gameId: game.id,
          field: game.field,
          at: game.startTime,
          watchlistCount: targets.length,
          players: targets.map((p) => p.name),
          walkFromPrevMinutes: 0
        }
      };
    })
    .filter((item): item is { game: Game; stop: ItineraryStop } => Boolean(item))
    .sort((a, b) => new Date(a.stop.at).getTime() - new Date(b.stop.at).getTime());

  return filtered.map((item, index) => {
    if (index === 0) return item.stop;
    const prev = filtered[index - 1].game.fieldLocation;
    const curr = item.game.fieldLocation;
    const distance = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const walkFromPrevMinutes = Math.max(2, Math.round(distance * 4));
    return { ...item.stop, walkFromPrevMinutes };
  });
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
  const [openError, setOpenError] = useState("");
  const [selectedInventorySlug, setSelectedInventorySlug] = useState("");
  const [activeTab, setActiveTab] = useState<"tournaments" | "schedule" | "notes">("tournaments");

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
    const rawWatch = localStorage.getItem(makeOrgKey(user.orgId, user.userId, "watchlist"));
    const rawNotes = localStorage.getItem(makeOrgKey(user.orgId, user.userId, "notes"));
    const rawPulses = localStorage.getItem(makeOrgKey(user.orgId, user.userId, "pulses"));
    const rawSync = localStorage.getItem(makeOrgKey(user.orgId, user.userId, "lastSyncAt"));

    setWatchlist(rawWatch ? JSON.parse(rawWatch) : []);
    setNotes(rawNotes ? JSON.parse(rawNotes) : []);
    setPulses(rawPulses ? JSON.parse(rawPulses) : []);
    setLastSyncAt(rawSync || null);
  }, [user]);

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
    if (!res.ok) return;
    const data = await res.json();
    setSubscribed(Boolean(data.subscribed));
    setInventory(data.inventory || []);
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
    const payload = {
      ...scheduleForm,
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
    setScheduleForm({
      flightSource: item.flight_source || "",
      flightDestination: item.flight_destination || "",
      flightArrivalTime: toInputDateTime(item.flight_arrival_time),
      hotelName: item.hotel_name || "",
      notes: item.notes || ""
    });
    setDesiredPlayers(item.desired_players || []);
    setMyGeneratedPlan(item.generated_plan || []);
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
  const showTournaments = activeTab === "tournaments";
  const showSchedule = activeTab === "schedule" && canAccessLockedPages;
  const showNotes = activeTab === "notes" && canAccessLockedPages;

  if (authLoading) {
    return <main className="bd-root"><p>Loading session...</p></main>;
  }

  return (
    <main className="bd-root" style={{ ["--org-primary" as string]: brand.primary, ["--org-accent" as string]: brand.accent }}>
      <section className="bd-header">
        <div>
          <h1>Project Bird Dog</h1>
          <p className="muted">{user?.name} ({user?.email}) - {user?.orgName}</p>
          <p className="muted">Status: {online ? "Online" : "Offline"} {syncing ? "| Syncing..." : ""} {lastSyncAt ? `| Last sync ${timeLabel(lastSyncAt)}` : ""}</p>
          {syncError ? <p className="muted">{syncError}</p> : null}
        </div>
        <div className="org-chip">
          <strong>{brand.logoText}</strong>
          <span>{brand.name}</span>
          <button className="secondary" onClick={() => void logout()}>Log Out</button>
        </div>
      </section>

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
        <div className="row wrap">
          <button className="secondary" onClick={() => void fetchInventory()}>Refresh List</button>
        </div>
        {openError ? <p className="muted">{openError}</p> : null}
        <div className="log-list" style={{ maxHeight: 520, marginTop: 12 }}>
          {inventory.length ? inventory.map((item) => {
            const locked = item.locked && !PREVIEW_UNLOCK_ALL;
            const opened = selectedInventorySlug === item.slug;
            return (
              <article key={item.slug} className={`log-card ${locked ? "locked-card" : "unlocked-card"}`}>
                <p><strong>{item.name}</strong></p>
                <p className="muted">{item.season.toUpperCase()} · {item.company}</p>
                <div className="row wrap">
                  {locked ? (
                    <button className="secondary" disabled={unlockingSlug === item.slug} onClick={() => void openCheckoutForTournament(item.slug)}>
                      {unlockingSlug === item.slug ? "Opening Checkout..." : "🔒 Subscribe to Unlock"}
                    </button>
                  ) : (
                    <button className="secondary" disabled={openingSlug === item.slug} onClick={() => void useUnlockedTournament(item)}>
                      {openingSlug === item.slug ? "Opening..." : opened ? "Open Tournament Again" : "Open Tournament"}
                    </button>
                  )}
                  {opened ? <span className="small">Opened</span> : null}
                </div>
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
                    <tr key={team.id}>
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
          <h2>Tournament Roster</h2>
          {players.length ? (
            <div className="table-wrap">
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
                  {players.map((p, idx) => (
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
          ) : <p className="muted">Roster appears after tournament data is loaded.</p>}
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

      <nav className="bottom-tabs">
        <button className={activeTab === "tournaments" ? "active" : ""} onClick={() => setActiveTab("tournaments")} type="button">Tournaments</button>
        <button className={activeTab === "schedule" ? "active" : ""} onClick={() => setActiveTab("schedule")} type="button" disabled={!canAccessLockedPages}>Schedule</button>
        <button className={activeTab === "notes" ? "active" : ""} onClick={() => setActiveTab("notes")} type="button" disabled={!canAccessLockedPages}>Notes</button>
      </nav>
    </main>
  );
}
