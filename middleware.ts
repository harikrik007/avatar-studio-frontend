import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// Two layers, checked in order. Layer 1: shared-password gate for the
// pitch build (unchanged from before Google login existed) -- lands
// everyone on /gate first, including /api/auth/* itself, so someone can't
// bypass the password by going straight to Google's OAuth callback
// without ever passing it. Layer 2: once past the password, /login and
// /dashboard/avatars require a real Google session. /onboarding sits
// between the two: session required, company_name not required (that's
// what it's collecting).
const COOKIE_NAME = "studio_gate";
const PUBLIC_PATHS = new Set(["/", "/pricing", "/gate", "/api/gate"]);
const ONBOARDING_PATHS = new Set(["/onboarding", "/api/onboarding"]);

async function expectedCookieValue(): Promise<string | null> {
  const password = process.env.GATE_PASSWORD;
  if (!password) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!isPublic) {
    const expected = await expectedCookieValue();
    const cookieOk = expected !== null && request.cookies.get(COOKIE_NAME)?.value === expected;
    if (!cookieOk) {
      const url = request.nextUrl.clone();
      url.pathname = "/gate";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  if (isPublic) {
    return NextResponse.next();
  }

  // /login and NextAuth's own routes can't require a session -- they're
  // how you get one.
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const session = await auth();
  if (!session?.clientId) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!session.companyName && !ONBOARDING_PATHS.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
