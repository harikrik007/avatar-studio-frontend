import { headers } from "next/headers";
import { EmbedWidget } from "@/components/embed-widget";

const API_URL = process.env.AVATAR_STUDIO_API_URL || "http://127.0.0.1:8095";
const API_TOKEN = process.env.AVATAR_STUDIO_API_TOKEN || "";

export const dynamic = "force-dynamic";

type EmbedConfig = {
  accent_color: string;
  greeting_label: string;
  allowed_origins: string[];
};

/**
 * The iframe document itself -- middleware.ts has already set this
 * response's frame-ancestors CSP from the same key before this ever runs,
 * so by the time this renders, the browser has already agreed the current
 * parent page is allowed to frame it. This component's job is just to
 * paint the widget, not to re-decide that.
 */
export default async function EmbedPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  // The Referer on THIS request -- the browser's own top-level navigation
  // into the iframe -- carries the real parent page's URL (subject to the
  // parent's Referrer-Policy). This is captured once, here, and threaded
  // down: a same-origin fetch made later by the client component's own JS
  // would carry this page's URL as its Referer instead, which is useless
  // for identifying which site embedded the widget. See lib/avatar-session.ts
  // and api/embed.py for where this value goes next.
  const referer = (await headers()).get("referer");
  let origin: string | undefined;
  if (referer) {
    try {
      origin = new URL(referer).origin;
    } catch {
      origin = undefined;
    }
  }

  let config: EmbedConfig | null = null;
  try {
    const res = await fetch(`${API_URL}/embed/config/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      cache: "no-store",
    });
    if (res.ok) {
      config = (await res.json()) as EmbedConfig;
    }
  } catch {
    config = null;
  }

  if (!config) {
    return (
      <div style={unavailableStyle}>
        <span>This chat widget is not available right now.</span>
      </div>
    );
  }

  return (
    <EmbedWidget
      publicKey={key}
      accentColor={config.accent_color}
      greetingLabel={config.greeting_label}
      origin={origin}
    />
  );
}

const unavailableStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  width: "100vw",
  margin: 0,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 14,
  color: "#6b7280",
  background: "#f9fafb",
  textAlign: "center",
  padding: 16,
};
