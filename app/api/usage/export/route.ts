import { proxyUsage } from "@/lib/usage-proxy";

export async function GET(request: Request) {
  return proxyUsage(request, "/usage/export.csv", { text: true });
}
