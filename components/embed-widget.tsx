"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Track, type RemoteTrack } from "livekit-client";
import { LiveKitFace } from "@/components/livekit-face";
import { GreenScreenCanvas } from "@/components/green-screen-canvas";
import { AvatarSession, type AvatarToolCall } from "@/lib/avatar-session";

type Status =
  | "idle"
  | "checking"
  | "connecting"
  | "listening"
  | "busy"
  | "error"
  | "ended";

// No user or assistant activity for this long ends the session -- a
// visitor who opens the widget and wanders off must not hold one of a
// small, fixed number of GPU slots (worker3's own cap is 4 for RingMe).
const IDLE_TIMEOUT_MS = 90_000;
// Also the practical way public traffic stays clear of Gemini Live's own
// ~10-minute GoAway stall (known, open, documented in realtime-avatar) --
// a session this widget starts never runs long enough to hit it.
const HARD_TIMEOUT_MS = 8 * 60_000;

type Props = {
  publicKey: string;
  accentColor: string;
  greetingLabel: string;
  /** Shown as the panel's title. The agent's own name, so a visitor knows
   * who they are about to talk to before the face loads. */
  agentName?: string;
  /** Float the avatar on the page with its background keyed out, instead of
   * showing it inside the panel. Only works on an avatar built from a
   * green-screen image; everything else about the session is identical. */
  transparent?: boolean;
  origin?: string;
  previewVideoUrl?: string | null;
  previewImageUrl?: string | null;
};

type Message = { id: number; role: "assistant" | "user"; text: string; at: number };

// Only http(s):// and www. are ever turned into links, so nothing a model
// says can become a javascript: or data: href.
const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/i;

/** Renders text with its web addresses as real links. The panel lives in an
 * iframe, so they open in a new tab rather than navigating the widget away.
 * Trailing sentence punctuation stays outside the link -- "...orchards." is
 * the end of a sentence, not part of the address. */
function linkify(text: string, linkStyle: React.CSSProperties) {
  return text.split(URL_PATTERN).map((part, i) => {
    if (i % 2 === 0) return part;
    const trailing = part.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return (
      <Fragment key={i}>
        <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>{url}</a>
        {trailing}
      </Fragment>
    );
  });
}

// Gemini sends transcripts as deltas -- "Hi," then " I'm" then " Riya" --
// so a chunk is not an utterance. Consecutive chunks from the same speaker
// this close together are the same sentence still being said, and joining
// them is the difference between a conversation and a wall of fragments.
const CHUNK_MERGE_MS = 2500;
// The panel widens to hold the transcript, and only if the host page has
// room for it -- a phone gets the card alone rather than two cramped
// columns.
const CARD_W = 340;
const TRANSCRIPT_W = 280;
const MIN_WIDE_PX = 560;

export function EmbedWidget({ publicKey, accentColor, greetingLabel, agentName, transparent, origin, previewVideoUrl, previewImageUrl }: Props) {
  const [status, setStatus] = useState<Status>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>(greetingLabel);
  const [videoTrack, setVideoTrack] = useState<RemoteTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<RemoteTrack | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [shared, setShared] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasRoom, setHasRoom] = useState(false);
  // The frameless control bar's own expand -- a chevron revealing the
  // keyboard and speaker buttons, distinct from `expanded` above (the
  // panel widget's bigger-box toggle, sent to the host over postMessage).
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [draftText, setDraftText] = useState("");
  // Mutes the avatar's own voice -- a visitor choice, independent of
  // audioBlocked (the browser refusing autoplay, which needs a retry, not
  // a toggle) and independent of micOn (their own mic, not hers).
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const messageSeqRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const bubbleTextRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const showTranscript = hasRoom && messages.length > 0;

  const sessionRef = useRef<AvatarSession | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // sessionStorage guard: one session per browser tab-group, so a single
  // visitor can't hold several of a small, shared concurrency pool open
  // across multiple tabs of the same widget.
  const ownsSessionRef = useRef(false);

  /** The panel lives in an iframe the host page owns, so anything that
   * changes the *frame* -- closing it, resizing it -- has to be asked for
   * rather than done. widget.js listens for these. targetOrigin is "*"
   * because the host is an unknown customer domain by definition; nothing
   * secret travels this way, only "close" and "expand". */
  function askHost(type: "close" | "expand" | "resize", detail?: Record<string, unknown>) {
    try {
      window.parent?.postMessage({ source: "avatar-studio-widget", type, ...detail }, "*");
    } catch {
      /* sandboxed without allow-scripts on the parent -- nothing to do */
    }
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    void sessionRef.current?.room.localParticipant.setMicrophoneEnabled(next);
  }

  async function share() {
    // The thing worth sharing is the page the widget is on, which is the
    // referrer the iframe was given -- the iframe's own URL is an
    // implementation detail nobody wants to paste.
    const url = origin || document.referrer || window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      /* clipboard blocked; the button simply does not confirm */
    }
  }

  // Whether there is room for two columns is a fact about the iframe we
  // were actually given, not about what we asked for: the host clamps our
  // width to its own viewport, so this reads the result.
  useEffect(() => {
    const measure = () => setHasRoom(window.innerWidth >= MIN_WIDE_PX);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Newest line at the bottom, always in view.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // The frameless bubble and the narrow-panel caption each hold the whole
  // conversation in their own scroller, and need the same pin: a long
  // answer that outgrows the fixed height otherwise sits frozen at
  // scrollTop 0 -- the start stays on screen while the newest words are
  // hidden below. A visitor can still scroll up to reread; each new
  // message just brings the latest one back into view.
  useEffect(() => {
    for (const el of [bubbleTextRef.current, captionRef.current]) {
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function appendTranscript(role: "assistant" | "user", text: string) {
    if (!text) return;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      const now = Date.now();
      // Concatenated verbatim, never trimmed: the word breaks live in the
      // deltas themselves (" I'm", " Riya"), so stripping a chunk's leading
      // space is what ran the sentence together. Tidying happens once, at
      // render, where a stray double space is all that is left to fix.
      if (last && last.role === role && now - last.at < CHUNK_MERGE_MS) {
        const merged = [...prev];
        merged[merged.length - 1] = { ...last, text: last.text + text, at: now };
        return merged;
      }
      // A whitespace-only chunk is the gap between two utterances, not the
      // start of a third one.
      if (!text.trim()) return prev;
      messageSeqRef.current += 1;
      return [...prev, { id: messageSeqRef.current, role, text, at: now }];
    });
  }

  function displayText(text: string) {
    return text.replace(/\s+/g, " ").trim();
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/embed/capacity/${publicKey}`)
      .then((r) => r.json())
      .then((data: { available?: boolean }) => {
        if (!cancelled) setStatus(data.available === false ? "busy" : "idle");
      })
      .catch(() => {
        if (!cancelled) setStatus("idle"); // fail open on the *display*; the real gate is server-side
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  useEffect(() => {
    return () => {
      clearIdleTimer();
      clearHardTimer();
      // Best-effort on unmount (tab closed, iframe removed) -- the
      // sendBeacon-style fire-and-forget pattern real close() below also
      // uses would be better for the unload case specifically, but a
      // synchronous unmount is not the unload event; disconnect() already
      // covers the common "visitor clicked Stop" path.
      if (sessionRef.current) {
        void endSession("visitor_closed");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearIdleTimer() {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  function clearHardTimer() {
    if (hardTimerRef.current) {
      clearTimeout(hardTimerRef.current);
      hardTimerRef.current = null;
    }
  }

  function armIdleTimer() {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      void endSession("idle_timeout");
    }, IDLE_TIMEOUT_MS);
  }

  async function endSession(reason: "visitor_closed" | "idle_timeout" | "hard_timeout") {
    clearIdleTimer();
    clearHardTimer();
    const room = roomNameRef.current;
    sessionRef.current?.close();
    sessionRef.current = null;
    roomNameRef.current = null;
    ownsSessionRef.current = false;
    setVideoTrack(null);
    setAudioTrack(null);
    setIsSpeaking(false);
    // A fresh call should not inherit a typed draft, an open keyboard, or
    // a mute the visitor may not remember setting three conversations ago.
    setControlsExpanded(false);
    setTextMode(false);
    setDraftText("");
    setSpeakerMuted(false);

    if (room) {
      try {
        await fetch("/api/embed/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_key: publicKey, room, reason }),
        });
      } catch {
        // Best-effort -- the control plane's own empty-room monitor
        // reaps it regardless.
      }
    }

    // Only the panel widget's transcript column is a request to widen the
    // host's box -- frameless has its own fixed size, set from config, and
    // shrinking it to the panel's width on every hang-up is what left the
    // avatar squeezed into a box sized for a different layout.
    if (!transparent) askHost("resize", { width: CARD_W });
    setStatus(reason === "idle_timeout" ? "ended" : "idle");
    setTranscript(
      reason === "idle_timeout"
        ? "Ended due to inactivity. Tap start to talk again."
        : reason === "hard_timeout"
          ? "This conversation reached its time limit. Tap start for a new one."
          : greetingLabel
    );
  }

  function handleToolCalls(calls: AvatarToolCall[]) {
    // The embed widget has no tool-owning UI (no cart, no account panel --
    // that lives in the customer's own product). Answering with success:
    // false rather than staying silent lets the agent's own persona
    // explain the limitation in its own words instead of hanging on a
    // function call that never resolves.
    if (!calls.length || !sessionRef.current) return;
    sessionRef.current.sendToolResponse({
      functionResponses: calls.map((call) => ({
        id: call.id,
        name: call.name,
        response: { success: false, error: "Not available in this embedded widget." },
      })),
    });
  }

  async function connect() {
    if (status === "connecting" || status === "listening") return;
    if (ownsSessionRef.current) return;

    setStatus("connecting");
    setErrorMessage(null);
    setTranscript("Connecting…");

    try {
      const capRes = await fetch(`/api/embed/capacity/${publicKey}`);
      const cap = (await capRes.json()) as { available?: boolean };
      if (cap.available === false) {
        setStatus("busy");
        setTranscript("All agents are busy right now. Please try again shortly.");
        return;
      }

      const session = await AvatarSession.connect(
        {
          onToolCall: handleToolCalls,
          onTranscript: (role, text) => {
            armIdleTimer();
            const trimmed = text.trim();
            if (trimmed) setTranscript(trimmed);
            appendTranscript(role, text);
          },
          onSpeakingChange: (speaking) => {
            armIdleTimer();
            setIsSpeaking(speaking);
          },
          onTrack: (track) => {
            if (track.kind === Track.Kind.Video) setVideoTrack(track);
            else if (track.kind === Track.Kind.Audio) setAudioTrack(track);
          },
          onAudioBlocked: setAudioBlocked,
          onDisconnected: () => {
            void endSession("visitor_closed");
          },
          onError: (message) => {
            setStatus("error");
            setErrorMessage(message);
          },
        },
        { sessionUrl: "/api/embed/session", sessionBody: { public_key: publicKey, origin } }
      );

      setMessages([]);
      // Same reasoning as the shrink on hang-up below: this widens the host
      // box for the panel's side transcript, and frameless does not have
      // one -- asking anyway squeezed its fixed-width layout down to 620px
      // on every connect, which is what cropped the avatar and left the
      // reply bubble too narrow not to scroll.
      if (!transparent) askHost("resize", { width: CARD_W + TRANSCRIPT_W });
      sessionRef.current = session;
      roomNameRef.current = session.room.name;
      ownsSessionRef.current = true;
      setAudioBlocked(!session.canPlaybackAudio);
      setStatus("listening");
      setTranscript(greetingLabel);
      armIdleTimer();
      hardTimerRef.current = setTimeout(() => {
        void endSession("hard_timeout");
      }, HARD_TIMEOUT_MS);
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to start the conversation.");
    }
  }

  const isConnected = status === "listening";
  const busy = status === "connecting" || status === "checking";
  const statusLabel =
    status === "listening" ? "LIVE"
      : status === "connecting" ? "CONNECTING"
        : status === "checking" ? "CHECKING"
          : status === "busy" ? "BUSY"
            : status === "error" ? "ERROR"
              : status === "ended" ? "ENDED"
                : "READY";
  const statusColor =
    status === "listening" ? "#16a34a"
      : status === "error" || status === "busy" ? "#b91c1c"
        : busy ? "#d97706"
          : "#6b7280";

  // The button is an icon, so what it would have said lives in its tooltip
  // and its aria-label instead of disappearing.
  const callTitle = isConnected
    ? "End call"
    : status === "connecting"
      ? "Connecting…"
      : status === "checking"
        ? "Checking availability…"
        : status === "busy"
          ? "All agents are busy"
          : "Start call";

  if (transparent) {
    // Three separate surfaces over the host page, the way the reference
    // does it: the avatar keyed and floating, what she is saying in its own
    // bubble, and the call controls in their own bar. No card, no border,
    // nothing that reads as a video player.
    return (
      <div style={framelessShellStyle}>
        <div style={framelessStageStyle}>
          <GreenScreenCanvas
            videoTrack={isConnected ? videoTrack : null}
            audioTrack={audioTrack}
            speakerMuted={speakerMuted}
            idleImageSrc={previewImageUrl ?? null}
            style={framelessCanvasStyle}
          />
        </div>

        <div style={framelessLeftStyle}>
          {messages.length || !isConnected ? (
            <div style={bubbleStyle}>
              <div ref={bubbleTextRef} className="hide-scrollbar" style={bubbleTextStyle}>
                {messages.length ? (
                  messages.map((m) => (
                    <p
                      key={m.id}
                      style={m.role === "assistant" ? bubbleAgentLineStyle : bubbleVisitorLineStyle}
                    >
                      {linkify(displayText(m.text), bubbleLinkStyle)}
                    </p>
                  ))
                ) : (
                  <p style={bubbleAgentLineStyle}>
                    {status === "connecting" ? "Connecting…" : greetingLabel}
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {textMode ? (
            // Replaces the whole bar rather than sharing it with the call
            // controls -- matches Docket's own reference exactly, and a
            // visitor mid-sentence should not also be looking at a mic
            // button that implies they should be talking instead.
            <div style={textInputRowStyle}>
              <input
                type="text"
                autoFocus
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const trimmed = draftText.trim();
                    if (trimmed) sessionRef.current?.sendClientContent({ turns: trimmed });
                    setDraftText("");
                    setTextMode(false);
                  } else if (e.key === "Escape") {
                    setDraftText("");
                    setTextMode(false);
                  }
                }}
                placeholder="Ask a follow-up"
                aria-label="Type a message"
                style={textInputStyle}
              />
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => { setDraftText(""); setTextMode(false); }}
                style={textInputCloseStyle}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5l14 14M19 5L5 19" stroke="#111" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : (
          <div style={controlBarStyle}>
            <button
              type="button"
              aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
              aria-pressed={!micOn}
              disabled={!isConnected}
              onClick={toggleMic}
              style={{
                ...barButtonStyle,
                background: !isConnected ? "rgba(255,255,255,0.12)"
                  : micOn ? "rgba(255,255,255,0.16)" : "#dc2626",
                boxShadow: isSpeaking ? "0 0 0 4px rgba(255,255,255,0.14)" : "none",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" fill="#fff" />
                <path d={micOn ? "M5 11a7 7 0 0 0 14 0M12 18v3" : "M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"}
                  stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              aria-label={isConnected ? "End call" : "Start call"}
              title={callTitle}
              disabled={busy || status === "busy"}
              onClick={() => (isConnected ? void endSession("visitor_closed") : void connect())}
              style={{
                ...barButtonStyle,
                background: isConnected ? "#dc2626" : busy ? "#d97706" : "#16a34a",
                opacity: busy || status === "busy" ? 0.75 : 1,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                style={{ transform: isConnected ? "rotate(135deg)" : "none" }}>
                <path
                  d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
                  fill="#fff"
                />
              </svg>
            </button>

            {isConnected ? (
              <button
                type="button"
                aria-label={controlsExpanded ? "Fewer controls" : "More controls"}
                aria-expanded={controlsExpanded}
                onClick={() => setControlsExpanded((v) => !v)}
                style={barButtonStyle}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d={controlsExpanded ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
                    stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}

            <span style={barDividerStyle} />

            {isConnected && controlsExpanded ? (
              <>
                <button
                  type="button"
                  aria-label="Type a message"
                  onClick={() => setTextMode(true)}
                  style={barButtonStyle}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="6" width="18" height="12" rx="2.5" stroke="#fff" strokeWidth="1.6" />
                    <path d="M6.5 10h.01M9.5 10h.01M12.5 10h.01M15.5 10h.01M17.5 10h.01M6.5 14h8"
                      stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>

                <button
                  type="button"
                  aria-label={speakerMuted ? "Unmute avatar" : "Mute avatar"}
                  aria-pressed={speakerMuted}
                  onClick={() => setSpeakerMuted((v) => !v)}
                  style={{
                    ...barButtonStyle,
                    background: speakerMuted ? "#dc2626" : "rgba(255,255,255,0.16)",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="#fff" />
                    {speakerMuted ? (
                      <path d="M16 8l6 8M22 8l-6 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                    ) : (
                      <path d="M17 8a5 5 0 0 1 0 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                    )}
                  </svg>
                </button>
              </>
            ) : null}

            {audioBlocked ? (
              <button type="button" aria-label="Enable sound" style={barButtonStyle}
                onClick={() => { void sessionRef.current?.startAudio().then((ok) => setAudioBlocked(!ok)); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 9v6h4l5 4V5L8 9H4z" fill="#fff" />
                  <path d="M17 8a5 5 0 0 1 0 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}

            <button type="button" aria-label="Close" style={barButtonStyle}
              onClick={() => { void endSession("visitor_closed"); askHost("close"); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5l14 14M19 5L5 19" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          )}

          {errorMessage ? <p style={framelessErrorStyle}>{errorMessage}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      {showTranscript ? (
        <aside style={transcriptPanelStyle} aria-label="Conversation transcript">
          <div ref={logRef} style={transcriptLogStyle}>
            {messages.map((m) => (
              <p
                key={m.id}
                style={m.role === "assistant" ? agentLineStyle : visitorLineStyle}
              >
                {linkify(displayText(m.text), transcriptLinkStyle)}
              </p>
            ))}
          </div>
        </aside>
      ) : null}

      <div style={panelStyle}>
        {/* The face is the panel, not a picture inside it. Everything else
            floats over it on two gradient scrims -- without those, white
            text lands on whatever the avatar happens to be wearing. */}
        <div style={videoLayerStyle}>
          <LiveKitFace
            videoTrack={videoTrack}
            audioTrack={audioTrack}
            isConnected={isConnected}
            width="100%"
            height="100%"
            idleVideoSrc={previewVideoUrl ?? undefined}
            idleImageSrc={previewImageUrl ?? null}
          />
        </div>

        <div style={topScrimStyle}>
          <header style={headerStyle}>
            <span style={brandStyle}>{agentName || "Avatar"}</span>
            <span style={windowControlsStyle}>
              <button type="button" aria-label="Minimise" style={iconButtonStyle}
                onClick={() => askHost("close")}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3 7h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <button type="button" aria-label={expanded ? "Shrink" : "Expand"} style={iconButtonStyle}
                onClick={() => { const next = !expanded; setExpanded(next); askHost("expand", { expanded: next }); }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2 5V2h3M12 9v3H9M12 5V2H9M2 9v3h3" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button type="button" aria-label="Close" style={iconButtonStyle}
                onClick={() => { void endSession("visitor_closed"); askHost("close"); }}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          </header>

          <div style={statusRowStyle}>
            <span style={statusLeftStyle}>
              <span style={{ ...statusDotStyle, background: statusColor }} />
              {statusLabel}
            </span>
            <button type="button" style={shareButtonStyle} onClick={() => void share()}>
              {shared ? "COPIED" : "SHARE"}
            </button>
          </div>
        </div>

        <div style={bottomScrimStyle}>
          {errorMessage ? <p style={errorStyle}>{errorMessage}</p> : null}

          {/* The conversation, for when there is no room for the column
              beside the card (a phone). Without either, a visitor who cannot
              hear has no way to follow it at all -- and it scrolls, so an
              earlier answer (a link, say) is not gone the moment the next
              one starts. */}
          {isConnected && !showTranscript && (messages.length || transcript) ? (
            <div ref={captionRef} className="hide-scrollbar" style={captionLogStyle}>
              {messages.length ? (
                messages.map((m) => (
                  <p
                    key={m.id}
                    style={m.role === "assistant" ? captionAgentLineStyle : captionVisitorLineStyle}
                  >
                    {linkify(displayText(m.text), captionLinkStyle)}
                  </p>
                ))
              ) : (
                <p style={captionAgentLineStyle}>{transcript}</p>
              )}
            </div>
          ) : null}

          {audioBlocked ? (
            <button type="button" style={enableSoundStyle}
              onClick={() => {
                void sessionRef.current?.startAudio().then((ok) => setAudioBlocked(!ok));
              }}
            >
              Enable sound
            </button>
          ) : null}

          <div style={controlsRowStyle}>
            <button
              type="button"
              aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
              aria-pressed={!micOn}
              disabled={!isConnected}
              onClick={toggleMic}
              style={{
                ...roundButtonStyle,
                background: !isConnected ? "rgba(107,114,128,0.85)" : micOn ? "#16a34a" : "#dc2626",
                cursor: isConnected ? "pointer" : "default",
                // Speaking is the avatar's turn, not the visitor's -- the
                // ring is the only place that distinction is visible at a
                // glance.
                boxShadow: isSpeaking ? "0 0 0 6px rgba(22,163,74,0.22)" : "0 4px 12px rgba(0,0,0,0.35)",
              }}
            >
              {micOn ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" fill="#fff" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" fill="#fff" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </button>

            {/* Start and end are the same control, the way a phone works:
                green to call, red to hang up, in one place the visitor is
                already looking. */}
            <button
              type="button"
              aria-label={isConnected ? "End call" : "Start call"}
              disabled={busy || status === "busy"}
              onClick={() => (isConnected ? void endSession("visitor_closed") : void connect())}
              title={callTitle}
              style={{
                ...roundButtonStyle,
                background: isConnected ? "#dc2626" : busy ? "#d97706" : "#16a34a",
                opacity: busy || status === "busy" ? 0.75 : 1,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                style={{ transform: isConnected ? "rotate(135deg)" : "none" }}>
                <path
                  d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
                  fill="#fff"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- frameless ------------------------------------------------------------
// Nothing here paints a background: the host page shows through everywhere
// the avatar and these two surfaces are not.
const framelessShellStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100vh",
  background: "transparent",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  overflow: "hidden",
};

const framelessStageStyle: React.CSSProperties = {
  position: "absolute",
  right: 0,
  bottom: 0,
  height: "100%",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "flex-end",
  pointerEvents: "none",
};

const framelessCanvasStyle: React.CSSProperties = {
  height: "100%",
  // Pinned, not auto: the canvas's own backing buffer is whatever the
  // current source is -- square (1152x1152) for the idle still, portrait
  // (768x1152) for Anam's live render -- and at width:auto the CSS box
  // followed that shape directly, so the instant a session connected the
  // whole box changed width and she visibly jumped sideways. aspectRatio
  // fixes the box to the live render's own shape regardless of which
  // source is actually drawn; objectFit:cover then fills that fixed box
  // from either source without distorting it, cropping the idle still's
  // extra width the same way object-fit already does for the panel
  // widget's video element.
  aspectRatio: "768 / 1152",
  objectFit: "cover",
  display: "block",
  // What makes her stand on the page rather than sit on top of it.
  filter: "drop-shadow(0 24px 34px rgba(0,0,0,0.34))",
};

const framelessLeftStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  bottom: 0,
  width: "62%",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 12,
  padding: "0 0 8px 4px",
};

const bubbleStyle: React.CSSProperties = {
  maxWidth: "100%",
  background: "rgba(18,18,20,0.72)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 18,
  padding: "16px 18px",
  boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
};

// The whole conversation, not just the newest reply: it scrolls rather than
// growing the bubble off the page, and never sideways -- a long address has
// to wrap, or it is what produces a horizontal scrollbar.
const bubbleTextStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  maxHeight: 220,
  overflowX: "hidden",
  overflowY: "auto",
  overflowWrap: "anywhere",
};

const bubbleAgentLineStyle: React.CSSProperties = {
  margin: 0,
  color: "#f5f6f7",
  fontSize: 15,
  lineHeight: 1.45,
};

const bubbleVisitorLineStyle: React.CSSProperties = {
  margin: 0,
  color: "rgba(245,246,247,0.62)",
  fontSize: 13,
  lineHeight: 1.45,
  maxWidth: "88%",
  alignSelf: "flex-end",
  textAlign: "right",
};

const bubbleLinkStyle: React.CSSProperties = {
  color: "#93c5fd",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

const transcriptLinkStyle: React.CSSProperties = {
  color: "#2563eb",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

const controlBarStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  background: "rgba(18,18,20,0.72)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 999,
  padding: "8px 12px",
  boxShadow: "0 12px 30px rgba(0,0,0,0.3)",
};

const barButtonStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: "50%",
  border: "none",
  background: "rgba(255,255,255,0.16)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "background 0.15s ease, box-shadow 0.15s ease",
};

const barDividerStyle: React.CSSProperties = {
  width: 1,
  height: 22,
  background: "rgba(255,255,255,0.18)",
};

// Replaces the whole control bar while typing -- same glass surface as
// the bubble above it, so the two read as one system rather than a new
// piece of UI appearing.
const textInputRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  background: "rgba(18,18,20,0.72)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 999,
  padding: "6px 6px 6px 16px",
  boxShadow: "0 12px 30px rgba(0,0,0,0.3)",
};

const textInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "#f5f6f7",
  fontSize: 14,
  fontFamily: "inherit",
};

const textInputCloseStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  border: "none",
  background: "rgba(255,255,255,0.85)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const framelessErrorStyle: React.CSSProperties = {
  margin: 0,
  color: "#fecaca",
  fontSize: 12,
  textShadow: "0 1px 6px rgba(0,0,0,0.6)",
};

const shellStyle: React.CSSProperties = {
  display: "flex",
  height: "100vh",
  background: "#0b0f14",
};

const transcriptPanelStyle: React.CSSProperties = {
  width: TRANSCRIPT_W,
  flexShrink: 0,
  borderRight: "1px solid #eceef0",
  background: "#fafbfc",
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

const transcriptLogStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "16px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  // Older lines fade out at the top instead of being cut by a hard edge,
  // so the column reads as a conversation running off rather than a box
  // with something hidden in it.
  maskImage: "linear-gradient(to bottom, transparent 0, #000 42px)",
  WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 42px)",
};

const agentLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.45,
  color: "#111827",
  maxWidth: "94%",
  alignSelf: "flex-start",
};

const visitorLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.45,
  color: "#8b95a1",
  maxWidth: "88%",
  alignSelf: "flex-end",
  textAlign: "right",
};

const panelStyle: React.CSSProperties = {
  position: "relative",
  flex: 1,
  minWidth: 0,
  height: "100vh",
  overflow: "hidden",
  background: "#0b0f14",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const videoLayerStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
};

// Chrome floats over live video, so it carries its own contrast rather than
// trusting whatever the avatar is standing in front of.
const topScrimStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  paddingBottom: 18,
  background: "linear-gradient(to bottom, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.28) 58%, transparent 100%)",
  pointerEvents: "none",
};

const bottomScrimStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  paddingTop: 28,
  background: "linear-gradient(to top, rgba(0,0,0,0.66) 0%, rgba(0,0,0,0.3) 55%, transparent 100%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  pointerEvents: "none",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px 0",
  pointerEvents: "auto",
};

const brandStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#ffffff",
  textShadow: "0 1px 6px rgba(0,0,0,0.5)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const windowControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  flexShrink: 0,
  pointerEvents: "auto",
};

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "rgba(0,0,0,0.32)",
  color: "#ffffff",
  borderRadius: 8,
  cursor: "pointer",
  padding: 0,
  backdropFilter: "blur(4px)",
};

const statusRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px 0",
  pointerEvents: "auto",
};

const statusLeftStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.09em",
  color: "#ffffff",
  textShadow: "0 1px 6px rgba(0,0,0,0.5)",
};

const statusDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  display: "inline-block",
  boxShadow: "0 0 0 2px rgba(0,0,0,0.25)",
};

const shareButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.35)",
  background: "rgba(0,0,0,0.32)",
  borderRadius: 999,
  padding: "5px 13px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#ffffff",
  cursor: "pointer",
  backdropFilter: "blur(4px)",
};

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: 14,
  padding: "2px 0 16px",
  pointerEvents: "auto",
};

const roundButtonStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  border: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "box-shadow 0.15s ease, background 0.15s ease",
  boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
};

// The narrow-panel caption: every line, scrollable. The scrim around it is
// pointer-transparent so the video underneath stays clickable, which means
// the scroller itself has to opt back in or it could not be scrolled.
const captionLogStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: "calc(100% - 32px)",
  maxHeight: 96,
  overflowX: "hidden",
  overflowY: "auto",
  overflowWrap: "anywhere",
  pointerEvents: "auto",
  textShadow: "0 1px 6px rgba(0,0,0,0.65)",
};

const captionAgentLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.4,
  color: "#f3f4f6",
  textAlign: "center",
};

const captionVisitorLineStyle: React.CSSProperties = {
  ...captionAgentLineStyle,
  color: "rgba(243,244,246,0.62)",
};

const captionLinkStyle: React.CSSProperties = {
  color: "#93c5fd",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#fecaca",
  textAlign: "center",
  margin: "0 16px",
  textShadow: "0 1px 6px rgba(0,0,0,0.65)",
};

const enableSoundStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.45)",
  background: "rgba(0,0,0,0.38)",
  color: "#ffffff",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  pointerEvents: "auto",
};

