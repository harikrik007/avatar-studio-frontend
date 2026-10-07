"use client";

/**
 * The landing and pricing header: sticky, with a real menu on a phone (the old three-link row wrapped onto three lines at 390px).
 * Signed-in visitors see "Open dashboard" instead of Sign in / Build yours free; the page itself is static, so that swap happens in
 * the browser once the session answers.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { NAV_LINKS } from "@/lib/landing-content";

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { status } = useSession();
  const signedIn = status === "authenticated";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="lh-header">
      <a className="lh-skip" href="#lh-main">
        Skip to content
      </a>
      <div className="lh-header-in">
        <Link href="/" className="lh-brand" onClick={() => setOpen(false)}>
          Avatar Studio
        </Link>
        <nav id="lh-menu" className={`lh-nav${open ? " lh-nav-open" : ""}`} aria-label="Main">
          <div className="lh-nav-links">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
          </div>
          <div className="lh-nav-actions">
            {signedIn ? (
              <Link href="/dashboardv2" className="l-btn l-btn-primary" onClick={() => setOpen(false)}>
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/login?next=/dashboardv2" className="lh-signin" onClick={() => setOpen(false)}>
                  Sign in
                </Link>
                <Link href="/dashboardv2" className="l-btn l-btn-primary" onClick={() => setOpen(false)}>
                  Build yours free
                </Link>
              </>
            )}
          </div>
        </nav>
        <button
          type="button"
          className="lh-menu-btn"
          aria-expanded={open}
          aria-controls="lh-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
          </svg>
        </button>
      </div>
    </header>
  );
}
