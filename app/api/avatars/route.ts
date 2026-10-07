import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Same shape as pizza_wav2lip_client's app/api/avatar-session/route.ts:
// this server route holds the backend bearer token, the browser never
// sees it. AVATAR_STUDIO_API_URL/AVATAR_STUDIO_API_TOKEN are server-side
// only (no NEXT_PUBLIC_ prefix).
const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

export async function GET() {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // The list is the database's: an administrator's Sync in the admin dashboard is what reads Anam, never this request.
  const res = await fetch(`${API_URL}/avatars`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
    },
    cache: "no-store",
  });
  const body = await res.json();

  // Same rewrite as the single-avatar route: local disk returns a relative
  // /static path that needs proxying; R2 returns an already-public,
  // presigned https:// URL the browser can fetch directly.
  if (Array.isArray(body)) {
    for (const avatar of body) {
      if (avatar.preview_video_url && !/^https?:\/\//.test(avatar.preview_video_url)) {
        avatar.preview_video_url = `/api/avatars/${avatar.id}/preview`;
      }
    }
  }

  return NextResponse.json(body, { status: res.status });
}
