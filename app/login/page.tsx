"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("Scout User");
  const [email, setEmail] = useState("scout@lsu.edu");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
        signal: controller.signal
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Login failed.");
        return;
      }

      router.replace("/bird-dog");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setError("Login timed out. Please check connection and try again.");
        return;
      }
      setError("Unable to reach login service. Please check network and try again.");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <img
          src="/branding/a-point-scout-logo.svg"
          alt="A-POINT Scout"
          style={{ width: 220, height: "auto", marginBottom: 8 }}
        />
        <h1>A-POINT Scout</h1>
        <p>Sign up or sign in with your scouting email. Org branding and vault partitioning are based on your domain.</p>
        <form onSubmit={onSubmit}>
          <label>
            Full Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password (Optional)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button type="submit" disabled={loading}>{loading ? "Authenticating..." : "Continue to Dashboard"}</button>
        </form>
      </section>
    </main>
  );
}
