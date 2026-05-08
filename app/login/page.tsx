"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrgByEmail } from "@/lib/birddog/mockData";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";

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

type LoginResult = {
  ok?: boolean;
  error?: string;
  mfaRequired?: boolean;
  message?: string;
};

type CountryCodeOption = {
  country: string;
  dialCode: string;
  digits: string;
};

const DEFAULT_COUNTRY_CODE_OPTIONS: CountryCodeOption[] = [
  { country: "Australia", dialCode: "+61", digits: "61" },
  { country: "Brazil", dialCode: "+55", digits: "55" },
  { country: "Canada", dialCode: "+1", digits: "1" },
  { country: "China", dialCode: "+86", digits: "86" },
  { country: "France", dialCode: "+33", digits: "33" },
  { country: "Germany", dialCode: "+49", digits: "49" },
  { country: "India", dialCode: "+91", digits: "91" },
  { country: "Indonesia", dialCode: "+62", digits: "62" },
  { country: "Japan", dialCode: "+81", digits: "81" },
  { country: "Mexico", dialCode: "+52", digits: "52" },
  { country: "Saudi Arabia", dialCode: "+966", digits: "966" },
  { country: "Singapore", dialCode: "+65", digits: "65" },
  { country: "South Africa", dialCode: "+27", digits: "27" },
  { country: "United Arab Emirates", dialCode: "+971", digits: "971" },
  { country: "United Kingdom", dialCode: "+44", digits: "44" },
  { country: "United States", dialCode: "+1", digits: "1" }
];

export default function LoginPage() {
  const router = useRouter();
  const [authIntent, setAuthIntent] = useState<"signup" | "signin">("signin");
  const [firstName, setFirstName] = useState("Scout");
  const [lastName, setLastName] = useState("User");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState<"MALE" | "FEMALE" | "UNSPECIFIED">("UNSPECIFIED");
  const [countryCallingCode, setCountryCallingCode] = useState("1");
  const [countryCodeSearch, setCountryCodeSearch] = useState("+1 United States");
  const [countryCodeOptions, setCountryCodeOptions] = useState<CountryCodeOption[]>(DEFAULT_COUNTRY_CODE_OPTIONS);
  const [phone, setPhone] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [stage, setStage] = useState<"credentials" | "mfa">("credentials");

  const org = useMemo(() => getOrgByEmail(email), [email]);
  const isAdminEmail = isPrivilegedAdminEmail(email);
  const fullName = `${firstName} ${lastName}`.trim() || "Scout User";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("https://restcountries.com/v3.1/all?fields=name,idd", { cache: "force-cache" });
        if (!res.ok) return;
        const data = await res.json().catch(() => ([])) as Array<{
          name?: { common?: string };
          idd?: { root?: string; suffixes?: string[] };
        }>;
        const dedupe = new Map<string, CountryCodeOption>();
        data.forEach((item) => {
          const country = String(item?.name?.common || "").trim();
          const root = String(item?.idd?.root || "").trim();
          const suffixes = Array.isArray(item?.idd?.suffixes) ? item.idd.suffixes : [];
          if (!country || !root.startsWith("+")) return;
          const roots = suffixes.length ? suffixes : [""];
          roots.forEach((suffix) => {
            const digits = `${root}${String(suffix || "").trim()}`.replace(/[^\d]/g, "");
            if (!digits) return;
            const dialCode = `+${digits}`;
            dedupe.set(`${dialCode}:${country.toLowerCase()}`, { country, dialCode, digits });
          });
        });
        if (!dedupe.size || cancelled) return;
        const next = Array.from(dedupe.values()).sort((a, b) => {
          if (a.digits.length !== b.digits.length) return a.digits.length - b.digits.length;
          return a.dialCode.localeCompare(b.dialCode) || a.country.localeCompare(b.country);
        });
        setCountryCodeOptions(next);
      } catch {
        // Keep fallback list on fetch failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!countryCallingCode) return;
    const exact = countryCodeOptions.find((item) => item.digits === countryCallingCode);
    if (exact) setCountryCodeSearch(`${exact.dialCode} ${exact.country}`);
  }, [countryCallingCode, countryCodeOptions]);

  function findCountryCodeMatch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return null;
    const digits = trimmed.replace(/[^\d]/g, "");
    const lower = trimmed.toLowerCase();
    if (digits) {
      const exact = countryCodeOptions.find((item) => item.digits === digits);
      if (exact) return exact;
      const prefix = countryCodeOptions.find((item) => item.digits.startsWith(digits));
      if (prefix) return prefix;
    }
    return countryCodeOptions.find((item) =>
      item.country.toLowerCase().includes(lower)
      || item.dialCode.includes(trimmed.replace(/\s+/g, ""))
    ) || null;
  }

  function isUniversityEmailInput(value: string) {
    return /^[^@\s]+@[^@\s]+\.edu$/i.test(String(value || "").trim());
  }

  async function startLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    if (authIntent === "signup" && !isAdminEmail && !isUniversityEmailInput(email)) {
      setError("Use your university email address to create an account.");
      setLoading(false);
      return;
    }
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

  async function ensureBiometricCredential() {
    if (!("PublicKeyCredential" in window) || !window.PublicKeyCredential) {
      setError("Biometric sign-in is not supported on this browser.");
      return false;
    }
    if (!email.includes("@")) {
      setError("Enter your email first, then set up biometric sign-in.");
      return false;
    }
    try {
      const platformAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!platformAvailable) {
        setError("No Face ID / fingerprint authenticator is available on this device.");
        return false;
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
        return false;
      }

      localStorage.setItem("bd-biometric-email", email.toLowerCase());
      localStorage.setItem("bd-biometric-id", toBase64Url(rawId));
      return true;
    } catch {
      setError("Biometric setup was cancelled or failed.");
      return false;
    }
  }

  async function loginWithFingerprint() {
    if (!("PublicKeyCredential" in window) || !window.PublicKeyCredential) {
      setError("Biometric sign-in is not supported on this browser.");
      return;
    }
    setBiometricLoading(true);
    setError("");
    setInfo("");
    try {
      const normalizedEmail = email.toLowerCase();
      let storedEmail = localStorage.getItem("bd-biometric-email") || "";
      let storedId = localStorage.getItem("bd-biometric-id") || "";
      if (!storedEmail || !storedId || storedEmail !== normalizedEmail) {
        const enabled = await ensureBiometricCredential();
        if (!enabled) return;
        storedEmail = localStorage.getItem("bd-biometric-email") || "";
        storedId = localStorage.getItem("bd-biometric-id") || "";
      }
      if (!storedEmail || !storedId || storedEmail !== normalizedEmail) {
        setError("Biometric sign-in could not be initialized for this email.");
        return;
      }

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
      setInfo("Biometric sign-in successful.");
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
        ["--login-accent-soft" as string]: toAlpha(org.primary, 0.16)
      }}
    >
      <section className="login-card">
        <img
          src="/branding/a-point-scout-mark.svg?v=20260508b"
          alt="APOINT SCOUT"
          className="login-brand-mark"
        />
        <h1 className="login-title">APOINT SCOUT</h1>
        <p className="login-subtitle">Sign up or sign in with your university email.</p>

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
            <label className="login-field">
              University Email
              <div className="input-shell">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@university.edu"
                  required
                />
                <span className="input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M3 6h18v12H3z" fill="none" />
                    <path d="M4.5 7.5h15a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
                    <path d="M4 8l8 6 8-6" />
                  </svg>
                </span>
              </div>
            </label>
            <label className="login-field">
              Password
              <div className="input-shell">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="input-icon-btn"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M3 3l18 18" />
                      <path d="M10.5 6.2A10.2 10.2 0 0 1 12 6c5.4 0 9.6 4.2 10.9 6-1 1.4-3.8 4.3-7.6 5.5" />
                      <path d="M6.3 7.1C3.9 8.6 2.3 10.9 1 12c1.3 1.8 5.5 6 11 6 1.3 0 2.5-.2 3.7-.5" />
                      <path d="M9.7 9.7a3.2 3.2 0 0 0 4.6 4.6" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M1 12c1.3-1.8 5.5-6 11-6s9.7 4.2 11 6c-1.3 1.8-5.5 6-11 6S2.3 13.8 1 12z" />
                      <circle cx="12" cy="12" r="3.2" />
                    </svg>
                  )}
                </button>
              </div>
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
                    list="country-codes"
                    value={countryCodeSearch}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCountryCodeSearch(value);
                      const digits = value.replace(/[^\d]/g, "");
                      setCountryCallingCode(digits);
                      const exact = countryCodeOptions.find((item) => item.digits === digits);
                      if (exact && /^\s*\+?\d+\s*$/.test(value)) {
                        setCountryCodeSearch(`${exact.dialCode} ${exact.country}`);
                      }
                    }}
                    onBlur={() => {
                      const match = findCountryCodeMatch(countryCodeSearch);
                      if (!match) return;
                      setCountryCallingCode(match.digits);
                      setCountryCodeSearch(`${match.dialCode} ${match.country}`);
                    }}
                    inputMode="numeric"
                    placeholder="+91 India"
                    required
                  />
                  <datalist id="country-codes">
                    {countryCodeOptions.map((item) => (
                      <option key={`${item.dialCode}-${item.country}`} value={`${item.dialCode} ${item.country}`} />
                    ))}
                  </datalist>
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
              {loading ? "Checking..." : (authIntent === "signup" ? "Create Account" : "Continue")}
            </button>
            {authIntent === "signin" ? (
              <button type="button" className="secondary-btn" disabled={loading || biometricLoading} onClick={loginWithFingerprint}>
                {biometricLoading ? "Working..." : "Use Face ID / Fingerprint"}
              </button>
            ) : null}
          </form>
          </>
        ) : (
          <form onSubmit={verifyMfa}>
            <p className="muted">Enter the MFA code sent to your university email to verify account ownership.</p>
            <label>
              MFA Code
              <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" required />
            </label>
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
