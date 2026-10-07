import { NextRequest } from "next/server";
import { handlers } from "@/auth";

// The addresses this site is served on. Login has to know which one the visitor actually used: Google sends them back to
// "<that address>/api/auth/callback/google", and the cookies that make the round trip safe were set on that address too. Behind
// Railway's proxy the server only sees its own internal address (https://localhost:8080), so without a fixed AUTH_URL the
// callback address Google is given is wrong; with a fixed AUTH_URL it is right for exactly one domain. This takes the address
// from the request's own headers instead, for the addresses listed here, so every domain the site is attached to can log in
// (each must also be an authorised redirect URI in the Google console). Set AUTH_ALLOWED_HOSTS (comma separated) to add one
// without a code change. Any other host is left exactly as it was.
const SITE_HOSTS = new Set(
  [
    "avatar.agentbaba.ai",
    "avatar-studio-frontend-production.up.railway.app",
    ...(process.env.AUTH_ALLOWED_HOSTS ?? "").split(","),
  ]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

const first = (value: string | null) => (value ?? "").split(",")[0].trim();

function withVisitorOrigin(req: NextRequest): NextRequest {
  // An explicit AUTH_URL pins every request to one address, whatever this does; leave that choice to whoever set it.
  if (process.env.AUTH_URL || process.env.NEXTAUTH_URL) return req;
  const host = (first(req.headers.get("x-forwarded-host")) || first(req.headers.get("host"))).toLowerCase();
  if (!SITE_HOSTS.has(host)) return req;
  // The site's domains only serve https. Not taken from x-forwarded-proto: Next.js fills that in as "http" whenever the proxy left
  // it out, which would send Google an http return address it rejects. A local address keeps whatever the request says.
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = local ? first(req.headers.get("x-forwarded-proto")) || "http" : "https";
  const url = new URL(req.url);
  // Auth.js reads the protocol and host from these headers when it builds its own addresses: make them agree with the address.
  const headers = new Headers(req.headers);
  headers.set("host", host);
  headers.set("x-forwarded-host", host);
  headers.set("x-forwarded-proto", proto);
  return new NextRequest(`${proto}://${host}${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    duplex: "half", // Node requires it when the body is a stream
  });
}

export const GET = (req: NextRequest) => handlers.GET(withVisitorOrigin(req));
export const POST = (req: NextRequest) => handlers.POST(withVisitorOrigin(req));
