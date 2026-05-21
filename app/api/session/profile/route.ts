import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, readSessionFromRequest, setSessionCookie } from "@/lib/birddog/serverSession";
import { getOrgByEmail } from "@/lib/birddog/mockData";
import { upsertScoutUser } from "@/lib/birddog/repository";
import {
  buildTrustedAuthToken,
  isSupportedScoutEmail,
  normalizeEmail,
  readTrustedAuthFromRequest,
  setTrustedAuthCookie
} from "@/lib/birddog/authFlow";
import { adminUserIdFromEmail, isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";
import { SessionUser } from "@/lib/birddog/types";

const VALID_GENDERS = new Set(["MALE", "FEMALE", "UNSPECIFIED"]);
type GenderValue = "MALE" | "FEMALE" | "UNSPECIFIED";

function normalizeGender(value: unknown, fallback: GenderValue): GenderValue {
  const next = String(value || "").trim().toUpperCase();
  if (VALID_GENDERS.has(next)) return next as GenderValue;
  return fallback;
}

function normalizePhone(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "").trim();
}

function normalizeCountryCallingCode(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "").trim();
}

function splitNameParts(value: string) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  const middleName = parts.length > 2 ? parts.slice(1, -1).join(" ") : "";
  return { firstName, middleName, lastName };
}

export async function PATCH(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const nextName = String(body?.name || session.name || "").trim() || "Scout User";
  const nextEmail = normalizeEmail(String(body?.email || session.email || ""));
  const nextGender = normalizeGender(body?.gender, (session.gender || "UNSPECIFIED") as GenderValue);
  const nextPhone = normalizePhone(body?.phone ?? session.phone);
  const nextCode = normalizeCountryCallingCode((body?.countryCallingCode ?? session.countryCallingCode) || "1");
  const nextState = String(body?.state ?? session.state ?? "").trim();
  const nextCountry = String(body?.country ?? session.country ?? "").trim();

  if (!nextEmail.includes("@")) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (session.isAdmin && !isPrivilegedAdminEmail(nextEmail)) {
    return NextResponse.json({ error: "Admin email cannot be changed to a non-admin address." }, { status: 400 });
  }
  if (!session.isAdmin) {
    if (isPrivilegedAdminEmail(nextEmail)) {
      return NextResponse.json({ error: "That email is reserved for admin access." }, { status: 400 });
    }
    if (!isSupportedScoutEmail(nextEmail)) {
      return NextResponse.json({ error: "Use a valid email address." }, { status: 400 });
    }
  }
  if (!nextCode || nextCode.length > 4) {
    return NextResponse.json({ error: "Enter a valid country code." }, { status: 400 });
  }
  if (!nextPhone || nextPhone.length < 7 || nextPhone.length > 15) {
    return NextResponse.json({ error: "Enter a valid mobile number." }, { status: 400 });
  }

  const nextIsAdmin = Boolean(session.isAdmin) || isPrivilegedAdminEmail(nextEmail);
  const org = getOrgByEmail(nextEmail);
  const nameParts = splitNameParts(nextName);
  const nextUser: SessionUser = {
    userId: nextIsAdmin ? adminUserIdFromEmail(nextEmail) : `u_${Buffer.from(nextEmail).toString("base64url")}`,
    name: nextName,
    firstName: nameParts.firstName,
    middleName: nameParts.middleName,
    lastName: nameParts.lastName,
    email: nextEmail,
    orgId: nextIsAdmin ? "admin" : org.orgId,
    orgName: nextIsAdmin ? "Apoint Scout Admin" : org.name,
    orgPrimary: org.primary,
    orgAccent: org.accent,
    orgLogoUrl: org.logoUrl || "",
    state: nextState,
    country: nextCountry,
    isAdmin: nextIsAdmin,
    authMethod: session.authMethod,
    gender: nextGender,
    phone: nextPhone,
    countryCallingCode: nextCode
  };

  const token = createSessionToken(nextUser);
  await setSessionCookie(token);

  const trusted = readTrustedAuthFromRequest(req);
  if (trusted?.passwordHash) {
    await setTrustedAuthCookie(
      buildTrustedAuthToken({
        email: nextEmail,
        name: nextName,
        firstName: nameParts.firstName,
        middleName: nameParts.middleName,
        lastName: nameParts.lastName,
        state: nextState,
        country: nextCountry,
        passwordHash: trusted.passwordHash,
        gender: nextGender,
        phone: nextPhone,
        countryCallingCode: nextCode
      })
    );
  }

  if (!nextUser.isAdmin) {
    try {
      await upsertScoutUser({
        userId: nextUser.userId,
        orgId: nextUser.orgId,
        name: nextUser.name,
        email: nextUser.email,
        gender: nextGender,
        phone: nextPhone,
        countryCallingCode: nextCode
      });
    } catch (error) {
      console.error("Failed to persist profile update", error);
    }
  }

  return NextResponse.json({ ok: true, user: nextUser });
}
