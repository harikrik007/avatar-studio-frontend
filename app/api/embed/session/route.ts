import { NextResponse } from "next/server";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

// Public on purpose -- no auth() check, unlike every other route in
// app/api/*. This is the one thing the embedded widget calls, and the
// widget runs on an unknown third-party site with no Google session to
// check. See api/embed.py's module docstring for the actual security
// model (frame-ancestors CSP + capacity/rate limits, not identity).
//
// Still a proxy, same shape as every other route here: AVATAR_STUDIO_API_TOKEN
// stays server-side, the browser never sees it. What differs is that the
// *caller* of this route is untrusted too, not just the token holder.

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const publicKey = typeof body.public_key === "string" ? body.public_key : "";
  const origin = typeof body.origin === "string" ? body.origin : undefined;
  if (!publicKey) {
    return NextResponse.json({ error: "Missing public_key." }, { status: 400 });
  }

  const res = await fetch(`${API_URL}/embed/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: publicKey, origin }),
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: payload?.detail ?? "Unable to start a session." },
      { status: res.status }
    );
  }
  return NextResponse.json(payload);
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const publicKey = typeof body.public_key === "string" ? body.public_key : "";
  const room = typeof body.room === "string" ? body.room : "";
  const reason = typeof body.reason === "string" ? body.reason : "visitor_closed";
  if (!publicKey || !room) {
    return NextResponse.json({ error: "Missing public_key or room." }, { status: 400 });
  }

  const res = await fetch(`${API_URL}/embed/session/${encodeURIComponent(room)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: publicKey, reason }),
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({ ok: res.ok }));
  return NextResponse.json(payload, { status: res.ok ? 200 : res.status });
}
