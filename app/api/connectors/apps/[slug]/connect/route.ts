import { connectorsBackend, siteOrigin } from "@/lib/connectors-proxy";

// A link for the owner to connect their account of one app. Where they land afterwards is decided here, not by the browser:
// this site's own return page (the backend refuses any other address).
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const callback = `${siteOrigin(request)}/dashboardv2/connectors/return?app=${encodeURIComponent(slug)}`;
  return connectorsBackend(`/connectors/apps/${encodeURIComponent(slug)}/connect`, { method: "POST", body: { callback_url: callback } });
}
