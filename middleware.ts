import { NextRequest, NextResponse } from "next/server";

// Shared-password gate for the pitch build. Not per-user auth -- deferred
// per the project's own instruction (Google login comes later, see
// docs/PLAN.md Phase 4). One shared secret; the cookie is a SHA-256 hash of
// that secret, not a literal "yes" flag, so a stranger can't just set
// studio_gate=1 by hand without knowing GATE_PASSWORD.
const COOKIE_NAME = "studio_gate";

async function expectedCookieValue(): Promise<string | null> {
  const password = process.env.GATE_PASSWORD;
  if (!password) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(request: NextRequest) {
  const isGateRoute =
    request.nextUrl.pathname === "/gate" || request.nextUrl.pathname === "/api/gate";

  const expected = await expectedCookieValue();
  const cookieOk = expected !== null && request.cookies.get(COOKIE_NAME)?.value === expected;

  if (!isGateRoute && !cookieOk) {
    const url = request.nextUrl.clone();
    url.pathname = "/gate";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
