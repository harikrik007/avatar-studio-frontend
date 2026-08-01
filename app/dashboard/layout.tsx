"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import "../landing.css";
import { inter, jetbrainsMono, spaceGrotesk } from "../landing-fonts";

const NAV_ITEMS = [
  { href: "/dashboard/avatars", label: "My Avatars" },
  { href: "/dashboard/agents", label: "Agents" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();

  return (
    <main className={`landing ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <nav className="l-nav">
        <Link href="/" className="l-brand" style={{ textDecoration: "none", color: "inherit" }}>
          Avatar Studio
        </Link>
        <div className="l-nav-links">
          <Link href="/pricing">Pricing</Link>
          {session ? (
            <div className="l-account">
              {session.user?.image ? (
                <img className="l-account-avatar" src={session.user.image} alt="" />
              ) : null}
              <span className="l-account-name">{session.companyName || session.user?.email}</span>
              <button type="button" className="l-btn-expand" onClick={() => signOut({ callbackUrl: "/" })}>
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </nav>

      <div className="l-dash-layout">
        <aside className="l-sidebar">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`l-sidebar-link${pathname?.startsWith(item.href) ? " l-sidebar-active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </aside>
        <div className="l-dash-main">{children}</div>
      </div>
    </main>
  );
}
