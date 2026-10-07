"use client";

/**
 * The live avatar at the top of the landing page.
 *
 * The avatar stands on the page with no box around it (the green screen is keyed out; the bottom fades into the background), with one
 * "Talk to Maya" button. When the visitor scrolls on, the same avatar docks small in the bottom-right corner and keeps working there: a
 * call started from either place continues in the other. The tabs are the personas published in the admin dashboard (labelled by job; no
 * tabs when there is one). A face that is not a green-screen one is shown in a rounded card instead.
 *
 * The calling code (LiveKit) is loaded when the visitor first reaches for the button, not with the page.
 *
 * States: idle, checking, connecting, live, queued (all seats taken), error, ended. When no persona is published (or the backend cannot
 * be reached) the hero shows a resting card that points at the builder and there is no dock.
 *
 * Other parts of the page start a call by dispatching `landing:talk` (optionally { key } to pick a persona). It starts where the visitor
 * is looking: in the hero when it is on screen, in the dock when it is not; the page never scrolls for them.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteTrack } from "livekit-client";
import type { AvatarSession } from "@/lib/avatar-session";
import { GreenScreenCanvas } from "@/components/green-screen-canvas";
import type { LandingPersona } from "@/lib/personas";

type Status = "idle" | "checking" | "connecting" | "live" | "queued" | "error" | "ended";
type EndReason = "visitor_closed" | "idle_timeout" | "hard_timeout" | "agent_ended";
type Line = { id: number; role: "assistant" | "user"; text: string; at: number };

// A visitor who opens the demo and wanders off must not hold one of a small, shared pool of seats.
const IDLE_TIMEOUT_MS = 90_000;
// A marketing demo does not need a long conversation to prove quality, and a short, predictable cap is what makes the queue move.
const DEMO_LIMIT_MS = 3 * 60_000;
const WARNING_MS = 30_000;
const QUEUE_POLL_MS = 4_000;
// Transcripts arrive as small deltas; chunks from the same speaker this close together are one sentence still being said.
const CHUNK_MERGE_MS = 2_500;
const DOCK_OFF_KEY = "lh-dock-off";

const stillOf = (p: LandingPersona) => `/api/embed/still/${encodeURIComponent(p.key)}`;
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function friendlyError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "NotAllowedError" || /permission|denied|not allowed/i.test(message)) {
    return "Your browser blocked the microphone. Click the lock icon in the address bar, allow the microphone, then try again.";
  }
  if (name === "NotFoundError" || /requested device not found|no .*(microphone|device)/i.test(message)) {
    return "We could not find a microphone. Plug one in or check your system settings, then try again.";
  }
  return message || "We could not start the call. Please try again.";
}

export default function HeroCall({ personas }: { personas: LandingPersona[] }) {
  const [selectedKey, setSelectedKey] = useState(personas[0]?.key ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [videoTrack, setVideoTrack] = useState<RemoteTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<RemoteTrack | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [remaining, setRemaining] = useState(DEMO_LIMIT_MS);
  const [endNote, setEndNote] = useState<string | null>(null);
  const [heroReady, setHeroReady] = useState(false);
  const [dockReady, setDockReady] = useState(false);
  const [scrolledPast, setScrolledPast] = useState(false);
  const [dockHidden, setDockHidden] = useState(false);

  const persona = personas.find((p) => p.key === selectedKey) ?? personas[0];
  const sessionRef = useRef<AvatarSession | null>(null);
  const roomRef = useRef<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const endingRef = useRef(false);
  const startedAtRef = useRef(0);
  const seqRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const loadSession = useRef<Promise<typeof import("@/lib/avatar-session")> | null>(null);

  const prefetch = useCallback(() => {
    // The calling code starts downloading as soon as the visitor reaches for the button.
    loadSession.current ??= import("@/lib/avatar-session");
    return loadSession.current;
  }, []);

  function clearTimers() {
    for (const t of [idleTimerRef, hardTimerRef]) {
      if (t.current) clearTimeout(t.current);
      t.current = null;
    }
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }
  function clearQueue() {
    if (queueRef.current) clearInterval(queueRef.current);
    queueRef.current = null;
  }
  function armIdle() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => void endSession("idle_timeout"), IDLE_TIMEOUT_MS);
  }

  function addLine(role: "assistant" | "user", text: string) {
    if (!text) return;
    setLines((prev) => {
      const last = prev[prev.length - 1];
      const now = Date.now();
      // Concatenated verbatim: the word breaks live in the deltas themselves (" I'm", " Riya"). Tidied once, at render.
      if (last && last.role === role && now - last.at < CHUNK_MERGE_MS) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text, at: now }];
      }
      if (!text.trim()) return prev;
      seqRef.current += 1;
      return [...prev, { id: seqRef.current, role, text, at: now }].slice(-6);
    });
  }

  async function endSession(reason: EndReason, uiStatus: Status = "ended", note?: string) {
    if (endingRef.current) return;
    endingRef.current = true;
    clearTimers();
    clearQueue();
    const key = keyRef.current;
    const room = roomRef.current;
    sessionRef.current?.close();
    sessionRef.current = null;
    roomRef.current = null;
    keyRef.current = null;
    setVideoTrack(null);
    setAudioTrack(null);
    setSpeaking(false);
    setAudioBlocked(false);
    setEndNote(
      note ??
        (reason === "hard_timeout"
          ? "That was the three-minute demo limit."
          : reason === "idle_timeout"
            ? "The call ended because it went quiet."
            : null)
    );
    setStatus(uiStatus);
    if (room && key) {
      try {
        await fetch("/api/embed/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_key: key, room, reason }),
        });
      } catch {
        // Best effort: the control plane's own empty-room monitor reaps the room regardless.
      }
    }
    endingRef.current = false;
  }

  // Leaving the page ends the call.
  useEffect(() => {
    return () => {
      clearTimers();
      clearQueue();
      if (sessionRef.current) {
        sessionRef.current.close();
        const key = keyRef.current;
        const room = roomRef.current;
        if (key && room) {
          void fetch("/api/embed/session", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ public_key: key, room, reason: "visitor_closed" }),
            keepalive: true,
          }).catch(() => undefined);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The dock appears once the hero avatar has scrolled out of view, and goes away when it comes back.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(DOCK_OFF_KEY) === "1") setDockHidden(true);
    } catch {
      /* storage blocked: the dock simply stays available */
    }
    const zone = zoneRef.current;
    if (!zone) return;
    const io = new IntersectionObserver(([entry]) => setScrolledPast(entry.intersectionRatio < 0.15), {
      threshold: [0, 0.15, 0.5, 1],
      rootMargin: "-72px 0px 0px 0px", // the sticky header
    });
    io.observe(zone);
    return () => io.disconnect();
  }, [persona?.key]);

  async function connect(p: LandingPersona) {
    setStatus("connecting");
    setLines([]);
    setEndNote(null);
    const { AvatarSession } = await prefetch();
    const session = await AvatarSession.connect(
      {
        // A persona's own tools run on the server. A tool that wants this page has no handler here: say so, never silence.
        onToolCall: (calls) =>
          sessionRef.current?.sendToolResponse({
            functionResponses: calls.map((c) => ({ id: c.id, name: c.name, response: { success: false, error: "Not available in this demo." } })),
          }),
        onTranscript: (role, text) => {
          armIdle();
          addLine(role, text);
        },
        onSpeakingChange: (s) => {
          armIdle();
          setSpeaking(s);
        },
        onTrack: (track) => {
          if ((track.kind as string) === "video") setVideoTrack(track);
          else if ((track.kind as string) === "audio") setAudioTrack(track);
        },
        onAudioBlocked: setAudioBlocked,
        onSessionEnded: (reason) => {
          if (!sessionRef.current) return;
          if (reason === "idle_timeout") void endSession("idle_timeout");
          else if (reason === "end_call") void endSession("agent_ended");
        },
        onDisconnected: () => {
          if (sessionRef.current) void endSession("visitor_closed");
        },
        onError: (message) => {
          setError(friendlyError(new Error(message)));
          if (sessionRef.current) void endSession("visitor_closed", "error");
          else setStatus("error");
        },
      },
      { sessionUrl: "/api/embed/session", sessionBody: { public_key: p.key, origin: window.location.origin } }
    );
    sessionRef.current = session;
    roomRef.current = session.room.name;
    keyRef.current = p.key;
    setAudioBlocked(!session.canPlaybackAudio);
    setStatus("live");
    startedAtRef.current = Date.now();
    setRemaining(DEMO_LIMIT_MS);
    tickRef.current = setInterval(() => setRemaining(Math.max(0, DEMO_LIMIT_MS - (Date.now() - startedAtRef.current))), 500);
    armIdle();
    hardTimerRef.current = setTimeout(() => void endSession("hard_timeout"), DEMO_LIMIT_MS);
  }

  function enterQueue(p: LandingPersona) {
    setStatus("queued");
    clearQueue();
    queueRef.current = setInterval(async () => {
      try {
        const cap = (await (await fetch(`/api/embed/capacity/${encodeURIComponent(p.key)}`)).json()) as { available?: boolean };
        if (cap.available === false) return;
        clearQueue();
        try {
          await connect(p);
        } catch {
          enterQueue(p); // lost the race to another visitor between the poll and the connect
        }
      } catch {
        // a network hiccup: keep polling
      }
    }, QUEUE_POLL_MS);
  }

  const start = useCallback(async (p: LandingPersona | undefined) => {
    if (!p || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setEndNote(null);
    setStatus("checking");
    void prefetch();
    try {
      try {
        const cap = (await (await fetch(`/api/embed/capacity/${encodeURIComponent(p.key)}`)).json()) as { available?: boolean };
        if (cap.available === false) {
          enterQueue(p);
          return;
        }
      } catch {
        // Fail open on the display check: the real gate is on the server, in connect().
      }
      try {
        await connect(p);
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        if (/busy|capacity/i.test(message)) enterQueue(p);
        else {
          setError(friendlyError(e));
          setStatus("error");
        }
      }
    } finally {
      busyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Talk to Maya" elsewhere on the page (the hero text, a use case, the closing call) comes in as an event.
  const startRef = useRef(start);
  startRef.current = start;
  const statusRef = useRef(status);
  statusRef.current = status;
  const personasRef = useRef(personas);
  personasRef.current = personas;
  useEffect(() => {
    function onTalk(e: Event) {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      const target = personasRef.current.find((p) => p.key === key) ?? personasRef.current.find((p) => p.key === keyRef.current) ?? personasRef.current[0];
      if (["live", "checking", "connecting", "queued"].includes(statusRef.current)) return; // a call is already under way
      if (target) {
        setSelectedKey(target.key);
        setDockHidden(false);
        void startRef.current(target);
      }
    }
    window.addEventListener("landing:talk", onTalk);
    return () => window.removeEventListener("landing:talk", onTalk);
  }, []);

  async function choose(key: string) {
    if (key === selectedKey) return;
    if (status === "live") await endSession("visitor_closed", "idle");
    clearQueue();
    setSelectedKey(key);
    setHeroReady(false);
    setDockReady(false);
    setStatus("idle");
    setError(null);
    setEndNote(null);
  }

  function hideDock() {
    setDockHidden(true);
    try {
      sessionStorage.setItem(DOCK_OFF_KEY, "1");
    } catch {
      /* fine: it comes back on the next visit */
    }
  }

  // ---- no persona published (or the backend is unreachable): a resting card that points at the builder
  if (!persona) {
    return (
      <div className="lh-call" id="lh-call">
        <div className="lh-stage lh-stage-boxed lh-stage-rest" ref={zoneRef}>
          <div className="lh-rest">
            <span className="lh-rest-dot" aria-hidden="true" />
            <h2>Our demo agent is resting</h2>
            <p>Build your own virtual human and talk to it in a few minutes.</p>
            <Link href="/dashboardv2" className="l-btn l-btn-primary">
              Build yours free
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const live = status === "live";
  const warning = live && remaining <= WARNING_MS;
  const busy = status === "checking" || status === "connecting";
  const active = live || busy || status === "queued";
  const showDock = scrolledPast && (!dockHidden || active || status === "ended");
  const boxed = !persona.greenScreen;
  const buttonLabel = status === "checking" ? "Checking…" : status === "connecting" ? "Connecting…" : status === "error" ? "Try again" : `Talk to ${persona.name}`;
  const shown = lines.slice(-2);

  /** What sits over the avatar's feet: the Talk button, or the live captions and End call, or the end-of-call / queue message. */
  function controls(variant: "hero" | "dock") {
    const dock = variant === "dock";
    if (status === "ended") {
      return (
        <div className="lh-glass lh-ended" role="status">
          <strong>That was {persona.name}.</strong>
          <span>{endNote ?? (dock ? "Build one like this for your site." : "Build a virtual human like this for your own website.")}</span>
          <div className="lh-ended-actions">
            <Link href="/dashboardv2" className="l-btn l-btn-primary">
              Build yours free
            </Link>
            <button type="button" className="l-btn l-btn-ghost" onClick={() => void start(persona)}>
              Talk again
            </button>
          </div>
        </div>
      );
    }
    if (status === "queued") {
      return (
        <div className="lh-glass lh-ended" role="status">
          <strong>All of {persona.name}&apos;s lines are busy.</strong>
          <span>You are in the queue. The call starts as soon as a line frees up.</span>
          <div className="lh-ended-actions">
            <button
              type="button"
              className="l-btn l-btn-ghost"
              onClick={() => {
                clearQueue();
                setStatus("idle");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }
    if (live) {
      return (
        <>
          <div className="lh-glass lh-captions" aria-live="polite" aria-label="Live captions">
            {shown.length ? (
              shown.map((l) => (
                <p key={l.id} className={l.role === "user" ? "lh-cap-user" : "lh-cap-agent"}>
                  <b>{l.role === "user" ? "You" : persona.name}</b> {l.text.replace(/\s+/g, " ").trim()}
                </p>
              ))
            ) : (
              <p className="lh-cap-agent">Say hello to {persona.name}.</p>
            )}
          </div>
          <button type="button" className="l-btn lh-end" onClick={() => void endSession("visitor_closed")}>
            End call
          </button>
        </>
      );
    }
    return (
      <>
        {error ? (
          <p className="lh-glass lh-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="l-btn l-btn-primary lh-talk"
          disabled={busy}
          onPointerEnter={() => void prefetch()}
          onFocus={() => void prefetch()}
          onClick={() => void start(persona)}
        >
          {busy ? <span className="lh-spin" aria-hidden="true" /> : <MicIcon />}
          {buttonLabel}
        </button>
      </>
    );
  }

  const soundButton =
    audioBlocked && live ? (
      <button type="button" className="lh-sound" onClick={() => void sessionRef.current?.startAudio().then((ok) => setAudioBlocked(!ok))}>
        Turn sound on
      </button>
    ) : null;

  return (
    <div className="lh-call" id="lh-call" data-status={status}>
      {personas.length > 1 ? (
        <div className="lh-tabs" role="tablist" aria-label="Choose who to talk to">
          {personas.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={p.key === persona.key}
              className={`lh-tab${p.key === persona.key ? " lh-tab-on" : ""}`}
              onClick={() => void choose(p.key)}
            >
              {p.role || p.name}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={zoneRef}
        className={`lh-stage ${boxed ? "lh-stage-boxed" : "lh-stage-free"}${speaking ? " lh-stage-speaking" : ""}${live ? " lh-stage-live" : ""}${heroReady || boxed ? " lh-face-ready" : ""}`}
      >
        {boxed ? null : <div className="lh-glow" aria-hidden="true" />}
        {showDock ? null : <Face persona={persona} videoTrack={live ? videoTrack : null} audioTrack={audioTrack} onReady={() => setHeroReady(true)} />}

        <div className="lh-badge">
          <span className={`lh-live-dot${live ? " lh-live-dot-on" : ""}`} aria-hidden="true" />
          <span>
            <strong>{persona.name}</strong>
            {persona.role ? <small>{persona.role}</small> : null}
          </span>
        </div>

        {live && !showDock ? (
          <div className={`lh-timer${warning ? " lh-timer-warn" : ""}`} aria-live="off">
            {warning ? `Ending in ${clock(remaining)}` : `${clock(remaining)} left`}
          </div>
        ) : null}
        {showDock ? null : soundButton}

        {showDock ? null : <div className="lh-bottom">{controls("hero")}</div>}
      </div>

      <p className="lh-call-note">
        {persona.blurb ? <>{persona.blurb} </> : null}
        Your browser will ask to use your microphone. The demo lasts up to three minutes.
      </p>

      {showDock ? (
        <div className={`lh-dock lh-dock-on${speaking ? " lh-stage-speaking" : ""}${dockReady || boxed ? " lh-face-ready" : ""}${boxed ? " lh-dock-boxed" : ""}`} data-status={status}>
          <div className="lh-dock-glow" aria-hidden="true" />
          <Face persona={persona} videoTrack={live ? videoTrack : null} audioTrack={audioTrack} onReady={() => setDockReady(true)} />
          {live ? (
            <div className={`lh-dock-timer${warning ? " lh-timer-warn" : ""}`} aria-live="off">
              {warning ? `Ending in ${clock(remaining)}` : `${clock(remaining)}`}
            </div>
          ) : null}
          {soundButton}
          <div className="lh-dock-ui">{controls("dock")}</div>
          {!active && status !== "ended" ? (
            <button type="button" className="lh-dock-x" aria-label={`Hide ${persona.name}`} onClick={hideDock}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
    </svg>
  );
}

/** The persona's face: keyed out of its green screen when the avatar has one, a plain picture and video otherwise. */
function Face({ persona, videoTrack, audioTrack, onReady }: { persona: LandingPersona; videoTrack: RemoteTrack | null; audioTrack: RemoteTrack | null; onReady: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (persona.greenScreen || !videoTrack || !el) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack, persona.greenScreen]);

  // The keyed path plays the audio itself; the plain path does it here, the same way.
  useEffect(() => {
    if (persona.greenScreen || !audioTrack) return;
    const el = audioTrack.attach() as HTMLAudioElement;
    el.dataset.avatarAudio = "true";
    el.autoplay = true;
    el.muted = false;
    el.volume = 1;
    document.body.appendChild(el);
    void el.play().catch(() => undefined);
    return () => {
      audioTrack.detach(el);
      el.remove();
    };
  }, [audioTrack, persona.greenScreen]);

  if (persona.greenScreen) {
    return <GreenScreenCanvas videoTrack={videoTrack} audioTrack={audioTrack} idleImageSrc={stillOf(persona)} className="lh-face lh-face-key" onFirstDraw={onReady} />;
  }
  const showVideo = Boolean(videoTrack);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="lh-face lh-face-box" src={stillOf(persona)} alt="" width={800} height={1000} fetchPriority="high" style={{ visibility: showVideo ? "hidden" : "visible" }} />
      <video ref={videoRef} className="lh-face lh-face-box lh-face-video" autoPlay playsInline muted style={{ visibility: showVideo ? "visible" : "hidden" }} />
    </>
  );
}
