import Link from "next/link";
import "../landing.css";
import { inter, jetbrainsMono, spaceGrotesk } from "../landing-fonts";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    priceNote: "= 10 credits / mo",
    body: [
      "Create your own avatar from a 6-second video",
      "Automated quality check on every upload",
      "Max 2 minutes / session",
      "Max 1 concurrent session",
      "Preview watermark included",
    ],
    cta: { label: "Get started", href: "/dashboard" },
  },
  {
    name: "Starter",
    price: "$19",
    priceNote: "= 150 credits / mo",
    body: [
      "Everything in Free, plus:",
      "Pay-as-you-go overage",
      "Max 5 minutes / session",
      "Max 5 concurrent sessions",
    ],
    cta: { label: "Get started", href: "/dashboard" },
  },
  {
    name: "Essential",
    price: "$99",
    priceNote: "= 1k credits / mo",
    body: [
      "Everything in Starter, plus:",
      "Pay-as-you-go overage",
      "Max 20 minutes / session",
      "Max 20 concurrent sessions",
      "Watermark removed",
    ],
    cta: { label: "Get started", href: "/dashboard" },
  },
  {
    name: "Business",
    price: "$475",
    priceNote: "= 5k credits / mo",
    body: [
      "Everything in Essential, plus:",
      "Pay-as-you-go overage",
      "Dedicated GPU option (1 included)",
      "Max 60 minutes / session",
      "40 concurrent sessions included",
    ],
    cta: { label: "Get started", href: "/dashboard" },
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    priceNote: "",
    body: [
      "Everything in Business, plus:",
      "Large-scale credit volume",
      "Customizable session length",
      "Starting from 100 concurrent sessions",
      "Dedicated priority support",
    ],
    cta: { label: "Contact sales", href: "mailto:hello@avatar-studio.example" },
  },
];

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
        <div className="l-pricing-grid l-cols-5">
          {TIERS.map((tier) => (
            <div className={`l-price-card${tier.featured ? " l-featured" : ""}`} key={tier.name}>
              <h3>{tier.name}</h3>
              <div className="l-price">{tier.price}</div>
              {tier.priceNote ? <div className="l-price-note">{tier.priceNote}</div> : <div className="l-price-note">&nbsp;</div>}
              <ul>
                {tier.body.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {tier.cta.href.startsWith("mailto:") ? (
                <a href={tier.cta.href} className="l-btn l-btn-ghost" style={{ width: "100%" }}>
                  {tier.cta.label}
                </a>
              ) : (
                <Link
                  href={tier.cta.href}
                  className={`l-btn ${tier.featured ? "l-btn-primary" : "l-btn-ghost"}`}
                  style={{ width: "100%" }}
                >
                  {tier.cta.label}
                </Link>
              )}
            </div>
          ))}
        </div>
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
