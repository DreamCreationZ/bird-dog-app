"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  initialParams: {
    inventorySlug: string;
    teamId: string;
    teamName: string;
    teamUrl: string;
    eventId: string;
    tournamentName: string;
    returnTab: string;
    returnInventorySlug: string;
    returnTournamentId: string;
  };
  inlineMode?: boolean;
  onClose?: () => void;
};

type TeamScheduleRow = {
  gameNo: string;
  date: string;
  time: string;
  field: string;
  homeTeam: string;
  awayTeam: string;
};

type TeamRosterRow = {
  no: string;
  name: string;
  team?: string;
  position: string;
  height?: string;
  weight?: string;
  batsThrows?: string;
  grad?: string;
  school: string;
  hometown?: string;
  rank?: string;
  commitment?: string;
};

type CrossTeamCartPlayer = {
  playerId: string;
  selectionKey?: string;
  name: string;
  team: string;
  hometown?: string;
  sourceTeamId?: string;
  sourceTeamName?: string;
};

type GeneratedCoachStep = {
  at: string;
  title: string;
  detail: string;
  from?: string;
  to?: string;
  mode?: string;
};

type TravelerProfile = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "MALE" | "FEMALE" | "UNSPECIFIED";
  email: string;
  phone: string;
  countryCallingCode: string;
  nationality: string;
};

type BookingProviderResult = {
  provider: string;
  status: "booked" | "quoted" | "failed" | "skipped";
  reference?: string;
  detail?: string;
};

type MonitorAlert = {
  id: string;
  kind: "pg_change" | "weather";
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  createdAt: string;
};

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

type TeamNote = {
  id: string;
  transcript: string;
  audioUrl?: string;
  createdAt: string;
};

type PlayerNote = {
  text: string;
  audioUrl?: string;
  updatedAt: string;
};

type PlayerNotesMap = Record<string, PlayerNote>;

type RecorderTarget = "team" | `player:${string}` | null;

type SavedPaymentMethod = {
  id: string;
  type: string;
  label: string;
};

type SessionUserTheme = {
  orgPrimary?: string;
  orgAccent?: string;
  orgName?: string;
  name?: string;
  email?: string;
  gender?: "MALE" | "FEMALE" | "UNSPECIFIED";
  phone?: string;
  countryCallingCode?: string;
};

type BookingPaymentMode = "saved_card" | "card" | "upi";

type PlannerCacheState = {
  selectedPlayers: string[];
  coachStartLocation: string;
  generatedSteps: GeneratedCoachStep[];
  approvedPlan: boolean;
  includeCompletedGames: boolean;
  bookingTestMode: boolean;
  bookingPaymentMode: BookingPaymentMode;
  selectedPaymentMethodId: string;
  traveler: TravelerProfile;
};

const COACH_BOOKING_PROFILE_KEY = "bd-coach-booking-profile:v1";

type TeamDetailsCachePayload = {
  schedule: TeamScheduleRow[];
  roster: TeamRosterRow[];
};

const TEAM_DETAILS_TTL_MS = 10 * 60 * 1000;

function teamDetailsCacheKey(input: Props["initialParams"]) {
  const identity = [
    input.inventorySlug,
    input.teamId,
    input.teamName,
    input.tournamentName,
    input.returnTournamentId,
    input.eventId
  ].join("|");
  return `bird_dog:team_details:v4:${identity}`;
}

function readTeamDetailsCache(key: string): TeamDetailsCachePayload | null {
  if (typeof window === "undefined") return null;
  let raw = "";
  try {
    raw = window.sessionStorage.getItem(key) || "";
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { savedAt: number; data: TeamDetailsCachePayload };
    if (!parsed?.data || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > TEAM_DETAILS_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeTeamDetailsCache(key: string, payload: TeamDetailsCachePayload) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: payload }));
  } catch {
    // Ignore storage write errors.
  }
}

function parseJsonSafe<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function splitNameParts(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
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

function safe(value: string) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function downloadPdfLikeReport(title: string, headers: string[], rows: string[][]) {
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
          <tbody>${tableRows || `<tr><td colspan="${headers.length}">No rows</td></tr>`}</tbody>
        </table>
      </body>
    </html>
  `;
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

function looksLikeLocation(value: string) {
  const v = String(value || "").toLowerCase();
  return /high school|complex|park|field|stadium|baseball|academy|facility|, [a-z]{2}\b| - [a-z]{2}\b/.test(v);
}

function normalizeTeamName(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pickOpponent(teamName: string, homeTeam: string, awayTeam: string) {
  const needle = normalizeTeamName(teamName);
  const home = normalizeTeamName(homeTeam);
  const away = normalizeTeamName(awayTeam);
  if (needle && home && (home === needle || home.includes(needle) || needle.includes(home))) return awayTeam;
  if (needle && away && (away === needle || away.includes(needle) || needle.includes(away))) return homeTeam;
  return awayTeam || homeTeam || "-";
}

function rosterRowKey(row: TeamRosterRow) {
  return `${row.no || "x"}::${String(row.name || "").toLowerCase()}::${normalizeTeamName(row.team || "")}`;
}

function normalizeSearchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rosterSearchHaystack(row: TeamRosterRow) {
  return normalizeSearchText(
    `${row.no} ${row.name} ${row.team || ""} ${row.position} ${row.height || ""} ${row.weight || ""} ${row.batsThrows || ""} ${row.grad || ""} ${row.school || ""} ${row.hometown || ""} ${row.rank || ""} ${row.commitment || ""}`
  );
}

function normalizeStorageScope(value: string) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "na";
}

function desiredSelectionKey(player: CrossTeamCartPlayer) {
  return player.selectionKey || player.playerId;
}

function rosterCartStorageKey(params: Props["initialParams"]) {
  const inventoryScope = normalizeStorageScope(params.returnInventorySlug || params.inventorySlug || "inventory");
  const tournamentScope = normalizeStorageScope(params.returnTournamentId || params.tournamentName || "tournament");
  return `bird_dog:roster_cart:v1:${inventoryScope}:${tournamentScope}`;
}

function readRosterCartStorage(key: string): CrossTeamCartPlayer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        playerId: String(item?.playerId || ""),
        selectionKey: item?.selectionKey ? String(item.selectionKey) : undefined,
        name: String(item?.name || ""),
        team: String(item?.team || ""),
        hometown: item?.hometown ? String(item.hometown) : undefined,
        sourceTeamId: item?.sourceTeamId ? String(item.sourceTeamId) : undefined,
        sourceTeamName: item?.sourceTeamName ? String(item.sourceTeamName) : undefined
      }))
      .filter((item) => item.playerId && item.name && item.team);
  } catch {
    return [];
  }
}

function writeRosterCartStorage(key: string, rows: CrossTeamCartPlayer[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    // Ignore storage write errors.
  }
}

function rosterSearchScore(row: TeamRosterRow, query: string, tokens: string[]) {
  const name = normalizeSearchText(row.name);
  const team = normalizeSearchText(row.team || "");
  const hometown = normalizeSearchText(row.hometown || "");

  let score = 0;
  if (name === query) score += 500;
  if (name.startsWith(query)) score += 320;
  if (name.includes(query)) score += 220;
  if (team.startsWith(query)) score += 200;
  if (team.includes(query)) score += 160;
  if (hometown.includes(query)) score += 120;

  for (const token of tokens) {
    if (!token) continue;
    if (name.includes(token)) {
      score += 35;
    } else if (team.includes(token)) {
      score += 28;
    } else if (hometown.includes(token)) {
      score += 24;
    }
  }
  return score;
}

function ensureRosterTeam(rows: TeamRosterRow[], fallbackTeam: string) {
  const team = String(fallbackTeam || "").trim();
  return rows.map((row) => ({
    ...row,
    team: String(row.team || team || "").trim()
  }));
}

function parseScheduleDateTime(row: TeamScheduleRow, index: number) {
  const raw = `${row.date || ""} ${row.time || ""}`.trim();
  const date = raw ? new Date(raw) : new Date();
  if (!Number.isNaN(date.getTime())) return date;
  return new Date(Date.now() + index * 90 * 60 * 1000);
}

function extractLocation(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "Event Venue";
  const atSplit = raw.split("@");
  const preferred = atSplit.length > 1 ? atSplit[atSplit.length - 1] : raw;
  return preferred.trim() || raw;
}

function extractState(value: string) {
  const match = value.match(/,\s*([A-Z]{2})\b/);
  return match ? match[1] : "";
}

function scheduleRowKey(row: TeamScheduleRow) {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  return [
    row.gameNo || "",
    normalize(row.date || ""),
    normalize(row.time || ""),
    normalize(row.field || ""),
    normalize(row.homeTeam || ""),
    normalize(row.awayTeam || "")
  ].join("|");
}

function scheduleFingerprint(rows: TeamScheduleRow[]) {
  return rows.map((row) => scheduleRowKey(row)).sort().join("~");
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

function isSafariBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Android/i.test(ua);
}

function encodeWav(chunks: Float32Array[], sampleRate: number) {
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, totalSamples * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: "audio/wav" });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to process recorded audio."));
    reader.readAsDataURL(blob);
  });
}

function toRad(n: number) {
  return (n * Math.PI) / 180;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

function estimateTravelNoGeo(from: string, to: string) {
  if (from.toLowerCase() === to.toLowerCase()) return { mode: "Walk / Local Cab", minutes: 20 };
  const fromState = extractState(from);
  const toState = extractState(to);
  if (fromState && toState && fromState !== toState) return { mode: "Flight + Cab", minutes: 300 };
  if (fromState && toState && fromState === toState) return { mode: "Car / Train", minutes: 120 };
  return { mode: "Car / Cab", minutes: 90 };
}

function prepareBookingLegsForProvider(
  legs: Array<{ at: string; from: string; to: string; mode: string }>,
  enableTestMode: boolean
) {
  const normalized = legs.map((leg) => ({
    at: String(leg.at || ""),
    from: String(leg.from || ""),
    to: String(leg.to || ""),
    mode: String(leg.mode || "")
  }));
  if (!enableTestMode) {
    return { legs: normalized, shifted: false, statusNote: "" };
  }

  const parsed = normalized
    .map((leg, idx) => ({ idx, ms: Date.parse(leg.at) }))
    .filter((item) => Number.isFinite(item.ms));
  if (!parsed.length) {
    return {
      legs: normalized,
      shifted: false,
      statusNote: "Booking test mode is on, but no valid date/time was found to shift."
    };
  }

  const earliestMs = Math.min(...parsed.map((item) => item.ms));
  const now = Date.now();
  const minimumFutureMs = now + 2 * 60 * 60 * 1000;
  if (earliestMs >= minimumFutureMs) {
    return {
      legs: normalized,
      shifted: false,
      statusNote: "Booking test mode is on, but itinerary is already in future dates."
    };
  }

  const targetStartMs = now + 2 * 24 * 60 * 60 * 1000;
  const shiftMs = targetStartMs - earliestMs;
  const shifted = normalized.map((leg) => {
    const ms = Date.parse(leg.at);
    if (!Number.isFinite(ms)) return leg;
    return { ...leg, at: new Date(ms + shiftMs).toISOString() };
  });

  return {
    legs: shifted,
    shifted: true,
    statusNote: `Booking test mode: shifted provider booking dates from ${new Date(earliestMs).toLocaleString()} to ${new Date(targetStartMs).toLocaleString()}.`
  };
}

export default function TeamDetailsClient({ initialParams, inlineMode = false, onClose }: Props) {
  const [sessionTheme, setSessionTheme] = useState<SessionUserTheme | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scheduleRows, setScheduleRows] = useState<TeamScheduleRow[]>([]);
  const [rosterRows, setRosterRows] = useState<TeamRosterRow[]>([]);
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [recordingTarget, setRecordingTarget] = useState<RecorderTarget>(null);
  const [transcript, setTranscript] = useState("");
  const [teamAudioDraftUrl, setTeamAudioDraftUrl] = useState("");
  const [teamNotes, setTeamNotes] = useState<TeamNote[]>([]);
  const [playerNotes, setPlayerNotes] = useState<PlayerNotesMap>({});
  const [notesStatus, setNotesStatus] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [crossTeamCartPlayers, setCrossTeamCartPlayers] = useState<CrossTeamCartPlayer[]>([]);
  const [coachStartLocation, setCoachStartLocation] = useState("Current location");
  const [includeCompletedGames, setIncludeCompletedGames] = useState(
    process.env.NEXT_PUBLIC_BIRD_DOG_ALLOW_PAST_GAMES === "1"
  );
  const bookingTestModeEnabled = process.env.NEXT_PUBLIC_BIRD_DOG_BOOKING_TEST_MODE === "1";
  const [bookingTestMode, setBookingTestMode] = useState(
    bookingTestModeEnabled
  );
  const [paymentMethods, setPaymentMethods] = useState<SavedPaymentMethod[]>([]);
  const [bookingPaymentMode, setBookingPaymentMode] = useState<BookingPaymentMode>("card");
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState("");
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
  const [paymentSetupReturnTo, setPaymentSetupReturnTo] = useState("/bird-dog/team");
  const [upiCheckoutLoading, setUpiCheckoutLoading] = useState(false);
  const [upiAuthorized, setUpiAuthorized] = useState(false);
  const bookingPaymentRequired = process.env.NEXT_PUBLIC_BIRD_DOG_REQUIRE_BOOKING_PAYMENT !== "0";
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerStatus, setPlannerStatus] = useState("");
  const [generatedSteps, setGeneratedSteps] = useState<GeneratedCoachStep[]>([]);
  const [approvedPlan, setApprovedPlan] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingStatus, setBookingStatus] = useState("");
  const [bookingResults, setBookingResults] = useState<BookingProviderResult[]>([]);
  const [monitoring, setMonitoring] = useState(false);
  const [monitorAlerts, setMonitorAlerts] = useState<MonitorAlert[]>([]);
  const [lastPgSyncAt, setLastPgSyncAt] = useState("");
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [traveler, setTraveler] = useState<TravelerProfile>({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "UNSPECIFIED",
    email: "",
    phone: "",
    countryCallingCode: "1",
    nationality: "US"
  });
  const geocodeCacheRef = useRef<Map<string, { lat: number; lng: number } | null>>(new Map());
  const scheduleRowsRef = useRef<TeamScheduleRow[]>([]);
  const rosterRowsRef = useRef<TeamRosterRow[]>([]);
  const scheduleFingerprintRef = useRef("");
  const weatherAlertHashRef = useRef("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const monitorSyncRunningRef = useRef(false);
  const fallbackAudioContextRef = useRef<AudioContext | null>(null);
  const fallbackSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const fallbackProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const fallbackPcmChunksRef = useRef<Float32Array[]>([]);
  const fallbackSampleRateRef = useRef(44100);
  const fallbackTargetRef = useRef<NonNullable<RecorderTarget> | null>(null);
  const transcriptRef = useRef("");
  const autoSaveTeamNoteRef = useRef(false);
  const plannerCacheLoadedRef = useRef(false);
  const coachProfileHydratedRef = useRef(false);
  const coachLocationTriedRef = useRef(false);

  const teamRequestPayload = useMemo(() => ({
    inventorySlug: initialParams.inventorySlug,
    teamId: initialParams.teamId,
    teamUrl: initialParams.teamUrl,
    teamName: initialParams.teamName,
    eventId: initialParams.eventId,
    tournamentId: initialParams.returnTournamentId
  }), [
    initialParams.eventId,
    initialParams.inventorySlug,
    initialParams.returnTournamentId,
    initialParams.teamId,
    initialParams.teamName,
    initialParams.teamUrl
  ]);

  const plannerCacheKey = useMemo(
    () => `bd-team-planner-v2:${initialParams.inventorySlug}:${initialParams.teamId}`,
    [initialParams.inventorySlug, initialParams.teamId]
  );
  const cartStorageKey = useMemo(
    () => rosterCartStorageKey(initialParams),
    [
      initialParams.inventorySlug,
      initialParams.returnInventorySlug,
      initialParams.returnTournamentId,
      initialParams.tournamentName
    ]
  );

  useEffect(() => {
    setCrossTeamCartPlayers(readRosterCartStorage(cartStorageKey));
  }, [cartStorageKey]);

  useEffect(() => {
    let mounted = true;
    async function loadSessionTheme() {
      try {
        const res = await fetch("/api/session/me");
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        const sessionUser = data?.user as SessionUserTheme | null;
        setSessionTheme(sessionUser || null);
        if (!coachProfileHydratedRef.current && typeof window !== "undefined") {
          coachProfileHydratedRef.current = true;
          const nameParts = splitNameParts(String(sessionUser?.name || ""));
          const sessionGenderRaw = String(sessionUser?.gender || "").toUpperCase();
          const sessionGender: TravelerProfile["gender"] =
            sessionGenderRaw === "MALE" || sessionGenderRaw === "FEMALE" || sessionGenderRaw === "UNSPECIFIED"
              ? sessionGenderRaw as TravelerProfile["gender"]
              : "UNSPECIFIED";
          const seeded: TravelerProfile = {
            firstName: nameParts.firstName || "Coach",
            lastName: nameParts.lastName || "",
            dateOfBirth: "",
            gender: sessionGender,
            email: String(sessionUser?.email || ""),
            phone: String(sessionUser?.phone || ""),
            countryCallingCode: String(sessionUser?.countryCallingCode || "1"),
            nationality: "US"
          };
          const saved = parseJsonSafe<Partial<TravelerProfile>>(
            window.localStorage.getItem(COACH_BOOKING_PROFILE_KEY),
            {}
          );
          const merged: TravelerProfile = {
            ...seeded,
            ...saved,
            email: String(saved?.email || seeded.email || "")
          };
          setTraveler((prev) => ({
            ...prev,
            ...merged
          }));
        }
      } catch {
        if (!mounted) return;
        setSessionTheme(null);
      }
    }
    void loadSessionTheme();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const param = new URLSearchParams(window.location.search).get("allowPast");
    if (param === "1") setIncludeCompletedGames(true);
    if (param === "0") setIncludeCompletedGames(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPaymentSetupReturnTo(`${window.location.pathname}${window.location.search}`);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || plannerCacheLoadedRef.current) return;
    plannerCacheLoadedRef.current = true;

    try {
      const raw = window.sessionStorage.getItem(plannerCacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PlannerCacheState>;
        if (Array.isArray(parsed.selectedPlayers)) setSelectedPlayers(parsed.selectedPlayers.filter(Boolean));
        if (typeof parsed.coachStartLocation === "string" && parsed.coachStartLocation.trim()) {
          setCoachStartLocation(parsed.coachStartLocation);
        }
        if (Array.isArray(parsed.generatedSteps)) {
          const steps = parsed.generatedSteps
            .map((item) => ({
              at: String(item?.at || ""),
              title: String(item?.title || ""),
              detail: String(item?.detail || ""),
              from: item?.from ? String(item.from) : undefined,
              to: item?.to ? String(item.to) : undefined,
              mode: item?.mode ? String(item.mode) : undefined
            }))
            .filter((item) => item.at && item.title);
          setGeneratedSteps(steps);
        }
        if (typeof parsed.approvedPlan === "boolean") setApprovedPlan(parsed.approvedPlan);
        if (typeof parsed.includeCompletedGames === "boolean") setIncludeCompletedGames(parsed.includeCompletedGames);
        if (typeof parsed.bookingTestMode === "boolean") {
          setBookingTestMode(bookingTestModeEnabled ? parsed.bookingTestMode : false);
        }
        if (parsed.bookingPaymentMode === "saved_card" || parsed.bookingPaymentMode === "card" || parsed.bookingPaymentMode === "upi") {
          setBookingPaymentMode(parsed.bookingPaymentMode);
        }
        if (typeof parsed.selectedPaymentMethodId === "string") setSelectedPaymentMethodId(parsed.selectedPaymentMethodId);
        if (parsed.traveler && typeof parsed.traveler === "object") {
          setTraveler((prev) => ({
            ...prev,
            firstName: String(parsed.traveler?.firstName || prev.firstName),
            lastName: String(parsed.traveler?.lastName || prev.lastName),
            dateOfBirth: String(parsed.traveler?.dateOfBirth || prev.dateOfBirth),
            gender: (String(parsed.traveler?.gender || prev.gender).toUpperCase() as TravelerProfile["gender"]),
            email: String(parsed.traveler?.email || prev.email),
            phone: String(parsed.traveler?.phone || prev.phone),
            countryCallingCode: String(parsed.traveler?.countryCallingCode || prev.countryCallingCode),
            nationality: String(parsed.traveler?.nationality || prev.nationality)
          }));
        }
      }
    } catch {
      // Ignore corrupted planner cache.
    }
  }, [bookingTestModeEnabled, plannerCacheKey]);

  useEffect(() => {
    if (coachLocationTriedRef.current) return;
    const raw = coachStartLocation.trim().toLowerCase();
    if (raw && raw !== "current city" && raw !== "current location") return;
    coachLocationTriedRef.current = true;
    let cancelled = false;
    void (async () => {
      const resolved = await resolveCoachStartLocation();
      if (cancelled) return;
      if (resolved.source === "live") {
        setPlannerStatus(`Current location detected: ${resolved.label}`);
      } else if (resolved.source === "fallback") {
        setPlannerStatus("Live location unavailable. Enter your start city in Edit before generating recommendation.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coachStartLocation]);

  async function loadPaymentMethods(input?: { showStatus?: boolean }) {
    setPaymentMethodsLoading(true);
    try {
      const res = await fetch("/api/payments/methods", {
        method: "GET",
        cache: "no-store"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (input?.showStatus) {
          setBookingStatus(body?.error || `Could not load saved payment methods (${res.status}).`);
        }
        return;
      }
      const list = Array.isArray(body?.methods) ? body.methods as Array<Record<string, unknown>> : [];
      const normalized: SavedPaymentMethod[] = list
        .map((item) => ({
          id: String(item?.id || ""),
          type: String(item?.type || ""),
          label: String(item?.label || "")
        }))
        .filter((item) => item.id);
      setPaymentMethods(normalized);

      const nextDefault = String(body?.defaultPaymentMethodId || "");
      setSelectedPaymentMethodId((prev) => {
        if (prev && normalized.some((item) => item.id === prev)) return prev;
        if (nextDefault && normalized.some((item) => item.id === nextDefault)) return nextDefault;
        return normalized[0]?.id || "";
      });
    } finally {
      setPaymentMethodsLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const pmSetup = params.get("pmSetup");
    const travelPayment = params.get("travelPayment");
    if (pmSetup === "success") {
      setBookingStatus("Your card details are saved. Please continue with booking using the saved card.");
    } else if (pmSetup === "cancelled") {
      setBookingStatus("Payment method setup cancelled.");
    }
    if (travelPayment === "success") {
      setUpiAuthorized(true);
      setBookingStatus("UPI authorization completed. You can now click Book Approved Travel.");
    } else if (travelPayment === "cancelled") {
      setUpiAuthorized(false);
      setBookingStatus("UPI authorization cancelled.");
    }
    if (pmSetup || travelPayment) {
      params.delete("pmSetup");
      params.delete("travelPayment");
      const nextQuery = params.toString();
      const clean = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
      window.history.replaceState(null, "", clean);
    }
    void loadPaymentMethods({ showStatus: Boolean(pmSetup) });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !plannerCacheLoadedRef.current) return;
    const payload: PlannerCacheState = {
      selectedPlayers,
      coachStartLocation,
      generatedSteps,
      approvedPlan,
      includeCompletedGames,
      bookingTestMode,
      bookingPaymentMode,
      selectedPaymentMethodId,
      traveler
    };
    try {
      window.sessionStorage.setItem(plannerCacheKey, JSON.stringify(payload));
    } catch {
      // Ignore session storage quota errors.
    }
  }, [
    approvedPlan,
    bookingTestMode,
    bookingPaymentMode,
    coachStartLocation,
    generatedSteps,
    includeCompletedGames,
    plannerCacheKey,
    selectedPaymentMethodId,
    selectedPlayers,
    traveler
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(COACH_BOOKING_PROFILE_KEY, JSON.stringify(traveler));
    } catch {
      // Ignore local storage write issues.
    }
  }, [traveler]);

  useEffect(() => {
    if (!paymentMethods.length && bookingPaymentMode === "saved_card") {
      setBookingPaymentMode("card");
    }
  }, [bookingPaymentMode, paymentMethods.length]);

  function pushMonitorAlert(alert: Omit<MonitorAlert, "createdAt">) {
    const nextAlert: MonitorAlert = { ...alert, createdAt: new Date().toISOString() };
    setMonitorAlerts((prev) => [nextAlert, ...prev].slice(0, 20));

    if (typeof window !== "undefined" && "Notification" in window) {
      try {
        if (Notification.permission === "granted") {
          new Notification(alert.title, { body: alert.detail });
        } else if (Notification.permission === "default") {
          void Notification.requestPermission();
        }
      } catch {
        // Ignore browser notification errors.
      }
    }
  }

  async function fetchTeamDetailsRemote() {
    const res = await fetch("/api/harvest/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(teamRequestPayload)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `Failed (${res.status})`);
    }
    const data = await res.json();
    const schedule = Array.isArray(data?.schedule) ? data.schedule as TeamScheduleRow[] : [];
    const rosterRaw = Array.isArray(data?.roster) ? data.roster as TeamRosterRow[] : [];
    const roster = ensureRosterTeam(rosterRaw, initialParams.teamName);
    return { schedule, roster };
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      const cacheKey = teamDetailsCacheKey(initialParams);
      const cached = readTeamDetailsCache(cacheKey);
      if (cached) {
        const cachedRoster = ensureRosterTeam(cached.roster, initialParams.teamName);
        setScheduleRows(cached.schedule);
        setRosterRows(cachedRoster);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const data = await fetchTeamDetailsRemote();
        if (!mounted) return;
        const schedule = data.schedule;
        const roster = data.roster;
        setScheduleRows(schedule);
        setRosterRows(roster);
        scheduleFingerprintRef.current = scheduleFingerprint(schedule);
        if (schedule.length || roster.length) {
          writeTeamDetailsCache(cacheKey, { schedule, roster });
        }
      } catch (fetchError) {
        if (!mounted) return;
        setError(String(fetchError));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [
    initialParams.eventId,
    initialParams.inventorySlug,
    initialParams.returnTournamentId,
    initialParams.teamId,
    initialParams.teamName,
    initialParams.teamUrl,
    initialParams.tournamentName,
    teamRequestPayload
  ]);

  function goBackOneStep() {
    if (inlineMode) {
      onClose?.();
      return;
    }
    const qs = new URLSearchParams(window.location.search);
    const requestedTab = (
      initialParams.returnTab
      || qs.get("returnTab")
      || qs.get("tab")
      || "notes"
    ).toLowerCase();
    const allowedTabs = new Set(["tournaments", "notes", "schedule", "coaches"]);
    const nextTab = allowedTabs.has(requestedTab) ? requestedTab : "notes";
    const nextInventory = initialParams.returnInventorySlug || qs.get("returnInventorySlug") || initialParams.inventorySlug || qs.get("inventorySlug") || "";
    const nextTournament = initialParams.returnTournamentId || qs.get("returnTournamentId") || qs.get("tournamentId") || "";
    const nextParams = new URLSearchParams();
    nextParams.set("tab", nextTab);
    if (nextInventory) nextParams.set("inventorySlug", nextInventory);
    if (nextTournament) nextParams.set("tournamentId", nextTournament);
    const target = `/bird-dog?${nextParams.toString()}`;
    window.location.assign(target);
  }

  function goToCoachScheduleTab() {
    const nextParams = new URLSearchParams();
    nextParams.set("tab", "schedule");
    if (initialParams.returnInventorySlug || initialParams.inventorySlug) {
      nextParams.set("inventorySlug", initialParams.returnInventorySlug || initialParams.inventorySlug);
    }
    if (initialParams.returnTournamentId) {
      nextParams.set("tournamentId", initialParams.returnTournamentId);
    }
    window.location.assign(`/bird-dog?${nextParams.toString()}`);
  }

  function openAppTab(tab: "tournaments" | "schedule" | "bestPlayers" | "profile") {
    const nextParams = new URLSearchParams();
    nextParams.set("tab", tab);
    if (initialParams.returnInventorySlug || initialParams.inventorySlug) {
      nextParams.set("inventorySlug", initialParams.returnInventorySlug || initialParams.inventorySlug);
    }
    if (initialParams.returnTournamentId) {
      nextParams.set("tournamentId", initialParams.returnTournamentId);
    }
    window.location.assign(`/bird-dog?${nextParams.toString()}`);
  }

  async function logout() {
    try {
      await fetch("/api/session/logout", { method: "POST", cache: "no-store" });
    } finally {
      window.location.assign("/login");
    }
  }

  const notesStorageKey = useMemo(
    () => `bird_dog:team_notes:${(initialParams.teamId || initialParams.teamName).toLowerCase()}`,
    [initialParams.teamId, initialParams.teamName]
  );
  const playerNotesStorageKey = useMemo(
    () => `bird_dog:player_notes:${(initialParams.teamId || initialParams.teamName).toLowerCase()}`,
    [initialParams.teamId, initialParams.teamName]
  );

  useEffect(() => {
    setSelectedPlayers((prev) => {
      const valid = new Set(rosterRows.map((row) => rosterRowKey(row)));
      return prev.filter((key) => valid.has(key));
    });
  }, [rosterRows]);

  useEffect(() => {
    scheduleRowsRef.current = scheduleRows;
  }, [scheduleRows]);

  useEffect(() => {
    if (!scheduleRows.length) return;
    const hasUpcomingGame = scheduleRows.some((game, idx) => parseScheduleDateTime(game, idx).getTime() >= Date.now());
    if (!hasUpcomingGame) {
      setIncludeCompletedGames(true);
    }
  }, [scheduleRows]);

  useEffect(() => {
    rosterRowsRef.current = rosterRows;
  }, [rosterRows]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    const ctor = (window as unknown as { SpeechRecognition?: BrowserSpeechConstructor; webkitSpeechRecognition?: BrowserSpeechConstructor }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: BrowserSpeechConstructor }).webkitSpeechRecognition;
    if (!ctor) {
      setNotesStatus("Speech-to-text is unavailable in this browser. Audio recording still works.");
    }
  }, []);

  useEffect(() => {
    let raw = "";
    try {
      raw = window.localStorage.getItem(notesStorageKey) || "";
    } catch {
      return;
    }
    if (!raw) return;
    const parsed = parseJsonSafe<TeamNote[]>(raw, []);
    const sanitized = Array.isArray(parsed)
      ? parsed
        .map((item) => ({
          ...item,
          audioUrl: String(item?.audioUrl || "").startsWith("blob:") ? "" : item?.audioUrl
        }))
      : [];
    setTeamNotes(sanitized);
  }, [notesStorageKey]);

  useEffect(() => {
    let raw = "";
    try {
      raw = window.localStorage.getItem(playerNotesStorageKey) || "";
    } catch {
      return;
    }
    if (!raw) return;
    const parsed = parseJsonSafe<PlayerNotesMap>(raw, {});
    const sanitized = parsed && typeof parsed === "object"
      ? Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [
          key,
          {
            text: value?.text || "",
            audioUrl: String(value?.audioUrl || "").startsWith("blob:") ? "" : value?.audioUrl,
            updatedAt: value?.updatedAt || new Date(0).toISOString()
          }
        ])
      )
      : {};
    setPlayerNotes(sanitized);
  }, [playerNotesStorageKey]);

  useEffect(() => () => {
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    mediaRecorderRef.current?.stop();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    fallbackProcessorRef.current?.disconnect();
    fallbackSourceRef.current?.disconnect();
    fallbackAudioContextRef.current?.close().catch(() => undefined);
    fallbackProcessorRef.current = null;
    fallbackSourceRef.current = null;
    fallbackAudioContextRef.current = null;
    fallbackPcmChunksRef.current = [];
    fallbackTargetRef.current = null;
  }, []);

  function appendTeamNote(noteText: string, audioUrl?: string) {
    setTeamNotes((prev) => {
      const next: TeamNote[] = [
        {
          id: `team-note-${Date.now()}`,
          transcript: noteText || "Audio note",
          audioUrl: audioUrl || undefined,
          createdAt: new Date().toISOString()
        },
        ...prev
      ];
      try {
        window.localStorage.setItem(notesStorageKey, JSON.stringify(next));
      } catch {
        // Ignore storage write errors.
      }
      return next;
    });
  }

  function updatePlayerNoteText(playerKey: string, text: string) {
    setPlayerNotes((prev) => {
      const next = {
        ...prev,
        [playerKey]: {
          text,
          audioUrl: prev[playerKey]?.audioUrl || "",
          updatedAt: new Date().toISOString()
        }
      };
      try {
        window.localStorage.setItem(playerNotesStorageKey, JSON.stringify(next));
      } catch {
        // Ignore storage write errors.
      }
      return next;
    });
  }

  function savePlayerAudio(playerKey: string, audioUrl: string) {
    setPlayerNotes((prev) => {
      const next = {
        ...prev,
        [playerKey]: {
          text: prev[playerKey]?.text || "",
          audioUrl,
          updatedAt: new Date().toISOString()
        }
      };
      try {
        window.localStorage.setItem(playerNotesStorageKey, JSON.stringify(next));
      } catch {
        // Ignore storage write errors.
      }
      return next;
    });
  }

  function startSpeechCapture(target: NonNullable<RecorderTarget>) {
    const ctor = (window as unknown as { SpeechRecognition?: BrowserSpeechConstructor; webkitSpeechRecognition?: BrowserSpeechConstructor }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: BrowserSpeechConstructor }).webkitSpeechRecognition;
    if (!ctor) return false;
    try {
      const recognition = new ctor();
      recognition.lang = "en-US";
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.onresult = (event) => {
        let text = "";
        for (let i = 0; i < event.results.length; i += 1) {
          const fragment = event.results[i]?.[0]?.transcript || "";
          if (fragment) text += `${fragment} `;
        }
        const nextText = text.trim();
        if (!nextText) return;
        if (target === "team") {
          setTranscript(nextText);
          return;
        }
        if (target.startsWith("player:")) {
          updatePlayerNoteText(target.slice("player:".length), nextText);
        }
      };
      recognition.onerror = () => {
        setNotesStatus("Audio recording will continue, but speech-to-text is unavailable in this browser.");
      };
      recognition.onend = () => {
        if (speechRecognitionRef.current === recognition) {
          speechRecognitionRef.current = null;
        }
      };
      recognition.start();
      speechRecognitionRef.current = recognition;
      return true;
    } catch {
      return false;
    }
  }

  function stopSpeechCapture() {
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
  }

  async function startPcmFallbackCapture(stream: MediaStream, target: NonNullable<RecorderTarget>) {
    const AudioContextCtor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return false;
    try {
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      fallbackPcmChunksRef.current = [];
      fallbackSampleRateRef.current = audioContext.sampleRate;
      fallbackTargetRef.current = target;
      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        fallbackPcmChunksRef.current.push(new Float32Array(channel));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      fallbackAudioContextRef.current = audioContext;
      fallbackSourceRef.current = source;
      fallbackProcessorRef.current = processor;
      return true;
    } catch {
      return false;
    }
  }

  async function startAudioCapture(target: NonNullable<RecorderTarget>) {
    if (typeof window.navigator?.mediaDevices?.getUserMedia !== "function") {
      setNotesStatus("Audio recording is not supported in this browser.");
      return;
    }
    if (recorderState === "recording") {
      setNotesStatus("Stop the current recording before starting a new one.");
      return;
    }
    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      if (isSafariBrowser() && await startPcmFallbackCapture(stream, target)) {
        void startSpeechCapture(target);
        setRecorderState("recording");
        setRecordingTarget(target);
        setNotesStatus("Recording...");
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        if (await startPcmFallbackCapture(stream, target)) {
          void startSpeechCapture(target);
          setRecorderState("recording");
          setRecordingTarget(target);
          setNotesStatus("Recording...");
          return;
        }
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setNotesStatus("Audio recording is not supported in this browser.");
        return;
      }
      const mimeType = chooseRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream);
      mediaChunksRef.current = [];
      recorder.onerror = () => {
        setNotesStatus("Recording failed. Please retry and check microphone permissions.");
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) mediaChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (!mediaChunksRef.current.length) {
          stream.getTracks().forEach((track) => track.stop());
          mediaRecorderRef.current = null;
          mediaStreamRef.current = null;
          setRecorderState("idle");
          setRecordingTarget(null);
          setNotesStatus("No audio captured. Check mic access/input source and try again.");
          return;
        }
        const blob = new Blob(mediaChunksRef.current, { type: mimeType || recorder.mimeType || "audio/webm" });
        if (blob.size < 1024) {
          stream.getTracks().forEach((track) => track.stop());
          mediaRecorderRef.current = null;
          mediaStreamRef.current = null;
          setRecorderState("idle");
          setRecordingTarget(null);
          setNotesStatus("Recording was too short or silent. Please try again.");
          return;
        }
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        setRecorderState("idle");
        setRecordingTarget(null);
        void blobToDataUrl(blob)
          .then((dataUrl) => {
            if (!dataUrl) {
              setNotesStatus("Unable to save recording. Please retry.");
              return;
            }
            if (target === "team") {
              if (autoSaveTeamNoteRef.current) {
                const spoken = transcriptRef.current.trim();
                appendTeamNote(spoken || "Audio note", dataUrl);
                setTranscript("");
                setTeamAudioDraftUrl("");
                autoSaveTeamNoteRef.current = false;
                setNotesStatus("Note saved.");
                return;
              }
              setTeamAudioDraftUrl(dataUrl);
              setNotesStatus("Audio captured. Click Save Note.");
              return;
            } else if (target.startsWith("player:")) {
              savePlayerAudio(target.slice("player:".length), dataUrl);
            }
            setNotesStatus("Audio captured.");
          })
          .catch(() => {
            setNotesStatus("Unable to process recorded audio. Please retry.");
          });
      };
      mediaRecorderRef.current = recorder;
      recorder.start(500);
      void startSpeechCapture(target);
      setRecorderState("recording");
      setRecordingTarget(target);
      setNotesStatus("Recording...");
    } catch {
      setNotesStatus("Microphone permission is blocked. Allow mic access and retry.");
    }
  }

  function stopAudioCapture() {
    stopSpeechCapture();
    if (fallbackProcessorRef.current) {
      const target = fallbackTargetRef.current;
      const chunks = [...fallbackPcmChunksRef.current];
      const sampleRate = fallbackSampleRateRef.current || 44100;
      fallbackProcessorRef.current.disconnect();
      fallbackSourceRef.current?.disconnect();
      fallbackAudioContextRef.current?.close().catch(() => undefined);
      fallbackProcessorRef.current = null;
      fallbackSourceRef.current = null;
      fallbackAudioContextRef.current = null;
      fallbackPcmChunksRef.current = [];
      fallbackTargetRef.current = null;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      mediaStreamRef.current = null;
      setRecorderState("idle");
      setRecordingTarget(null);
      if (!target || !chunks.length) {
        setNotesStatus("No audio captured. Check mic and retry.");
        return;
      }
      const wavBlob = encodeWav(chunks, sampleRate);
      if (wavBlob.size < 1024) {
        setNotesStatus("Recording was too short or silent. Please try again.");
        return;
      }
      void blobToDataUrl(wavBlob)
        .then((dataUrl) => {
          if (!dataUrl) {
            setNotesStatus("Unable to save recording. Please retry.");
            return;
          }
          if (target === "team") {
            if (autoSaveTeamNoteRef.current) {
              const spoken = transcriptRef.current.trim();
              appendTeamNote(spoken || "Audio note", dataUrl);
              setTranscript("");
              setTeamAudioDraftUrl("");
              autoSaveTeamNoteRef.current = false;
              setNotesStatus("Note saved.");
              return;
            }
            setTeamAudioDraftUrl(dataUrl);
            setNotesStatus("Audio captured. Click Save Note.");
            return;
          }
          if (target.startsWith("player:")) {
            savePlayerAudio(target.slice("player:".length), dataUrl);
          }
          setNotesStatus("Audio captured.");
        })
        .catch(() => {
          setNotesStatus("Unable to process recorded audio. Please retry.");
        });
      return;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    setRecorderState("idle");
    setRecordingTarget(null);
  }

  async function startMic() {
    if (recorderState === "recording" && recordingTarget !== "team") {
      setNotesStatus("A player note recording is active. Stop it first.");
      return;
    }
    if (recorderState === "recording" && recordingTarget === "team") {
      return;
    }
    autoSaveTeamNoteRef.current = false;
    await startAudioCapture("team");
  }

  function stopMic() {
    stopSpeechCapture();
    if ((mediaRecorderRef.current || fallbackProcessorRef.current) && recordingTarget === "team") {
      autoSaveTeamNoteRef.current = true;
      stopAudioCapture();
      return;
    }
    autoSaveTeamNoteRef.current = false;
    setRecorderState("idle");
    setRecordingTarget(null);
  }

  function saveTeamNote() {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript && !teamAudioDraftUrl) return;
    appendTeamNote(cleanTranscript || "Audio note", teamAudioDraftUrl || undefined);
    setTranscript("");
    setTeamAudioDraftUrl("");
    setNotesStatus("Note saved.");
  }

  function togglePlayerAudio(row: TeamRosterRow) {
    const playerKey = rosterRowKey(row);
    const playerTarget: RecorderTarget = `player:${playerKey}`;
    if (recorderState === "recording" && recordingTarget === playerTarget) {
      autoSaveTeamNoteRef.current = false;
      stopAudioCapture();
      return;
    }
    if (recorderState === "recording") {
      setNotesStatus("Stop the current recording before recording this player note.");
      return;
    }
    autoSaveTeamNoteRef.current = false;
    void startAudioCapture(playerTarget);
  }

  function toggleBestPlayer(row: TeamRosterRow) {
    const key = rosterRowKey(row);
    setSelectedPlayers((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }

  function clearTeamSelection() {
    setSelectedPlayers([]);
  }

  function addSelectedPlayersToCart() {
    const selectedSet = new Set(selectedPlayers);
    const selectedRoster = rosterRows.filter((row) => selectedSet.has(rosterRowKey(row)));
    if (!selectedRoster.length) {
      setPlannerStatus("Select at least one player from this roster before adding to cart.");
      return;
    }

    setCrossTeamCartPlayers((prev) => {
      const merged = new Map<string, CrossTeamCartPlayer>(
        prev.map((item) => [desiredSelectionKey(item), item])
      );
      selectedRoster.forEach((row) => {
        const rowKey = rosterRowKey(row);
        const selectionKey = `team:${initialParams.teamId}:${rowKey}`;
        merged.set(selectionKey, {
          playerId: selectionKey,
          selectionKey,
          name: row.name || "-",
          team: row.team || initialParams.teamName || "Unknown Team",
          hometown: row.hometown || "",
          sourceTeamId: initialParams.teamId || "",
          sourceTeamName: initialParams.teamName || row.team || ""
        });
      });
      const next = Array.from(merged.values());
      writeRosterCartStorage(cartStorageKey, next);
      return next;
    });

    setPlannerStatus(
      `Added ${selectedRoster.length} player(s) from ${initialParams.teamName || "this team"} to final cart. Open another team to keep adding.`
    );
  }

  function removeCartPlayer(selectionKey: string) {
    setCrossTeamCartPlayers((prev) => {
      const next = prev.filter((item) => desiredSelectionKey(item) !== selectionKey);
      writeRosterCartStorage(cartStorageKey, next);
      return next;
    });
  }

  function clearCrossTeamCart() {
    setCrossTeamCartPlayers([]);
    writeRosterCartStorage(cartStorageKey, []);
    setPlannerStatus("Final player cart cleared.");
  }

  function goToTournamentRosterSelection() {
    const nextParams = new URLSearchParams();
    nextParams.set("tab", "notes");
    if (initialParams.returnInventorySlug || initialParams.inventorySlug) {
      nextParams.set("inventorySlug", initialParams.returnInventorySlug || initialParams.inventorySlug);
    }
    if (initialParams.returnTournamentId) {
      nextParams.set("tournamentId", initialParams.returnTournamentId);
    }
    window.location.assign(`/bird-dog?${nextParams.toString()}`);
  }

  function hasTravelerForBooking(profile: TravelerProfile) {
    return Boolean(
      profile.firstName.trim()
      && profile.lastName.trim()
      && profile.dateOfBirth.trim()
      && profile.email.trim()
      && profile.phone.trim()
      && profile.countryCallingCode.trim()
      && profile.nationality.trim()
    );
  }

  async function geocodeLocation(address: string) {
    const key = address.trim().toLowerCase();
    if (!key) return null;
    if (geocodeCacheRef.current.has(key)) {
      return geocodeCacheRef.current.get(key) || null;
    }

    try {
      const res = await fetch(`/api/maps/geocode?address=${encodeURIComponent(address)}`);
      const data = await res.json().catch(() => ({ location: null }));
      const location = data?.location && typeof data.location.lat === "number" && typeof data.location.lng === "number"
        ? { lat: data.location.lat, lng: data.location.lng }
        : null;
      geocodeCacheRef.current.set(key, location);
      return location;
    } catch {
      geocodeCacheRef.current.set(key, null);
      return null;
    }
  }

  async function detectBrowserLocationLabel() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return null;
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 }
      );
    });
    if (!position) return null;

    try {
      const reverse = await fetch(
        `/api/maps/reverse-geocode?lat=${position.coords.latitude}&lng=${position.coords.longitude}`,
        { cache: "no-store" }
      );
      if (reverse.ok) {
        const data = await reverse.json().catch(() => ({}));
        const label = String(data?.location?.label || "").trim();
        if (label) return label;
      }
    } catch {
      // Keep default label below.
    }
    return "Current location";
  }

  async function resolveCoachStartLocation() {
    const raw = coachStartLocation.trim();
    if (raw && !/^current (city|location)$/i.test(raw)) {
      return { label: raw, source: "manual" as const };
    }

    const detected = await detectBrowserLocationLabel();
    if (detected) {
      setCoachStartLocation(detected);
      return { label: detected, source: "live" as const };
    }

    const fallback = "Current location";
    setCoachStartLocation(fallback);
    return { label: fallback, source: "fallback" as const };
  }

  async function recommendTravel(from: string, to: string) {
    const fromGeo = await geocodeLocation(from);
    const toGeo = await geocodeLocation(to);
    if (!fromGeo || !toGeo) return estimateTravelNoGeo(from, to);

    const km = haversineKm(fromGeo, toGeo);
    if (km > 550) return { mode: "Flight + Cab", minutes: Math.round((km / 760) * 60 + 180) };
    if (km > 180) return { mode: "Train / Bus + Cab", minutes: Math.round((km / 95) * 60 + 35) };
    if (km > 30) return { mode: "Cab / Car", minutes: Math.round((km / 45) * 60 + 12) };
    return { mode: "Metro / Walk", minutes: Math.round((km / 22) * 60 + 8) };
  }

  async function checkWeatherRisks(nextSchedule: TeamScheduleRow[]) {
    const now = Date.now();
    const items = nextSchedule
      .map((row, idx) => ({
        id: `${row.gameNo || idx + 1}`,
        location: row.field || "",
        at: parseScheduleDateTime(row, idx).toISOString()
      }))
      .filter((row) => row.location && new Date(row.at).getTime() >= now)
      .slice(0, 20);
    if (!items.length) return;

    const res = await fetch("/api/weather/risks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items })
    });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    const alerts = Array.isArray(body?.alerts) ? body.alerts : [];
    const hash = alerts.map((a: { title?: string; detail?: string }) => `${a.title || ""}|${a.detail || ""}`).join("~");
    if (!hash || hash === weatherAlertHashRef.current) return;
    weatherAlertHashRef.current = hash;

    for (const alert of alerts.slice(0, 5)) {
      pushMonitorAlert({
        id: `wx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "weather",
        severity: (alert?.severity || "medium") as "low" | "medium" | "high",
        title: String(alert?.title || "Weather watch"),
        detail: String(alert?.detail || "Weather risk detected for an upcoming game.")
      });
    }
  }

  function compareAndAlertScheduleChanges(previousRows: TeamScheduleRow[], nextRows: TeamScheduleRow[]) {
    const prevByGame = new Map(previousRows.map((row) => [row.gameNo || scheduleRowKey(row), row]));
    const nextByGame = new Map(nextRows.map((row) => [row.gameNo || scheduleRowKey(row), row]));
    const removed: TeamScheduleRow[] = [];
    const changed: Array<{ before: TeamScheduleRow; after: TeamScheduleRow }> = [];

    for (const [id, before] of prevByGame.entries()) {
      const after = nextByGame.get(id);
      if (!after) {
        removed.push(before);
        continue;
      }
      if (
        before.date !== after.date
        || before.time !== after.time
        || before.field !== after.field
        || before.homeTeam !== after.homeTeam
        || before.awayTeam !== after.awayTeam
      ) {
        changed.push({ before, after });
      }
    }

    if (removed.length) {
      pushMonitorAlert({
        id: `pg-remove-${Date.now()}`,
        kind: "pg_change",
        severity: "high",
        title: "PG schedule change detected",
        detail: `${removed.length} game(s) disappeared from Perfect Game. Likely cancellation/reschedule. Approve regenerate to modify your coach travel plan.`
      });
    }
    if (changed.length) {
      pushMonitorAlert({
        id: `pg-change-${Date.now()}`,
        kind: "pg_change",
        severity: "medium",
        title: "PG game timing/location updated",
        detail: `${changed.length} game(s) changed date/time/field. Approve regenerate to keep bookings aligned.`
      });
    }
  }

  async function runLiveMonitorSync() {
    if (monitorSyncRunningRef.current) return;
    monitorSyncRunningRef.current = true;
    setMonitoring(true);
    try {
      const data = await fetchTeamDetailsRemote();
      const previous = scheduleRowsRef.current;
      const nextFingerprint = scheduleFingerprint(data.schedule);
      const hasChange = nextFingerprint !== scheduleFingerprintRef.current;
      if (hasChange) {
        compareAndAlertScheduleChanges(previous, data.schedule);
        setScheduleRows(data.schedule);
        const mergedRoster = ensureRosterTeam(data.roster.length ? data.roster : rosterRowsRef.current, initialParams.teamName);
        setRosterRows(mergedRoster);
        scheduleFingerprintRef.current = nextFingerprint;
        writeTeamDetailsCache(teamDetailsCacheKey(initialParams), { schedule: data.schedule, roster: mergedRoster });
        if (approvedPlan) {
          setPlannerStatus("Perfect Game updated this team schedule. Approve regenerate to modify travel bookings.");
        }
      }
      await checkWeatherRisks(data.schedule);
      setLastPgSyncAt(new Date().toISOString());
    } catch {
      // Keep prior data if monitor sync fails.
    } finally {
      monitorSyncRunningRef.current = false;
      setMonitoring(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!initialParams.inventorySlug || !initialParams.teamId) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void runLiveMonitorSync();
    };
    const onFocus = () => tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const id = window.setInterval(tick, 30000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    tick();
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initialParams.inventorySlug, initialParams.teamId]);

  async function approveRegenerateFromAlerts() {
    setMonitorAlerts([]);
    await runLiveMonitorSync();
    await generateCoachSchedule();
    setApprovedPlan(false);
    setPlannerStatus("Plan regenerated from latest PG/weather updates. Review and click Approve Recommendation to modify bookings.");
  }

  async function generateCoachSchedule() {
    if (!rosterRows.length || !scheduleRows.length) {
      setPlannerStatus("Load roster + schedule first, then generate.");
      return;
    }
    if (!selectedPlayers.length) {
      setPlannerStatus("Select at least one player from roster.");
      return;
    }

    setPlannerLoading(true);
    setPlannerStatus("");
    setBookingStatus("");
    setBookingResults([]);
    setApprovedPlan(false);

    try {
      const selectedSet = new Set(selectedPlayers);
      const selectedRoster = rosterRows.filter((row) => selectedSet.has(rosterRowKey(row)));
      const sortedGames = [...scheduleRows].sort(
        (a, b) => parseScheduleDateTime(a, 0).getTime() - parseScheduleDateTime(b, 0).getTime()
      );
      const now = Date.now();
      const upcomingGames = sortedGames.filter((game, idx) => parseScheduleDateTime(game, idx).getTime() >= now);
      const skippedPastCount = Math.max(0, sortedGames.length - upcomingGames.length);

      const generationGames = includeCompletedGames ? sortedGames : upcomingGames;
      if (!generationGames.length) {
        const latest = sortedGames.length
          ? parseScheduleDateTime(sortedGames[sortedGames.length - 1], sortedGames.length - 1)
          : null;
        setGeneratedSteps([]);
        setPlannerStatus(
          latest
            ? `All listed games for ${initialParams.teamName} are completed (latest game: ${latest.toLocaleString()}). Turn on "Include completed matches" to generate a retrospective route.`
            : `All listed games for ${initialParams.teamName} are completed. Turn on "Include completed matches" to generate a retrospective route.`
        );
        return;
      }

      const nextSteps: GeneratedCoachStep[] = [];
      let currentPoint = coachStartLocation.trim() || "Current City";

      for (let idx = 0; idx < generationGames.length; idx += 1) {
        const game = generationGames[idx];
        const gameAt = parseScheduleDateTime(game, idx);
        const venue = extractLocation(game.field || "");
        const opponent = pickOpponent(initialParams.teamName, game.homeTeam, game.awayTeam);

        const travel = await recommendTravel(currentPoint, venue);
        const departAt = new Date(gameAt.getTime() - travel.minutes * 60 * 1000);
        const lateMinutes = departAt.getTime() < Date.now() ? Math.max(0, Math.round((Date.now() - departAt.getTime()) / 60000)) : 0;

        nextSteps.push({
          at: departAt.toISOString(),
          title: `Travel ${currentPoint} -> ${venue}`,
          detail: `${travel.mode} · ETA ${travel.minutes} min${lateMinutes ? ` · leave ASAP (late by ~${lateMinutes} min)` : ""}`,
          from: currentPoint,
          to: venue,
          mode: travel.mode
        });

        nextSteps.push({
          at: gameAt.toISOString(),
          title: `Watch ${initialParams.teamName} vs ${opponent}`,
          detail: `Field: ${game.field || "TBD"} · Selected players: ${selectedRoster.map((p) => p.name).join(", ")}`
        });

        currentPoint = venue;
      }

      setGeneratedSteps(nextSteps);
      if (includeCompletedGames) {
        setPlannerStatus(
          skippedPastCount
            ? `Included ${skippedPastCount} completed game(s). Generated ${nextSteps.length} coach steps for ${selectedRoster.length} selected players.`
            : `Generated ${nextSteps.length} coach steps for ${selectedRoster.length} selected players using completed games.`
        );
      } else {
        setPlannerStatus(
          skippedPastCount
            ? `Generated ${nextSteps.length} coach steps for ${selectedRoster.length} selected players. Skipped ${skippedPastCount} completed game(s).`
            : `Generated ${nextSteps.length} coach steps for ${selectedRoster.length} selected players.`
        );
      }
    } catch (error) {
      setPlannerStatus(error instanceof Error ? error.message : "Failed to generate schedule.");
    } finally {
      setPlannerLoading(false);
    }
  }

  async function approveRecommendation() {
    if (!generatedSteps.length) {
      setPlannerStatus("Generate recommendation first, then approve.");
      return;
    }
    const selectedSet = new Set(selectedPlayers);
    const selectedRoster = rosterRows.filter((row) => selectedSet.has(rosterRowKey(row)));
    const travelLegs = generatedSteps.filter((step) => step.mode);
    const firstLeg = travelLegs[0];
    const lastLeg = travelLegs[travelLegs.length - 1];

    const desiredPlayers = selectedRoster.map((row) => ({
      playerId: rosterRowKey(row),
      name: row.name,
      team: row.team || initialParams.teamName
    }));

    const payload = {
      flightSource: firstLeg?.from || coachStartLocation,
      flightDestination: lastLeg?.to || "",
      flightArrivalTime: generatedSteps[0]?.at || "",
      hotelName: "",
      notes: "Coach-approved recommendation generated from tournament roster selection.",
      desiredPlayers,
      generatedPlan: generatedSteps.map((step) => ({
        at: step.at,
        title: step.title,
        detail: step.detail,
        from: step.from || "",
        to: step.to || "",
        mode: step.mode || ""
      }))
    };
    setApprovedPlan(true);
    setPlannerStatus("Recommendation approved. Syncing coach schedule...");
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      setPlannerStatus("Recommendation approved locally. Cloud sync is unavailable right now.");
    } else {
      setPlannerStatus("Recommendation approved and saved for the coach.");
    }

    if (hasTravelerForBooking(traveler)) {
      if (
        bookingPaymentRequired
        && (bookingPaymentMode === "saved_card" || bookingPaymentMode === "card")
        && !selectedPaymentMethodId
      ) {
        setBookingStatus("Add/select a saved card, then click Book Approved Travel.");
      } else if (bookingPaymentRequired && bookingPaymentMode === "upi" && !upiAuthorized) {
        setBookingStatus("Complete UPI authorization, then click Book Approved Travel.");
      } else {
        await executeProviderBookings({ trigger: "approve" });
      }
    } else {
      setBookingStatus("Approved. Using saved profile details for booking.");
    }
  }

  async function openUpiCheckout() {
    setUpiCheckoutLoading(true);
    const popup = typeof window === "undefined" ? null : window.open("", "_blank");
    if (popup) {
      try {
        popup.document.write("<title>Opening UPI checkout...</title><p style='font-family:Arial,sans-serif;padding:12px;'>Opening secure UPI checkout...</p>");
      } catch {
        // Ignore popup rendering issues.
      }
    }
    try {
      const returnTo = typeof window === "undefined"
        ? "/bird-dog/team"
        : `${window.location.pathname}${window.location.search}`;
      const res = await fetch("/api/payments/travel-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnTo,
          teamName: initialParams.teamName,
          tournamentName: initialParams.tournamentName
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.checkoutUrl) {
        if (popup && !popup.closed) popup.close();
        setBookingStatus(body?.error || `Unable to open UPI checkout (${res.status}).`);
        return;
      }
      setUpiAuthorized(false);
      if (popup && !popup.closed) {
        popup.location.href = body.checkoutUrl;
        try {
          popup.focus();
        } catch {
          // Ignore focus errors.
        }
      } else {
        const opened = window.open(body.checkoutUrl, "_blank");
        if (!opened) {
          window.location.assign(body.checkoutUrl);
        }
      }
      setBookingStatus("UPI checkout opened. Complete payment, then return and click Book Approved Travel.");
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      setBookingStatus(error instanceof Error ? error.message : "Unable to open UPI checkout.");
    } finally {
      setUpiCheckoutLoading(false);
    }
  }

  async function executeProviderBookings(input?: { trigger?: "approve" | "manual" }) {
    if (!approvedPlan && input?.trigger !== "approve") {
      setBookingStatus("Approve recommendation first, then create bookings.");
      return;
    }
    if (bookingPaymentRequired) {
      if ((bookingPaymentMode === "saved_card" || bookingPaymentMode === "card") && !selectedPaymentMethodId) {
        setBookingStatus("Add/select a saved card first for card payment.");
        return;
      }
      if (bookingPaymentMode === "upi" && !upiAuthorized) {
        setBookingStatus("Complete UPI authorization first.");
        return;
      }
    }
    const travelLegs = generatedSteps.filter((step) => step.mode && step.from && step.to);
    if (!travelLegs.length) {
      setBookingStatus("No travel legs found to book.");
      return;
    }

    if (!hasTravelerForBooking(traveler)) {
      setProfileEditorOpen(true);
      setBookingStatus("Profile details are incomplete. Update details from My Profile and try again.");
      return;
    }

    const prepared = prepareBookingLegsForProvider(
      travelLegs.map((leg) => ({
        at: leg.at,
        from: String(leg.from || ""),
        to: String(leg.to || ""),
        mode: String(leg.mode || "")
      })),
      bookingTestModeEnabled && bookingTestMode
    );

    setBookingLoading(true);
    setBookingStatus("");
    setBookingResults([]);
    try {
      if (bookingPaymentRequired && (bookingPaymentMode === "saved_card" || bookingPaymentMode === "card")) {
        const authRes = await fetch("/api/payments/travel-authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentMethodId: selectedPaymentMethodId,
            teamName: initialParams.teamName,
            tournamentName: initialParams.tournamentName
          })
        });
        const authBody = await authRes.json().catch(() => ({}));
        if (!authRes.ok) {
          setBookingStatus(authBody?.error || `Payment authorization failed (${authRes.status}).`);
          return;
        }
      }

      const res = await fetch("/api/bookings/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: initialParams.teamName,
          tournamentName: initialParams.tournamentName,
          travelLegs: prepared.legs,
          bookingTestMode: bookingTestModeEnabled && bookingTestMode,
          traveler
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBookingStatus(body?.error || `Booking failed (${res.status})`);
        return;
      }
      const results: BookingProviderResult[] = Array.isArray(body?.results) ? body.results : [];
      setBookingResults(results);
      const booked = results.filter((item) => item.status === "booked").length;
      const quoted = results.filter((item) => item.status === "quoted").length;
      const failed = results.filter((item) => item.status === "failed").length;
      const skipped = results.filter((item) => item.status === "skipped").length;
      const refs = results
        .filter((item) => item.reference)
        .slice(0, 3)
        .map((item) => `${item.provider}: ${item.reference}`)
        .join(" | ");
      const parts = [`Booking run complete. Booked: ${booked}, Quoted: ${quoted}, Failed: ${failed}, Skipped: ${skipped}${refs ? ` (${refs})` : ""}`];
      if (bookingPaymentRequired && (bookingPaymentMode === "saved_card" || bookingPaymentMode === "card")) {
        parts.push("Card authorization succeeded with selected saved card.");
      } else if (bookingPaymentRequired && bookingPaymentMode === "upi") {
        parts.push("UPI authorization completed via checkout.");
      }
      if (prepared.statusNote) parts.push(prepared.statusNote);
      if (!booked && !quoted && skipped > 0) {
        parts.push("Only local-transfer legs were detected (cab/walk). No OTA flight/bus leg required for this run.");
      }
      setBookingStatus(parts.join(" "));
      if (booked || quoted) {
        goToCoachScheduleTab();
      }
    } catch (error) {
      setBookingStatus(error instanceof Error ? error.message : "Booking request failed.");
    } finally {
      setBookingLoading(false);
    }
  }

  function dismissMonitorAlert(id: string) {
    setMonitorAlerts((prev) => prev.filter((item) => item.id !== id));
  }

  const filteredSchedule = useMemo(() => {
    const query = scheduleSearch.trim().toLowerCase();
    if (!query) return scheduleRows;
    return scheduleRows.filter((row) =>
      `${row.date} ${row.time} ${row.field} ${row.homeTeam} ${row.awayTeam}`.toLowerCase().includes(query)
    );
  }, [scheduleRows, scheduleSearch]);

  const filteredRoster = useMemo(() => {
    const query = normalizeSearchText(rosterSearch);
    if (!query) return rosterRows;
    const tokens = query.split(" ").filter(Boolean);
    return rosterRows
      .map((row, index) => ({
        row,
        index,
        haystack: rosterSearchHaystack(row),
        score: rosterSearchScore(row, query, tokens)
      }))
      .filter((entry) => tokens.every((token) => entry.haystack.includes(token)))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.row);
  }, [rosterRows, rosterSearch]);

  const smartRosterResults = useMemo(() => {
    if (!rosterSearch.trim()) return [];
    return filteredRoster.slice(0, 20);
  }, [filteredRoster, rosterSearch]);
  const selectedBestPlayerRows = useMemo(() => {
    const selectedSet = new Set(selectedPlayers);
    return rosterRows.filter((row) => selectedSet.has(rosterRowKey(row)));
  }, [rosterRows, selectedPlayers]);

  function scrollToSection(sectionId: string) {
    if (typeof window === "undefined") return;
    const node = window.document.getElementById(sectionId);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const cardBasedMode = bookingPaymentMode === "saved_card" || bookingPaymentMode === "card";
  const paymentReady = !bookingPaymentRequired
    || (cardBasedMode ? Boolean(selectedPaymentMethodId) : upiAuthorized);
  const travelerProfileComplete = hasTravelerForBooking(traveler);
  const travelerName = `${traveler.firstName} ${traveler.lastName}`.trim();
  const orgPrimary = sessionTheme?.orgPrimary || "#1f3a5f";
  const orgAccent = sessionTheme?.orgAccent || "#d7a316";
  const bgValue = "#060b16";
  const bgImageValue = `radial-gradient(circle at 12% 14%, ${alphaColor(orgPrimary, 0.28)} 0%, transparent 33%), radial-gradient(circle at 88% 16%, ${alphaColor(orgAccent, 0.2)} 0%, transparent 28%), linear-gradient(175deg, #060b16 0%, #0a1326 46%, #0b1322 100%)`;
  const panelValue = `linear-gradient(155deg, ${alphaColor(orgPrimary, 0.22)} 0%, rgba(10, 18, 34, 0.92) 72%)`;
  const inkValue = "#edf3ff";
  const lineValue = alphaColor(orgAccent, 0.34);
  const cardInkValue = "#f8fbff";
  const cardMutedValue = "rgba(214, 226, 245, 0.8)";

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
    >
      <section className="top-menu">
        <button
          className="secondary"
          type="button"
          onClick={goBackOneStep}
        >
          {inlineMode ? "Close" : "Back"}
        </button>
        {!inlineMode ? (
          <button
            className="secondary menu-trigger"
            type="button"
            aria-label="Open navigation menu"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            ☰
          </button>
        ) : null}
        {!inlineMode && menuOpen ? (
          <div className="menu-dropdown">
            <div className="menu-brand">
              <img src="/branding/a-point-scout-icon.svg?v=20260506k" alt="APOINT SCOUT" />
              <div className="menu-brand-copy">
                <p>APOINT SCOUT</p>
                <p>{String(sessionTheme?.orgName || "Apoint Scout Admin")}</p>
              </div>
            </div>
            <button type="button" onClick={() => openAppTab("tournaments")}>Tournament Dashboard</button>
            <button type="button" className="active" onClick={() => openAppTab("schedule")}>Schedules</button>
            <button type="button" onClick={() => openAppTab("bestPlayers")}>My Players</button>
            <button type="button" onClick={() => openAppTab("profile")}>My Profile</button>
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
      </section>

      <section className="panel" id="team-schedule-section">
        <h2>Team Schedule & Roster</h2>
        <p className="muted">Tournament: {initialParams.tournamentName || "Tournament"}</p>
        <p className="muted">Team: {initialParams.teamName || "-"}</p>
        {loading ? <p className="muted">Loading tournament details...</p> : null}
        {error ? <p className="muted">Load error: {error}</p> : null}
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <button
            className="secondary"
            type="button"
            onClick={() => downloadPdfLikeReport(
              `Team Schedule - ${initialParams.teamName}`,
              ["Date", "Time", "Field / Location", "Opponent"],
              filteredSchedule.map((row) => {
                const location =
                  /@\s*$/.test((row.field || "").trim()) && looksLikeLocation(row.homeTeam || "")
                    ? `${row.field} ${row.homeTeam}`
                    : (row.field || "");
                return [row.date || "-", row.time || "-", location.trim() || "-", pickOpponent(initialParams.teamName, row.homeTeam, row.awayTeam)];
              })
            )}
          >
            Download Schedule PDF
          </button>
        </div>
        <label>
          Search Schedule
          <input
            value={scheduleSearch}
            onChange={(e) => setScheduleSearch(e.target.value)}
            placeholder="Search date, time, field, opponent"
          />
        </label>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="roster-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Field / Location</th>
                <th>Opponent</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchedule.length ? filteredSchedule.map((row, idx) => (
                <tr key={`${row.gameNo}-${idx}`}>
                  <td>{row.date || "-"}</td>
                  <td>{row.time || "-"}</td>
                  <td>{(/\@\s*$/.test((row.field || "").trim()) && looksLikeLocation(row.homeTeam || "") ? `${row.field} ${row.homeTeam}` : row.field || "-").trim()}</td>
                  <td>{pickOpponent(initialParams.teamName, row.homeTeam, row.awayTeam)}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4}>No schedule rows found yet for this team.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="row wrap" style={{ marginBottom: 8 }}>
            <button
              className="secondary"
              type="button"
              onClick={() => downloadPdfLikeReport(
                `Team Roster - ${initialParams.teamName}`,
                ["No", "Name", "Position", "School", "Hometown", "Commitment"],
                filteredRoster.map((row) => [
                  row.no || "-",
                  row.name || "-",
                  row.position || "-",
                  row.school || "-",
                  row.hometown || "-",
                  row.commitment || "-"
                ])
              )}
            >
              Download Roster PDF
            </button>
          </div>
          <label>
            Search Roster
            <input
              value={rosterSearch}
              onChange={(e) => setRosterSearch(e.target.value)}
              placeholder="Search no, name, position, school, hometown"
            />
          </label>
          <div className="row wrap" style={{ marginTop: 6 }}>
            <p className="muted" style={{ margin: 0 }}>
              Team selections: {selectedBestPlayerRows.length} | Final cart (all teams): {crossTeamCartPlayers.length}
            </p>
            <button type="button" className="secondary" onClick={clearTeamSelection} disabled={!selectedPlayers.length}>
              Clear Team Selection
            </button>
            <button type="button" onClick={addSelectedPlayersToCart} disabled={!selectedPlayers.length}>
              Add Selected To Final Cart
            </button>
          </div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
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
                {filteredRoster.length ? filteredRoster.map((row, idx) => (
                  <tr key={`${row.no}-${row.name}-${idx}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedPlayers.includes(rosterRowKey(row))}
                        onChange={() => toggleBestPlayer(row)}
                      />
                    </td>
                    <td>{row.no || "-"}</td>
                    <td>{row.name || "-"}</td>
                    <td>{row.position || "-"}</td>
                    <td>{row.school || "-"}</td>
                    <td>{row.hometown || "-"}</td>
                    <td>{row.commitment || "-"}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7}>No roster rows found yet for this team.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="panel" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Final Player Cart (All Teams)</h3>
            <p className="muted">Add players from any team roster, then go back to tournament view for final schedule generation.</p>
            {crossTeamCartPlayers.length ? (
              <>
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="roster-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Team</th>
                        <th>From Team</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crossTeamCartPlayers.map((player) => {
                        const selectionKey = desiredSelectionKey(player);
                        return (
                          <tr key={selectionKey}>
                            <td>{player.name}</td>
                            <td>{player.team}</td>
                            <td>{player.sourceTeamName || "-"}</td>
                            <td className="action-cell">
                              <button type="button" className="secondary" onClick={() => removeCartPlayer(selectionKey)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <button type="button" className="secondary" onClick={clearCrossTeamCart}>
                    Clear Final Cart
                  </button>
                  <button type="button" onClick={goToTournamentRosterSelection}>
                    Finalize In Tournament View
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">No players in final cart yet.</p>
            )}
          </div>
        </div>
      </section>

    </main>
  );
}
