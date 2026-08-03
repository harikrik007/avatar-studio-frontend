import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// Google login is the only gate now -- the shared-password layer from the
// early pitch build is gone (it predates real per-user accounts and was
// causing real friction on mobile). /, /pricing, /login, and NextAuth's
// own routes stay public; /onboarding needs a session but not yet a
// company_name (that's what it's collecting); everything else needs both.
const PUBLIC_PATHS = new Set(["/", "/pricing"]);
const ONBOARDING_PATHS = new Set(["/onboarding", "/api/onboarding"]);

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

/**
 * /embed/{key} is loaded inside an iframe on an unknown third-party site --
 * it must be reachable with no Google session, which is the opposite of
 * every other path here. Rather than special-casing this one route deep
 * inside the auth logic below, it is carved out at the very top alongside
 * /login: an unauthenticated route, on purpose, not a gap in the gate.
 *
 * This is also the one place that can set a *dynamic*, per-key
 * Content-Security-Policy: frame-ancestors header -- next.config.ts's
 * headers() only supports static values, and app/embed/[key]/page.tsx (a
 * React Server Component) has no way to set arbitrary response headers on
 * itself. Middleware runs before the page renders and can attach one here.
 *
 * This CSP, not the allowed_origins check inside POST /embed/session, is
 * the actual security boundary: it is enforced by the browser against the
 * real page framing the widget and cannot be spoofed from JavaScript,
 * unlike an Origin/Referer value a non-browser caller can just make up.
 */
async function embedFrameAncestorsHeader(publicKey: string): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/embed/config/${publicKey}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      // Never cache: a revoked key or an edited allowlist must take effect
      // on the very next request, not after some stale TTL.
      cache: "no-store",
    });
    if (!res.ok) {
      // Unknown or revoked key -- no origin gets to frame it.
      return "frame-ancestors 'none'";
    }
    const config = (await res.json()) as { allowed_origins?: string[] };
    const origins = config.allowed_origins ?? [];
    return origins.length > 0 ? `frame-ancestors ${origins.join(" ")}` : "frame-ancestors 'none'";
  } catch {
    // Backend unreachable -- fail closed, same as an unknown key. A widget
    // that can't confirm its own allowlist must not render anywhere rather
    // than render everywhere.
    return "frame-ancestors 'none'";
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const embedMatch = pathname.match(/^\/embed\/([^/]+)\/?$/);
  if (embedMatch) {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", await embedFrameAncestorsHeader(embedMatch[1]));
    return response;
  }
  if (pathname.startsWith("/api/embed/")) {
    // The session broker itself -- public by design (see api/embed.py's
    // module docstring). No CSP to set here: this is a same-origin fetch
    // made by the iframe's own script, not a framed document.
    return NextResponse.next();
  }
  if (pathname === "/widget.js") {
    // The loader script itself, served from public/ -- it runs inside a
    // stranger's page before that page has (or could have) any session
    // with this app, so it must load with no auth. The middleware matcher
    // below only excludes _next/static, _next/image and favicon.ico, so a
    // public/ file with any other name still passes through here and would
    // otherwise get redirected to /login like a real app route.
    return NextResponse.next();
  }

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
