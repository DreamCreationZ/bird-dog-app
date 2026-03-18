"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  initialParams: {
    inventorySlug: string;
    teamId: string;
    teamName: string;
    teamUrl: string;
    eventId: string;
    tournamentName: string;
    tournamentIcon: string;
    returnTab: string;
    returnInventorySlug: string;
    returnTournamentId: string;
  };
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
  position: string;
  school: string;
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
  start: () => void;
  stop: () => void;
};

type BrowserSpeechConstructor = new () => BrowserSpeechRecognition;

type TeamNote = {
  id: string;
  transcript: string;
  createdAt: string;
};

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
  const v = value.toLowerCase();
  return /high school|complex|park|field|stadium|baseball|academy|facility|, [a-z]{2}\b| - [a-z]{2}\b/.test(v);
}

function normalizeTeamName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pickOpponent(teamName: string, homeTeam: string, awayTeam: string) {
  const needle = normalizeTeamName(teamName);
  const home = normalizeTeamName(homeTeam);
  const away = normalizeTeamName(awayTeam);
  if (needle && home && (home === needle || home.includes(needle) || needle.includes(home))) return awayTeam;
  if (needle && away && (away === needle || away.includes(needle) || needle.includes(away))) return homeTeam;
  return awayTeam || homeTeam || "-";
}

export default function TeamDetailsClient({ initialParams }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scheduleRows, setScheduleRows] = useState<TeamScheduleRow[]>([]);
  const [rosterRows, setRosterRows] = useState<TeamRosterRow[]>([]);
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [transcript, setTranscript] = useState("");
  const [teamNotes, setTeamNotes] = useState<TeamNote[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/harvest/team", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inventorySlug: initialParams.inventorySlug,
            teamId: initialParams.teamId,
            teamUrl: initialParams.teamUrl,
            teamName: initialParams.teamName,
            eventId: initialParams.eventId,
            tournamentId: initialParams.returnTournamentId
          })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed (${res.status})`);
        }
        const data = await res.json();
        if (!mounted) return;
        setScheduleRows(Array.isArray(data?.schedule) ? data.schedule : []);
        setRosterRows(Array.isArray(data?.roster) ? data.roster : []);
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
  }, [initialParams.eventId, initialParams.inventorySlug, initialParams.teamId, initialParams.teamName, initialParams.teamUrl]);

  const backHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("tab", initialParams.returnTab || "notes");
    if (initialParams.returnInventorySlug) params.set("inventorySlug", initialParams.returnInventorySlug);
    if (initialParams.returnTournamentId) params.set("tournamentId", initialParams.returnTournamentId);
    return `/bird-dog?${params.toString()}`;
  }, [initialParams.returnInventorySlug, initialParams.returnTab, initialParams.returnTournamentId]);

  function goBackOneStep() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(backHref);
  }

  const notesStorageKey = useMemo(
    () => `bird_dog:team_notes:${(initialParams.teamId || initialParams.teamName).toLowerCase()}`,
    [initialParams.teamId, initialParams.teamName]
  );

  useEffect(() => {
    const ctor = (window as unknown as { SpeechRecognition?: BrowserSpeechConstructor; webkitSpeechRecognition?: BrowserSpeechConstructor }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: BrowserSpeechConstructor }).webkitSpeechRecognition;
    setSpeechSupported(Boolean(ctor));
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(notesStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as TeamNote[];
    setTeamNotes(Array.isArray(parsed) ? parsed : []);
  }, [notesStorageKey]);

  function persistNotes(next: TeamNote[]) {
    setTeamNotes(next);
    window.localStorage.setItem(notesStorageKey, JSON.stringify(next));
  }

  function startMic() {
    const ctor = (window as unknown as { SpeechRecognition?: BrowserSpeechConstructor; webkitSpeechRecognition?: BrowserSpeechConstructor }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: BrowserSpeechConstructor }).webkitSpeechRecognition;
    if (!ctor) return;
    const recognition = new ctor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i]?.[0]?.transcript || "";
        if (result) text += `${result} `;
      }
      setTranscript(text.trim());
    };
    recognition.start();
    (window as unknown as { __bdTeamRecognition?: BrowserSpeechRecognition }).__bdTeamRecognition = recognition;
    setRecorderState("recording");
  }

  function stopMic() {
    const holder = window as unknown as { __bdTeamRecognition?: BrowserSpeechRecognition };
    holder.__bdTeamRecognition?.stop();
    holder.__bdTeamRecognition = undefined;
    setRecorderState("idle");
  }

  function saveTeamNote() {
    if (!transcript.trim()) return;
    const next: TeamNote[] = [
      {
        id: `team-note-${Date.now()}`,
        transcript: transcript.trim(),
        createdAt: new Date().toISOString()
      },
      ...teamNotes
    ];
    persistNotes(next);
    setTranscript("");
  }

  const filteredSchedule = useMemo(() => {
    const query = scheduleSearch.trim().toLowerCase();
    if (!query) return scheduleRows;
    return scheduleRows.filter((row) =>
      `${row.date} ${row.time} ${row.field} ${row.homeTeam} ${row.awayTeam}`.toLowerCase().includes(query)
    );
  }, [scheduleRows, scheduleSearch]);

  const filteredRoster = useMemo(() => {
    const query = rosterSearch.trim().toLowerCase();
    if (!query) return rosterRows;
    return rosterRows.filter((row) =>
      `${row.no} ${row.name} ${row.position} ${row.school}`.toLowerCase().includes(query)
    );
  }, [rosterRows, rosterSearch]);

  return (
    <main className="bd-root">
      <section className="panel">
        <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button
            className="secondary"
            type="button"
            onClick={goBackOneStep}
          >
            Back
          </button>
          {initialParams.teamUrl ? (
            <button className="secondary" type="button" onClick={() => window.open(initialParams.teamUrl, "_blank", "noopener,noreferrer")}>
              Open PG Team Page
            </button>
          ) : null}
        </div>
        {initialParams.tournamentIcon ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <img className="tile-icon" src={initialParams.tournamentIcon} alt={initialParams.tournamentName || "Tournament"} />
          </div>
        ) : null}
        <h2 style={{ marginTop: 8 }}>{initialParams.tournamentName || "Tournament"}</h2>
        <p className="muted"><strong>Team:</strong> {initialParams.teamName || "-"}</p>
      </section>

      <section className="panel">
        <h2>Team Schedule</h2>
        {loading ? <p className="muted">Loading schedule and roster from Perfect Game...</p> : null}
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
      </section>

      <section className="panel">
        <h2>Tournament Roster</h2>
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <button
            className="secondary"
            type="button"
            onClick={() => downloadPdfLikeReport(
              `Tournament Roster - ${initialParams.teamName}`,
              ["No.", "Name", "Pos", "HS"],
              filteredRoster.map((row, idx) => [row.no || String(idx + 1), row.name, row.position || "-", row.school || "-"])
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
            placeholder="Search no, player name, position, HS"
          />
        </label>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="roster-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Name</th>
                <th>Pos</th>
                <th>HS</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoster.length ? filteredRoster.map((row, idx) => (
                <tr key={`${row.no}-${row.name}-${idx}`}>
                  <td>{row.no || idx + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.position || "-"}</td>
                  <td>{row.school || "-"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4}>No roster rows found yet for this team.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel grid2">
        <div>
          <h2>Hands-Free Notes</h2>
          <div className="row wrap">
            {recorderState === "idle" ? (
              <button type="button" onClick={startMic}>Start Mic</button>
            ) : (
              <button type="button" className="danger" onClick={stopMic}>Stop Mic</button>
            )}
            <button className="secondary" type="button" onClick={saveTeamNote}>Save Note</button>
          </div>
          <label>
            Live Transcript
            <textarea
              rows={4}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Transcript appears here."
            />
          </label>
          {!speechSupported ? <p className="muted">Speech recognition is not available in this browser.</p> : null}
          <div className="log-list" style={{ maxHeight: 180 }}>
            {teamNotes.length ? teamNotes.map((note) => (
              <article key={note.id} className="log-card">
                <p><strong>{new Date(note.createdAt).toLocaleString()}</strong></p>
                <p>{note.transcript}</p>
              </article>
            )) : <p className="muted">No notes saved for this team yet.</p>}
          </div>
        </div>
        <div>
          <h2>Optimized Path</h2>
          <p className="muted">Schedule and roster stay on this page while you capture team notes.</p>
        </div>
      </section>
    </main>
  );
}
