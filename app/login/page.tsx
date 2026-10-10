"use client";

/**
 * Sign in. Two halves (2026-10-10, after a reference Hari sent for the style): on the left the brand, "Welcome back" and the
 * one way in (Google: the only sign-in this product has, and a first sign-in is also how an account is made); on the right a
 * panel with the landing page's own headline and its face. On a phone the panel goes and the form has the screen.
 * What signing in does is unchanged: Google, then back to where the visitor was going (?next=).
 */

import { Suspense } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import "../landing.css";
import "./login.css";
import { inter, jetbrainsMono, spaceGrotesk } from "../landing-fonts";
import { FACTS, HEADLINE, SUBHEAD } from "@/lib/landing-content";

function LoginCard() {
  const params = useSearchParams();
  const next = params.get("next") || "/dashboardv2";

  return (
    <main className={`landing ll ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <section className="ll-side" aria-labelledby="ll-title">
        <Link href="/" className="ll-brand">Avatar Studio</Link>
        <div className="ll-form">
          <h1 id="ll-title">Welcome back</h1>
          <button type="button" className="ll-provider" onClick={() => signIn("google", { callbackUrl: next })}>
            <GoogleMark />
            Sign in with Google
          </button>
          <p className="ll-note">Don&apos;t have an account? Signing in with Google creates one.</p>
        </div>
      </section>

      {/* The landing page's own words and face: nothing here is new copy or a number of its own. */}
      <aside className="ll-panel" aria-label="About Avatar Studio">
        <div className="ll-pitch">
          <span className="ll-figure" aria-hidden="true">{FACTS[0].value}</span>
          <div className="ll-pitch-text">
            <p className="ll-pitch-title">{HEADLINE}</p>
            <p className="ll-pitch-sub">{SUBHEAD}</p>
          </div>
        </div>
        <img className="ll-face" src="/login-avatar.webp" alt="" width={774} height={720} />
      </aside>
    </main>
  );
}

/** Google's "G", in its own colours, as its sign-in branding asks. */
function GoogleMark() {
  return (
    <svg className="ll-mark" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
