"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SubscribePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startSubscription() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: "/bird-dog" })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Unable to open checkout.");
        return;
      }

      if (data?.alreadySubscribed) {
        router.replace("/bird-dog?subscription=active");
        return;
      }

      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      setError("Checkout URL missing.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <h1>Bird Dog Subscription</h1>
        <p>Unlock all tournament access for this coach account.</p>
        <p><strong>$500</strong> one-time unlock in test mode.</p>
        {error ? <p className="error-text">{error}</p> : null}
        <button type="button" onClick={() => void startSubscription()} disabled={loading}>
          {loading ? "Redirecting..." : "Subscribe & Unlock"}
        </button>
        <button type="button" onClick={() => router.push("/bird-dog")} style={{ marginTop: 8, background: "#ece5d6", color: "#111" }}>
          Back to Dashboard
        </button>
      </section>
    </main>
  );
}
