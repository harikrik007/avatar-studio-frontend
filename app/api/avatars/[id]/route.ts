import { NextResponse } from "next/server";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/avatars/${id}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    cache: "no-store",
  });
  const body = await res.json();

  // The backend's preview_video_url points at its own /static path, only
  // reachable from this box -- rewrite it to a same-origin proxy the
  // browser can actually fetch.
  if (body.preview_video_url) {
    body.preview_video_url = `/api/avatars/${id}/preview`;
  }

  return NextResponse.json(body, { status: res.status });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/avatars/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (res.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
