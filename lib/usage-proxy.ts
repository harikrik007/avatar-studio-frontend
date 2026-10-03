import { NextResponse } from "next/server";
import { auth } from "@/auth";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

/**
 * The usage API is per signed-in client: the browser never talks to the backend, the Next server does,
 * with the shared token and the client id from the session (same shape as the other /api routes).
 * The query string (filters, paging, scope) is passed through untouched; the backend decides what
 * this client may see.
 */
export async function proxyUsage(request: Request, backendPath: string, opts: { text?: boolean } = {}) {
  const session = await auth();
  if (!session?.clientId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const search = new URL(request.url).search;
  const res = await fetch(`${API_URL}${backendPath}${search}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}`, "X-Avatar-Studio-Client-Id": session.clientId },
    cache: "no-store",
  });
  if (opts.text) {
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "text/csv; charset=utf-8",
        "Content-Disposition": res.headers.get("content-disposition") ?? 'attachment; filename="usage.csv"',
      },
    });
  }
  const body = await res.json().catch(() => ({ error: "Unexpected response." }));
  return NextResponse.json(body, { status: res.status });
}
