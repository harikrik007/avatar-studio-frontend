"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import "../landing.css";
import { inter, jetbrainsMono, spaceGrotesk } from "../landing-fonts";

// Inline so the sidebar gets icons without pulling in an icon package for
// two glyphs. 16px, stroke-only, currentColor -- they inherit the link's
// muted/active colour for free.
function AvatarsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      <circle cx="8" cy="6.5" r="2" />
      <path d="M4.2 12.4a4 4 0 0 1 7.6 0" strokeLinecap="round" />
    </svg>
  );
}

function AgentsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H6.8L3.5 13.8V11.5h-1z" strokeLinejoin="round" />
      <path d="M6 6.5h4M6 8.75h2.5" strokeLinecap="round" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/dashboard/avatars", label: "My Avatars", Icon: AvatarsIcon },
  { href: "/dashboard/agents", label: "Agents", Icon: AgentsIcon },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const accountName = session?.companyName || session?.user?.email || "";

  return (
    <main className={`landing ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      {/* Full-bleed on the dashboard: the old 1120px-centred nav sat over a
          sidebar layout, so the brand and the content column were centred to
          two different boxes and nothing lined up. */}
      <nav className="l-nav l-nav-dash">
        <Link href="/" className="l-brand" style={{ textDecoration: "none", color: "inherit" }}>
          Avatar Studio
        </Link>
        <div className="l-nav-links">
          <Link href="/pricing">Pricing</Link>
        </div>
      </nav>

      <div className="l-dash-layout">
        <aside className="l-sidebar">
          <div className="l-sidebar-nav">
            {NAV_ITEMS.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname?.startsWith(href) ? "page" : undefined}
                className={`l-sidebar-link${pathname?.startsWith(href) ? " l-sidebar-active" : ""}`}
              >
                <Icon />
                {label}
              </Link>
            ))}
          </div>

          {session ? (
            <div className="l-sidebar-account">
              <div className="l-account">
                {session.user?.image ? (
                  <img className="l-account-avatar" src={session.user.image} alt="" />
                ) : (
                  <span className="l-account-avatar l-account-initial" aria-hidden="true">
                    {accountName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="l-account-name" title={accountName}>
                  {accountName}
                </span>
              </div>
              <button type="button" className="l-sidebar-signout" onClick={() => signOut({ callbackUrl: "/" })}>
                Sign out
              </button>
            </div>
          ) : null}
        </aside>
        <div className="l-dash-main">{children}</div>
      </div>
    </main>
  );
}
