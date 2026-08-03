import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

// Starts (POST) / stops (DELETE) a live "test drive" session for an agent --
// proxies to avatar-studio's backend, which in turn calls the realtime-avatar
// box's orchestrator. Neither of those tokens ever reaches the browser.

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;
  const res = await fetch(`${API_URL}/agents/${id}/test-session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
    },
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Polled by the dashboard while it's showing the "warming up" state, so
  // it can distinguish "the RunPod worker just hasn't booted yet" from
  // "the job actually failed" instead of guessing from elapsed time.
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;
  const room = new URL(request.url).searchParams.get("room");
  if (!room) {
    return NextResponse.json({ error: "Missing room." }, { status: 400 });
  }
  const res = await fetch(`${API_URL}/agents/${id}/test-session/${room}`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
    },
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;
  const room = new URL(request.url).searchParams.get("room");
  if (!room) {
    return NextResponse.json({ error: "Missing room." }, { status: 400 });
  }
  const res = await fetch(`${API_URL}/agents/${id}/test-session/${room}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
    },
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
