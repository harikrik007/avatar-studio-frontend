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
  origin?: string;
  previewVideoUrl?: string | null;
};

export function EmbedWidget({ publicKey, accentColor, greetingLabel, origin, previewVideoUrl }: Props) {
  const [status, setStatus] = useState<Status>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>(greetingLabel);
  const [videoTrack, setVideoTrack] = useState<RemoteTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<RemoteTrack | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const sessionRef = useRef<AvatarSession | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // sessionStorage guard: one session per browser tab-group, so a single
  // visitor can't hold several of a small, shared concurrency pool open
  // across multiple tabs of the same widget.
  const ownsSessionRef = useRef(false);

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

  return (
    <div style={panelStyle}>
      <div style={{ ...avatarStageStyle, borderColor: accentColor }}>
        <LiveKitFace
          videoTrack={videoTrack}
          audioTrack={audioTrack}
          isConnected={isConnected}
          width={220}
          height={260}
          idleVideoSrc={previewVideoUrl ?? undefined}
        />
        {isSpeaking ? <span style={{ ...speakingDotStyle, background: accentColor }} /> : null}
      </div>

      <p style={transcriptStyle}>{transcript}</p>

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

      <div style={actionsRowStyle}>
        {isConnected ? (
          <button type="button" style={{ ...primaryButtonStyle, background: accentColor }}
            onClick={() => void endSession("visitor_closed")}>
            End conversation
          </button>
        ) : (
          <button
            type="button"
            style={{
              ...primaryButtonStyle,
              background: accentColor,
              opacity: status === "connecting" || status === "checking" ? 0.6 : 1,
            }}
            disabled={status === "connecting" || status === "checking" || status === "busy"}
            onClick={() => void connect()}
          >
            {status === "connecting"
              ? "Connecting…"
              : status === "checking"
                ? "Checking availability…"
                : status === "busy"
                  ? "All agents busy"
                  : "Start talking"}
          </button>
        )}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
  padding: 16,
  height: "100vh",
  boxSizing: "border-box",
  fontFamily: "system-ui, -apple-system, sans-serif",
  background: "#ffffff",
};

const avatarStageStyle: React.CSSProperties = {
  position: "relative",
  borderRadius: 16,
  border: "2px solid",
  overflow: "hidden",
  width: 220,
  height: 260,
  background: "#0b0f14",
};

const speakingDotStyle: React.CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  width: 10,
  height: 10,
  borderRadius: "50%",
};

const transcriptStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.4,
  color: "#1f2937",
  textAlign: "center",
  minHeight: 36,
  margin: 0,
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#b91c1c",
  textAlign: "center",
  margin: 0,
};

const actionsRowStyle: React.CSSProperties = {
  marginTop: "auto",
  width: "100%",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  borderRadius: 999,
  border: "none",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 600,
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
