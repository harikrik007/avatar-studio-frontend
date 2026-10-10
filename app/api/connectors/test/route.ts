import { NextResponse } from "next/server";
import { connectorsBackend } from "@/lib/connectors-proxy";

// Run one connector tool once, from the builder. It is a real run on the connected account.
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  return connectorsBackend("/connectors/test", { method: "POST", body: payload });
}
