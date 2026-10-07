/**
 * The landing page's personas: the demo agents an administrator builds and publishes in the admin dashboard. The page asks the backend
 * for the published ones whose agent is live (first three, in the admin's order); this app's server holds the shared token, so the
 * browser never talks to the backend for it. Only the embed key and the card come back -- the call itself starts the way any embed's does
 * (/api/embed/session with the key), so the embed key's allowed origins must include this site.
 */

export type LandingPersona = {
  /** the embed public key a call is started with */
  key: string;
  name: string;
  /** the line under the name, e.g. "Sales Representative" */
  role: string;
  /** one sentence on what to ask it; may be empty */
  blurb: string;
  /** the face is a green-screen picture: the page keys the green out so she floats over the card */
  greenScreen: boolean;
};

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

/** The published personas, or none when the backend cannot be reached (the page then shows its resting card). Cached for a minute. */
export async function fetchLandingPersonas(): Promise<LandingPersona[]> {
  try {
    const res = await fetch(`${API_URL}/public/personas`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const list: unknown = await res.json();
    if (!Array.isArray(list)) return [];
    const out: LandingPersona[] = [];
    for (const p of list) {
      if (p && typeof p.public_key === "string" && typeof p.name === "string" && p.name.trim()) {
        out.push({
          key: p.public_key,
          name: p.name.trim(),
          role: typeof p.role === "string" ? p.role.trim() : "",
          blurb: typeof p.blurb === "string" ? p.blurb.trim() : "",
          greenScreen: p.green_screen === true,
        });
      }
    }
    return out.slice(0, 3);
  } catch {
    return [];
  }
}
