import Link from "next/link";
import "../landing.css";
import { inter, jetbrainsMono, spaceGrotesk } from "../landing-fonts";
import PricingGrid from "../PricingGrid";

export default function PricingPage() {
  return (
    <main className={`landing ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <nav className="l-nav">
        <Link href="/" className="l-brand" style={{ textDecoration: "none", color: "inherit" }}>
          Avatar Studio
        </Link>
        <div className="l-nav-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard" className="l-btn l-btn-primary">
            Get started
          </Link>
        </div>
      </nav>

      <section className="l-hero" style={{ paddingBottom: 24 }}>
        <span className="l-kicker">Pricing</span>
        <h1 style={{ fontSize: 44 }}>Find a plan for your team</h1>
        <p>Every plan includes the full pipeline -- face detection, idle-motion generation, and an automated quality check on every upload.</p>
      </section>

      <section className="l-section" style={{ borderTop: "none", paddingTop: 0 }}>
        <PricingGrid />
      </section>

      <section className="l-section">
        <p className="l-trust">
          Credits are consumed by session minutes, not by creating avatars --
          building an avatar never costs credits, on any plan.
        </p>
      </section>

      <footer className="l-footer">
        <span>Avatar Studio</span>
        <Link href="/">Home</Link>
      </footer>
    </main>
  );
}
