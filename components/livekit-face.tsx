"use client";

import { useEffect, useRef } from "react";
import { Track, type RemoteTrack } from "livekit-client";

type LiveKitFaceProps = {
  /** Tracks handed over by AvatarSession as they are subscribed. */
  videoTrack: RemoteTrack | null;
  audioTrack: RemoteTrack | null;
  isConnected: boolean;
  width?: number;
  height?: number;
  /** Shown before a real track exists. Defaults to the single generic
   * placeholder every other caller (dashboard test panel, the third-party
   * embed widget) already relies on -- pass a specific avatar's own idle
   * loop (e.g. the demo section, one per real avatar) to avoid every card
   * showing the same face before connecting. */
  idleVideoSrc?: string;
};

/**
 * Renders the avatar published by the realtime-avatar agent.
 *
 * Replaces Wav2LipFace, which hand-rolled an RTCPeerConnection against the
 * LiveTalking server and pushed PCM to it over HTTP. LiveKit now carries both
 * the video and the already-synced audio, so this component only has to
 * attach the tracks — no signalling, no TURN config, no reconnect loop.
 *
 * The live element is mounted (never display:none) whenever a video track
 * exists: LiveKit's adaptive streaming decides what to deliver based on the
 * attached element's visibility, so hiding it stops frames arriving, which
 * then keeps it hidden. The idle clip is a separate element shown only before
 * a track exists — the agent has its own idle loop once connected.
 */
export function LiveKitFace({
  videoTrack,
  audioTrack,
  isConnected,
  width = 320,
  height = 320,
  idleVideoSrc = "/avatar-idle-loop.webm"
}: LiveKitFaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!videoTrack || !element || videoTrack.kind !== Track.Kind.Video) {
      return;
    }
    videoTrack.attach(element);
    return () => {
      videoTrack.detach(element);
    };
  }, [videoTrack]);

  useEffect(() => {
    if (!audioTrack || audioTrack.kind !== Track.Kind.Audio) {
      return;
    }
    // attach() with no argument lets LiveKit build and own the element; it
    // wires srcObject and the autoplay attributes the way the SDK expects.
    // Attaching to our own <audio> node produced a silent track.
    const element = audioTrack.attach() as HTMLAudioElement;
    element.dataset.avatarAudio = "true";
    element.autoplay = true;
    element.muted = false;
    element.volume = 1;
    document.body.appendChild(element);

    void element.play().catch((error) => {
      // Autoplay refused: AvatarSession.startAudio() retries on the next click.
      console.warn("[avatar] audio play() blocked", error);
    });

    return () => {
      audioTrack.detach(element);
      element.remove();
    };
  }, [audioTrack]);

  const showLive = isConnected && Boolean(videoTrack);

  return (
    <div className="wav2lip-face" style={{ width, height, position: "relative" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        width={width}
        height={height}
        style={{ width, height, objectFit: "cover", visibility: showLive ? "visible" : "hidden" }}
      />
      {showLive ? null : (
        <video
          src={idleVideoSrc}
          autoPlay
          loop
          muted
          playsInline
          width={width}
          height={height}
          style={{ position: "absolute", inset: 0, width, height, objectFit: "cover" }}
        />
      )}
    </div>
  );
}
