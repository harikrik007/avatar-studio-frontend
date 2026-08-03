"use client";

import { useEffect, useRef, useState } from "react";
import { Track, type RemoteTrack } from "livekit-client";
import { LiveKitFace } from "@/components/livekit-face";
import { AvatarSession, type AvatarToolCall } from "@/lib/avatar-session";

type DemoAgent = {
  key: string; // embed public_key, seeded via scripts/seed_pizza.py / seed_bank.py / seed_ringme.py
  name: string;
  business: string;
  blurb: string;
  idleVideoSrc: string; // each avatar's own idle loop -- LiveKitFace's default is a single generic clip
  kind: "pizza" | "bank" | "ringme"; // picks which tool-call handler below answers this card's calls
};

// All three are real, box-hosted deployments (never RunPod) -- seeded into
// Avatar Studio's own DB the same way scripts/seed_ringme.py already did,
// so this section is just another (first-party) consumer of the real
// embed-widget backend, not a special path.
const DEMO_AGENTS: DemoAgent[] = [
  {
    key: "pk_e92d071807d94962b7dd660eead4afe2",
    name: "Chef Mozza",
    business: "Pizza Orbit",
    blurb: "Order pizza, ask about the menu, get delivery help.",
    idleVideoSrc: "/pizza-idle-loop.webm",
    kind: "pizza",
  },
  {
    key: "pk_955115ca0514429ebd62c6cf2ef9d370",
    name: "Mira",
    business: "central Bank",
    blurb: "Check balances, ask about products, get account help.",
    idleVideoSrc: "/bank-idle-loop.webm",
    kind: "bank",
  },
  {
    key: "pk_02e0307e97d74dd086602ea4c618bef4",
    name: "RingMe Assistant",
    business: "RingMe",
    blurb: "Customer care for RingMe's own callers.",
    idleVideoSrc: "/ringme-idle-loop.webm",
    kind: "ringme",
  },
];

// Mirrors central Bank's own demo data + PIN check (bank/lib/ringme-content.ts,
// bank/components/voice-assistant-demo.tsx's executeToolCall) -- kept as a
// separate, smaller copy here rather than shared, since this is the one
// place check_balance/get_account_details/download_statement need to behave
// for real instead of the "Not available in this demo" stub every other
// tool call gets. Real bank.agentbaba.ai is untouched by this.
const BANK_DEMO_PIN = "4321";
const BANK_ACCOUNTS = [
  {
    id: "primary-savings",
    type: "Savings",
    nickname: "Primary Savings",
    holderName: "Arun Kumar",
    accountNumberMasked: "XXXXXX4821",
    ifsc: "FDRL0001234",
    branch: "Kochi MG Road",
    availableBalance: 128450.75,
    ledgerBalance: 129100.75,
  },
  {
    id: "family-current",
    type: "Current",
    nickname: "Family Current",
    holderName: "Arun Kumar",
    accountNumberMasked: "XXXXXX9037",
    ifsc: "FDRL0005678",
    branch: "Bengaluru Indiranagar",
    availableBalance: 86320.2,
    ledgerBalance: 87320.2,
  },
];
const BANK_STATEMENTS = [
  { id: "jun-2026", label: "June 2026 Statement", period: "01 Jun 2026 - 30 Jun 2026" },
  { id: "may-2026", label: "May 2026 Statement", period: "01 May 2026 - 31 May 2026" },
];

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function normalizeToken(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function resolveBankAccount(args: Record<string, unknown>) {
  const accountId = normalizeToken(String(args.accountId ?? ""));
  const accountType = normalizeToken(String(args.accountType ?? ""));
  return (
    BANK_ACCOUNTS.find((a) => normalizeToken(a.id) === accountId) ??
    BANK_ACCOUNTS.find((a) => normalizeToken(a.type) === accountType) ??
    BANK_ACCOUNTS[0]
  );
}

function resolveBankStatement(statementId: unknown) {
  const id = normalizeToken(String(statementId ?? ""));
  return BANK_STATEMENTS.find((s) => normalizeToken(s.id) === id) ?? BANK_STATEMENTS[0];
}

function executeBankToolCall(call: AvatarToolCall): Record<string, unknown> {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const account = resolveBankAccount(args);

  if (call.name === "check_balance") {
    const pin = typeof args.pin === "string" ? args.pin.trim() : "";
    if (!pin) {
      return {
        success: false,
        requiresPin: true,
        customerMessage: "Please tell me the demo PIN so I can check your balance.",
      };
    }
    if (pin !== BANK_DEMO_PIN) {
      return {
        success: false,
        requiresPin: true,
        customerMessage: "That PIN doesn't match our demo account. The demo PIN is 4321.",
      };
    }
    return {
      success: true,
      accountId: account.id,
      availableBalance: account.availableBalance,
      ledgerBalance: account.ledgerBalance,
      customerMessage: `${account.nickname} available balance is ${formatInr(account.availableBalance)} and ledger balance is ${formatInr(account.ledgerBalance)}.`,
    };
  }

  if (call.name === "get_account_details") {
    return {
      success: true,
      account: {
        id: account.id,
        type: account.type,
        nickname: account.nickname,
        holderName: account.holderName,
        accountNumberMasked: account.accountNumberMasked,
        ifsc: account.ifsc,
        branch: account.branch,
      },
      customerMessage: `${account.nickname} is your ${account.type.toLowerCase()} account ending ${account.accountNumberMasked.slice(-4)}. IFSC is ${account.ifsc} and branch is ${account.branch}.`,
    };
  }

  if (call.name === "download_statement") {
    const statement = resolveBankStatement(args.statementId);
    return {
      success: true,
      statement: { id: statement.id, label: statement.label, period: statement.period },
      customerMessage: `${statement.label} is ready for ${account.nickname}. Statement downloads aren't available in this demo, but they work on the live site.`,
    };
  }

  return { success: false, error: "Not available in this demo." };
}

function executeRingmeToolCall(call: AvatarToolCall): Record<string, unknown> {
  if (call.name === "save_contact_details") {
    const args = (call.args ?? {}) as Record<string, unknown>;
    const name = typeof args.name === "string" ? args.name.trim() : "";
    return {
      success: true,
      customerMessage: name
        ? `Thanks ${name}, I've saved your details.`
        : "Thanks, I've saved your details.",
    };
  }
  return { success: false, error: "Not available in this demo." };
}

type CardStatus =
  | "idle"
  | "checking"
  | "queued"
  | "connecting"
  | "listening"
  | "error"
  | "ended";

// A visitor who opens a demo and wanders off must not hold one of a small,
// shared, four-slot pool that each business's own real customers also draw
// from -- same reasoning as embed-widget.tsx.
const IDLE_TIMEOUT_MS = 90_000;
// Deliberately shorter than the real embed widget's 8-minute cap: a
// marketing demo doesn't need a long conversation to prove quality, and a
// short, predictable cap is what makes the queue below actually move.
const DEMO_HARD_TIMEOUT_MS = 3 * 60_000;
const DEMO_WARNING_MS = DEMO_HARD_TIMEOUT_MS - 30_000;
const QUEUE_POLL_MS = 4_000;

export function DemoAvatarsSection() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>({});
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoTrack, setVideoTrack] = useState<RemoteTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<RemoteTrack | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [endingSoon, setEndingSoon] = useState(false);

  const sessionRef = useRef<AvatarSession | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const busyRef = useRef(false); // guards against a double-click across cards firing two connects
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function setCardStatus(key: string, status: CardStatus) {
    setStatuses((prev) => ({ ...prev, [key]: status }));
  }

  function clearTimers() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (hardTimerRef.current) clearTimeout(hardTimerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    idleTimerRef.current = null;
    hardTimerRef.current = null;
    warnTimerRef.current = null;
  }

  function clearQueuePoll() {
    if (queuePollRef.current) {
      clearInterval(queuePollRef.current);
      queuePollRef.current = null;
    }
  }

  function armIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => void endSession("idle_timeout"), IDLE_TIMEOUT_MS);
  }

  useEffect(() => {
    return () => {
      clearTimers();
      clearQueuePoll();
      if (sessionRef.current) void endSession("visitor_closed");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function endSession(
    reason: "visitor_closed" | "idle_timeout" | "hard_timeout",
    uiStatus?: CardStatus
  ) {
    clearTimers();
    clearQueuePoll();
    const key = activeKeyRef.current;
    const room = roomNameRef.current;
    sessionRef.current?.close();
    sessionRef.current = null;
    roomNameRef.current = null;
    activeKeyRef.current = null;
    setActiveKey(null);
    setVideoTrack(null);
    setAudioTrack(null);
    setIsSpeaking(false);
    setEndingSoon(false);

    if (room && key) {
      try {
        await fetch("/api/embed/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_key: key, room, reason }),
        });
      } catch {
        // Best-effort -- the control plane's own empty-room monitor reaps it regardless.
      }
    }
    if (key) {
      setCardStatus(
        key,
        uiStatus ?? (reason === "idle_timeout" || reason === "hard_timeout" ? "ended" : "idle")
      );
    }
  }

  function handleToolCalls(calls: AvatarToolCall[]) {
    // Bank's check_balance/get_account_details/download_statement and
    // RingMe's save_contact_details answer for real (see executeBankToolCall
    // / executeRingmeToolCall above) since both are just data lookups with
    // no UI dependency. Pizza's cart tools stay stubbed -- add_to_cart/
    // view_cart/calculate_cart_total need real cart *state*, which this
    // page doesn't own; Chef Mozza still answers list_menu questions fine
    // from her own system-prompt knowledge regardless of the tool result.
    if (!calls.length || !sessionRef.current) return;
    const kind = DEMO_AGENTS.find((a) => a.key === activeKeyRef.current)?.kind;
    sessionRef.current.sendToolResponse({
      functionResponses: calls.map((call) => ({
        id: call.id,
        name: call.name,
        response:
          kind === "bank"
            ? executeBankToolCall(call)
            : kind === "ringme"
              ? executeRingmeToolCall(call)
              : { success: false, error: "Not available in this demo." },
      })),
    });
  }

  async function beginConnect(agent: DemoAgent) {
    if (activeKeyRef.current && activeKeyRef.current !== agent.key) {
      await endSession("visitor_closed");
    }
    clearQueuePoll();
    setErrorMessage(null);
    setCardStatus(agent.key, "connecting");
    setTranscript("Connecting…");

    const session = await AvatarSession.connect(
      {
        onToolCall: handleToolCalls,
        onTranscript: (_role, text) => {
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
        onDisconnected: () => void endSession("visitor_closed"),
        onError: (message) => {
          setErrorMessage(message);
          void endSession("visitor_closed", "error");
        },
      },
      {
        sessionUrl: "/api/embed/session",
        sessionBody: { public_key: agent.key, origin: window.location.origin },
      }
    );

    sessionRef.current = session;
    roomNameRef.current = session.room.name;
    activeKeyRef.current = agent.key;
    setActiveKey(agent.key);
    setAudioBlocked(!session.canPlaybackAudio);
    setCardStatus(agent.key, "listening");
    setTranscript(`Say hello to ${agent.name}.`);
    armIdleTimer();
    hardTimerRef.current = setTimeout(() => void endSession("hard_timeout"), DEMO_HARD_TIMEOUT_MS);
    warnTimerRef.current = setTimeout(() => setEndingSoon(true), DEMO_WARNING_MS);
  }

  function enterQueue(key: string) {
    setCardStatus(key, "queued");
    clearQueuePoll();
    queuePollRef.current = setInterval(async () => {
      const agent = DEMO_AGENTS.find((a) => a.key === key);
      if (!agent) return;
      try {
        const capRes = await fetch(`/api/embed/capacity/${key}`);
        const cap = (await capRes.json()) as { available?: boolean };
        if (cap.available === false) return; // keep polling
        clearQueuePoll();
        try {
          await beginConnect(agent);
        } catch {
          // Lost the race to another visitor between the poll and connect --
          // this is the one place a real server-side queue would have
          // guaranteed a turn; here it just resumes polling instead of
          // showing a dead end.
          enterQueue(key);
        }
      } catch {
        // Network hiccup -- keep polling.
      }
    }, QUEUE_POLL_MS);
  }

  async function startDemo(agent: DemoAgent) {
    if (busyRef.current) return;
    busyRef.current = true;
    setCardStatus(agent.key, "checking");
    try {
      const capRes = await fetch(`/api/embed/capacity/${agent.key}`);
      const cap = (await capRes.json()) as { available?: boolean };
      if (cap.available === false) {
        enterQueue(agent.key);
        return;
      }
    } catch {
      // Fail open on the display check -- the real gate is server-side in beginConnect.
    }
    try {
      await beginConnect(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/busy|capacity/i.test(message)) {
        enterQueue(agent.key);
      } else {
        setCardStatus(agent.key, "error");
        setErrorMessage(message || "Unable to start the conversation.");
      }
    } finally {
      busyRef.current = false;
    }
  }

  function cancelQueue(key: string) {
    clearQueuePoll();
    setCardStatus(key, "idle");
  }

  // The connected card becomes the visual focus: it moves into the center
  // grid slot (order 1 of 3) via CSS `order`, not by reordering the DOM --
  // reordering the actual elements would remount LiveKitFace's <video>,
  // interrupting the live track. The other two keep their original
  // relative order on whichever side is left, so a second card taking
  // focus doesn't also shuffle which side the first one recedes to.
  const activeIndex = activeKey ? DEMO_AGENTS.findIndex((a) => a.key === activeKey) : -1;
  function cardOrder(index: number, focusIndex: number): number {
    if (focusIndex === -1) return index;
    if (index === focusIndex) return 1;
    const others = DEMO_AGENTS.map((_, i) => i).filter((i) => i !== focusIndex);
    return others.indexOf(index) === 0 ? 0 : 2;
  }

  return (
    <section className="l-section" id="try-avatars">
      <div className="l-section-title l-center">
        <span className="l-kicker">Try it live</span>
        <h2>Talk to a real avatar, right now</h2>
        <p>
          Three working agents, live on our own GPU box — no signup, no
          waiting for a demo call.
        </p>
      </div>

      <div className="l-demo-grid">
        {DEMO_AGENTS.map((agent, index) => {
          const status = statuses[agent.key] ?? "idle";
          const isActive = activeKey === agent.key;

          return (
            <div
              className={`l-demo-card${isActive ? " l-demo-card-focused" : activeKey ? " l-demo-card-receded" : ""}`}
              style={{ order: cardOrder(index, activeIndex) }}
              key={agent.key}
            >
              <div className="l-demo-stage">
                <LiveKitFace
                  videoTrack={isActive ? videoTrack : null}
                  audioTrack={isActive ? audioTrack : null}
                  isConnected={isActive && status === "listening"}
                  width={220}
                  height={260}
                  idleVideoSrc={agent.idleVideoSrc}
                />
                {isActive && isSpeaking ? <span className="l-demo-speaking-dot" /> : null}
              </div>

              <h3>{agent.name}</h3>
              <p className="l-demo-business">{agent.business}</p>
              <p className="l-demo-blurb">{agent.blurb}</p>

              {isActive ? (
                <>
                  <p className="l-demo-transcript">{transcript}</p>
                  {endingSoon ? <p className="l-demo-warning">Ending in 30s…</p> : null}
                  {audioBlocked ? (
                    <button
                      type="button"
                      className="l-btn l-btn-ghost"
                      onClick={() =>
                        void sessionRef.current?.startAudio().then((ok) => setAudioBlocked(!ok))
                      }
                    >
                      Enable sound
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="l-btn l-btn-primary"
                    onClick={() => void endSession("visitor_closed")}
                  >
                    End conversation
                  </button>
                </>
              ) : status === "queued" ? (
                <>
                  <p className="l-demo-transcript">You&apos;re in queue — waiting for a free seat…</p>
                  <button type="button" className="l-btn l-btn-ghost" onClick={() => cancelQueue(agent.key)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {status === "error" && errorMessage ? (
                    <p className="l-demo-error">{errorMessage}</p>
                  ) : null}
                  <button
                    type="button"
                    className="l-btn l-btn-primary"
                    disabled={status === "checking" || status === "connecting"}
                    onClick={() => void startDemo(agent)}
                  >
                    {status === "checking"
                      ? "Checking…"
                      : status === "connecting"
                        ? "Connecting…"
                        : status === "error"
                          ? "Try again"
                          : status === "ended"
                            ? "Start a new chat"
                            : "Start talking"}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
