import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";

// Scoped to the landing page only -- the rest of the app (dashboard,
// pricing, gate) keeps the plain system-font look on purpose.
export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
  display: "swap",
});

export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-body",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-mono",
  display: "swap",
});
