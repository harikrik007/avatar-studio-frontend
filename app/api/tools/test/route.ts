import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

// Dry-run a single tool. The tool config travels in the request body rather
// than being read from the database, so an edit can be tried before it is
// saved -- the usual reason to test is that what you just typed is wrong.
// Not scoped to an agent, so a tool can also be tested while building one.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const res = await fetch(`${API_URL}/tools/test`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
