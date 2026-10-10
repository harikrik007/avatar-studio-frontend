import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

// The signed-in account's plan and minutes (the backend's GET /billing), for the Plan page and the minutes banner. Minutes
// and sessions only; while minutes are not switched on the backend answers {shown: false} and the app shows neither.
export async function GET() {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const res = await fetch(`${API_URL}/billing`, {
    headers: { Authorization: `Bearer ${API_TOKEN}`, "X-Avatar-Studio-Client-Id": session.clientId },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({ shown: false }));
  return NextResponse.json(body, { status: res.status, headers: { "Cache-Control": "no-store" } });
}
