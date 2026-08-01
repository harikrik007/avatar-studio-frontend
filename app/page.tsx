import Link from "next/link";

const PROOF_POINTS = [
  {
    title: "Automated quality gate",
    body: "Every upload is checked frame by frame for watermarks, repeated corruption, and face-tracking stability before an avatar ever ships -- not a manual review.",
  },
  {
    title: "Billed to the GPU's own clock",
    body: "Usage is metered against the provider's own reported uptime, not a local timer, so you're never billed for time you didn't use.",
  },
  {
    title: "Two ways to serve",
    body: "Spin up on-demand and pay per minute, or reserve a dedicated GPU for always-on, no-cold-start serving.",
  },
];

const FAQS = [
  {
    q: "What video works best?",
    a: "A single person, facing the camera, six seconds long, without a burned-in watermark or logo. Poor lighting or a shaky camera won't stop the upload, but they'll show up in the result.",
  },
  {
    q: "What happens if my video fails the quality check?",
    a: "You'll see exactly which check failed -- a watermark, a corrupted frame, a face that couldn't be tracked -- and can re-upload. Nothing ships without passing.",
  },
  {
    q: "How is this billed?",
    a: "Creating an avatar is free. You're billed per minute only while it's actually serving a live conversation.",
  },
  {
    q: "Can I get a dedicated GPU instead of on-demand?",
    a: "Yes. The Dedicated tier reserves hardware for your avatar so there's no cold start, billed at a fixed monthly rate.",
  },
  {
    q: "How many people can talk to one avatar at once?",
    a: "Up to 8 concurrent sessions per on-demand avatar. Enterprise plans provision additional GPUs for more.",
  },
  {
    q: "How long does creation take?",
    a: "Under a minute from upload to a ready avatar, including the quality check.",
  },
];

export default function LandingPage() {
  return (
    <main>
      <nav className="nav">
        <span className="brand">Avatar Studio</span>
        <div className="nav-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard" className="button button-primary">
            Get started
          </Link>
        </div>
      </nav>

      <section className="hero">
        <h1>
          Turn a 6-second video
          <br />
          into a real-time talking avatar.
        </h1>
        <p>
          Upload one short clip. We detect the face, build the talking and
          idle frame sets, and hand you back an avatar ready to serve live
          conversations -- billed per minute of GPU time, not per video.
        </p>
        <Link href="/dashboard" className="button button-primary">
          Create your first avatar
        </Link>
      </section>

      <section className="steps">
        <div className="step">
          <div className="step-number">01</div>
          <h3>Upload</h3>
          <p>A 6-second video of one person, facing the camera. That&rsquo;s the only input we need.</p>
        </div>
        <div className="step">
          <div className="step-number">02</div>
          <h3>We build it</h3>
          <p>
            Face detection, talking and idle frame generation, and an
            automated quality check run in under a minute.
          </p>
        </div>
        <div className="step">
          <div className="step-number">03</div>
          <h3>Deploy</h3>
          <p>Your avatar is ready to serve live, lip-synced conversations on demand.</p>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Built on infrastructure already serving real traffic</h2>
          <p>Not a prototype -- the same pipeline behind live customer-facing deployments today.</p>
        </div>
        <div className="proof-grid">
          {PROOF_POINTS.map((point) => (
            <div className="proof-item" key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Simple, usage-based pricing</h2>
          <p>Avatar creation is free. You only pay for the minutes your avatar is actually live.</p>
        </div>
        <div className="price-teaser">
          <div className="price-teaser-amount">
            $0.35<span>/min</span>
          </div>
          <div className="price-teaser-label">On-demand serving, billed to the minute</div>
          <Link href="/pricing" className="button button-secondary">
            See full pricing
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Questions</h2>
          <p>Everything you need to know before you upload.</p>
        </div>
        <div className="faq-list">
          {FAQS.map((item) => (
            <details className="faq-item" key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <h2>Ready to build your avatar?</h2>
        <p>Upload a video, get a working avatar back in under a minute.</p>
        <Link href="/dashboard" className="button button-primary">
          Create your first avatar
        </Link>
      </section>

      <footer className="footer">Avatar Studio</footer>
    </main>
  );
}
