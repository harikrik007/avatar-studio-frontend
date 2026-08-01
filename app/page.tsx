import Link from "next/link";
import "./landing.css";
import { inter, jetbrainsMono, spaceGrotesk } from "./landing-fonts";
import PricingGrid from "./PricingGrid";

// The same three steps the dashboard's flow rail shows. The landing used to
// describe the four internal stages of avatar creation instead, which never
// mentioned agents -- so the product's actual shape only became apparent
// after signing up.
const PIPELINE = [
  {
    label: "Create avatar",
    body: "Upload one 6-second clip. We detect the face, run the quality gate, and build the avatar.",
  },
  {
    label: "Build agent",
    body: "Give the avatar a system prompt and connect the tools it should be able to call.",
  },
  {
    label: "Go live",
    body: "Take it live and let people hold real-time video conversations with it.",
  },
];

const FEATURES = [
  {
    title: "Automated quality gate",
    body: "Every upload is checked frame by frame for watermarks, repeated corruption, and face-tracking stability before an avatar ever ships—not a manual review.",
  },
  {
    title: "Metered to the GPU's own clock",
    body: "Credits are spent against the provider's own reported uptime, not a local timer, so you're never charged for time you didn't use.",
  },
  {
    title: "A plan for every scale",
    body: "Start free with pay-as-you-go credits, or step up to a plan with a dedicated GPU included for always-on, no-cold-start serving.",
  },
  {
    title: "Scales to zero",
    body: "On-demand workers spin up per request and shut down when idle—no GPU sits around running up a bill.",
  },
];

const STATS = [
  { value: "Free", label: "To create your first avatar" },
  { value: "< 60s", label: "Upload to ready" },
  { value: "5", label: "Plans, from Free to Enterprise" },
];

const FAQS = [
  {
    q: "What's the difference between an avatar and an agent?",
    a: "An avatar is the face, built from your video. An agent is that avatar given a system prompt and a set of tools, so it can hold a conversation. One avatar can back as many agents as you like.",
  },
  {
    q: "What video works best?",
    a: "A single person, facing the camera, six seconds long, without a burned-in watermark or logo. Poor lighting or a shaky camera won't stop the upload, but they'll show up in the result.",
  },
  {
    q: "What happens if my video fails the quality check?",
    a: "You'll see exactly which check failed—a watermark, a corrupted frame, a face that couldn't be tracked—and can re-upload. Nothing ships without passing.",
  },
  {
    q: "How is this billed?",
    a: "Creating an avatar is free on every plan. Credits are spent on session minutes while your avatar is actually live.",
  },
  {
    q: "Can I get a dedicated GPU instead of on-demand?",
    a: "Yes—the Business plan includes one dedicated GPU so there's no cold start; Enterprise can add more.",
  },
  {
    q: "How many people can talk to one avatar at once?",
    a: "Depends on your plan—from 1 concurrent session on Free up to 100+ on Enterprise.",
  },
  {
    q: "How long does creation take?",
    a: "Under a minute from upload to a ready avatar, including the quality check.",
  },
];

export default function LandingPage() {
  return (
    <main className={`landing ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <nav className="l-nav">
        <span className="l-brand">Avatar Studio</span>
        <div className="l-nav-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard" className="l-btn l-btn-primary">
            Get started
          </Link>
        </div>
      </nav>

      <section className="l-hero">
        <span className="l-kicker">Avatars and agents</span>
        <h1>
          Turn a 6-second video into a
          <br />
          real-time talking agent.
        </h1>
        <p>
          Upload one short clip and we build the avatar. Give it a system
          prompt and the tools it needs, and it holds live conversations for
          you—free to create, credit-based to serve.
        </p>
        <div className="l-hero-ctas">
          <Link href="/dashboard" className="l-btn l-btn-primary">
            Create your first avatar
          </Link>
          <Link href="/pricing" className="l-btn l-btn-ghost">
            See pricing
          </Link>
        </div>
      </section>

      <div className="l-pipeline">
        {PIPELINE.map((node, i) => (
          <div className="l-pipeline-node" key={node.label}>
            <div className="l-pipeline-step">{i + 1}</div>
            <h4>{node.label}</h4>
            <p>{node.body}</p>
          </div>
        ))}
      </div>

      <section className="l-section">
        <div className="l-section-title l-center">
          <span className="l-kicker">Why it holds up</span>
          <h2>Built to run unsupervised</h2>
          <p>A self-service pipeline has to catch what a human reviewer would—automatically, every time.</p>
        </div>
        <div className="l-feature-grid">
          {FEATURES.map((f) => (
            <div className="l-feature-card" key={f.title}>
              <div className="l-dot" />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="l-section">
        <div className="l-stat-row">
          {STATS.map((s) => (
            <div className="l-stat-card" key={s.label}>
              <div className="l-stat-value">{s.value}</div>
              <div className="l-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="l-section">
        <div className="l-section-title l-center">
          <span className="l-kicker">Pricing</span>
          <h2>Simple, credit-based pricing</h2>
          <p>Avatar creation is free on every plan. Credits are spent on session minutes.</p>
        </div>
        <PricingGrid />
      </section>

      <section className="l-section">
        <div className="l-section-title l-center">
          <span className="l-kicker">FAQ</span>
          <h2>Questions</h2>
          <p>Everything you need to know before you upload.</p>
        </div>
        <div className="l-faq-list">
          {FAQS.map((item) => (
            <details className="l-faq-item" key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="l-section">
        <p className="l-trust">
          Your video and the avatar built from it are private to your
          account—stored to serve your own sessions, nothing else.
        </p>
      </section>

      <section className="l-cta-band">
        <h2>Ready to build your first agent?</h2>
        <p>Upload a video, get a working avatar back in under a minute, then give it a prompt and tools.</p>
        <Link href="/dashboard" className="l-btn l-btn-dark">
          Create your first avatar
        </Link>
      </section>

      <footer className="l-footer">
        <span>Avatar Studio</span>
        <Link href="/pricing">Pricing</Link>
      </footer>
    </main>
  );
}
