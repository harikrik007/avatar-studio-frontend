"use client";

import { useEffect, useRef, useState } from "react";
import { formatOffset, type CallTranscript, type UsageItem } from "@/lib/usage";

/** The call's conversation, turn by turn (the visitor's words and the agent's), in a dialog over the Usage page. Calls from before
 * transcripts were kept have none, and the dialog says so. Closes on Close, Esc or a click outside it. */
export default function TranscriptDialog({ call, onClose }: { call: UsageItem; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<CallTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    let live = true;
    fetch(`/api/usage/calls/${encodeURIComponent(call.id)}/transcript`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!live) return;
        if (r.ok && body && Array.isArray(body.lines)) setData(body as CallTranscript);
        else setError("The transcript could not be loaded. Try again in a moment.");
      })
      .catch(() => live && setError("The transcript could not be loaded. Try again in a moment."));
    return () => {
      live = false;
    };
  }, [call.id]);

  const agentName = data?.agent_name || call.agent_name || "Agent";
  const started = call.started_at ? new Date(call.started_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <dialog
      ref={ref}
      className="lu-dialog"
      aria-labelledby="lu-transcript-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close(); // the backdrop
      }}
    >
      <div className="lu-dialog-inner">
        <header className="lu-dialog-head">
          <div>
            <h2 id="lu-transcript-title">Transcript</h2>
            <p className="lu-dialog-sub">
              {agentName}
              {started ? ` · ${started}` : ""}
            </p>
          </div>
          <button type="button" className="l-btn l-btn-ghost lu-dialog-close" onClick={() => ref.current?.close()}>
            Close
          </button>
        </header>
        <div className="lu-transcript" data-transcript>
          {error ? (
            <p className="lu-transcript-empty">{error}</p>
          ) : data === null ? (
            <p className="lu-transcript-empty">Loading…</p>
          ) : data.lines.length === 0 ? (
            <p className="lu-transcript-empty">
              No transcript for this call. Transcripts are kept for calls from 10 October 2026 on.
            </p>
          ) : (
            <ol className="lu-turns">
              {data.lines.map((line) => (
                <li key={line.n} className={`lu-turn lu-turn-${line.role}`}>
                  <div className="lu-turn-meta">
                    <span className="lu-turn-who">{line.role === "agent" ? agentName : "Visitor"}</span>
                    {line.offset_seconds !== null ? <span className="lu-turn-time">{formatOffset(line.offset_seconds)}</span> : null}
                  </div>
                  <p className="lu-turn-text">{line.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </dialog>
  );
}
