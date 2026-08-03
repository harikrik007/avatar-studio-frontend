/**
 * LiveKit transport for the avatar session.
 *
 * Gemini used to run in this browser; it now runs in the realtime-avatar
 * agent, which owns the persona, the tool declarations and the lip-synced
 * video. The browser's job shrinks to: publish the mic, play the avatar's
 * tracks, and answer tool calls over the data channel.
 *
 * `AvatarSession` deliberately mirrors the three methods the old Gemini
 * `LiveSession` exposed (sendClientContent / sendToolResponse / close) so the
 * cart, menu and animation code above it did not have to change.
 *
 * Ported from ringme/lib/avatar-session.ts, the most complete
 * implementation of this transport (tool_call, transcript, speaking-state,
 * audio-unblock retry all proven end to end there). `connect()`'s
 * `sessionUrl`/`sessionBody` are the one addition here: the public embed
 * widget (app/embed/[key]/page.tsx) needs a different endpoint and a
 * public_key/origin body instead of the default cookie-authenticated
 * /api/avatar-session, and the caller-supplied `room` name is read off
 * `session.room.name` after connect() -- no other change needed to reuse
 * this for both.
 */
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from "livekit-client";

export type AvatarToolCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

export type AvatarSessionCallbacks = {
  onToolCall: (calls: AvatarToolCall[]) => void;
  onTranscript: (role: "assistant" | "user", text: string) => void;
  onSpeakingChange: (speaking: boolean) => void;
  onTrack: (track: RemoteTrack) => void;
  onAudioBlocked: (blocked: boolean) => void;
  onDisconnected: (reason?: string) => void;
  onError: (message: string) => void;
};

type SessionResponse = {
  url: string;
  token: string;
  room: string;
  error?: string;
};

export class AvatarSession {
  readonly room: Room;
  private callbacks: AvatarSessionCallbacks;

  private constructor(room: Room, callbacks: AvatarSessionCallbacks) {
    this.room = room;
    this.callbacks = callbacks;
  }

  static async connect(
    callbacks: AvatarSessionCallbacks,
    options?: { sessionUrl?: string; sessionBody?: Record<string, unknown> }
  ): Promise<AvatarSession> {
    const response = await fetch(options?.sessionUrl ?? "/api/avatar-session", {
      method: "POST",
      ...(options?.sessionBody
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.sessionBody) }
        : {})
    });
    const payload = (await response.json()) as SessionResponse;
    if (!response.ok || payload.error) {
      throw new Error(payload.error ?? "Unable to start an avatar session.");
    }

    // adaptiveStream is deliberately off: it withholds frames when it judges
    // the attached element to be hidden or tiny, and there is only ever one
    // video here that we always want. dynacast is publisher-side and we
    // publish nothing but the mic.
    const room = new Room({ adaptiveStream: false, dynacast: false });
    const session = new AvatarSession(room, callbacks);

    room.on(RoomEvent.DataReceived, (data: Uint8Array) => session.handleData(data));
    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack) => {
        console.info(`[avatar] track subscribed: ${track.kind}`);
        if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
          callbacks.onTrack(track);
        }
      }
    );
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      callbacks.onAudioBlocked(!room.canPlaybackAudio);
    });
    room.on(RoomEvent.Disconnected, (reason) => callbacks.onDisconnected(String(reason ?? "")));

    await room.connect(payload.url, payload.token);
    // The agent transcribes our speech server-side; barge-in is handled there
    // too, so the mic simply stays open for the whole session.
    await room.localParticipant.setMicrophoneEnabled(true);
    // Browsers block audio elements that were not started by a gesture. This
    // runs inside the click that called connect(), so it normally succeeds;
    // if it does not, canPlaybackAudio stays false and the UI offers a retry.
    await session.startAudio();
    return session;
  }

  /** Ask the browser to allow playback. Safe to call again from a click. */
  async startAudio(): Promise<boolean> {
    try {
      await this.room.startAudio();
    } catch (error) {
      console.warn("[avatar] startAudio blocked", error);
    }
    return this.room.canPlaybackAudio;
  }

  get canPlaybackAudio(): boolean {
    return this.room.canPlaybackAudio;
  }

  private handleData(data: Uint8Array) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(new TextDecoder().decode(data));
    } catch {
      return;
    }

    switch (message.type) {
      case "tool_call":
        this.callbacks.onToolCall([
          {
            id: message.id as string,
            name: message.name as string,
            args: (message.args ?? {}) as Record<string, unknown>
          }
        ]);
        break;
      case "transcript":
        this.callbacks.onTranscript(
          message.role === "user" ? "user" : "assistant",
          String(message.text ?? "")
        );
        break;
      case "state":
        this.callbacks.onSpeakingChange(Boolean(message.speaking));
        break;
      case "error":
        this.callbacks.onError(String(message.message ?? "Avatar session error."));
        break;
    }
  }

  private publish(payload: Record<string, unknown>) {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    void this.room.localParticipant.publishData(data, { reliable: true });
  }

  /** Typed prompt — same shape the Gemini SDK session took. */
  sendClientContent(input?: { turns?: unknown; turnComplete?: boolean }) {
    const turns = input?.turns;
    const text =
      typeof turns === "string"
        ? turns
        : Array.isArray(turns)
          ? turns
              .flatMap((turn) => (turn as { parts?: Array<{ text?: string }> }).parts ?? [])
              .map((part) => part.text ?? "")
              .join(" ")
          : "";
    if (text.trim()) {
      this.publish({ type: "text", text: text.trim() });
    }
  }

  /** Tool results travel back to the agent, which returns them to Gemini. */
  sendToolResponse(input: {
    functionResponses:
      | Array<{ id?: string; name?: string; response?: Record<string, unknown> }>
      | { id?: string; name?: string; response?: Record<string, unknown> };
  }) {
    const responses = Array.isArray(input.functionResponses)
      ? input.functionResponses
      : [input.functionResponses];
    for (const response of responses) {
      this.publish({
        type: "tool_result",
        id: response.id,
        name: response.name,
        response: response.response ?? {}
      });
    }
  }

  close() {
    void this.room.disconnect();
  }
}
