import { createHash } from "node:crypto";

/** The short tag put on the proxied still's URL, so a changed picture is a new URL for the browser's cache. */
export function stillVersion(upstream: string): string {
  return createHash("sha1").update(upstream).digest("hex").slice(0, 10);
}

type StillConfig = { transparent?: boolean; orientation?: string; preview_image_url?: string | null; portrait_image_url?: string | null };

/**
 * Which still a widget shows before its call (2026-10-08). A frameless widget in portrait shows the provider's portrait still,
 * which lines up 1:1 with the portrait render, so the closed bubble, the opened widget and the call are one figure (the
 * landscape still made a portrait widget look like a landscape one). Everything else shows the usual (landscape) still.
 * `shape` goes on the proxied URL (/api/embed/still/<key>?shape=portrait) so the proxy fetches the same picture.
 */
export function framePicture(config: StillConfig): { upstream: string | null; shape?: "portrait" } {
  if (config.transparent && config.orientation === "portrait" && config.portrait_image_url) {
    return { upstream: config.portrait_image_url, shape: "portrait" };
  }
  return { upstream: config.preview_image_url ?? null };
}

/** The proxied still's path for a widget (relative; prefix an origin for a customer's page). */
export function proxiedStillPath(key: string, config: StillConfig): string | null {
  const { upstream, shape } = framePicture(config);
  if (!upstream) return null;
  return `/api/embed/still/${encodeURIComponent(key)}?v=${stillVersion(upstream)}${shape ? `&shape=${shape}` : ""}`;
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
