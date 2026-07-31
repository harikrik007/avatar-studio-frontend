import { NextResponse } from "next/server";

// Same shape as pizza_wav2lip_client's app/api/avatar-session/route.ts:
// this server route holds the backend bearer token, the browser never
// sees it. AVATAR_STUDIO_API_URL/AVATAR_STUDIO_API_TOKEN are server-side
// only (no NEXT_PUBLIC_ prefix).
const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

export async function GET() {
  const res = await fetch(`${API_URL}/avatars`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    cache: "no-store",
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}

export async function POST(request: Request) {
  const incoming = await request.formData();
  const file = incoming.get("file");
  const name = incoming.get("name");

  if (!(file instanceof File) || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Missing file or name." }, { status: 400 });
  }

  // Backend expects `name` as a multipart form field (FastAPI Form(...)),
  // not a query param -- it can't be a bare query param alongside a File
  // param in the same endpoint.
  const outgoing = new FormData();
  outgoing.set("name", name);
  outgoing.set("file", file, file.name);

  const res = await fetch(`${API_URL}/avatars`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    body: outgoing,
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
