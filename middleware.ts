import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// Google login is the only gate now -- the shared-password layer from the
// early pitch build is gone (it predates real per-user accounts and was
// causing real friction on mobile). /, /pricing, /login, and NextAuth's
// own routes stay public; /onboarding needs a session but not yet a
// company_name (that's what it's collecting); everything else needs both.
const PUBLIC_PATHS = new Set(["/", "/pricing"]);
const ONBOARDING_PATHS = new Set(["/onboarding", "/api/onboarding"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
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
