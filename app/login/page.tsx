"use client";

import { Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import "../landing.css";
import { inter, jetbrainsMono, spaceGrotesk } from "../landing-fonts";

function LoginCard() {
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  return (
    <main className={`landing ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <div className="l-login-shell">
        <div className="l-login-card">
          <span className="l-kicker">Sign in</span>
          <h1>Avatar Studio</h1>
          <p>Sign in with Google to see your avatars.</p>
          <button
            type="button"
            className="l-btn l-btn-primary"
            style={{ width: "100%" }}
            onClick={() => signIn("google", { callbackUrl: next })}
          >
            Sign in with Google
          </button>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
