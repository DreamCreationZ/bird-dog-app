import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, setSessionCookie } from "@/lib/birddog/serverSession";
import { getOrgByEmail } from "@/lib/birddog/mockData";
import { upsertScoutUser } from "@/lib/birddog/repository";
import {
  buildPendingMfaToken,
  buildTrustedAuthToken,
  clearPendingMfaCookie,
  generateMfaCode,
  hashSecret,
  isAdminLogin,
  isUniversityEmail,
  normalizeEmail,
  readPendingMfaFromRequest,
  readTrustedAuthFromRequest,
  setPendingMfaCookie,
  setTrustedAuthCookie,
  verifyMfaCode
} from "@/lib/birddog/authFlow";
import { adminUserIdFromEmail, isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";
import { sendMfaCodes } from "@/lib/birddog/mfaMailer";
import { SessionUser } from "@/lib/birddog/types";

const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;
const VALID_GENDERS = new Set(["MALE", "FEMALE", "UNSPECIFIED"]);
type GenderValue = "MALE" | "FEMALE" | "UNSPECIFIED";

function normalizeGender(value: unknown): GenderValue {
  const normalized = String(value || "").trim().toUpperCase();
  return VALID_GENDERS.has(normalized) ? (normalized as GenderValue) : "UNSPECIFIED";
}

function normalizePhone(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "").trim();
}

function normalizeCountryCallingCode(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "").trim();
}

function buildUser(input: {
  name: string;
  email: string;
  isAdmin?: boolean;
  authMethod?: SessionUser["authMethod"];
  gender?: GenderValue;
  phone?: string;
  countryCallingCode?: string;
}) {
  const org = getOrgByEmail(input.email);
  return {
    userId: input.isAdmin ? adminUserIdFromEmail(input.email) : `u_${Buffer.from(input.email).toString("base64url")}`,
    name: input.name,
    email: input.email,
    orgId: input.isAdmin ? "admin" : org.orgId,
    orgName: input.isAdmin ? "Apoint Scout Admin" : org.name,
    orgPrimary: org.primary,
    orgAccent: org.accent,
    orgLogoUrl: org.logoUrl || "",
    isAdmin: Boolean(input.isAdmin),
    authMethod: input.authMethod,
    gender: input.gender || "UNSPECIFIED",
    phone: input.phone || "",
    countryCallingCode: input.countryCallingCode || "1"
  } satisfies SessionUser;
}

async function saveScoutProfile(user: SessionUser) {
  if (user.isAdmin) return;
  try {
    await upsertScoutUser({
      userId: user.userId,
      orgId: user.orgId,
      name: user.name,
      email: user.email,
      gender: user.gender || "UNSPECIFIED",
      phone: user.phone || "",
      countryCallingCode: user.countryCallingCode || "1"
    });
  } catch (error) {
    console.error("Failed to upsert scout user during login. Continuing with session fallback.", error);
  }
}

async function finishLogin(user: SessionUser, ttlSeconds?: number) {
  const token = createSessionToken(user, { ttlSeconds });
  await setSessionCookie(token, { maxAgeSeconds: ttlSeconds });
  await saveScoutProfile(user);
  return NextResponse.json({ ok: true, user });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode || "start").trim().toLowerCase();
  const authIntent = String(body?.authIntent || "signin").trim().toLowerCase() === "signup" ? "signup" : "signin";
  const biometricOnly = Boolean(body?.biometric);

  const name = String(body?.name || "").trim() || "Scout User";
  const email = normalizeEmail(String(body?.email || ""));
  const password = String(body?.password || "");
  const mfaCode = String(body?.mfaCode || "").trim();
  const gender = normalizeGender(body?.gender);
  const phone = normalizePhone(body?.phone);
  const countryCallingCode = normalizeCountryCallingCode(body?.countryCallingCode || "1");

  if (!email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }

  if (isPrivilegedAdminEmail(email)) {
    if (isAdminLogin(email, password)) {
      const adminUser = buildUser({
        name: name || "Admin",
        email,
        isAdmin: true,
        authMethod: "admin"
      });
      return finishLogin(adminUser, ADMIN_SESSION_TTL_SECONDS);
    }
    return NextResponse.json({ error: "Invalid admin credentials." }, { status: 401 });
  }

  if (!isUniversityEmail(email)) {
    return NextResponse.json({ error: "Only university email addresses can be used to create and access scout accounts." }, { status: 400 });
  }

  const trusted = readTrustedAuthFromRequest(req);
  if (biometricOnly) {
    if (trusted && trusted.email === email) {
      const user = buildUser({
        name,
        email,
        authMethod: "passkey",
        gender: trusted.gender,
        phone: trusted.phone,
        countryCallingCode: trusted.countryCallingCode
      });
      return finishLogin(user);
    }
    return NextResponse.json({ error: "Biometric login is not enabled yet for this device. Complete first-time setup first." }, { status: 401 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const passwordHash = hashSecret(password);

  if (trusted && trusted.email === email && trusted.passwordHash === passwordHash && mode !== "verify") {
    const user = buildUser({
      name,
      email,
      authMethod: "password",
      gender: trusted.gender,
      phone: trusted.phone,
      countryCallingCode: trusted.countryCallingCode
    });
    return finishLogin(user);
  }

  if (authIntent === "signin" && mode !== "verify") {
    return NextResponse.json({
      error: "Sign-in on this device is not set up yet. Use Sign Up once (with email verification), then Sign In works with email/password or biometric."
    }, { status: 401 });
  }

  if (mode !== "verify") {
    if (!countryCallingCode || countryCallingCode.length < 1 || countryCallingCode.length > 4) {
      return NextResponse.json({ error: "Enter a valid country code like 1 or 91." }, { status: 400 });
    }
    if (!phone || phone.length < 7 || phone.length > 15) {
      return NextResponse.json({ error: "Enter a valid mobile number." }, { status: 400 });
    }
  }

  if (mode !== "verify") {
    const nextMfaCode = generateMfaCode();
    const pendingToken = buildPendingMfaToken({
      name,
      email,
      passwordHash,
      codeHash: hashSecret(nextMfaCode),
      gender,
      phone,
      countryCallingCode
    });
    await setPendingMfaCookie(pendingToken);

    const org = getOrgByEmail(email);
    const delivery = await sendMfaCodes({
      email,
      name,
      orgName: org.name,
      code: nextMfaCode
    });

    if (delivery.delivered) {
      return NextResponse.json({
        ok: true,
        mfaRequired: true,
        message: "A verification code has been sent to your university email."
      }, { status: 202 });
    }

    return NextResponse.json({
      error: "We could not send the MFA code to your university email right now. Please try again."
    }, { status: 503 });
  }

  const pending = readPendingMfaFromRequest(req);
  if (!pending) {
    return NextResponse.json({ error: "MFA session expired. Request new codes." }, { status: 401 });
  }
  if (pending.email !== email || pending.passwordHash !== passwordHash) {
    return NextResponse.json({ error: "MFA session does not match your current login details." }, { status: 401 });
  }
  if (!pending.codeHash) {
    return NextResponse.json({ error: "Your MFA challenge format is outdated. Start login again to get a fresh code." }, { status: 401 });
  }
  if (!verifyMfaCode({ pending, code: mfaCode })) {
    return NextResponse.json({ error: "Invalid MFA code. Please check and try again." }, { status: 401 });
  }

  await clearPendingMfaCookie();
  await setTrustedAuthCookie(buildTrustedAuthToken({
    email,
    passwordHash,
    gender: pending.gender || "UNSPECIFIED",
    phone: pending.phone || "",
    countryCallingCode: pending.countryCallingCode || "1"
  }));

  const user = buildUser({
    name: pending.name || name,
    email,
    authMethod: "password_mfa",
    gender: pending.gender || "UNSPECIFIED",
    phone: pending.phone || "",
    countryCallingCode: pending.countryCallingCode || "1"
  });
  return finishLogin(user);
}
