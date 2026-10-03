import { proxyUsage } from "@/lib/usage-proxy";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyUsage(request, `/usage/calls/${encodeURIComponent(id)}`);
}
