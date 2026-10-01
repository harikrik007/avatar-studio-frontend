import Script from "next/script";

const publicKey = "pk_e85664965c7c49c2aa9a7c16563039c5";

export default function SampleEmbedPage() {
  return (
    <main style={{ minHeight: "100vh", padding: "clamp(24px, 6vw, 80px)", background: "#f3f6fa", color: "#172033", fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 760 }}>
        <p style={{ color: "#526176", fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase" }}>Local widget test</p>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.1, margin: "12px 0 20px" }}>Avatar embed sample</h1>
        <p style={{ fontSize: 18, lineHeight: 1.55 }}>This page loads the local <code>/widget.js</code> script with your test key. Click the avatar in the bottom-right corner to start a call.</p>
        <p style={{ lineHeight: 1.55 }}>To check the timeout, let the avatar finish speaking, then stay silent. To check that the mic still works, interrupt the avatar and confirm your words appear in chat and it answers.</p>
        <p style={{ fontSize: 13, color: "#526176", wordBreak: "break-all" }}>Key: {publicKey}</p>
      </div>
      <Script src="/widget.js" data-key={publicKey} strategy="afterInteractive" />
    </main>
  );
}
