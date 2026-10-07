import type { Metadata } from "next";
import Link from "next/link";
import { preload } from "react-dom";
import "./landing.css";
import "./landing-home.css";
import { inter, jetbrainsMono, spaceGrotesk } from "./landing-fonts";
import EmbedSection from "@/components/landing/EmbedSection";
import HeroCall from "@/components/landing/HeroCall";
import SiteFooter from "@/components/landing/SiteFooter";
import SiteHeader from "@/components/landing/SiteHeader";
import TalkButton from "@/components/landing/TalkButton";
import UseCases from "@/components/landing/UseCases";
import step1 from "@/components/landing/img/step-1.webp";
import step2 from "@/components/landing/img/step-2.webp";
import step3 from "@/components/landing/img/step-3.webp";
import { CAPABILITIES, CONTROL, FACTS, FAQS, HEADLINE, HERO_CHECKS, PRICING_NOTE, PRICING_POINTS, STEPS, SUBHEAD } from "@/lib/landing-content";
import { fetchLandingPersonas } from "@/lib/personas";

// The demo agents are the personas published in the admin dashboard. The list is read from the backend and cached for a minute (see
// lib/personas.ts), so a newly published persona shows up within about a minute without a deploy.
// The page is rendered per request, not as a timed static page: a page that revalidates on a timer is sent with
// "s-maxage=60, stale-while-revalidate", which makes Chrome cache it and then stall the dashboard's repeated prefetches of "/" for ~30 s
// (found by the builder check, which never reached network idle). A dynamic page carries no such header.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Avatar Studio: put a talking virtual human on your website",
  description: "Pick a face and a voice, teach it your business, and add one line of code. Visitors talk to your virtual human face to face. Try it here, no signup.",
  openGraph: {
    title: "Put a talking virtual human on your website",
    description: "Pick a face and a voice, teach it your business, and add one line of code. Try it here, no signup.",
    type: "website",
  },
};

const STEP_IMAGES = [step1, step2, step3];

function Icon({ name }: { name: (typeof CAPABILITIES)[number]["icon"] }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "talk":
      return <svg {...common}><path d="M4 5.5h16v10H12l-4.5 3.5v-3.5H4z" /><path d="M8 9.5h8M8 12.5h5" /></svg>;
    case "docs":
      return <svg {...common}><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4M10 12h5M10 15.5h5" /></svg>;
    case "bolt":
      return <svg {...common}><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" /></svg>;
    case "voice":
      return <svg {...common}><path d="M12 4v16M8 8v8M4 10.5v3M16 8v8M20 10.5v3" /></svg>;
    case "frame":
      return <svg {...common}><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="12" cy="11" r="2.6" /><path d="M7.5 18c.7-2.4 2.4-3.5 4.5-3.5s3.8 1.1 4.5 3.5" /></svg>;
    default:
      return <svg {...common}><path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>;
  }
}

export default async function LandingPage() {
  const personas = await fetchLandingPersonas();
  const first = personas[0];
  // The first paint of the hero card is the persona's still: start fetching it with the page.
  if (first) preload(`/api/embed/still/${encodeURIComponent(first.key)}`, { as: "image", fetchPriority: "high", ...(first.greenScreen ? { crossOrigin: "anonymous" as const } : {}) });

  return (
    <div className={`landing ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <SiteHeader />

      <main id="lh-main">
        {/* ---------- hero ---------- */}
        <div className="lh-hero-wrap">
        <section className="lh-hero" aria-labelledby="lh-title">
          <div className="lh-hero-copy">
            <span className="lh-chip">Virtual humans for websites</span>
            <h1 id="lh-title">{HEADLINE}</h1>
            <p className="lh-sub">{SUBHEAD}</p>
          </div>
          <div className="lh-hero-actions">
            <div className="lh-ctas">
              {first ? (
                <TalkButton personaKey={first.key} className="l-btn l-btn-primary lh-talk-btn">
                  Talk to {first.name}
                </TalkButton>
              ) : null}
              <Link href="/dashboardv2" className={first ? "l-btn l-btn-ghost" : "l-btn l-btn-primary"}>
                Build yours free
              </Link>
            </div>
            <ul className="lh-checks">
              {HERO_CHECKS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="lh-hero-card">
            <HeroCall personas={personas} />
          </div>
        </section>
        </div>

        {/* ---------- facts ---------- */}
        <section className="lh-facts" aria-label="At a glance">
          <div className="lh-facts-in">
            {FACTS.map((f) => (
              <div className="lh-fact" key={f.value}>
                <b>{f.value}</b>
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="lh-section lh-wrap" id="how" aria-labelledby="how-title">
          <div className="lh-head">
            <span className="l-kicker">How it works</span>
            <h2 id="how-title">From idea to a live agent in three steps</h2>
            <p>These are the screens you will use, not a mock-up.</p>
          </div>
          <div className="lh-steps">
            {STEPS.map((s, i) => (
              <div className="lh-step" key={s.label}>
                <div className="lh-step-text">
                  <span className="lh-step-label">{s.label}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <ul>
                    {s.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
                <figure className="lh-step-shot">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={STEP_IMAGES[i].src} width={STEP_IMAGES[i].width} height={STEP_IMAGES[i].height} alt={s.alt} loading="lazy" decoding="async" />
                </figure>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- one line of code ---------- */}
        <section className="lh-section lh-wrap" id="install" aria-labelledby="install-title">
          <div className="lh-head">
            <span className="l-kicker">The install</span>
            <h2 id="install-title">One line of code. That is the whole install.</h2>
            <p>Paste it into your site once. After that you change the agent in the builder and your site updates by itself.</p>
          </div>
          <EmbedSection />
        </section>

        {/* ---------- what it can do ---------- */}
        <section className="lh-section lh-wrap" id="features" aria-labelledby="features-title">
          <div className="lh-head">
            <span className="l-kicker">What it can do</span>
            <h2 id="features-title">More than a face on a chat box</h2>
            <p>It listens, answers from your own material, and takes real actions on your behalf.</p>
          </div>
          <div className="lh-caps">
            {CAPABILITIES.map((c) => (
              <div className="lh-cap" key={c.title}>
                <div className="lh-cap-icon">
                  <Icon name={c.icon} />
                </div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- use cases ---------- */}
        <section className="lh-section lh-wrap" id="use-cases" aria-labelledby="uc-title">
          <div className="lh-head">
            <span className="l-kicker">Use cases</span>
            <h2 id="uc-title">One virtual human, many jobs</h2>
            <p>Give it a job, a voice and your documents. These are the jobs people start with.</p>
          </div>
          <UseCases personas={personas} />
        </section>

        {/* ---------- control ---------- */}
        <section className="lh-section lh-wrap" id="control" aria-labelledby="control-title">
          <div className="lh-head">
            <span className="l-kicker">Control</span>
            <h2 id="control-title">You decide where it appears</h2>
            <p>The questions a business asks before it installs anything, answered up front.</p>
          </div>
          <div className="lh-control">
            {CONTROL.map((c) => (
              <div key={c.title}>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- pricing ---------- */}
        <section className="lh-section lh-wrap" id="pricing" aria-labelledby="pricing-title">
          <div className="lh-head">
            <span className="l-kicker">Pricing</span>
            <h2 id="pricing-title">Pay for the minutes your agent talks</h2>
            <p>No setup fee for building. You pay for conversation time, and you can see every minute.</p>
          </div>
          <div className="lh-price">
            {PRICING_POINTS.map((p) => (
              <div className="lh-price-card" key={p.title}>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
          <p className="lh-price-note">{PRICING_NOTE}</p>
          <div className="lh-price-cta">
            <Link href="/pricing" className="l-btn l-btn-ghost">
              How billing works
            </Link>
          </div>
        </section>

        {/* ---------- faq ---------- */}
        <section className="lh-section lh-wrap" id="faq" aria-labelledby="faq-title">
          <div className="lh-head">
            <span className="l-kicker">FAQ</span>
            <h2 id="faq-title">Questions before you start</h2>
          </div>
          <div className="lh-faq l-faq-list">
            {FAQS.map((item) => (
              <details className="l-faq-item" key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------- final call ---------- */}
        <section className="lh-final" aria-labelledby="final-title">
          <h2 id="final-title">{first ? `Talk to ${first.name}, then build your own.` : "Build your own virtual human."}</h2>
          <p>Choose a face, give it a voice and your documents, and put it on your website today.</p>
          <div className="lh-ctas">
            <Link href="/dashboardv2" className="l-btn l-btn-primary">
              Build yours free
            </Link>
            {first ? (
              <TalkButton personaKey={first.key} className="l-btn l-btn-ghost">
                Talk to {first.name}
              </TalkButton>
            ) : null}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
