"use client";

/**
 * Shared pieces of the Anam dashboard's agent pages: the agent/tool types,
 * tool-header helpers, connector presets, and the live test panel. Moved out
 * of agents/page.tsx unchanged when the create form and edit dialog were
 * replaced by the full-page builder (builder/), so the list page and the
 * builder use one copy.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { RemoteTrack, RemoteTrackPublication, RemoteParticipant } from "livekit-client";
import type { Tool } from "@/lib/tools/model";

export type Avatar = {
  id: string;
  name: string;
  status: "uploading" | "processing" | "quality_check" | "ready" | "failed";
  // "anam" faces are hosted and shared; "wav2lip" ones were created by this
  // client from their own video. This page only offers the former.
  provider?: string;
  preview_video_url?: string | null;
  // Anam's own CDN still, which is what the picker shows.
  preview_image_url?: string | null;
  // Measured from that still: only a face shot against a green screen can
  // be shown with its background removed.
  supports_transparency?: boolean;
  // false: an administrator no longer offers this face to this client, but the client's agents already use it. Show it on
  // those agents; do not offer it in a picker. Absent (an older backend) means offered.
  selectable?: boolean;
};

export type AgentDocument = {
  id: string;
  filename: string;
  char_count: number;
  size_bytes: number;
  created_at: string;
};

export type EmbedKey = {
  public_key: string;
  allowed_origins: string[];
  is_active: boolean;
  max_concurrent: number;
  accent_color: string;
  greeting_label: string;
};

export type Deployment = {
  role: "primary" | "scaleout";
  status: "provisioning" | "running" | "draining" | "stopping" | "stopped" | "failed";
  status_detail: string | null;
  max_concurrent_sessions: number;
};

export type Agent = {
  id: string;
  avatar_id: string;
  name: string;
  system_prompt: string;
  opening_intro: string;
  voice: string;
  // v2 tools (lib/tools/model.ts); the API upgrades older ones on read
  tools_json: Tool[];
  // "provisioning" is server-derived only -- set while a real RunPod pod is
  // booting after Make live was clicked (see backend's _set_agent_live).
  // Never sent by this dashboard as a PATCH value.
  status: "draft" | "provisioning" | "live";
  // Float the avatar on the customer's page with its background keyed out.
  // Needs a green-screen avatar; off by default, so nothing changes for an
  // agent that does not ask for it.
  transparent?: boolean;
  created_at: string;
  documents: AgentDocument[];
  // Set once the agent has been made live at least once -- see the
  // backend's update_agent/_set_agent_live (api/main.py). null for an
  // agent that has never gone live, not an empty/inactive placeholder.
  embed: EmbedKey | null;
  // The primary Deployment behind this agent, if any -- null for
  // box-hosted demo avatars (RingMe/pizza3/bank) even while status="live",
  // and null before the first Make live click.
  deployment: Deployment | null;
};

export const DOC_EXTENSIONS = ".pdf,.txt,.md,.csv,.docx";

// Avatars offered in this dashboard. PRODUCTION OFFERS ANAM ONLY (Hari, 2026-10-07): Ditto, FlashHead and any
// avatar provider we build next are developed on the `development` branch and served locally to Hari for testing,
// never offered to a production visitor. The list is configuration, not code, so the same code is on both branches
// and a merge can never carry a provider into production: it is "anam" unless NEXT_PUBLIC_AVATAR_PROVIDERS says
// otherwise, and only a local .env.local sets it, e.g. NEXT_PUBLIC_AVATAR_PROVIDERS=anam,ditto,flashhead
// (Railway has no such variable). It is read at build time. Agents already built on another provider keep working;
// they are just not offered in the picker.
/** Can this avatar be offered when building an agent: a provider this build offers, ready, and not withdrawn from this client. */
export function isPickable(a: Avatar): boolean {
  return HOSTED_PROVIDERS.has(a.provider ?? "") && a.status === "ready" && a.selectable !== false;
}

export const HOSTED_PROVIDERS = new Set(
  (process.env.NEXT_PUBLIC_AVATAR_PROVIDERS || "anam")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
);

export function agentStatusLabel(status: Agent["status"]): string {
  if (status === "live") return "Live";
  if (status === "provisioning") return "Starting…";
  return "Draft";
}

export function agentStatusBadgeClass(status: Agent["status"]): string {
  if (status === "live") return "l-status-ready";
  if (status === "provisioning") return "l-status-processing";
  return "l-status-uploading";
}

export function formatDocMeta(doc: AgentDocument): string {
  const kb = doc.size_bytes / 1024;
  const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  return `${size} · ${doc.char_count.toLocaleString()} characters of text`;
}

export type ActivityEntry =
  | { id: string; kind: "transcript"; role: "user" | "assistant"; text: string }
  // `detail` carries the tool's own error text. Without it the feed only
  // said "failed", which tells you a tool broke but not whether the URL
  // was wrong, the API rejected the request, or it timed out -- and the
  // session's logs are deleted on teardown, so there is nowhere else to
  // look afterwards.
  | { id: string; kind: "tool"; name: string; status: "calling" | "done" | "failed"; detail?: string };

export type TestState = "idle" | "connecting" | "warming" | "connected" | "error";

// Bounded polling of GET /test-session/{room} while "warming" -- catches a
// real RunPod job failure (the worker never booted) instead of leaving the
// customer staring at "warming up" forever. Not tight: the bot's own
// LiveKit track subscription is what actually ends the warming state on
// the happy path, this is only the unhappy-path backstop.
export const WARMING_POLL_MS = 4000;
export const WARMING_MAX_POLLS = 10; // ~40s; the avatar normally appears in ~2

// Talks to a real LiveKit room -- the same one agent.main just published its
// avatar video/audio tracks into -- so this is the actual test drive, not a
// mockup: real Gemini, real tool calls, real rendered video.
export function LiveTestPanel({
  agentId,
  onStopped,
  pipeline,
  frame,
  stopLabel = "Stop test",
  stopClassName = "l-btn l-btn-ghost",
}: {
  agentId: string;
  onStopped: () => void;
  // "cascade": the test-only VAD -> speech-to-text -> LLM -> TTS pipeline
  // instead of Gemini Live (see the backend's cascade-test-session).
  pipeline?: "cascade";
  // "wide": ask for the landscape render (1152x768), for a landscape preview box, instead of the portrait default.
  frame?: "wide";
  // The builder's preview calls it "End call" and styles it red.
  stopLabel?: string;
  stopClassName?: string;
}) {
  const [state, setState] = useState<TestState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  const roomNameRef = useRef<string | null>(null);
  // Persists across React StrictMode's dev-only double-invoke of this
  // effect (mount -> cleanup -> mount again, same instance, same refs).
  // Without serializing on it, the second mount's start() could POST a new
  // test session before the first mount's cleanup had finished DELETEing
  // its session -- a real race, not just dev noise, since the orchestrator
  // only has one slot: two sessions overlapping means the second 409s and
  // the first leaks until its hard timeout.
  const pendingRef = useRef<Promise<void>>(Promise.resolve());
  const intentionalDisconnectRef = useRef(false);

  const pushActivity = useCallback((entry: ActivityEntry) => {
    setActivity((prev) => {
      // A tool call and its result arrive as two messages sharing one id.
      // Replacing in place makes one call render as one line that moves
      // from "Calling…" to "responded" -- appending instead produced two
      // lines that read as two separate calls, and collided as duplicate
      // React keys.
      const existing = prev.findIndex((e) => e.id === entry.id);
      if (existing !== -1) {
        const next = [...prev];
        next[existing] = entry;
        return next;
      }

      // Gemini streams transcripts in fragments ("I'm sorry," / "I can't" /
      // "get"), so one spoken sentence arrived as a dozen lines. Merge a
      // fragment into the previous line when it continues the same speaker.
      const last = prev[prev.length - 1];
      if (entry.kind === "transcript" && last?.kind === "transcript" && last.role === entry.role) {
        const merged: ActivityEntry = {
          ...last,
          text: `${last.text}${last.text.endsWith(" ") || entry.text.startsWith(" ") ? "" : " "}${entry.text}`.trim(),
        };
        return [...prev.slice(0, -1), merged];
      }

      return [...prev.slice(-19), entry];
    });
  }, []);

  // Tears down whatever this component instance is currently holding.
  // Deliberately does NOT call onStopped() -- that's the parent-visible
  // "testing ended" signal, which should only fire on an explicit Stop
  // click or an unexpected disconnect, never on a teardown that's really
  // just StrictMode's phantom cleanup ahead of an immediate remount.
  const teardown = useCallback(async () => {
    intentionalDisconnectRef.current = true;
    roomRef.current?.disconnect();
    roomRef.current = null;
    const room = roomNameRef.current;
    roomNameRef.current = null;
    if (room) {
      await fetch(`/api/agents/${agentId}/test-session?room=${encodeURIComponent(room)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      // Wait for any in-flight teardown (including a StrictMode phantom
      // mount's cleanup) to actually finish before claiming a new session.
      await pendingRef.current.catch(() => {});
      if (cancelled) return;

      const params = new URLSearchParams();
      if (pipeline === "cascade") params.set("pipeline", "cascade");
      if (frame === "wide") params.set("frame", "wide");
      const query = params.size ? `?${params}` : "";
      const res = await fetch(`/api/agents/${agentId}/test-session${query}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(body.error || body.detail || "Couldn't start a test session.");
        setState("error");
        return;
      }
      roomNameRef.current = body.room;
      intentionalDisconnectRef.current = false;

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
        if (track.kind === Track.Kind.Video && videoRef.current) {
          track.attach(videoRef.current);
          // The bot's video track only exists once agent.main has actually
          // booted and published -- this, not room.connect() resolving, is
          // the real "live" signal for a RunPod-Serverless-backed session
          // (unlike the old box-hosted orchestrator, connect() now
          // resolves against an empty room almost instantly).
          if (!cancelled) setState("connected");
        }
        if (track.kind === Track.Kind.Audio && audioRef.current) track.attach(audioRef.current);
      });

      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === "client_tool_call" && msg.awaitResult) {
            // The test drive has no host page to run a client tool in, so it
            // answers for one (PLAN.md decision 3); the call and this answer
            // show in the feed through the agent's own tool_call/tool_result.
            const answer = { type: "client_tool_result", id: msg.id, result: { ok: true, test: true } };
            void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(answer)), { reliable: true });
          } else if (msg.type === "transcript" && msg.text) {
            pushActivity({ id: crypto.randomUUID(), kind: "transcript", role: msg.role, text: msg.text });
          } else if (msg.type === "tool_call") {
            pushActivity({ id: msg.id, kind: "tool", name: msg.name, status: "calling" });
          } else if (msg.type === "tool_result") {
            // v2 results are {result} or {error, body?}; older agents sent {success: false, ...}
            const failed = msg.response?.success === false || msg.response?.error != null;
            // HTTP failures carry the upstream body too -- it is usually
            // the most informative part (an API's own "invalid key" or
            // "unknown city" message), so include a trimmed slice of it.
            const detail = failed
              ? [msg.response?.error, typeof msg.response?.body === "string" ? msg.response.body : null]
                  .filter(Boolean)
                  .join(" — ")
                  .slice(0, 200)
              : undefined;
            pushActivity({
              id: msg.id,
              kind: "tool",
              name: msg.name,
              status: failed ? "failed" : "done",
              detail,
            });
          }
        } catch {
          // ignore non-JSON data packets
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        // Only a *server-initiated* disconnect should tell the parent
        // testing ended -- our own teardown() already set the intentional
        // flag before calling room.disconnect(), which is what fires this
        // same event on a deliberate Stop.
        if (!intentionalDisconnectRef.current) {
          onStopped();
        }
      });

      try {
        await room.connect(body.url, body.token);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't join the test session.");
          setState("error");
        }
        return;
      }
      if (cancelled) return;
      // Room joined, but the bot itself may still be booting (RunPod cold
      // start) -- "connected" only fires once its video track
      // actually arrives, above. Mic still enables now, not once
      // "connected": no reason to make the customer wait to grant mic
      // permission just because the bot hasn't shown up yet.
      setState("warming");

      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        if (!cancelled) setMicOn(true);
      } catch (e) {
        // No mic, permission denied, or (like this sandbox) no audio
        // device at all -- the test drive still shows the avatar live,
        // just without the customer able to talk to it by voice.
        if (!cancelled) setMicError(e instanceof Error ? e.message : "Microphone unavailable.");
      }
    }

    pendingRef.current = start();
    return () => {
      cancelled = true;
      pendingRef.current = pendingRef.current.catch(() => {}).then(teardown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, pipeline, frame]);

  // Unhappy-path backstop while "warming": if RunPod's own job status comes
  // back FAILED, surface that instead of leaving the customer staring at
  // "warming up" until they give up. The happy path never touches this --
  // the TrackSubscribed handler above ends "warming" first.
  useEffect(() => {
    if (state !== "warming") return;
    let cancelled = false;
    let polls = 0;

    const interval = setInterval(async () => {
      polls += 1;
      const room = roomNameRef.current;
      if (!room) return;
      try {
        const res = await fetch(`/api/agents/${agentId}/test-session?room=${encodeURIComponent(room)}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (body.runpod_status === "FAILED" || body.runpod_status === "CANCELLED") {
          setError("The test session failed to start. Try again.");
          setState("error");
        }
      } catch {
        // A transient status-check failure isn't itself a reason to give
        // up -- only RunPod's own reported FAILED/CANCELLED is.
      }
      if (polls >= WARMING_MAX_POLLS && !cancelled) {
        setError("The avatar hasn't appeared yet. You can keep waiting, or stop and try again.");
      }
    }, WARMING_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state, agentId]);

  const handleStopClick = useCallback(() => {
    void teardown().then(onStopped);
  }, [teardown, onStopped]);

  return (
    <div className="l-live-test">
      <div className="l-avatar-dialog-video l-live-test-video-wrap">
        <video ref={videoRef} autoPlay playsInline className="l-live-test-video" />
        <audio ref={audioRef} autoPlay />
        {state !== "connected" ? (
          <div className="l-live-test-overlay">
            {state === "error"
              ? error || "Something went wrong."
              : state === "warming"
                ? "Starting your agent — the avatar joins in a few seconds…"
                : "Connecting…"}
          </div>
        ) : null}
      </div>
      <div className="l-live-test-bar">
        <span className="l-live-test-status">
          {state === "connected"
            ? micOn
              ? "Live — mic on, talk to your agent"
              : `Live — ${micError || "mic unavailable"}`
            : state === "warming"
              ? error || "Warming up…"
              : state === "error"
                ? "Not connected" // the reason is in the overlay above; it used to be printed twice
                : "Connecting…"}
        </span>
        <button type="button" className={stopClassName} onClick={handleStopClick}>
          {stopLabel}
        </button>
      </div>
      {activity.length > 0 ? (
        <div className="l-live-test-activity">
          {activity.map((e) =>
            e.kind === "transcript" ? (
              <div key={e.id} className={`l-live-test-line l-live-test-${e.role}`}>
                <strong>{e.role === "user" ? "You" : "Agent"}:</strong> {e.text}
              </div>
            ) : (
              <div
                key={e.id}
                className={`l-live-test-line l-live-test-tool${
                  e.status === "failed" ? " l-live-test-tool-failed" : ""
                }`}
              >
                {e.status === "calling"
                  ? `Calling ${e.name}…`
                  : e.status === "done"
                    ? `${e.name} responded`
                    : `${e.name} failed${e.detail ? `: ${e.detail}` : ""}`}
              </div>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
