"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import "../landing.css";
import { inter, jetbrainsMono, spaceGrotesk } from "../landing-fonts";

export default function OnboardingPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || !session?.clientId) return;

    setBusy(true);
    setError(null);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_name: companyName.trim() }),
    });
    setBusy(false);

    if (!res.ok) {
      setError("Couldn't save that. Try again.");
      return;
    }

    await update({ companyName: companyName.trim() });
    router.replace("/dashboard");
  }

  if (status === "loading") return null;

  return (
    <main className={`landing ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <div className="l-login-shell">
        <form className="l-login-card" onSubmit={submit}>
          <span className="l-kicker">One more thing</span>
          <h1>What's your company called?</h1>
          <p>This is how you'll show up on your avatars and billing.</p>
          <div className="l-field">
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Inc"
              autoFocus
            />
          </div>
          <button className="l-btn l-btn-primary" type="submit" disabled={busy || !companyName.trim()} style={{ width: "100%" }}>
            {busy ? "Saving..." : "Continue"}
          </button>
          {error ? <p className="l-error-text">{error}</p> : null}
        </form>
      </div>
    </main>
  );
}
