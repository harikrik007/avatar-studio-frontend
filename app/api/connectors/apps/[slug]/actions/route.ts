import { connectorsBackend } from "@/lib/connectors-proxy";

// One app's actions an owner can give an agent, with each action's parameters.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return connectorsBackend(`/connectors/apps/${encodeURIComponent(slug)}/actions`);
}
