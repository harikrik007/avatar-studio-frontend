import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectorsEnabled } from "@/lib/connectors-proxy";

// Features shown to chosen accounts only. Decided here, on the server, so the list of e-mails never reaches the browser.
// Voice isolation (the agent's Advanced tab): Hari, 2026-10-09 -- "show the voice isolation switch only for user
// iamharihk@gmail.com". VOICE_ISOLATION_EMAILS (comma separated) replaces the list without a code change.
const VOICE_ISOLATION_EMAILS = (process.env.VOICE_ISOLATION_EMAILS ?? "iamharihk@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
// Connectors (apps the owner connects for their agents; the builder's Tools tab): who gets them is the backend's list
// (CONNECTOR_EMAILS there), asked here so there is one list and not two.

export async function GET() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase() ?? "";
  return NextResponse.json(
    {
      voiceIsolation: Boolean(email) && VOICE_ISOLATION_EMAILS.includes(email),
      connectors: await connectorsEnabled(session?.clientId),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
