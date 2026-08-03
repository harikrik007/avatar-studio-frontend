import { NextResponse } from "next/server";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

// Public, no auth() -- same reasoning as ../session/route.ts. Polled by the
// widget before the visitor clicks Start, so "All agents busy" can show up
// front instead of after a failed connect attempt.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const res = await fetch(`${API_URL}/embed/capacity/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({}));
  return NextResponse.json(payload, { status: res.status });
}
