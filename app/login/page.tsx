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

function toBase64Url(bytes: Uint8Array) {
  const chars: string[] = [];
  bytes.forEach((byte) => {
    chars.push(String.fromCharCode(byte));
  });
  return btoa(chars.join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

type FallbackCodes = {
  codeOne: string;
  codeTwo: string;
};

type LoginResult = {
  ok?: boolean;
  error?: string;
  mfaRequired?: boolean;
  message?: string;
  fallbackCodes?: FallbackCodes;
};

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("Scout User");
  const [email, setEmail] = useState("scout@lsu.edu");
  const [password, setPassword] = useState("");
  const [codeOne, setCodeOne] = useState("");
  const [codeTwo, setCodeTwo] = useState("");
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [stage, setStage] = useState<"credentials" | "mfa">("credentials");
  const [fallbackCodes, setFallbackCodes] = useState<FallbackCodes | null>(null);

  const org = useMemo(() => getOrgByEmail(email), [email]);

  async function startLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    setFallbackCodes(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "start", name, email, password }),
        signal: controller.signal
      });

      const data = (await res.json().catch(() => ({}))) as LoginResult;
      if (!res.ok) {
        setError(data?.error || "Login failed.");
        return;
      }

      if (data?.mfaRequired) {
        setStage("mfa");
        setInfo(data?.message || "Enter both MFA codes to continue.");
        setFallbackCodes(data?.fallbackCodes || null);
        return;
      }

      router.replace("/bird-dog");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Login timed out. Please check connection and try again.");
        return;
      }
      setError("Unable to reach login service. Please check network and try again.");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "verify",
          name,
          email,
          password,
          codeOne,
          codeTwo
        }),
        signal: controller.signal
      });
      const data = (await res.json().catch(() => ({}))) as LoginResult;
      if (!res.ok) {
        setError(data?.error || "MFA verification failed.");
        return;
      }
      router.replace("/bird-dog");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Verification timed out. Please check connection and try again.");
        return;
      }
      setError("Unable to verify right now. Please try again.");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function enableFingerprint() {
    if (!("PublicKeyCredential" in window) || !window.PublicKeyCredential) {
      setError("Fingerprint login is not supported on this browser.");
      return;
    }
    if (!email.includes("@")) {
      setError("Enter your email first, then enable fingerprint login.");
      return;
    }
    setBiometricLoading(true);
    setError("");
    setInfo("");
    try {
      const platformAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!platformAvailable) {
        setError("No biometric authenticator available on this device.");
        return;
      }

      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(32));
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "APOINT SCOUT" },
          user: {
            id: userId,
            name: email.toLowerCase(),
            displayName: name || "Coach"
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "preferred"
          },
          attestation: "none",
          timeout: 60_000
        }
      });

      const passkey = credential as PublicKeyCredential | null;
      const rawId = passkey ? new Uint8Array(passkey.rawId) : null;
      if (!rawId || !rawId.length) {
        setError("Could not complete fingerprint setup on this device.");
        return;
      }

      localStorage.setItem("bd-biometric-email", email.toLowerCase());
      localStorage.setItem("bd-biometric-id", toBase64Url(rawId));
      setInfo("Fingerprint login enabled on this device.");
    } catch {
      setError("Fingerprint setup was cancelled or failed.");
    } finally {
      setBiometricLoading(false);
    }
  }

  async function loginWithFingerprint() {
    if (!("PublicKeyCredential" in window) || !window.PublicKeyCredential) {
      setError("Fingerprint login is not supported on this browser.");
      return;
    }
    const storedEmail = localStorage.getItem("bd-biometric-email") || "";
    const storedId = localStorage.getItem("bd-biometric-id") || "";
    if (!storedEmail || !storedId || storedEmail !== email.toLowerCase()) {
      setError("Fingerprint login is not enabled for this email on this device.");
      return;
    }

    setBiometricLoading(true);
    setError("");
    setInfo("");
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [
            {
              id: fromBase64Url(storedId),
              type: "public-key"
            }
          ],
          userVerification: "required",
          timeout: 60_000
        }
      });

      const res = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "start", biometric: true, name, email })
      });
      const data = (await res.json().catch(() => ({}))) as LoginResult;
      if (!res.ok) {
        setError(data?.error || "Biometric login failed.");
        return;
      }
      router.replace("/bird-dog");
    } catch {
      setError("Fingerprint verification failed or was cancelled.");
    } finally {
      setBiometricLoading(false);
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

        {stage === "credentials" ? (
          <form onSubmit={startLogin}>
            <label>
              Full Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error ? <p className="error-text">{error}</p> : null}
            {info ? <p className="muted">{info}</p> : null}
            <button type="submit" disabled={loading || biometricLoading}>
              {loading ? "Checking..." : "Continue to Dashboard"}
            </button>
            <button type="button" className="secondary-btn" disabled={loading || biometricLoading} onClick={enableFingerprint}>
              {biometricLoading ? "Working..." : "Enable Fingerprint Login"}
            </button>
            <button type="button" className="secondary-btn" disabled={loading || biometricLoading} onClick={loginWithFingerprint}>
              {biometricLoading ? "Working..." : "Login with Fingerprint"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyMfa}>
            <p className="muted">First-time setup: enter both MFA codes sent to your university email.</p>
            <label>
              MFA Code 1
              <input value={codeOne} onChange={(e) => setCodeOne(e.target.value)} inputMode="numeric" required />
            </label>
            <label>
              MFA Code 2
              <input value={codeTwo} onChange={(e) => setCodeTwo(e.target.value)} inputMode="numeric" required />
            </label>
            {fallbackCodes ? (
              <p className="muted">
                Code 1: <b>{fallbackCodes.codeOne}</b> | Code 2: <b>{fallbackCodes.codeTwo}</b>
              </p>
            ) : null}
            {error ? <p className="error-text">{error}</p> : null}
            {info ? <p className="muted">{info}</p> : null}
            <button type="submit" disabled={loading}>
              {loading ? "Verifying..." : "Verify and Continue"}
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={loading}
              onClick={() => {
                setStage("credentials");
                setCodeOne("");
                setCodeTwo("");
                setError("");
                setInfo("");
              }}
            >
              Back
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
