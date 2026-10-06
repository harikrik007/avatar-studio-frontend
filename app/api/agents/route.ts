import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // `?summary=true` is passed through: the backend then leaves out each system prompt, which the
  // list screens never show and which is most of the response.
  const summary = new URL(request.url).searchParams.get("summary") === "true" ? "?summary=true" : "";
  const res = await fetch(`${API_URL}/agents${summary}`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
    },
    cache: "no-store",
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const res = await fetch(`${API_URL}/agents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
