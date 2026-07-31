import Link from "next/link";

export default function PricingPage() {
  return (
    <main>
      <nav className="nav">
        <Link href="/" className="brand">
          Avatar Studio
        </Link>
        <div className="nav-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard" className="button button-primary">
            Get started
          </Link>
        </div>
      </nav>

      <section className="hero" style={{ padding: "64px 24px 40px" }}>
        <h1 style={{ fontSize: 34 }}>Simple, usage-based pricing</h1>
        <p>Avatar creation is free. You only pay for the minutes your avatar is actually live.</p>
      </section>

      <section className="section" style={{ borderTop: "none", paddingTop: 0 }}>
        <div className="pricing-grid">
          <div className="price-card">
            <h3>On-demand</h3>
            <div className="price">
              $0.35<span className="price-unit"> / min</span>
            </div>
            <div className="price-note">Serving time, billed to the minute</div>
            <ul>
              <li>Unlimited avatar creation</li>
              <li>Spin up in seconds, pay only while live</li>
              <li>Up to 8 concurrent sessions per avatar</li>
              <li>Automated quality check on every upload</li>
            </ul>
            <Link href="/dashboard" className="button button-secondary" style={{ width: "100%" }}>
              Start free
            </Link>
          </div>

          <div className="price-card featured">
            <h3>Dedicated</h3>
            <div className="price">Custom</div>
            <div className="price-note">Reserved GPU, fixed monthly rate</div>
            <ul>
              <li>Everything in On-demand</li>
              <li>Always-on, no cold start</li>
              <li>Priority support</li>
              <li>Typical term: 6 months</li>
            </ul>
            <a href="mailto:hello@avatar-studio.example" className="button button-primary" style={{ width: "100%" }}>
              Talk to us
            </a>
          </div>

          <div className="price-card">
            <h3>Enterprise</h3>
            <div className="price">Custom</div>
            <div className="price-note">Multiple avatars, volume pricing</div>
            <ul>
              <li>Everything in Dedicated</li>
              <li>Multiple avatars, multiple GPUs</li>
              <li>SLA + dedicated support</li>
              <li>Custom integration support</li>
            </ul>
            <a href="mailto:hello@avatar-studio.example" className="button button-secondary" style={{ width: "100%" }}>
              Talk to us
            </a>
          </div>
        </div>
      </section>

      <footer className="footer">Avatar Studio</footer>
    </main>
  );
}
