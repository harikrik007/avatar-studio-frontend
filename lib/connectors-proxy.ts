import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

/**
 * Connectors (apps the owner connects for their agents: the backend's api/connectors.py) are per signed-in client, like every
 * other /api route here: the browser never talks to the backend, the Next server does, with the shared token and the client
 * id from the session. The backend decides who gets connectors at all (403 otherwise) and what an account may pick.
 */
export async function connectorsBackend(path: string, init: { method?: string; body?: unknown } = {}) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({ error: "Unexpected response." }));
  return NextResponse.json(body, { status: res.status });
}

/** Whether the signed-in account has connectors at all (for /api/features). False when anything is off or unreachable. */
export async function connectorsEnabled(clientId: string | undefined): Promise<boolean> {
  if (!clientId) return false;
  try {
    const res = await fetch(`${API_URL}/connectors/status`, {
      headers: { Authorization: `Bearer ${API_TOKEN}`, "X-Avatar-Studio-Client-Id": clientId },
      cache: "no-store",
    });
    return res.ok && (await res.json())?.enabled === true;
  } catch {
    return false;
  }
}

const first = (value: string | null) => (value ?? "").split(",")[0].trim();

/** This site's own address as the visitor sees it (the request's own URL is the container's behind the proxy). The site's
 * domains only serve https; a local address keeps what the request says. Same reading as app/api/auth/[...nextauth]. */
export function siteOrigin(request: Request): string {
  const host = (first(request.headers.get("x-forwarded-host")) || first(request.headers.get("host"))).toLowerCase();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = local ? first(request.headers.get("x-forwarded-proto")) || "http" : "https";
  return `${proto}://${host}`;
}
