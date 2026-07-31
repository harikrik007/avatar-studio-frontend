import Link from "next/link";

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
      </section>

      <footer className="footer">Avatar Studio</footer>
    </main>
  );
}
