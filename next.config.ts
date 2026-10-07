import type { NextConfig } from "next";

// TEST BUILDS ONLY: LANDING_FAKE_SESSION=1 swaps the LiveKit session client for a scripted one (see test-support/), so browser checks can
// drive the landing page's call card without a LiveKit server. Never set on Railway.
const fakeSession = process.env.LANDING_FAKE_SESSION === "1";

const nextConfig: NextConfig = {
  ...(fakeSession ? { turbopack: { resolveAlias: { "@/lib/avatar-session": "./test-support/avatar-session.fake.ts" } } } : {}),
  // The first dashboard (My Avatars: upload a clip, wait for a Wav2Lip render) is gone; the agent builder under /dashboardv2 is the only
  // one. Old bookmarks and emails still land somewhere useful.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/dashboardv2/agents", permanent: false },
      { source: "/dashboard/:path*", destination: "/dashboardv2/agents", permanent: false },
    ];
  },
};

export default nextConfig;
