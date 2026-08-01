import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.clientId) {
    return new NextResponse("Not signed in.", { status: 401 });
  }

  const { id } = await params;

  const metaRes = await fetch(`${API_URL}/avatars/${id}`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "X-Avatar-Studio-Client-Id": session.clientId,
    },
    cache: "no-store",
  });
  const meta = await metaRes.json();
  if (!meta.preview_video_url) {
    return new NextResponse("No preview available.", { status: 404 });
  }

  // meta.preview_video_url here is the backend's raw value (this fetch hits
  // FastAPI directly, not the Next.js route above, so it hasn't been
  // rewritten). Local disk returns a relative /static/... path that needs
  // API_URL prefixed; R2 returns an already-absolute presigned https:// URL
  // -- prefixing that would produce a malformed double-absolute URL and
  // this fetch would throw.
  const videoUrl = /^https?:\/\//.test(meta.preview_video_url)
    ? meta.preview_video_url
    : `${API_URL}${meta.preview_video_url}`;
  const videoRes = await fetch(videoUrl, { cache: "no-store" });
  if (!videoRes.ok || !videoRes.body) {
    return new NextResponse("Preview not found.", { status: 404 });
  }

  return new NextResponse(videoRes.body, {
    headers: {
      "Content-Type": "video/webm",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
