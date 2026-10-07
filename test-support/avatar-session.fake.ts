/**
 * TEST BUILDS ONLY. next.config.ts swaps this in for lib/avatar-session.ts when LANDING_FAKE_SESSION=1, so the browser checks in
 * results/landing-redesign can drive the call card's live states (captions, speaking, countdown, end of call, errors) without a
 * LiveKit server. The real session request is still made (so the check can see what the page sends); everything after it is scripted
 * through window.__fakeCall. A production build never includes this file.
 */
export type AvatarToolCall = { id?: string; name?: string; args?: Record<string, unknown> };
export type ClientToolCall = { id: string; name: string; args: Record<string, unknown>; awaitResult: boolean };

type Callbacks = {
  onToolCall: (calls: AvatarToolCall[]) => void;
  onClientToolCall?: (call: ClientToolCall) => void;
  onTranscript: (role: "assistant" | "user", text: string) => void;
  onSpeakingChange: (speaking: boolean) => void;
  onTrack: (track: unknown) => void;
  onAudioBlocked: (blocked: boolean) => void;
  onSessionEnded?: (reason: string) => void;
  onDisconnected: (reason?: string) => void;
  onError: (message: string) => void;
};

type Control = {
  connects: number;
  closed: number;
  toolResponses: unknown[];
  connectError?: { name: string; message: string };
  connectDelayMs?: number;
  callbacks?: Callbacks;
  say: (role: "assistant" | "user", text: string) => void;
  speaking: (on: boolean) => void;
  end: (reason: string) => void;
  disconnect: () => void;
  error: (message: string) => void;
  audioBlocked: (on: boolean) => void;
  toolCall: (name: string) => void;
};

declare global {
  interface Window {
    __fakeCall?: Control;
  }
}

function control(): Control {
  return (window.__fakeCall ??= {
    connects: 0,
    closed: 0,
    toolResponses: [],
    say: (r, t) => window.__fakeCall?.callbacks?.onTranscript(r, t),
    speaking: (on) => window.__fakeCall?.callbacks?.onSpeakingChange(on),
    end: (reason) => window.__fakeCall?.callbacks?.onSessionEnded?.(reason),
    disconnect: () => window.__fakeCall?.callbacks?.onDisconnected(""),
    error: (m) => window.__fakeCall?.callbacks?.onError(m),
    audioBlocked: (on) => window.__fakeCall?.callbacks?.onAudioBlocked(on),
    toolCall: (name) => window.__fakeCall?.callbacks?.onToolCall([{ id: "t1", name, args: {} }]),
  });
}

export class AvatarSession {
  readonly room = { name: "fake-room" };
  canPlaybackAudio = true;

  static async connect(callbacks: Callbacks, options?: { sessionUrl?: string; sessionBody?: Record<string, unknown> }): Promise<AvatarSession> {
    const ctl = control();
    ctl.connects += 1;
    await fetch(options?.sessionUrl ?? "/api/avatar-session", {
      method: "POST",
      ...(options?.sessionBody ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.sessionBody) } : {}),
    }).catch(() => null);
    if (ctl.connectDelayMs) await new Promise((r) => setTimeout(r, ctl.connectDelayMs));
    if (ctl.connectError) throw Object.assign(new Error(ctl.connectError.message), { name: ctl.connectError.name });
    ctl.callbacks = callbacks;
    return new AvatarSession();
  }

  async startAudio() {
    return true;
  }
  close() {
    control().closed += 1;
  }
  sendToolResponse(input: unknown) {
    control().toolResponses.push(input);
  }
  sendClientToolResult() {}
  sendClientContent() {}
}
