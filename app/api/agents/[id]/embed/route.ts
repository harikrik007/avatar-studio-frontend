import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

// Edits the domain allowlist and bubble theming for an already-live agent's
// embed widget. Separate from PATCH /api/agents/[id] (which flips
// draft/live and owns whether the key exists at all) for the same reason
// the backend keeps them separate -- see api/main.py's update_agent_embed.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const res = await fetch(`${API_URL}/agents/${id}/embed`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: payload?.detail ?? "Unable to update the widget." }, { status: res.status });
  }
  return NextResponse.json(payload);
}
