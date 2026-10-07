const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

/**
 * The avatar's still, served from OUR origin with CORS open.
 *
 * widget.js turns a frameless agent's closed button into a small cutout by keying the still on a canvas,
 * which needs the picture loaded with `crossOrigin = "anonymous"`, i.e. the image host must answer with
 * Access-Control-Allow-Origin. Anam's image host (lab.anam.ai, Vercel) does not, so the browser blocks the
 * picture and the widget falls back to the plain chat icon (2026-10-07, all frameless Anam embeds). Fetching
 * the picture here, on the server, and handing it back with the header makes the widget independent of
 * what Anam's CDN decides to send.
 *
 * Public, like /api/embed/config: it is drawn on the customer's own public page. What it fetches is only the
 * still URL the backend holds for this embed key (our database, Anam's catalogue) -- never a URL taken from
 * the request -- so it cannot be pointed at anything else.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MAX_ENTRIES = 64;
const CACHE_TTL_MS = 60 * 60 * 1000;

type Cached = { body: ArrayBuffer; type: string; at: number };
// Keyed by the upstream URL, which carries Anam's own version (`?v=`): a changed still is a new entry.
const cache = new Map<string, Cached>();

function remember(url: string, entry: Cached) {
  cache.delete(url);
  cache.set(url, entry);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function cors(headers: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    ...headers,
  };
}

function failure(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: cors({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  let upstream: string | null = null;
  try {
    const res = await fetch(`${API_URL}/embed/config/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) return failure(res.status === 404 ? 404 : 502, "Unknown widget key.");
    upstream = ((await res.json()) as { preview_image_url?: string | null }).preview_image_url ?? null;
  } catch {
    return failure(502, "Could not read the widget's configuration.");
  }
  if (!upstream || !/^https?:\/\//i.test(upstream)) return failure(404, "This widget has no avatar picture.");

  const hit = cache.get(upstream);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return new Response(hit.body, { headers: cors({ "Content-Type": hit.type, "Cache-Control": "public, max-age=3600" }) });
  }

  try {
    const res = await fetch(upstream, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.toLowerCase().startsWith("image/")) {
      // Anam briefly down, or the link expired: a stale copy beats no picture.
      if (hit) return new Response(hit.body, { headers: cors({ "Content-Type": hit.type, "Cache-Control": "public, max-age=60" }) });
      return failure(502, "The avatar picture is not available right now.");
    }
    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return failure(502, "The avatar picture is not usable.");
    remember(upstream, { body, type, at: Date.now() });
    return new Response(body, { headers: cors({ "Content-Type": type, "Cache-Control": "public, max-age=3600" }) });
  } catch {
    if (hit) return new Response(hit.body, { headers: cors({ "Content-Type": hit.type, "Cache-Control": "public, max-age=60" }) });
    return failure(502, "The avatar picture is not available right now.");
  }
}
