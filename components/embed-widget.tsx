"use client";

import { useEffect, useRef, useState } from "react";
import { Track, type RemoteTrack } from "livekit-client";
import { LiveKitFace } from "@/components/livekit-face";
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
  origin?: string;
  previewVideoUrl?: string | null;
  previewImageUrl?: string | null;
};

type Message = { id: number; role: "assistant" | "user"; text: string; at: number };

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

export function EmbedWidget({ publicKey, accentColor, greetingLabel, agentName, origin, previewVideoUrl, previewImageUrl }: Props) {
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
  const messageSeqRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);

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

    askHost("resize", { width: CARD_W });
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
      askHost("resize", { width: CARD_W + TRANSCRIPT_W });
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

  const showTranscript = hasRoom && messages.length > 0;
  // Without the column, the caption is the only view of the conversation --
  // so it shows the whole last line rather than the newest delta.
  const lastLine = messages.length ? displayText(messages[messages.length - 1].text) : "";

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
                {displayText(m.text)}
              </p>
            ))}
          </div>
        </aside>
      ) : null}

      <div style={panelStyle}>
      <header style={headerStyle}>
        <span style={{ ...brandStyle, color: accentColor }}>{agentName || "Avatar"}</span>
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
          <button type="button" aria-label="Close" style={{ ...iconButtonStyle, color: "#dc2626" }}
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

      <div style={stageWrapStyle}>
        <div style={stageStyle}>
          <LiveKitFace
            videoTrack={videoTrack}
            audioTrack={audioTrack}
            isConnected={isConnected}
            width={STAGE_W}
            height={STAGE_H}
            idleVideoSrc={previewVideoUrl ?? undefined}
            idleImageSrc={previewImageUrl ?? null}
          />
          <button
            type="button"
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
            aria-pressed={!micOn}
            disabled={!isConnected}
            onClick={toggleMic}
            style={{
              ...micButtonStyle,
              background: !isConnected ? "#9ca3af" : micOn ? "#16a34a" : "#dc2626",
              // Speaking is the avatar's turn, not the visitor's -- the ring
              // is the only place that distinction is visible at a glance.
              boxShadow: isSpeaking ? "0 0 0 6px rgba(22,163,74,0.22)" : "0 4px 12px rgba(0,0,0,0.25)",
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
        </div>
      </div>

      {/* The last line, for when there is no room for the column beside the
          card (a phone). Without either, a visitor who cannot hear has no
          way to follow the conversation at all. */}
      {isConnected && !showTranscript && (lastLine || transcript) ? (
        <p style={transcriptStyle}>{lastLine || transcript}</p>
      ) : null}

      {audioBlocked ? (
        <button
          type="button"
          style={{ ...secondaryButtonStyle, borderColor: accentColor, color: accentColor }}
          onClick={() => {
            void sessionRef.current?.startAudio().then((ok) => setAudioBlocked(!ok));
          }}
        >
          Enable sound
        </button>
      ) : null}

      {errorMessage ? <p style={errorStyle}>{errorMessage}</p> : null}

      <button
        type="button"
        style={{ ...connectButtonStyle, opacity: busy ? 0.6 : 1 }}
        disabled={busy || status === "busy"}
        onClick={() => (isConnected ? void endSession("visitor_closed") : void connect())}
      >
        {isConnected
          ? "END CALL"
          : status === "connecting"
            ? "CONNECTING…"
            : status === "checking"
              ? "CHECKING…"
              : status === "busy"
                ? "ALL AGENTS BUSY"
                : "CONNECT"}
      </button>
      </div>
    </div>
  );
}

const STAGE_W = 300;
const STAGE_H = 330;

const shellStyle: React.CSSProperties = {
  display: "flex",
  height: "100vh",
  background: "#ffffff",
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
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  height: "100vh",
  boxSizing: "border-box",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  background: "#ffffff",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
};

const brandStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const windowControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  flexShrink: 0,
};

const iconButtonStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  color: "#374151",
  borderRadius: 6,
  cursor: "pointer",
  padding: 0,
};

const statusRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 14px",
  borderTop: "1px solid #eceef0",
  borderBottom: "1px solid #eceef0",
};

const statusLeftStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#111827",
};

const statusDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  display: "inline-block",
};

const shareButtonStyle: React.CSSProperties = {
  border: "1px solid #e2e5e8",
  background: "#fff",
  borderRadius: 8,
  padding: "6px 14px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  color: "#111827",
  cursor: "pointer",
};

const stageWrapStyle: React.CSSProperties = {
  padding: "14px 14px 8px",
  display: "flex",
  justifyContent: "center",
};

const stageStyle: React.CSSProperties = {
  position: "relative",
  borderRadius: 14,
  overflow: "hidden",
  background: "#e8ece7",
  lineHeight: 0,
};

const micButtonStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 12,
  transform: "translateX(-50%)",
  width: 46,
  height: 46,
  borderRadius: "50%",
  border: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "box-shadow 0.15s ease, background 0.15s ease",
};

const transcriptStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.4,
  color: "#4b5563",
  textAlign: "center",
  margin: "0 14px 4px",
  maxHeight: 34,
  overflow: "hidden",
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#b91c1c",
  textAlign: "center",
  margin: "0 14px 6px",
};

const connectButtonStyle: React.CSSProperties = {
  margin: "auto 14px 16px",
  padding: "15px 16px",
  borderRadius: 999,
  border: "none",
  background: "#0b0b0c",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 800,
  letterSpacing: "0.06em",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 999,
  border: "1px solid",
  background: "transparent",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
