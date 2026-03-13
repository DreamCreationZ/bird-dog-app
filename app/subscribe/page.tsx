"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function SubscribePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inventorySlug, setInventorySlug] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setInventorySlug(params.get("inventorySlug") || "");
  }, []);

  async function startSubscription() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnTo: "/bird-dog",
          inventorySlug
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Unable to open checkout.");
        return;
      }

      if (data?.alreadyUnlocked) {
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
        <p>Unlock one tournament for your entire organization.</p>
        <p><strong>$500</strong> per tournament in test mode.</p>
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
