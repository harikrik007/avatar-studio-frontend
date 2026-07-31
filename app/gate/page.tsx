"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function GateForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Incorrect password.");
      return;
    }
    router.replace(params.get("next") || "/");
    router.refresh();
  }

  return (
    <div className="gate-shell">
      <form className="gate-card" onSubmit={submit}>
        <h1>Avatar Studio</h1>
        <div className="field">
          <label htmlFor="password">Access password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <button className="button button-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Checking..." : "Enter"}
        </button>
        {error ? <p className="error-text">{error}</p> : null}
      </form>
    </div>
  );
}

export default function GatePage() {
  return (
    <Suspense>
      <GateForm />
    </Suspense>
  );
}
