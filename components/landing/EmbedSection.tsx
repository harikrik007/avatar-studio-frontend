"use client";

/**
 * "One line of code": the install snippet with a copy button, a switch between the two layouts the widget has (panel, frameless),
 * and a small mock of a customer's website showing what a visitor sees. The mock is an illustration, drawn in CSS.
 */

import { useEffect, useRef, useState } from "react";
import { CLIENT_TOOL_SNIPPET, EMBED_LAYOUTS } from "@/lib/landing-content";
import face from "./img/face-cutout.webp";

const FALLBACK_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || "https://your-studio-domain";

export default function EmbedSection() {
  const [layout, setLayout] = useState<"panel" | "frameless">("panel");
  const [origin, setOrigin] = useState(FALLBACK_ORIGIN);
  const [copied, setCopied] = useState<"snippet" | "tool" | "snippet-failed" | "tool-failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const snippet = `<script src="${origin}/widget.js" data-key="pk_your_key"></script>`;
  const current = EMBED_LAYOUTS.find((l) => l.id === layout) ?? EMBED_LAYOUTS[0];

  async function copy(text: string, which: "snippet" | "tool", box: HTMLElement | null) {
    let done: typeof copied = which;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // The browser refused (an embedded view, an older browser): select the text so Ctrl+C / Cmd+C does it.
      done = `${which}-failed`;
      const code = box?.closest(".lh-codebox")?.querySelector("pre code");
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    setCopied(done);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2400);
  }

  return (
    <div className="lh-embed">
      <div className="lh-embed-text">
        <div className="lh-codebox">
          <div className="lh-codebox-head">
            <span>Paste before the closing &lt;/body&gt; tag</span>
            <button type="button" className="lh-copy" onClick={(e) => void copy(snippet, "snippet", e.currentTarget)}>
              {copied === "snippet" ? "Copied" : copied === "snippet-failed" ? "Press Ctrl+C" : "Copy"}
            </button>
          </div>
          <pre tabIndex={0}>
            <code>{snippet}</code>
          </pre>
        </div>

        <div className="lh-seg" role="radiogroup" aria-label="Layout">
          {EMBED_LAYOUTS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={layout === l.id} className={`lh-seg-btn${layout === l.id ? " lh-seg-on" : ""}`} onClick={() => setLayout(l.id as "panel" | "frameless")}>
              {l.label}
            </button>
          ))}
        </div>
        <p className="lh-embed-desc">{current.body}</p>

        <div className="lh-codebox lh-codebox-sub">
          <div className="lh-codebox-head">
            <span>Let your agent act on your page</span>
            <button type="button" className="lh-copy" onClick={(e) => void copy(CLIENT_TOOL_SNIPPET, "tool", e.currentTarget)}>
              {copied === "tool" ? "Copied" : copied === "tool-failed" ? "Press Ctrl+C" : "Copy"}
            </button>
          </div>
          <pre tabIndex={0}>
            <code>{CLIENT_TOOL_SNIPPET}</code>
          </pre>
        </div>
        <p className="lh-embed-desc">When the agent decides to open the booking form, this runs in your visitor&apos;s browser and tells it what happened.</p>
      </div>

      <div className="lh-mock" aria-hidden="true">
        <div className="lh-browser">
          <div className="lh-browser-bar">
            <i />
            <i />
            <i />
            <span>yourcompany.com</span>
          </div>
          <div className="lh-site">
            <div className="lh-site-nav">
              <b />
              <span />
              <span />
              <span />
            </div>
            <div className="lh-site-hero">
              <div className="lh-sk lh-sk-h" />
              <div className="lh-sk lh-sk-h lh-sk-h2" />
              <div className="lh-sk lh-sk-p" />
              <div className="lh-sk lh-sk-p lh-sk-p2" />
              <div className="lh-sk lh-sk-btn" />
            </div>
            <div className="lh-site-cards">
              <div />
              <div />
              <div />
            </div>

            <div className={`lh-widget lh-widget-${layout}`}>
              <div className="lh-widget-bubble">Hi, I&apos;m Maya. What can I help you find today?</div>
              <div className="lh-widget-face">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={face.src} width={face.width} height={face.height} alt="" loading="lazy" />
              </div>
              <div className="lh-widget-bar">
                <i />
                <i />
                <i className="lh-widget-end" />
              </div>
            </div>
          </div>
        </div>
        <p className="lh-mock-cap">An illustration of the {layout === "panel" ? "panel" : "frameless"} layout on a customer&apos;s site.</p>
      </div>
    </div>
  );
}
