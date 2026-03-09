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

const CACHE_KEY = "bird_dog_tournament_cache";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString();
}

function makeOrgKey(orgId: string, userId: string, key: string) {
  return `bird_dog:${orgId}:${userId}:${key}`;
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

  const selectedTournament = useMemo(
    () => tournaments.find((t) => t.id === selectedTournamentId) || null,
    [tournaments, selectedTournamentId]
  );

  const games = selectedTournament?.games || [];
  const players = useMemo(() => uniquePlayers(games), [games]);

  const [watchlist, setWatchlist] = useState<string[]>([]);
  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);

  const [notes, setNotes] = useState<ScoutNote[]>([]);
  const [pulses, setPulses] = useState<PulseEvent[]>([]);

  const [selectedGameId, setSelectedGameId] = useState("");
  const [pulseMessage, setPulseMessage] = useState("Pitcher change");

  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [transcript, setTranscript] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);

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

  async function queueHarvestJob() {
    if (!jobHint.trim()) return;
    const res = await fetch("/api/harvest/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company,
        tournamentHint: jobHint.trim()
      })
    });
    if (!res.ok) return;
    await fetchJobs();
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

  if (authLoading) {
    return <main className="bd-root"><p>Loading session...</p></main>;
  }

  return (
    <main className="bd-root" style={{ ["--org-primary" as string]: brand.primary, ["--org-accent" as string]: brand.accent }}>
      <section className="bd-header">
        <div>
          <h1>Project Bird Dog</h1>
          <p className="muted">
            {user?.name} ({user?.email}) - {user?.orgName}
          </p>
          <p className="muted">Status: {online ? "Online" : "Offline"} {syncing ? "| Syncing..." : ""} {lastSyncAt ? `| Last sync ${timeLabel(lastSyncAt)}` : ""}</p>
          {syncError ? <p className="muted">{syncError}</p> : null}
        </div>
        <div className="org-chip">
          <strong>{brand.logoText}</strong>
          <span>{brand.name}</span>
          <button className="secondary" onClick={() => void logout()}>Log Out</button>
        </div>
      </section>

      <section className="panel grid2">
        <div>
          <h2>Data Harvester</h2>
          <div className="row">
            <label>
              Company
              <select
                value={company}
                onChange={(e) => {
                  const next = e.target.value as "PG" | "PBR";
                  setCompany(next);
                }}
              >
                {(companies.length ? companies : ["PG", "PBR"]).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <button onClick={() => void loadCompanyData(company)}>{loadingHarvest ? "Harvesting..." : "Load"}</button>
          </div>

          <label>
            Tournament
            <select
              value={selectedTournamentId}
              onChange={(e) => {
                const nextTournamentId = e.target.value;
                void loadTournamentDetails(company, nextTournamentId);
              }}
            >
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>{t.name} - {t.city} ({dateLabel(t.date)})</option>
              ))}
            </select>
          </label>

          <div className="row wrap">
            <button className="secondary" onClick={cacheTournamentOffline}>Download Offline</button>
            <button className="secondary" onClick={loadCachedTournament}>Load Offline Cache</button>
            <button className="secondary" onClick={() => void syncNow()}>Force Sync</button>
          </div>
          <div className="panel" style={{ marginTop: 10 }}>
            <h3>Harvester Queue</h3>
            <div className="row wrap">
              <input value={jobHint} onChange={(e) => setJobHint(e.target.value)} placeholder="Tournament hint (example: PG Spring Showdown)" />
              <button className="secondary" onClick={() => void queueHarvestJob()}>Queue Scrape Job</button>
              <button className="secondary" onClick={() => void fetchJobs()}>{loadingJobs ? "Loading..." : "Refresh Jobs"}</button>
            </div>
            <div className="log-list" style={{ maxHeight: 180 }}>
              {jobs.length ? jobs.map((job) => (
                <article key={job.id} className="log-card">
                  <p><strong>{job.company}</strong> - {job.tournament_hint}</p>
                  <p>{job.status} at {dateLabel(job.created_at)} {timeLabel(job.created_at)}</p>
                </article>
              )) : <p className="muted">No harvest jobs yet.</p>}
            </div>
          </div>
        </div>

        <div>
          <h2>Scout Cockpit</h2>
          <label>
            Active Game
            <select value={selectedGameId} onChange={(e) => setSelectedGameId(e.target.value)}>
              {games.map((g) => (
                <option key={g.id} value={g.id}>{timeLabel(g.startTime)} - {g.field} ({g.homeTeam} vs {g.awayTeam})</option>
              ))}
            </select>
          </label>
          <div className="pulse-box">
            <input value={pulseMessage} onChange={(e) => setPulseMessage(e.target.value)} placeholder="Pitcher change / rain delay" />
            <button className="pulse" onClick={sendPulse}>PULSE</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Active Watchlist</h2>
        <div className="player-grid">
          {players.map((p) => {
            const active = watchlistSet.has(p.id) || Boolean(p.mustSee);
            return (
              <button key={p.id} className={`player-card ${active ? "active" : ""}`} onClick={() => toggleWatch(p.id)} type="button">
                <strong>{p.name}</strong>
                <span>{p.position}</span>
                <small>{p.school}</small>
              </button>
            );
          })}
        </div>
      </section>

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
    </main>
  );
}
