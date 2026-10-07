"use client";

/**
 * "Talk to Maya" anywhere on the page: asks the call card to start (or, if a call is running, to come into view).
 * The card listens for `landing:talk`; see HeroCall.
 */

import type { ReactNode } from "react";

export function talk(key?: string) {
  window.dispatchEvent(new CustomEvent("landing:talk", { detail: { key } }));
}

export default function TalkButton({ personaKey, className = "l-btn l-btn-primary", children }: { personaKey?: string; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => talk(personaKey)}>
      {children}
    </button>
  );
}
