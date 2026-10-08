"use client";

/**
 * The visitor's camera or screen, for an agent that can see (its "vision" / "screen_capture" system tools).
 *
 * The agent says what it can see in a {"type":"vision"} message when the call starts, and asks for one with
 * {"type":"vision_request"}. The page answers a request at once ("vision_ack": can it offer that here?) and shows the
 * visitor a one-tap card -- browsers open the screen picker only from a click, so the agent can never start sharing by
 * itself. The camera or screen goes into the room as a video track, a few frames a second; the agent keeps one picture a
 * second and shows the model the ones that matter (realtime-avatar-studio anam_agent/visitor_video.py). One at a time:
 * turning one on turns the other off. Used by the embed widget and the builder's test call.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RoomEvent,
  Track,
  type LocalVideoTrack,
  type Room,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions,
} from "livekit-client";

export type VisionSource = "camera" | "screen";
export type Sight = { camera: boolean; screen: boolean };
export type VisionRequest = { id: string; source: VisionSource };

// A few frames a second is plenty: the agent uses one a second. Less upload for the visitor, less decoding for us.
const CAMERA_CAPTURE: VideoCaptureOptions = { resolution: { width: 960, height: 540, frameRate: 5 } };
const CAMERA_PUBLISH: TrackPublishOptions = { simulcast: false, videoEncoding: { maxBitrate: 600_000, maxFramerate: 5 } };
// Full size and tuned for text: the model reads what is on the screen.
const SCREEN_CAPTURE: ScreenShareCaptureOptions = {
  audio: false,
  resolution: { width: 1920, height: 1080, frameRate: 5 },
  contentHint: "text",
  selfBrowserSurface: "exclude",
};
const SCREEN_PUBLISH: TrackPublishOptions = { simulcast: false, screenShareEncoding: { maxBitrate: 1_500_000, maxFramerate: 5 } };

/** Phones and tablets cannot share a screen from a browser. */
export function canShareScreen(): boolean {
  if (typeof navigator === "undefined") return false;
  const md = navigator.mediaDevices as MediaDevices | undefined;
  return typeof md?.getDisplayMedia === "function" && !/Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
}

function canUseCamera(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** Whether the page the widget sits in lets it use this at all (its iframe's allow= and its own Permissions-Policy).
 * Only Chromium can say; elsewhere this is found out when the browser refuses. */
function allowedHere(source: VisionSource): boolean {
  const doc = document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } };
  try {
    return doc.featurePolicy?.allowsFeature(source === "camera" ? "camera" : "display-capture") ?? true;
  } catch {
    return true;
  }
}

function tellAgent(room: Room, payload: Record<string, unknown>) {
  void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true });
}

function errorText(error: unknown, source: VisionSource): string {
  const name = (error as { name?: string } | null)?.name;
  if (source === "screen") return name === "NotAllowedError" ? "Screen sharing was cancelled." : "Couldn't share the screen.";
  if (name === "NotAllowedError") return "The camera is blocked. Allow it from the lock icon in the address bar.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found.";
  if (name === "NotReadableError") return "The camera is in use by another app.";
  return "Couldn't turn on the camera.";
}

async function turnOff(room: Room, source: VisionSource) {
  // Unpublished, not muted: setCameraEnabled(false) only mutes a camera, and the agent then never learns it went off.
  const pub = room.localParticipant.getTrackPublication(source === "camera" ? Track.Source.Camera : Track.Source.ScreenShare);
  if (pub?.track) await room.localParticipant.unpublishTrack(pub.track, true);
}

export function useVisitorVideo(room: Room | null) {
  const [sight, setSight] = useState<Sight | null>(null);
  const [active, setActive] = useState<VisionSource | null>(null);
  const [track, setTrack] = useState<LocalVideoTrack | null>(null);
  const [request, setRequest] = useState<VisionRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [canFlip, setCanFlip] = useState(false);
  const roomRef = useRef(room);
  roomRef.current = room;
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (!room) {
      // the call ended (the room's own disconnect stopped the tracks)
      setSight(null);
      setActive(null);
      setTrack(null);
      setRequest(null);
      setError(null);
      return;
    }
    const sync = () => {
      const lp = room.localParticipant;
      const source: VisionSource | null = lp.isScreenShareEnabled ? "screen" : lp.isCameraEnabled ? "camera" : null;
      const pub = source ? lp.getTrackPublication(source === "camera" ? Track.Source.Camera : Track.Source.ScreenShare) : undefined;
      setActive(source);
      setTrack((pub?.videoTrack as LocalVideoTrack | undefined) ?? null);
    };
    sync();
    room.on(RoomEvent.LocalTrackPublished, sync).on(RoomEvent.LocalTrackUnpublished, sync);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, sync).off(RoomEvent.LocalTrackUnpublished, sync);
    };
  }, [room]);

  // Errors are a line under the controls for a few seconds, not a state to clear by hand.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  /** Every data message from the agent goes through this; true when it was one of these. The "vision" message can arrive
   * before the caller has the room (during connect), so it does not need one. */
  const handleMessage = useCallback((msg: Record<string, unknown>, from?: Room): boolean => {
    if (msg.type === "vision") {
      setSight({ camera: Boolean(msg.camera), screen: Boolean(msg.screen) });
      return true;
    }
    if (msg.type === "vision_request") {
      const r = from ?? roomRef.current;
      if (!r) return true;
      const source: VisionSource = msg.source === "screen" ? "screen" : "camera";
      const id = String(msg.id ?? "");
      const reason = (source === "screen" ? !canShareScreen() : !canUseCamera()) ? "unsupported" : !allowedHere(source) ? "blocked" : null;
      tellAgent(r, reason ? { type: "vision_ack", id, ok: false, reason } : { type: "vision_ack", id, ok: true });
      if (!reason) setRequest({ id, source });
      return true;
    }
    return false;
  }, []);

  const start = useCallback(async (source: VisionSource) => {
    const r = roomRef.current;
    if (!r) return;
    const asked = requestRef.current?.source === source ? requestRef.current : null;
    setBusy(true);
    setError(null);
    try {
      const lp = r.localParticipant;
      if (source === "camera") {
        await turnOff(r, "screen");
        await lp.setCameraEnabled(true, { ...CAMERA_CAPTURE, facingMode: "user" }, CAMERA_PUBLISH);
        setFacing("user");
        navigator.mediaDevices
          ?.enumerateDevices()
          .then((devices) => setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1))
          .catch(() => setCanFlip(false));
      } else {
        // the picker first, while the click that asked for it still counts (Safari allows it only then)
        await lp.setScreenShareEnabled(true, SCREEN_CAPTURE, SCREEN_PUBLISH);
        await turnOff(r, "camera");
      }
      if (asked) setRequest(null);
    } catch (e) {
      setError(errorText(e, source));
      if (asked) {
        // closing the screen picker is a no; a blocked or missing camera is the browser's
        const declined = source === "screen" && (e as { name?: string } | null)?.name === "NotAllowedError";
        tellAgent(r, { type: declined ? "vision_declined" : "vision_failed", source });
        setRequest(null);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    await turnOff(r, "camera");
    await turnOff(r, "screen");
  }, []);

  const toggle = useCallback(
    (source: VisionSource) => (active === source ? void stop() : void start(source)),
    [active, start, stop]
  );

  const decline = useCallback(() => {
    const r = roomRef.current;
    const req = requestRef.current;
    if (r && req) tellAgent(r, { type: "vision_declined", source: req.source });
    setRequest(null);
  }, []);

  /** Front or back camera, on a phone: show the agent what is in front of you, not your face. */
  const flip = useCallback(async () => {
    if (!track) return;
    const next = facing === "user" ? "environment" : "user";
    try {
      await track.restartTrack({ ...CAMERA_CAPTURE, facingMode: next });
      setFacing(next);
    } catch {
      setError("Couldn't switch the camera.");
    }
  }, [track, facing]);

  return { sight, active, track, request, busy, error, facing, canFlip, handleMessage, start, stop, toggle, decline, flip };
}

export type VisitorVideo = ReturnType<typeof useVisitorVideo>;

// --- pieces of UI, dark glass like the widget's own surfaces -------------------------------------------------------------------

/** What the visitor is showing, small, so they always know the agent can see it. The front camera is mirrored, as in
 * every video call; the agent gets it the right way round. */
export function VisionPreview({ v, style }: { v: VisitorVideo; style?: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !v.track) return;
    v.track.attach(el);
    return () => {
      v.track?.detach(el);
    };
  }, [v.track]);
  if (!v.active || !v.track) return null;
  const mirrored = v.active === "camera" && v.facing === "user";
  return (
    <div style={{ ...previewStyle, ...style }} data-vision-preview={v.active}>
      <video ref={ref} autoPlay playsInline muted style={{ ...previewVideoStyle, transform: mirrored ? "scaleX(-1)" : "none" }} />
      <span style={previewLabelStyle}>{v.active === "camera" ? "Your camera" : "Your screen"}</span>
      <span style={previewButtonsStyle}>
        {v.active === "camera" && v.canFlip ? (
          <button type="button" aria-label="Switch camera" title="Switch camera" style={previewButtonStyle} onClick={() => void v.flip()}>
            <FlipIcon />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={v.active === "camera" ? "Turn off camera" : "Stop sharing"}
          title={v.active === "camera" ? "Turn off camera" : "Stop sharing"}
          style={previewButtonStyle}
          onClick={() => void v.stop()}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </div>
  );
}

/** The agent asked to see: one tap to say yes. */
export function VisionRequestCard({ v, agentName, style }: { v: VisitorVideo; agentName?: string; style?: React.CSSProperties }) {
  if (!v.request) return null;
  const camera = v.request.source === "camera";
  const who = agentName?.trim() || "The agent";
  return (
    <div role="dialog" aria-label={camera ? "Turn on your camera?" : "Share your screen?"} style={{ ...cardStyle, ...style }}>
      <p style={cardTextStyle}>
        {who} would like to see {camera ? "your camera" : "your screen"}.
      </p>
      <div style={cardButtonsStyle}>
        <button type="button" style={cardPrimaryStyle} disabled={v.busy} onClick={() => void v.start(v.request!.source)}>
          {camera ? <CameraIcon size={15} /> : <ScreenIcon size={15} />}
          {camera ? "Turn on camera" : "Share screen"}
        </button>
        <button type="button" style={cardSecondaryStyle} onClick={v.decline}>
          Not now
        </button>
      </div>
    </div>
  );
}

export function CameraIcon({ size = 18, off = false }: { size?: number; off?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6.5" width="12.5" height="11" rx="2.2" stroke="#fff" strokeWidth="1.8" />
      <path d="M15.5 10.5l5-3v9l-5-3z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      {off ? <path d="M3 3l18 18" stroke="#fff" strokeWidth="2" strokeLinecap="round" /> : null}
    </svg>
  );
}

export function ScreenIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="12" rx="2" stroke="#fff" strokeWidth="1.8" />
      <path d="M8.5 20h7M12 16.5V20" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 13.5V8m0 0l-2.5 2.5M12 8l2.5 2.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M18 3v4h-4M6 21v-4h4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const glass: React.CSSProperties = {
  background: "rgba(18,18,20,0.78)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "0 12px 30px rgba(0,0,0,0.3)",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const previewStyle: React.CSSProperties = {
  ...glass,
  position: "relative",
  width: 124,
  aspectRatio: "16 / 10",
  borderRadius: 12,
  overflow: "hidden",
  pointerEvents: "auto",
};

const previewVideoStyle: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block", background: "#000" };

const previewLabelStyle: React.CSSProperties = {
  position: "absolute",
  left: 6,
  bottom: 5,
  fontSize: 10,
  fontWeight: 600,
  color: "#fff",
  textShadow: "0 1px 4px rgba(0,0,0,0.8)",
};

const previewButtonsStyle: React.CSSProperties = { position: "absolute", top: 4, right: 4, display: "flex", gap: 4 };

const previewButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  border: "none",
  background: "rgba(0,0,0,0.55)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const cardStyle: React.CSSProperties = {
  ...glass,
  borderRadius: 16,
  padding: "12px 14px",
  maxWidth: 300,
  pointerEvents: "auto",
};

const cardTextStyle: React.CSSProperties = { margin: "0 0 10px", color: "#fff", fontSize: 13.5, lineHeight: 1.4 };

const cardButtonsStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };

const cardPrimaryStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "none",
  borderRadius: 999,
  padding: "8px 14px",
  background: "#16a34a",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const cardSecondaryStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: 999,
  padding: "8px 14px",
  background: "transparent",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
};
