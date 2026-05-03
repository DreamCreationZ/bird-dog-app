"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TravelLeg = {
  at: string;
  from: string;
  to: string;
  mode: string;
};

type PlanItem = {
  at: string;
  title: string;
  detail: string;
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
  planItems: PlanItem[];
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
const BOOKING_SUMMARY_KEY = "bird_dog:booking_summary:v1";

function readDraftFromStorage(): BookingReviewDraft | null {
  try {
    const raw = window.localStorage.getItem(BOOKING_REVIEW_DRAFT_KEY) || window.sessionStorage.getItem(BOOKING_REVIEW_DRAFT_KEY);
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
      planItems: Array.isArray(parsed.planItems)
        ? parsed.planItems.map((item) => ({
          at: String(item?.at || new Date().toISOString()),
          title: String(item?.title || "Step"),
          detail: String(item?.detail || "")
        }))
        : [],
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
  const [editableLegs, setEditableLegs] = useState<TravelLeg[]>([]);
  const [modifyMode, setModifyMode] = useState(false);
  const [planApproved, setPlanApproved] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"UPI" | "CARD">("UPI");
  const [upiId, setUpiId] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");

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
    const next = readDraftFromStorage();
    setDraft(next);
    setEditableLegs(next?.travelLegs || []);
    if (!next) {
      setReviewNote("No recommendation draft found. Open booking from My Schedule again.");
    }
    setLoadingDraft(false);
  }, []);

  async function runReview(quoteOnly: boolean) {
    if (!draft || !editableLegs.length) return;
    if (quoteOnly) {
      setQuoteLoading(true);
      setReviewNote("Fetching live quotes for all travel legs...");
    } else {
      setBookLoading(true);
      setReviewNote("Booking flights/hotels for approved plan...");
    }

    try {
      const res = await fetch("/api/bookings/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: draft.teamName,
          tournamentName: draft.tournamentName,
          travelLegs: editableLegs,
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
        return;
      }

      const snapshot = {
        savedAt: new Date().toISOString(),
        paymentMethod,
        booked,
        quoted,
        failed,
        results: nextResults
      };
      window.localStorage.setItem(BOOKING_SUMMARY_KEY, JSON.stringify(snapshot));
      setReviewNote(`Booking done. Booked: ${booked}, Quoted: ${quoted}, Failed: ${failed}. Returning to My Schedule...`);
      window.setTimeout(() => {
        router.push(returnTo);
      }, 1200);
    } finally {
      setQuoteLoading(false);
      setBookLoading(false);
    }
  }

  useEffect(() => {
    if (!draft || results.length || !editableLegs.length) return;
    void runReview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  function validatePaymentInput() {
    if (paymentMethod === "UPI") {
      return /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(upiId.trim());
    }
    const normalizedCard = cardNumber.replace(/\D/g, "");
    const normalizedCvv = cardCvv.replace(/\D/g, "");
    return Boolean(cardName.trim()) && normalizedCard.length >= 12 && /^\d{2}\/\d{2}$/.test(cardExpiry) && (normalizedCvv.length === 3 || normalizedCvv.length === 4);
  }

  async function payAndBook() {
    if (!draft || !editableLegs.length) {
      setReviewNote("No travel legs available for booking.");
      return;
    }
    if (!planApproved) {
      setReviewNote("Approve this recommendation first, then continue to payment.");
      return;
    }
    if (!validatePaymentInput()) {
      setReviewNote(paymentMethod === "UPI"
        ? "Enter a valid UPI ID (example: coach@okhdfcbank)."
        : "Enter valid card holder, card number, expiry (MM/YY), and CVV.");
      return;
    }
    await runReview(false);
  }

  const summary = useMemo(() => ({
    booked: results.filter((item) => item.status === "booked").length,
    quoted: results.filter((item) => item.status === "quoted").length,
    failed: results.filter((item) => item.status === "failed").length
  }), [results]);

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(140deg, #140b15 0%, #08112a 45%, #050915 100%)", color: "#f5f8ff", padding: "18px 14px 30px" }}>
      <section style={{ maxWidth: 1140, margin: "0 auto", border: "1px solid rgba(214, 202, 170, 0.35)", borderRadius: 16, background: "linear-gradient(160deg, rgba(35, 20, 28, 0.62), rgba(8, 18, 38, 0.94))", padding: 16 }}>
        <h1 style={{ margin: 0 }}>Book Recommendation</h1>
        <p style={{ marginTop: 8, color: "#b9c6d9" }}>
          Review all travel + hotel steps, modify if needed, approve, pay, and complete booking.
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
            onClick={() => setModifyMode((prev) => !prev)}
            disabled={loadingDraft || !draft}
            style={{ borderRadius: 10, border: "1px solid rgba(120, 154, 202, 0.5)", background: "rgba(11, 27, 52, 0.8)", color: "#f5f8ff", padding: "10px 14px", fontWeight: 700, opacity: loadingDraft || !draft ? 0.6 : 1 }}
          >
            {modifyMode ? "Stop Editing" : "Modify Itinerary"}
          </button>
          <button
            type="button"
            onClick={() => void runReview(true)}
            disabled={loadingDraft || !draft || quoteLoading || !editableLegs.length}
            style={{ borderRadius: 10, border: "1px solid rgba(120, 154, 202, 0.5)", background: "rgba(11, 27, 52, 0.8)", color: "#f5f8ff", padding: "10px 14px", fontWeight: 700, opacity: loadingDraft || !draft || quoteLoading || !editableLegs.length ? 0.6 : 1 }}
          >
            {quoteLoading ? "Loading Quotes..." : "Refresh Quotes"}
          </button>
          <button
            type="button"
            disabled={loadingDraft || !draft || !editableLegs.length}
            onClick={() => {
              setPlanApproved(true);
              setReviewNote("Recommendation approved. Continue to payment.");
            }}
            style={{ borderRadius: 10, border: "1px solid rgba(111, 199, 149, 0.6)", background: "rgba(16, 53, 38, 0.9)", color: "#f5f8ff", padding: "10px 14px", fontWeight: 800, opacity: loadingDraft || !draft || !editableLegs.length ? 0.6 : 1 }}
          >
            Approve Plan
          </button>
        </div>

        {reviewNote ? <p style={{ marginTop: 12, color: "#b9c6d9" }}>{reviewNote}</p> : null}

        {!loadingDraft && draft ? (
          <>
            <p style={{ marginTop: 8, color: "#b9c6d9" }}>
              Tournament: {draft.tournamentName || "-"} {draft.teamName ? `| Team: ${draft.teamName}` : ""}
            </p>

            {draft.planItems.length ? (
              <section style={{ marginTop: 14 }}>
                <h2 style={{ marginTop: 0, marginBottom: 8 }}>Recommendation Steps (Flight + Hotel)</h2>
                <div style={{ display: "grid", gap: 10 }}>
                  {draft.planItems.map((item, idx) => (
                    <article key={`${item.at}-${idx}`} style={{ border: "1px solid rgba(126, 152, 195, 0.38)", borderRadius: 12, padding: 12, background: "rgba(5, 20, 43, 0.65)" }}>
                      <p style={{ margin: 0, fontWeight: 800 }}>{new Date(item.at).toLocaleString()} - {item.title}</p>
                      <p style={{ margin: "6px 0 0", color: "#b9c6d9" }}>{item.detail}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section style={{ marginTop: 14 }}>
              <h2 style={{ marginTop: 0, marginBottom: 8 }}>Travel Legs</h2>
              <div style={{ display: "grid", gap: 10 }}>
                {editableLegs.map((leg, index) => (
                  <article key={`${leg.at}-${index}`} style={{ border: "1px solid rgba(126, 152, 195, 0.38)", borderRadius: 12, padding: 12, background: "rgba(5, 20, 43, 0.65)" }}>
                    <p style={{ margin: 0, fontWeight: 800 }}>Leg {index + 1}</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 8 }}>
                      <label>
                        From
                        <input
                          value={leg.from}
                          disabled={!modifyMode}
                          onChange={(e) => setEditableLegs((prev) => prev.map((row, idx) => idx === index ? { ...row, from: e.target.value } : row))}
                        />
                      </label>
                      <label>
                        To
                        <input
                          value={leg.to}
                          disabled={!modifyMode}
                          onChange={(e) => setEditableLegs((prev) => prev.map((row, idx) => idx === index ? { ...row, to: e.target.value } : row))}
                        />
                      </label>
                      <label>
                        Mode
                        <select
                          value={leg.mode}
                          disabled={!modifyMode}
                          onChange={(e) => setEditableLegs((prev) => prev.map((row, idx) => idx === index ? { ...row, mode: e.target.value } : row))}
                        >
                          <option value="Flight">Flight</option>
                          <option value="Flight / Bus">Flight / Bus</option>
                          <option value="Bus">Bus</option>
                          <option value="Hotel Transfer">Hotel Transfer</option>
                        </select>
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section style={{ marginTop: 16, border: "1px solid rgba(126, 152, 195, 0.38)", borderRadius: 12, padding: 12, background: "rgba(5, 20, 43, 0.65)" }}>
              <h2 style={{ marginTop: 0, marginBottom: 8 }}>Payment</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("UPI")}
                  style={{ borderRadius: 10, border: "1px solid rgba(120, 154, 202, 0.5)", background: paymentMethod === "UPI" ? "rgba(20, 64, 42, 0.9)" : "rgba(11, 27, 52, 0.8)", color: "#f5f8ff", padding: "8px 12px", fontWeight: 700 }}
                >
                  UPI
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("CARD")}
                  style={{ borderRadius: 10, border: "1px solid rgba(120, 154, 202, 0.5)", background: paymentMethod === "CARD" ? "rgba(20, 64, 42, 0.9)" : "rgba(11, 27, 52, 0.8)", color: "#f5f8ff", padding: "8px 12px", fontWeight: 700 }}
                >
                  Credit / Debit Card
                </button>
              </div>

              {paymentMethod === "UPI" ? (
                <label>
                  UPI ID
                  <input
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="coach@okhdfcbank"
                  />
                </label>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                  <label>
                    Name on Card
                    <input value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="Coach User" />
                  </label>
                  <label>
                    Card Number
                    <input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="4111 1111 1111 1111" />
                  </label>
                  <label>
                    Expiry (MM/YY)
                    <input value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="12/28" />
                  </label>
                  <label>
                    CVV
                    <input value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} placeholder="123" />
                  </label>
                </div>
              )}

              <button
                type="button"
                onClick={() => void payAndBook()}
                disabled={loadingDraft || !draft || bookLoading || !editableLegs.length}
                style={{ marginTop: 12, borderRadius: 10, border: "1px solid rgba(214, 162, 120, 0.7)", background: "linear-gradient(135deg, rgba(156, 69, 41, 0.45), rgba(11, 27, 52, 0.92))", color: "#f5f8ff", padding: "10px 14px", fontWeight: 800, opacity: loadingDraft || !draft || bookLoading || !editableLegs.length ? 0.6 : 1 }}
              >
                {bookLoading ? "Booking..." : "Pay & Book Now"}
              </button>
            </section>
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
