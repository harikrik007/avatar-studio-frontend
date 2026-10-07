import { createHash } from "node:crypto";

/** The short tag put on the proxied still's URL, so a changed picture is a new URL for the browser's cache. */
export function stillVersion(upstream: string): string {
  return createHash("sha1").update(upstream).digest("hex").slice(0, 10);
}

/**
 * This app's public origin as the visitor's browser reached it (https://studio.example), for a URL a customer's page
 * has to load from us. Railway terminates TLS in front of the app, so the forwarded headers come first; the request's
 * own URL is the fallback (local runs).
 */
export function publicOrigin(request: Request): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = (h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")).split(",")[0].trim();
    return `${proto}://${host.split(",")[0].trim()}`;
  }
  return new URL(request.url).origin;
}
