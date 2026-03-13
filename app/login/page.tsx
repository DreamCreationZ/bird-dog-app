"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("Scout User");
  const [email, setEmail] = useState("scout@lsu.edu");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/session/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, accessCode })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || "Login failed.");
      setLoading(false);
      return;
    }

    router.replace("/bird-dog");
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <h1>Project Bird Dog</h1>
        <p>Sign up or sign in with your scouting email and access code. Org branding and vault partitioning are based on your domain.</p>
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
            Access Code
            <input type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} required />
          </label>
          <p className="muted">Use your organization access code provided by admin.</p>
          {error ? <p className="error-text">{error}</p> : null}
          <button type="submit" disabled={loading}>{loading ? "Authenticating..." : "Continue to Dashboard"}</button>
        </form>
      </section>
    </main>
  );
}
