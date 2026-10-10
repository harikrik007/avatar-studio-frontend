import { connectorsBackend } from "@/lib/connectors-proxy";

// The apps an owner can connect for their agents, each with whether it is connected.
export async function GET() {
  return connectorsBackend("/connectors/apps");
}
