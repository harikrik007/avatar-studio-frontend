import { connectorsBackend } from "@/lib/connectors-proxy";

// Disconnect the owner's account of one app.
export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return connectorsBackend(`/connectors/apps/${encodeURIComponent(slug)}/connection`, { method: "DELETE" });
}
