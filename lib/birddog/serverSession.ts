import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { SessionUser } from "@/lib/birddog/types";

const COOKIE_NAME = "bird_dog_session";
const TTL_SECONDS = 60 * 60 * 24;

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

export function createSessionToken(user: SessionUser) {
  const payload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS
  };
  const encoded = base64Url(JSON.stringify(payload));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string): SessionUser | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as SessionUser & { exp: number };
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    const { exp: _exp, ...user } = parsed;
    return user;
  } catch {
    return null;
  }
}

export function readSessionFromRequest(req: NextRequest): SessionUser | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: TTL_SECONDS
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
}
