import { NextResponse } from "next/server";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

/**
 * Public, and CORS-open, because widget.js calls it from the customer's own
 * page -- not from inside our iframe like /api/embed/capacity does. That is
 * the whole reason this route exists separately from the server-side fetch
 * in app/embed/[key]/page.tsx: the closed bubble is painted on the host
 * page, before any iframe exists, so the host page itself needs the
 * avatar's face and the accent colour.
 *
 * Only what the bubble draws is returned. allowed_origins is deliberately
 * dropped -- the iframe's frame-ancestors CSP and the session broker are
 * what enforce it, and there is no reason to hand every page on the
 * internet a customer's site list.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const res = await fetch(`${API_URL}/embed/config/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Unknown widget key." }, { status: res.status });
  }
  const config = await res.json();
  return NextResponse.json(
    {
      accent_color: config.accent_color,
      greeting_label: config.greeting_label,
      preview_image_url: config.preview_image_url ?? null,
      // widget.js needs this before it creates the panel: a frameless
      // widget is a different shape with no background at all.
      transparent: config.transparent ?? false,
    },
    {
      headers: {
        // Public data -- it is drawn on the customer's own public page --
        // so a wildcard is honest here. No credentials are involved: the
        // API token stays on this server.
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    }
  );
}
