import { createHash, createHmac, randomInt, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const TRUSTED_AUTH_COOKIE = "bird_dog_trusted_auth";
const MFA_PENDING_COOKIE = "bird_dog_mfa_pending";
const VERSION = 1;

const TRUSTED_TTL_SECONDS = 60 * 60 * 24 * 180;
const MFA_TTL_SECONDS = 60 * 10;

export type TrustedAuthPayload = {
  v: number;
  email: string;
  passwordHash: string;
  exp: number;
};

export type PendingMfaPayload = {
  v: number;
  name: string;
  email: string;
  passwordHash: string;
  codeOneHash: string;
  codeTwoHash: string;
  exp: number;
};

function getSecret() {
  return process.env.BIRD_DOG_SESSION_SECRET || "dev-only-secret-change-in-prod";
}

function shouldUseSecureCookie() {
  const override = process.env.BIRD_DOG_COOKIE_SECURE;
  if (override === "true") return true;
  if (override === "false") return false;

  if (process.env.NODE_ENV !== "production") return false;
  const appUrl = process.env.APP_BASE_URL || "";
  if (!appUrl) {
    return Boolean(process.env.VERCEL || process.env.VERCEL_URL);
  }
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(appUrl)) return false;
  return true;
}

function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function encodeSigned(payload: object) {
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function decodeSigned<T>(token: string): T | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  if (!safeEqual(signature, expected)) return null;

  try {
    return JSON.parse(fromBase64Url(encoded)) as T;
  } catch {
    return null;
  }
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function generateMfaCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function normalizeEmail(input: string) {
  return String(input || "").trim().toLowerCase();
}

export function isUniversityEmail(email: string) {
  const at = email.indexOf("@");
  if (at < 1) return false;
  const domain = email.slice(at + 1);
  return /\.edu$/i.test(domain);
}

export function getAdminCredentials() {
  const defaultEmail = "admin@apointscount.com";
  const fallbackAlias = "admin@apointscout.com";
  const email = normalizeEmail(process.env.BIRD_DOG_ADMIN_EMAIL || defaultEmail);
  const password = process.env.BIRD_DOG_ADMIN_PASSWORD || "Dreamzlyf!";
  return {
    email,
    fallbackAlias,
    password
  };
}

export function isAdminLogin(email: string, password: string) {
  const admin = getAdminCredentials();
  const normalized = normalizeEmail(email);
  if (password !== admin.password) return false;
  return normalized === admin.email || normalized === admin.fallbackAlias;
}

export function buildTrustedAuthToken(input: { email: string; passwordHash: string }) {
  const payload: TrustedAuthPayload = {
    v: VERSION,
    email: normalizeEmail(input.email),
    passwordHash: input.passwordHash,
    exp: nowUnix() + TRUSTED_TTL_SECONDS
  };
  return encodeSigned(payload);
}

export function readTrustedAuthFromRequest(req: NextRequest): TrustedAuthPayload | null {
  const token = req.cookies.get(TRUSTED_AUTH_COOKIE)?.value;
  if (!token) return null;
  const payload = decodeSigned<TrustedAuthPayload>(token);
  if (!payload || payload.v !== VERSION || payload.exp < nowUnix()) return null;
  return payload;
}

export async function setTrustedAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(TRUSTED_AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: TRUSTED_TTL_SECONDS
  });
}

export async function clearTrustedAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.set(TRUSTED_AUTH_COOKIE, "", { path: "/", maxAge: 0 });
}

export function buildPendingMfaToken(input: {
  name: string;
  email: string;
  passwordHash: string;
  codeOneHash: string;
  codeTwoHash: string;
}) {
  const payload: PendingMfaPayload = {
    v: VERSION,
    name: String(input.name || "").trim(),
    email: normalizeEmail(input.email),
    passwordHash: input.passwordHash,
    codeOneHash: input.codeOneHash,
    codeTwoHash: input.codeTwoHash,
    exp: nowUnix() + MFA_TTL_SECONDS
  };
  return encodeSigned(payload);
}

export function readPendingMfaFromRequest(req: NextRequest): PendingMfaPayload | null {
  const token = req.cookies.get(MFA_PENDING_COOKIE)?.value;
  if (!token) return null;
  const payload = decodeSigned<PendingMfaPayload>(token);
  if (!payload || payload.v !== VERSION || payload.exp < nowUnix()) return null;
  return payload;
}

export async function setPendingMfaCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(MFA_PENDING_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: MFA_TTL_SECONDS
  });
}

export async function clearPendingMfaCookie() {
  const cookieStore = await cookies();
  cookieStore.set(MFA_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
}

export function verifyMfaCodes(input: {
  pending: PendingMfaPayload;
  codeOne: string;
  codeTwo: string;
}) {
  const codeOneHash = hashSecret(String(input.codeOne || "").trim());
  const codeTwoHash = hashSecret(String(input.codeTwo || "").trim());
  return safeEqual(input.pending.codeOneHash, codeOneHash) && safeEqual(input.pending.codeTwoHash, codeTwoHash);
}
