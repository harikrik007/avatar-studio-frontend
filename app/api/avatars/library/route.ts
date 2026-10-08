import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// One page of the avatar library (the built-in faces), for the builder's Avatar tab. Same token handling as ../route.ts: the
// backend bearer token stays on this server.
const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";
const PASSED = ["page", "per_page", "q", "style", "around"];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const params = new URLSearchParams();
  for (const name of PASSED) {
    const value = req.nextUrl.searchParams.get(name);
    if (value) params.set(name, value.slice(0, 200));
  }
  const res = await fetch(`${API_URL}/avatars/library?${params}`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({ error: "The avatar library could not be read." }));
  return NextResponse.json(body, { status: res.status });
}
