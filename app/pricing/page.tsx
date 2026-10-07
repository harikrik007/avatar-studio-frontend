import type { Metadata } from "next";
import Link from "next/link";
import "../landing.css";
import "../landing-home.css";
import { inter, jetbrainsMono, spaceGrotesk } from "../landing-fonts";
import SiteFooter from "@/components/landing/SiteFooter";
import SiteHeader from "@/components/landing/SiteHeader";
import { FAQS, PRICING_NOTE, PRICING_POINTS } from "@/lib/landing-content";

export const metadata: Metadata = {
  title: "Pricing: Avatar Studio",
  description: "Build your virtual human for free and pay for the minutes it talks. A usage page shows every call.",
};

const BILLING_QUESTIONS = ["How is it billed?", "Can I try it before I build one?", "Is it safe to put on my site?"];

export default function PricingPage() {
  const faqs = FAQS.filter((f) => BILLING_QUESTIONS.includes(f.q));
  return (
    <div className={`landing ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <SiteHeader />
      <main id="lh-main">
        <section className="lh-page-head">
          <span className="l-kicker">Pricing</span>
          <h1>Pay for the minutes your agent talks.</h1>
          <p>Building is free. Each call is timed from the moment it connects until it ends, and your usage page shows the exact length of every call.</p>
        </section>

        <section className="lh-wrap" aria-label="How billing works">
          <div className="lh-price">
            {PRICING_POINTS.map((p) => (
              <div className="lh-price-card" key={p.title}>
                <h2 style={{ fontSize: 20, margin: "0 0 10px" }}>{p.title}</h2>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
          <p className="lh-price-note">{PRICING_NOTE}</p>
          <div className="lh-price-cta">
            <Link href="/dashboardv2" className="l-btn l-btn-primary">
              Build yours free
            </Link>
          </div>
        </section>

        <section className="lh-section lh-wrap" aria-labelledby="pricing-faq">
          <div className="lh-head">
            <h2 id="pricing-faq">Questions about billing</h2>
          </div>
          <div className="lh-faq l-faq-list">
            {faqs.map((item) => (
              <details className="l-faq-item" key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
