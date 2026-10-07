import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import "./globals.css";

// Absolute addresses for the share image and the page's own links. Without this Next falls back to localhost, and a link preview of the
// live site would point at a picture nobody can fetch. Set NEXT_PUBLIC_SITE_URL when the site gets its own domain.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://avatar-studio-frontend-production.up.railway.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Avatar Studio",
  description: "Put a talking virtual human on your website: pick a face and a voice, teach it your business, add one line of code.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
