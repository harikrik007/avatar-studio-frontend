"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Track, type RemoteTrack } from "livekit-client";
import { LiveKitFace } from "@/components/livekit-face";
import { GreenScreenCanvas } from "@/components/green-screen-canvas";
import { AvatarSession, type AvatarToolCall, type ClientToolCall } from "@/lib/avatar-session";

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
  /** The shape the agent's owner chose (the builder's Display mode): the portrait card / figure, or the landscape one. Also
   * decides which render the session asks for, so the picture fills the shape it is shown in. */
  orientation?: "portrait" | "landscape";
  /** "Powered by Immilearn" at the bottom of the widget, a link to immilearn.com. On unless the owner turned it off (builder,
   * Embed tab). */
  showBranding?: boolean;
  origin?: string;
  previewVideoUrl?: string | null;
  previewImageUrl?: string | null;
};

type Message = { id: number; role: "assistant" | "user" | "system"; text: string; at: number };

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
// The landscape card: the 1152x768 render's own 3:2 at the frame's height (public/widget.js PANEL_W_LANDSCAPE, which must match).
const CARD_W_LANDSCAPE = 540;
const TRANSCRIPT_W = 280;
// Room for the transcript column = the card plus at least this much: 560 px for the portrait card, as it always was.
const TRANSCRIPT_MIN_PX = 220;

export function EmbedWidget({ publicKey, accentColor, greetingLabel, agentName, transparent, orientation = "portrait", showBranding = true, origin, previewVideoUrl, previewImageUrl }: Props) {
  const landscape = orientation === "landscape";
  const cardW = landscape ? CARD_W_LANDSCAPE : CARD_W;
  // Frameless only: her outline's right edge in the idle still, to stand her exactly where the closed bubble did.
  const silhouette = useStillSilhouette(transparent ? previewImageUrl : null);
  // The box follows what is being drawn: the idle still (landscape) stands exactly where the closed bubble had her, in either
  // orientation; a portrait render, once it arrives, gets the portrait box -- the two line up (framelessCanvasFor), so nothing moves.
  const [drawingPortrait, setDrawingPortrait] = useState(false);
  const framelessCanvas = framelessCanvasFor(landscape || !drawingPortrait, silhouette);
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
  // Frameless only: on a phone the chat column has nowhere to go but over
  // her face, so the visitor can put it away.
  const [chatHidden, setChatHidden] = useState(false);
  const messageSeqRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const bubbleTextRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);
  // From the moment the call connects, not from the first words: the frame is widened for this column at connect, and an empty
  // column for the second before the greeting is better than the card stretched across the whole widened frame, cropping her.
  const showTranscript = hasRoom && (messages.length > 0 || status === "listening");

  const sessionRef = useRef<AvatarSession | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const endingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoConnectStartedRef = useRef(false);
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
    const measure = () => setHasRoom(window.innerWidth >= cardW + TRANSCRIPT_MIN_PX);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [cardW]);

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
    // chatHidden: re-showing the bubble mounts a fresh scroller at the top.
  }, [messages, chatHidden]);

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

  function appendSystemNotice(text: string) {
    setMessages((prev) => {
      messageSeqRef.current += 1;
      return [...prev, { id: messageSeqRef.current, role: "system", text, at: Date.now() }];
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

  async function endSession(reason: "visitor_closed" | "idle_timeout" | "hard_timeout" | "agent_ended") {
    if (endingRef.current) return;
    endingRef.current = true;
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

    const notice = reason === "idle_timeout"
      ? "Disconnected due to inactivity. Tap start to talk again."
      : reason === "hard_timeout"
        ? "This conversation reached its time limit. Tap start for a new one."
        : reason === "agent_ended"
          ? "Call ended. Tap start to talk again."
          : null;
    if (notice) {
      appendSystemNotice(notice);
      setChatHidden(false);
    }
    // Keep the panel's transcript column visible when it holds an ending
    // notice; manual hang-up still returns to the compact card.
    if (!transparent && !notice) askHost("resize", { width: cardW });
    setStatus(notice ? "ended" : "idle");
    setTranscript(notice ?? greetingLabel);

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

  }

  /** Client tools run in the host page: widget.js holds the handlers the
   * page registered (AvatarStudio.registerToolHandler) and posts the result
   * back. Only the arguments travel to the page, and only to the origin this
   * widget was opened on. */
  function handleClientToolCall(call: ClientToolCall) {
    const session = sessionRef.current;
    if (!session) return;
    if (window.parent === window) {
      // opened directly, not embedded: there is no page to run it
      session.sendClientToolResult(call.id, { error: `no handler registered for ${call.name}` });
      return;
    }
    try {
      window.parent.postMessage(
        {
          source: "avatar-studio-widget",
          type: "client_tool_call",
          callId: call.id,
          toolName: call.name,
          arguments: call.args,
          awaitResult: call.awaitResult,
        },
        origin || "*"
      );
    } catch {
      session.sendClientToolResult(call.id, { error: "Could not reach the page to run this tool." });
    }
  }

  // The page's answer to a client tool call (see handleClientToolCall).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      if (origin && event.origin !== origin) return;
      const data = event.data as { source?: string; type?: string; callId?: string; result?: unknown; error?: unknown };
      if (!data || data.source !== "avatar-studio-host" || data.type !== "client_tool_result" || !data.callId) return;
      sessionRef.current?.sendClientToolResult(
        data.callId,
        data.error !== undefined && data.error !== null ? { error: String(data.error) } : { result: data.result }
      );
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

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

    endingRef.current = false;
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
          onClientToolCall: handleClientToolCall,
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
          onSessionEnded: (reason) => {
            if (reason === "idle_timeout") void endSession("idle_timeout");
            // the agent hung up (its end_call tool) after saying goodbye
            else if (reason === "end_call") void endSession("agent_ended");
          },
          onDisconnected: () => {
            void endSession("visitor_closed");
          },
          onError: (message) => {
            setStatus("error");
            setErrorMessage(message);
          },
        },
        {
          sessionUrl: "/api/embed/session",
          // The render of the shape the owner chose: landscape is the idle still's own shape, with the shoulders whole; portrait is
          // 768 px wide and fills the portrait card (or figure). Said explicitly, though the backend would pick the same from the agent.
          sessionBody: { public_key: publicKey, origin, frame: landscape ? "wide" : "portrait" },
        }
      );

      setMessages([]);
      // Same reasoning as the shrink on hang-up below: this widens the host
      // box for the panel's side transcript, and frameless does not have
      // one -- asking anyway squeezed its fixed-width layout down to 620px
      // on every connect, which is what cropped the avatar and left the
      // reply bubble too narrow not to scroll.
      if (!transparent) askHost("resize", { width: cardW + TRANSCRIPT_W });
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

  // widget.js creates this iframe lazily when the visitor clicks the small
  // avatar and adds autoConnect=1 to that route. Once the availability check
  // has completed, treat that original launcher click as the call action too.
  // A directly opened /embed/[key] page has no flag and keeps its Start button.
  useEffect(() => {
    if (status !== "idle" || autoConnectStartedRef.current) return;
    if (new URLSearchParams(window.location.search).get("autoConnect") !== "1") return;

    autoConnectStartedRef.current = true;
    void connect();
    // connect intentionally uses the latest render state; status is the gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

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
            style={framelessCanvas}
            onSourceSize={(w, h) => setDrawingPortrait(h > w)}
          />
        </div>

        <div style={framelessLeftStyle}>
          {!chatHidden && (messages.length || !isConnected) ? (
            <div style={bubbleStyle}>
              <div ref={bubbleTextRef} className="hide-scrollbar" style={bubbleTextStyle}>
                {messages.length ? (
                  messages.map((m) => (
                    <p
                      key={m.id}
                      style={m.role === "system" ? bubbleSystemLineStyle : m.role === "assistant" ? bubbleAgentLineStyle : bubbleVisitorLineStyle}
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

            <button
              type="button"
              aria-label={chatHidden ? "Show chat" : "Hide chat"}
              aria-pressed={chatHidden}
              title={chatHidden ? "Show chat" : "Hide chat"}
              onClick={() => setChatHidden((v) => !v)}
              style={barButtonStyle}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 5h16v11H8.5L4 20V5z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
                {chatHidden ? (
                  <path d="M3 3l18 18" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                ) : null}
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

            {/* Only when something follows it: on a live call with the extra
                controls folded away there is nothing to divide from. */}
            {!isConnected || controlsExpanded || audioBlocked ? <span style={barDividerStyle} /> : null}

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

            {/* Not during a call: closing here would drop it without the
                visitor having chosen to hang up. The call button is the way
                out while connected, and close comes back once it ends. */}
            {!isConnected ? (
              <button type="button" aria-label="Close" style={barButtonStyle}
                onClick={() => { void endSession("visitor_closed"); askHost("close"); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5l14 14M19 5L5 19" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
          </div>
          )}

          {errorMessage ? <p style={framelessErrorStyle}>{errorMessage}</p> : null}
          {showBranding ? <PoweredBy style={brandFramelessStyle} /> : null}
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
                style={m.role === "system" ? systemLineStyle : m.role === "assistant" ? agentLineStyle : visitorLineStyle}
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
          {(isConnected || status === "ended") && !showTranscript && (messages.length || transcript) ? (
            <div ref={captionRef} className="hide-scrollbar" style={captionLogStyle}>
              {messages.length ? (
                messages.map((m) => (
                  <p
                    key={m.id}
                    style={m.role === "system" ? captionSystemLineStyle : m.role === "assistant" ? captionAgentLineStyle : captionVisitorLineStyle}
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
          {showBranding ? <PoweredBy style={brandPanelStyle} /> : null}
        </div>
      </div>
    </div>
  );
}

// --- "Powered by Immilearn" ---------------------------------------------------
// One small line at the bottom of the open widget. The tags say where a visit came from in Immilearn's own analytics.
const BRAND_URL = "https://immilearn.com/?utm_source=avatar-widget&utm_medium=powered-by";

function PoweredBy({ style }: { style: React.CSSProperties }) {
  return (
    <a href={BRAND_URL} target="_blank" rel="noopener noreferrer" style={style} aria-label="Powered by Immilearn (opens in a new tab)">
      Powered by <strong style={{ fontWeight: 600, color: "#ffffff" }}>Immilearn</strong>
    </a>
  );
}

// Under the call buttons, on the card's dark bottom gradient. The scrim ignores the pointer (so the face stays clickable through
// it); the link takes it back.
const brandPanelStyle: React.CSSProperties = {
  pointerEvents: "auto",
  margin: "-8px 0 10px",
  fontSize: 11,
  lineHeight: 1.3,
  letterSpacing: 0.2,
  color: "rgba(255,255,255,0.72)",
  textDecoration: "none",
};

// Frameless: the customer's page can be any colour, so it sits in the same dark glass as the bubble and the control bar.
const brandFramelessStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  borderRadius: 999,
  background: "rgba(18,18,20,0.72)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.10)",
  color: "rgba(255,255,255,0.78)",
  fontSize: 11,
  lineHeight: 1.3,
  letterSpacing: 0.2,
  textDecoration: "none",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

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

// Frameless: she is drawn at exactly the size and in exactly the place the closed bubble shows her (public/widget.js), so opening the
// widget, the idle picture and the live call are one and the same figure. The bubble draws the keyed still as if the whole picture
// were CLOSED_FRAMELESS_H tall, cropped to her outline, her rightmost pixel on the page's edge and the picture's bottom on the page's
// bottom. FRAMELESS_FIGURE_H must equal widget.js's CLOSED_FRAMELESS_H.
// Two thirds of the 350 px frame: her size while connected, which Hari chose for both states (2026-10-08).
const FRAMELESS_FIGURE_H = (350 * 2) / 3;
// How Anam's portrait render (768x1152) holds the 1152x768 still, at the same scale: its middle 768 columns, with 128 rows added
// above her (a third of the extra height) and the rest below. Measured on a live frame 2026-10-08 (194 and 127, within 2 px of this
// rule): results/landing-redesign/live-local/measure_frame_mapping.py. The landscape render is the still itself.
const PORTRAIT_CROP_LEFT = 192;
const PORTRAIT_PAD_TOP = 128;

type Silhouette = { w: number; h: number; maxX: number };

/** Her outline's right edge in the idle still, found exactly as widget.js's keyGreenScreenStill finds it (same green rule, a pixel
 * counts once it keeps more than 32/255 of its opacity) -- the column the bubble puts on the page's edge. */
function silhouetteOf(img: HTMLImageElement): Silhouette | null {
  const MIN_GREEN = 90, GREEN_BIAS = 1.15, SOFTNESS = 28;
  const keyRamp = Math.max(8, SOFTNESS * 0.55);
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx || !w || !h) return null;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    let maxX = -1;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
      const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
      const dom = g - Math.max(r, b);
      let alpha = px[i + 3];
      if (g === maxC && g > MIN_GREEN && g > r * GREEN_BIAS && g > b * GREEN_BIAS && sat > 0.08 && dom > 2) {
        alpha = Math.round(alpha * (1 - Math.min(1, Math.max(0, (dom - 2) / keyRamp + (sat - 0.08) * 1.8))));
      }
      if (alpha > 32) {
        const x = (i / 4) % w;
        if (x > maxX) maxX = x;
      }
    }
    return maxX < 0 ? null : { w, h, maxX };
  } catch {
    return null; // an unreadable picture: the default placement below is right for the stock faces
  }
}

function useStillSilhouette(src: string | null | undefined): Silhouette | null {
  const [sil, setSil] = useState<Silhouette | null>(null);
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!cancelled) setSil(silhouetteOf(img));
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return sil;
}

/** The canvas box for the frameless figure. Pinned (not auto): the canvas's backing buffer is whatever is being drawn -- the idle still
 * or the live render -- and a box that followed it would jump when the call connects; objectFit:cover fills the pinned box from either.
 * Its right edge sits on the frame's edge (the stage is right-aligned) and the translate moves it so her rightmost pixel lands there;
 * whatever hangs outside the shell (the empty margin, the portrait render's extra torso below the frame) is clipped. */
function framelessCanvasFor(landscape: boolean, sil: Silhouette | null): React.CSSProperties {
  const w = sil?.w ?? 1152, h = sil?.h ?? 768;
  const maxX = sil?.maxX ?? Math.round(w * 0.838); // the stock faces' right shoulder, until the picture has been read
  const s = FRAMELESS_FIGURE_H / h; // screen px per still px: the bubble's scale
  const base: React.CSSProperties = { objectFit: "cover", display: "block", filter: "drop-shadow(0 24px 34px rgba(0,0,0,0.34))" };
  if (landscape) {
    return { ...base, height: FRAMELESS_FIGURE_H, aspectRatio: `${w} / ${h}`, transform: `translateX(${((w - 1 - maxX) * s).toFixed(2)}px)` };
  }
  const lastColumn = PORTRAIT_CROP_LEFT + 768; // the first still column past the portrait render's right edge
  return {
    ...base,
    height: Math.round(1152 * s * 100) / 100,
    aspectRatio: "768 / 1152",
    transform: `translate(${((lastColumn - 1 - maxX) * s).toFixed(2)}px, ${((1152 - PORTRAIT_PAD_TOP - h) * s).toFixed(2)}px)`,
  };
}

const framelessLeftStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  bottom: 0,
  // Whatever the avatar leaves free, not a fixed share. She herself (not her
  // picture's transparent margins, which the chat may lie over) is about
  // 234 px wide at the bubble's size (see framelessCanvasFor), so 242 px are
  // kept clear -- a flat 62% ran well past the free space on a 760x620 frame
  // and put the chat on top of her. Still capped at 62% for a wide, short
  // frame, and floored so a very narrow one keeps a usable column even though
  // it can no longer avoid her entirely.
  width: "min(62%, max(200px, calc(100% - 242px)))",
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
  // Bubble + control bar have to fit the 310px frameless frame (widget.js).
  maxHeight: 170,
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

const bubbleSystemLineStyle: React.CSSProperties = {
  ...bubbleAgentLineStyle,
  color: "#ffffff",
  background: "rgba(255,255,255,0.16)",
  borderRadius: 8,
  padding: "8px 10px",
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

const systemLineStyle: React.CSSProperties = {
  ...agentLineStyle,
  color: "#374151",
  background: "#eef2f7",
  borderRadius: 8,
  padding: "8px 10px",
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

const captionSystemLineStyle: React.CSSProperties = {
  ...captionAgentLineStyle,
  color: "#ffffff",
  background: "rgba(0,0,0,0.45)",
  borderRadius: 8,
  padding: "8px 10px",
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

