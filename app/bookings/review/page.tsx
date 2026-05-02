"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TravelLeg = {
  at: string;
  from: string;
  to: string;
  mode: string;
};

type Traveler = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "MALE" | "FEMALE" | "UNSPECIFIED";
  email: string;
  phone: string;
  countryCallingCode: string;
  nationality: string;
};

type BookingReviewDraft = {
  travelLegs: TravelLeg[];
  traveler: Traveler;
  teamName: string;
  tournamentName: string;
};

type BookingResult = {
  provider?: string;
  status?: "booked" | "quoted" | "failed" | "skipped";
  leg?: TravelLeg;
  reference?: string;
  detail?: string;
  price?: string;
};

const BOOKING_REVIEW_DRAFT_KEY = "bird_dog:booking_review_draft:v1";

function readDraftFromSession(): BookingReviewDraft | null {
  try {
    const raw = window.sessionStorage.getItem(BOOKING_REVIEW_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BookingReviewDraft>;
    if (!Array.isArray(parsed.travelLegs) || !parsed.travelLegs.length) return null;
    return {
      travelLegs: parsed.travelLegs.map((leg) => ({
        at: String(leg?.at || new Date().toISOString()),
        from: String(leg?.from || "").trim(),
        to: String(leg?.to || "").trim(),
        mode: String(leg?.mode || "Flight").trim()
      })).filter((leg) => leg.from && leg.to),
      traveler: {
        firstName: String(parsed.traveler?.firstName || "Coach"),
        lastName: String(parsed.traveler?.lastName || "User"),
        dateOfBirth: String(parsed.traveler?.dateOfBirth || "1990-01-01"),
        gender: (String(parsed.traveler?.gender || "UNSPECIFIED").toUpperCase() as Traveler["gender"]),
        email: String(parsed.traveler?.email || ""),
        phone: String(parsed.traveler?.phone || "0000000000"),
        countryCallingCode: String(parsed.traveler?.countryCallingCode || "1"),
        nationality: String(parsed.traveler?.nationality || "US")
      },
      teamName: String(parsed.teamName || ""),
      tournamentName: String(parsed.tournamentName || "")
    };
  } catch {
    return null;
  }
}

function statusColor(status: string | undefined) {
  if (status === "booked") return "#7be495";
  if (status === "quoted") return "#f8d57e";
  if (status === "failed") return "#ff8d8d";
  return "#b7c7de";
}

export default function BookingReviewPage() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState("/bird-dog?tab=schedule");

  const [draft, setDraft] = useState<BookingReviewDraft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [reviewNote, setReviewNote] = useState("");
  const [results, setResults] = useState<BookingResult[]>([]);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [bookLoading, setBookLoading] = useState(false);

  useEffect(() => {
    try {
      const parsed = new URLSearchParams(window.location.search);
      const next = String(parsed.get("returnTo") || "").trim();
      if (next.startsWith("/") && !next.startsWith("//")) {
        setReturnTo(next);
      }
    } catch {
      // Keep fallback return path.
    }
  }, []);

  useEffect(() => {
    const next = readDraftFromSession();
    setDraft(next);
    if (!next) {
      setReviewNote("No approved recommendation draft found. Please open booking from My Schedule again.");
    }
    setLoadingDraft(false);
  }, []);

  async function runReview(quoteOnly: boolean) {
    if (!draft) return;
    if (quoteOnly) {
      setQuoteLoading(true);
      setReviewNote("Fetching live quotes for all travel legs...");
    } else {
      setBookLoading(true);
      setReviewNote("Booking all approved legs...");
    }

    try {
      const res = await fetch("/api/bookings/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: draft.teamName,
          tournamentName: draft.tournamentName,
          travelLegs: draft.travelLegs,
          traveler: draft.traveler,
          quoteOnly
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReviewNote(body?.error || `Request failed (${res.status}).`);
        return;
      }
      const nextResults = Array.isArray(body?.results) ? body.results as BookingResult[] : [];
      setResults(nextResults);
      const booked = nextResults.filter((item) => item.status === "booked").length;
      const quoted = nextResults.filter((item) => item.status === "quoted").length;
      const failed = nextResults.filter((item) => item.status === "failed").length;
      const skipped = nextResults.filter((item) => item.status === "skipped").length;
      if (quoteOnly) {
        setReviewNote(`Quote review ready. Quoted: ${quoted}, Failed: ${failed}, Skipped: ${skipped}.`);
      } else {
        setReviewNote(`Booking run complete. Booked: ${booked}, Quoted: ${quoted}, Failed: ${failed}, Skipped: ${skipped}.`);
      }
    } finally {
      setQuoteLoading(false);
      setBookLoading(false);
    }
  }

  useEffect(() => {
    if (!draft) return;
    if (results.length) return;
    void runReview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const summary = useMemo(() => ({
    booked: results.filter((item) => item.status === "booked").length,
    quoted: results.filter((item) => item.status === "quoted").length,
    failed: results.filter((item) => item.status === "failed").length
  }), [results]);

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(140deg, #140b15 0%, #08112a 45%, #050915 100%)", color: "#f5f8ff", padding: "18px 14px 30px" }}>
      <section style={{ maxWidth: 1140, margin: "0 auto", border: "1px solid rgba(214, 202, 170, 0.35)", borderRadius: 16, background: "linear-gradient(160deg, rgba(35, 20, 28, 0.62), rgba(8, 18, 38, 0.94))", padding: 16 }}>
        <h1 style={{ margin: 0 }}>Book Approved Recommendation</h1>
        <p style={{ marginTop: 8, color: "#b9c6d9" }}>
          Review all legs at once, verify quotes, then book once for the whole plan.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => router.push(returnTo)}
            style={{ borderRadius: 10, border: "1px solid rgba(120, 154, 202, 0.5)", background: "rgba(11, 27, 52, 0.8)", color: "#f5f8ff", padding: "10px 14px", fontWeight: 700 }}
          >
            Back to My Schedule
          </button>
          <button
            type="button"
            onClick={() => void runReview(true)}
            disabled={loadingDraft || !draft || quoteLoading}
            style={{ borderRadius: 10, border: "1px solid rgba(120, 154, 202, 0.5)", background: "rgba(11, 27, 52, 0.8)", color: "#f5f8ff", padding: "10px 14px", fontWeight: 700, opacity: loadingDraft || !draft || quoteLoading ? 0.6 : 1 }}
          >
            {quoteLoading ? "Loading Quotes..." : "Refresh All Quotes"}
          </button>
          <button
            type="button"
            onClick={() => void runReview(false)}
            disabled={loadingDraft || !draft || bookLoading}
            style={{ borderRadius: 10, border: "1px solid rgba(214, 162, 120, 0.7)", background: "linear-gradient(135deg, rgba(156, 69, 41, 0.45), rgba(11, 27, 52, 0.92))", color: "#f5f8ff", padding: "10px 14px", fontWeight: 800, opacity: loadingDraft || !draft || bookLoading ? 0.6 : 1 }}
          >
            {bookLoading ? "Booking..." : "Book All Approved Legs"}
          </button>
        </div>

        {reviewNote ? <p style={{ marginTop: 12, color: "#b9c6d9" }}>{reviewNote}</p> : null}

        {!loadingDraft && draft ? (
          <>
            <p style={{ marginTop: 8, color: "#b9c6d9" }}>
              Tournament: {draft.tournamentName || "-"} {draft.teamName ? `| Team: ${draft.teamName}` : ""}
            </p>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {draft.travelLegs.map((leg, index) => (
                <article key={`${leg.at}-${leg.from}-${leg.to}-${index}`} style={{ border: "1px solid rgba(126, 152, 195, 0.38)", borderRadius: 12, padding: 12, background: "rgba(5, 20, 43, 0.65)" }}>
                  <p style={{ margin: 0, fontWeight: 800 }}>Leg {index + 1}: {leg.from} {"->"} {leg.to}</p>
                  <p style={{ margin: "6px 0 0", color: "#b9c6d9" }}>
                    {new Date(leg.at).toLocaleString()} | {leg.mode}
                  </p>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {results.length ? (
          <section style={{ marginTop: 18 }}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Provider Results</h2>
            <p style={{ marginTop: 0, color: "#b9c6d9" }}>
              Booked: {summary.booked} | Quoted: {summary.quoted} | Failed: {summary.failed}
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              {results.map((item, index) => (
                <article key={`${item.provider || "provider"}-${index}`} style={{ border: "1px solid rgba(126, 152, 195, 0.38)", borderRadius: 12, padding: 12, background: "rgba(5, 20, 43, 0.65)" }}>
                  <p style={{ margin: 0, fontWeight: 700 }}>
                    {item.provider || "Provider"} | <span style={{ color: statusColor(item.status) }}>{String(item.status || "unknown").toUpperCase()}</span>
                  </p>
                  <p style={{ margin: "6px 0 0", color: "#b9c6d9" }}>
                    {(item.leg?.from || "-")} {"->"} {(item.leg?.to || "-")} {item.price ? `| Price: ${item.price}` : ""}
                  </p>
                  {item.reference ? <p style={{ margin: "6px 0 0", color: "#b9c6d9" }}>Reference: {item.reference}</p> : null}
                  {item.detail ? <p style={{ margin: "6px 0 0", color: "#b9c6d9" }}>{item.detail}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
