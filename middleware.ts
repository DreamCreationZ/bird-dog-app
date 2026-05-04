import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "bird_dog_session";
const STALE_BIRD_DOG_CHUNKS = new Set([
  "/_next/static/chunks/app/bird-dog/page-3da0868d4720a619.js"
]);

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

  if (STALE_BIRD_DOG_CHUNKS.has(path)) {
    const recoverTo = req.nextUrl.clone();
    recoverTo.pathname = "/login";
    recoverTo.searchParams.set("_chunkRecover", String(Date.now()));
    return new NextResponse(
      `window.location.replace(${JSON.stringify(recoverTo.toString())});`,
      {
        status: 200,
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate, max-age=0"
        }
      }
    );
  }

  if ((path.startsWith("/bird-dog") || path.startsWith("/subscribe")) && !hasUsableSession) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/bird-dog/:path*", "/subscribe", "/login", "/_next/static/chunks/app/bird-dog/page-3da0868d4720a619.js"]
};
