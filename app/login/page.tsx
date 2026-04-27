"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrgByEmail } from "@/lib/birddog/mockData";

function toAlpha(hex: string, alpha: number) {
  const raw = (hex || "").replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((ch) => `${ch}${ch}`).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return `rgba(31,58,95,${alpha})`;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("Scout User");
  const [email, setEmail] = useState("scout@lsu.edu");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const org = useMemo(() => getOrgByEmail(email), [email]);

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
    <main
      className="login-shell"
      style={{
        ["--login-primary" as string]: org.primary,
        ["--login-accent" as string]: org.accent,
        ["--login-primary-soft" as string]: toAlpha(org.primary, 0.16),
        ["--login-accent-soft" as string]: toAlpha(org.accent, 0.22)
      }}
    >
      <section className="login-card">
        <img
          src="/branding/a-point-scout-logo.svg"
          alt="APOINT SCOUT"
          style={{ width: 220, height: "auto", marginBottom: 8 }}
        />
        <h1>APOINT SCOUT</h1>
        <p>Sign up or sign in with your scouting email.</p>
        <div className="org-preview">
          <div className="org-preview-mark">
            {org.logoUrl ? (
              <img
                src={org.logoUrl}
                alt={`${org.name} logo`}
                onError={(event) => {
                  const target = event.currentTarget;
                  if (target.src.endsWith("/branding/a-point-scout-icon.svg")) return;
                  target.src = "/branding/a-point-scout-icon.svg";
                }}
              />
            ) : (
              <span>{org.logoText || "ORG"}</span>
            )}
          </div>
          <div>
            <p className="org-preview-title">University Theme</p>
            <p className="org-preview-name">{org.name}</p>
          </div>
        </div>
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
