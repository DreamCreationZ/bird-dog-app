import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "bird_dog_session";

function isNonExpiredToken(token: string | undefined) {
  if (!token) return false;
  const encoded = token.split(".")[0];
  if (!encoded) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { exp?: number };
    if (typeof payload?.exp !== "number") return false;
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const path = req.nextUrl.pathname;
  const hasUsableSession = isNonExpiredToken(token);

  if ((path.startsWith("/bird-dog") || path.startsWith("/subscribe")) && !hasUsableSession) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/bird-dog/:path*", "/subscribe", "/login"]
};
