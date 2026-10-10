import { proxyUsage } from "@/lib/usage-proxy";

// One call's conversation, for the Usage page's Transcript dialog (the signed-in client's own calls only, see proxyUsage).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyUsage(request, `/usage/calls/${encodeURIComponent(id)}/transcript`);
}
