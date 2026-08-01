import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const res = await fetch(`${API_URL}/avatars/${id}`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
    },
    cache: "no-store",
  });
  const body = await res.json();

  // Local disk backend returns a relative /static path, only reachable
  // from this box -- rewrite it to a same-origin proxy the browser can
  // actually fetch. R2 returns an already-public, presigned https:// URL
  // the browser can fetch directly, so leave it alone -- prefixing it with
  // API_URL would produce a malformed double-absolute URL.
  if (body.preview_video_url && !/^https?:\/\//.test(body.preview_video_url)) {
    body.preview_video_url = `/api/avatars/${id}/preview`;
  }

  return NextResponse.json(body, { status: res.status });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const res = await fetch(`${API_URL}/avatars/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
    },
  });
  if (res.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
