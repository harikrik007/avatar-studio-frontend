import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Only runs on an actual sign-in (account/profile present), not on
    // every request that reads the session -- this is where the Client
    // row gets created/updated, once per login, not once per page load.
    async jwt({ token, account, profile, trigger, session }) {
      // Client-side useSession().update() after onboarding -- rewrites the
      // token's companyName without a full re-login, so middleware sees it
      // on the very next navigation.
      if (trigger === "update" && session?.companyName !== undefined) {
        token.companyName = session.companyName;
        return token;
      }
      if (account && profile) {
        try {
          const res = await fetch(`${API_URL}/internal/clients/sync`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              google_sub: profile.sub,
              email: profile.email,
              picture_url: typeof profile.picture === "string" ? profile.picture : undefined,
            }),
          });
          if (res.ok) {
            const client = await res.json();
            token.clientId = client.id;
            token.companyName = client.company_name ?? null;
          }
        } catch {
          // Backend unreachable at login time -- token just won't carry a
          // clientId, so downstream API calls 401 instead of silently
          // acting as some other client.
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.clientId = (token.clientId as string) ?? "";
      session.companyName = (token.companyName as string | null) ?? null;
      return session;
    },
  },
});
