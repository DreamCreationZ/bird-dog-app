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
  verifyMfaCodes
} from "@/lib/birddog/authFlow";
import { sendMfaCodes } from "@/lib/birddog/mfaMailer";
import { SessionUser } from "@/lib/birddog/types";

const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;

function buildUser(input: {
  name: string;
  email: string;
  isAdmin?: boolean;
  authMethod?: SessionUser["authMethod"];
}) {
  const org = getOrgByEmail(input.email);
  return {
    userId: input.isAdmin ? "u_admin_apointscout" : `u_${Buffer.from(input.email).toString("base64url")}`,
    name: input.name,
    email: input.email,
    orgId: input.isAdmin ? "admin" : org.orgId,
    orgName: input.isAdmin ? "Apoint Scout Admin" : org.name,
    orgPrimary: org.primary,
    orgAccent: org.accent,
    orgLogoUrl: org.logoUrl || "",
    isAdmin: Boolean(input.isAdmin),
    authMethod: input.authMethod
  } satisfies SessionUser;
}

async function saveScoutProfile(user: SessionUser) {
  if (user.isAdmin) return;
  try {
    await upsertScoutUser({
      userId: user.userId,
      orgId: user.orgId,
      name: user.name,
      email: user.email
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
  const biometricOnly = Boolean(body?.biometric);

  const name = String(body?.name || "").trim() || "Scout User";
  const email = normalizeEmail(String(body?.email || ""));
  const password = String(body?.password || "");
  const codeOne = String(body?.codeOne || "").trim();
  const codeTwo = String(body?.codeTwo || "").trim();

  if (!email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }

  if (isAdminLogin(email, password)) {
    const adminUser = buildUser({
      name: name || "Admin",
      email,
      isAdmin: true,
      authMethod: "admin"
    });
    return finishLogin(adminUser, ADMIN_SESSION_TTL_SECONDS);
  }

  if (!isUniversityEmail(email)) {
    return NextResponse.json({ error: "Please sign in with your university .edu email address." }, { status: 400 });
  }

  const trusted = readTrustedAuthFromRequest(req);
  if (biometricOnly) {
    if (trusted && trusted.email === email) {
      const user = buildUser({
        name,
        email,
        authMethod: "passkey"
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
      authMethod: "password"
    });
    return finishLogin(user);
  }

  if (mode !== "verify") {
    const mfaCodeOne = generateMfaCode();
    const mfaCodeTwo = generateMfaCode();
    const pendingToken = buildPendingMfaToken({
      name,
      email,
      passwordHash,
      codeOneHash: hashSecret(mfaCodeOne),
      codeTwoHash: hashSecret(mfaCodeTwo)
    });
    await setPendingMfaCookie(pendingToken);

    const org = getOrgByEmail(email);
    const delivery = await sendMfaCodes({
      email,
      name,
      orgName: org.name,
      codeOne: mfaCodeOne,
      codeTwo: mfaCodeTwo
    });

    if (delivery.delivered) {
      return NextResponse.json({
        ok: true,
        mfaRequired: true,
        message: "Two MFA codes were sent to your university email."
      }, { status: 202 });
    }

    return NextResponse.json({
      ok: true,
      mfaRequired: true,
      message: "Email delivery is not configured. Use the codes below once, then configure Resend in env for production email MFA.",
      fallbackCodes: {
        codeOne: mfaCodeOne,
        codeTwo: mfaCodeTwo
      }
    }, { status: 202 });
  }

  const pending = readPendingMfaFromRequest(req);
  if (!pending) {
    return NextResponse.json({ error: "MFA session expired. Request new codes." }, { status: 401 });
  }
  if (pending.email !== email || pending.passwordHash !== passwordHash) {
    return NextResponse.json({ error: "MFA session does not match your current login details." }, { status: 401 });
  }
  if (!verifyMfaCodes({ pending, codeOne, codeTwo })) {
    return NextResponse.json({ error: "Invalid MFA codes. Please check both codes and try again." }, { status: 401 });
  }

  await clearPendingMfaCookie();
  await setTrustedAuthCookie(buildTrustedAuthToken({ email, passwordHash }));

  const user = buildUser({
    name: pending.name || name,
    email,
    authMethod: "password_mfa"
  });
  return finishLogin(user);
}
