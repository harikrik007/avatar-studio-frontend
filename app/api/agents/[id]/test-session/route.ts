import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

// Starts (POST) / stops (DELETE) a live "test drive" session for an agent --
// proxies to avatar-studio's backend, which in turn calls the realtime-avatar
// box's orchestrator. Neither of those tokens ever reaches the browser.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;
  // ?pipeline=cascade: the test-only cascaded voice pipeline (VAD -> speech-
  // to-text -> LLM -> TTS) instead of Gemini Live; stopped/polled through the
  // same GET/DELETE below.
  const search = new URL(request.url).searchParams;
  const cascade = search.get("pipeline") === "cascade";
  // ?frame=wide: the landscape render, for a preview box that is landscape. Only this one value is passed on.
  const frame = search.get("frame") === "wide" ? "?frame=wide" : "";
  const res = await fetch(`${API_URL}/agents/${id}/${cascade ? "cascade-test-session" : "test-session"}${frame}`, {
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
