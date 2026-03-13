import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "bird_dog_session";

export function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const path = req.nextUrl.pathname;

  if ((path.startsWith("/bird-dog") || path.startsWith("/subscribe")) && !token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (path.startsWith("/login") && token) {
    return NextResponse.redirect(new URL("/bird-dog", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/bird-dog/:path*", "/subscribe", "/login"]
};
