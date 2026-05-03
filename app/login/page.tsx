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
  code: string;
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
  const [authIntent, setAuthIntent] = useState<"signup" | "signin">("signin");
  const [firstName, setFirstName] = useState("Scout");
  const [lastName, setLastName] = useState("User");
  const [email, setEmail] = useState("scout@lsu.edu");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState<"MALE" | "FEMALE" | "UNSPECIFIED">("UNSPECIFIED");
  const [countryCallingCode, setCountryCallingCode] = useState("1");
  const [phone, setPhone] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [stage, setStage] = useState<"credentials" | "mfa">("credentials");
  const [fallbackCodes, setFallbackCodes] = useState<FallbackCodes | null>(null);

  const org = useMemo(() => getOrgByEmail(email), [email]);
  const isAdminEmail = email.trim().toLowerCase() === "admin@apointscout.com";
  const fullName = `${firstName} ${lastName}`.trim() || "Scout User";

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
        body: JSON.stringify({
          mode: "start",
          authIntent,
          name: fullName,
          email,
          password,
          ...(authIntent === "signup" && !isAdminEmail ? {
            gender,
            phone,
            countryCallingCode
          } : {})
        }),
        signal: controller.signal
      });

      const data = (await res.json().catch(() => ({}))) as LoginResult;
      if (!res.ok) {
        setError(data?.error || "Login failed.");
        return;
      }

      if (data?.mfaRequired) {
        setStage("mfa");
        setInfo(data?.message || "Enter the MFA code to continue.");
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
          authIntent,
          name: fullName,
          email,
          password,
          mfaCode
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
      setError("Biometric sign-in is not supported on this browser.");
      return;
    }
    if (!email.includes("@")) {
      setError("Enter your email first, then set up biometric sign-in.");
      return;
    }
    setBiometricLoading(true);
    setError("");
    setInfo("");
    try {
      const platformAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!platformAvailable) {
        setError("No Face ID / fingerprint authenticator is available on this device.");
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
            displayName: fullName || "Coach"
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
        setError("Could not complete biometric setup on this device.");
        return;
      }

      localStorage.setItem("bd-biometric-email", email.toLowerCase());
      localStorage.setItem("bd-biometric-id", toBase64Url(rawId));
      setInfo("Biometric sign-in is ready on this device.");
    } catch {
      setError("Biometric setup was cancelled or failed.");
    } finally {
      setBiometricLoading(false);
    }
  }

  async function loginWithFingerprint() {
    if (!("PublicKeyCredential" in window) || !window.PublicKeyCredential) {
      setError("Biometric sign-in is not supported on this browser.");
      return;
    }
    const storedEmail = localStorage.getItem("bd-biometric-email") || "";
    const storedId = localStorage.getItem("bd-biometric-id") || "";
    if (!storedEmail || !storedId || storedEmail !== email.toLowerCase()) {
      setError("Biometric sign-in is not set up for this email on this device.");
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
        body: JSON.stringify({ mode: "start", authIntent: "signin", biometric: true, name: fullName, email })
      });
      const data = (await res.json().catch(() => ({}))) as LoginResult;
      if (!res.ok) {
        setError(data?.error || "Biometric login failed.");
        return;
      }
      router.replace("/bird-dog");
    } catch {
      setError("Biometric verification failed or was cancelled.");
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
          <>
            <div className="auth-toggle" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={authIntent === "signin" ? "active" : ""}
                onClick={() => {
                  setAuthIntent("signin");
                  setError("");
                  setInfo("");
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                className={authIntent === "signup" ? "active" : ""}
                onClick={() => {
                  setAuthIntent("signup");
                  setError("");
                  setInfo("");
                }}
              >
                Sign Up
              </button>
            </div>
          <form onSubmit={startLogin}>
            {authIntent === "signup" ? (
              <>
                <label>
                  First Name
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </label>
                <label>
                  Last Name
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </label>
              </>
            ) : null}
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {authIntent === "signup" && !isAdminEmail ? (
              <>
                <label>
                  Gender
                  <select value={gender} onChange={(e) => setGender(e.target.value as "MALE" | "FEMALE" | "UNSPECIFIED")} required>
                    <option value="UNSPECIFIED">Prefer not to say</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </label>
                <label>
                  Country Code
                  <input
                    value={countryCallingCode}
                    onChange={(e) => setCountryCallingCode(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    placeholder="1"
                    required
                  />
                </label>
                <label>
                  Mobile Number
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="tel"
                    placeholder="9876543210"
                    required
                  />
                </label>
              </>
            ) : null}
            {error ? <p className="error-text">{error}</p> : null}
            {info ? <p className="muted">{info}</p> : null}
            <button type="submit" disabled={loading || biometricLoading}>
              {loading ? "Checking..." : (authIntent === "signup" ? "Create Account" : "Sign In")}
            </button>
            {authIntent === "signin" ? (
              <>
                <button type="button" className="secondary-btn" disabled={loading || biometricLoading} onClick={loginWithFingerprint}>
                  {biometricLoading ? "Working..." : "Use Face ID / Fingerprint"}
                </button>
                <button type="button" className="secondary-btn" disabled={loading || biometricLoading} onClick={enableFingerprint}>
                  {biometricLoading ? "Working..." : "Set Up Face ID / Fingerprint"}
                </button>
              </>
            ) : (
              <p className="muted">Sign up once with your university email, then use Sign In or biometric next time.</p>
            )}
          </form>
          </>
        ) : (
          <form onSubmit={verifyMfa}>
            <p className="muted">Finish Sign Up: enter the MFA code sent to your university email.</p>
            <label>
              MFA Code
              <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" required />
            </label>
            {fallbackCodes ? (
              <p className="muted">
                Code: <b>{fallbackCodes.code}</b>
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
                setMfaCode("");
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
