"use client";

/**
 * Full-page, tabbed agent builder (AGENT_BUILDER_REDESIGN.md), replacing the
 * create form and the edit dialog on /dashboardv2/agents:
 *   /dashboardv2/agents/new   create mode
 *   /dashboardv2/agents/:id   edit mode
 *   ?tab=prompt|avatar|voice|tools|embed|advanced
 * Left: tabs of numbered section cards. Right: sticky preview with Start call
 * (the existing live test) and a summary strip. Frontend only -- every request
 * goes through useAgentForm with the same payloads as before.
 */

import "../../builder.css";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { voiceById, voiceName } from "@/lib/voices";
import { Spinner } from "../../ui";
import { LiveTestPanel } from "../shared";
import { useAgentForm, type AgentForm } from "../useAgentForm";
import { isCustom } from "@/lib/tools/model";
import { AdvancedTab, AvatarTab, Chevron, EmbedTab, PromptTab, VoiceTab } from "./tabs";
import ToolsTab from "./tools/ToolsTab";

type TabId = "prompt" | "avatar" | "voice" | "tools" | "embed" | "advanced";
const CORE_TABS: { id: TabId; label: string }[] = [
  { id: "prompt", label: "Prompt" },
  { id: "avatar", label: "Avatar" },
  { id: "voice", label: "Voice" },
  { id: "tools", label: "Tools" },
];
const MORE_TABS: { id: TabId; label: string }[] = [
  { id: "embed", label: "Embed" },
  { id: "advanced", label: "Advanced" },
];
const FLASH_KEY = "lb-flash";

export default function AgentBuilder({ agentId }: { agentId?: string }) {
  const f = useAgentForm(agentId);
  const router = useRouter();
  const params = useSearchParams();
  const nameRef = useRef<HTMLInputElement>(null);
  const [testMode, setTestMode] = useState<null | "live" | "cascade">(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nameHint, setNameHint] = useState(false);

  const tabs = f.isCreate ? CORE_TABS : [...CORE_TABS, ...MORE_TABS];
  const requested = params.get("tab") as TabId | null;
  const tab: TabId = tabs.some((t) => t.id === requested) ? (requested as TabId) : "prompt";

  const goTab = useCallback(
    (t: TabId) => {
      const q = new URLSearchParams(params.toString());
      q.set("tab", t);
      q.delete("created");
      router.replace(`?${q.toString()}`, { scroll: false });
    },
    [params, router]
  );

  // "Agent created" toast after the create -> edit redirect (plus any upload warning)
  useEffect(() => {
    if (params.get("created") !== "1") return;
    let flash = "Agent created";
    try {
      const stored = sessionStorage.getItem(FLASH_KEY);
      if (stored) flash = stored;
      sessionStorage.removeItem(FLASH_KEY);
    } catch {
      /* storage blocked: plain toast */
    }
    setToast(flash);
    const q = new URLSearchParams(params.toString());
    q.delete("created");
    router.replace(`?${q.toString()}`, { scroll: false });
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // leave-page guard
  useEffect(() => {
    if (!f.dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [f.dirty]);

  const confirmLeave = useCallback(
    (e?: React.MouseEvent) => {
      if (f.dirty && !window.confirm("You have unsaved changes. Leave without saving?")) {
        e?.preventDefault();
        return false;
      }
      return true;
    },
    [f.dirty]
  );

  async function handleCreate() {
    if (!f.form.name.trim()) {
      setNameHint(true);
      goTab("prompt");
      setTimeout(() => nameRef.current?.focus(), 50);
      return;
    }
    const { id, warning } = await f.create();
    if (!id) return;
    try {
      sessionStorage.setItem(FLASH_KEY, warning ?? "Agent created");
    } catch {
      /* fine */
    }
    router.replace(`/dashboardv2/agents/${id}?tab=embed&created=1`);
  }

  async function handleSaveAndLive() {
    if (f.dirty && !(await f.save())) return;
    await f.setStatus("live");
  }

  async function handleToggleLive() {
    await f.setStatus(f.agent?.status === "live" ? "draft" : "live");
  }

  async function handleDelete() {
    if (!f.agent) return;
    if (!window.confirm(`Delete agent "${f.agent.name}"?`)) return;
    if (await f.remove()) router.push("/dashboardv2/agents");
  }

  if (f.loaded && f.loadError) {
    return (
      <div className="lb-missing">
        <p>{f.loadError}</p>
        <Link href="/dashboardv2/agents" className="l-btn l-btn-ghost">
          Back to agents
        </Link>
      </div>
    );
  }

  const status = f.agent?.status;
  const statusText = f.isCreate ? "Draft" : status === "live" ? "Live" : status === "provisioning" ? "Starting…" : "Offline";
  const canTest = !f.isCreate && Boolean(f.agent);
  const canCascade = canTest && f.selectedAvatar?.provider === "anam";
  const tabIndex = CORE_TABS.findIndex((t) => t.id === tab);

  const stepDone: Record<TabId, boolean> = {
    prompt: Boolean(f.form.name.trim()),
    avatar: Boolean(f.form.avatarId),
    voice: Boolean(f.form.voice),
    tools: f.form.tools.some(isCustom),
    embed: false,
    advanced: false,
  };

  return (
    <div className="lb">
      {/* ---------------- top bar ---------------- */}
      <header className="lb-top">
        <div className="lb-top-left">
          <Link href="/dashboardv2/agents" className="lb-back" aria-label="Back to agents" onClick={(e) => confirmLeave(e)}>
            <Chevron dir="left" size={16} />
          </Link>
          <span className="lb-crumb">
            <span className="lb-crumb-root">Agents</span>
            <span className="lb-crumb-sep">/</span>
            <span className="lb-crumb-name" title={f.form.name}>
              {f.form.name.trim() || "Untitled agent"}
            </span>
          </span>
          <span className={`lb-pill ${f.isCreate ? "lb-pill-grey" : status === "live" ? "lb-pill-green" : status === "provisioning" ? "lb-pill-amber" : "lb-pill-grey"}`}>
            {statusText}
          </span>
          {f.dirty ? <span className="lb-dirty" title="Unsaved changes" aria-label="Unsaved changes" /> : null}
        </div>
        <div className="lb-top-right">
          <button
            type="button"
            className="l-btn l-btn-ghost lb-btn-sm"
            disabled={!canTest || testMode !== null || f.busy}
            title={canTest ? "Opens a real, temporary live session — your mic will be requested." : "Create the agent first"}
            onClick={() => setTestMode("live")}
          >
            {testMode === "live" ? "Testing…" : "Test agent"}
          </button>
          {f.isCreate ? (
            <button
              type="button"
              className={`l-btn l-btn-primary lb-btn-sm${f.form.name.trim() ? "" : " lb-btn-soft-disabled"}`}
              aria-disabled={!f.form.name.trim() || f.busy}
              disabled={f.busy || !f.form.avatarId}
              onClick={() => void handleCreate()}
            >
              {f.busy ? (
                <>
                  <Spinner /> Creating…
                </>
              ) : (
                "Create agent"
              )}
            </button>
          ) : status === "live" ? (
            <button type="button" className="l-btn l-btn-primary lb-btn-sm" disabled={!f.dirty || f.busy} onClick={() => void f.save()}>
              {f.busy ? "Saving…" : "Save changes"}
            </button>
          ) : (
            <>
              <button type="button" className="l-btn l-btn-ghost lb-btn-sm" disabled={!f.dirty || f.busy} onClick={() => void f.save()}>
                {f.busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="l-btn l-btn-primary lb-btn-sm"
                disabled={f.busy || status === "provisioning"}
                onClick={() => void handleSaveAndLive()}
              >
                {status === "provisioning" ? "Starting…" : "Save & go live"}
              </button>
            </>
          )}
        </div>
      </header>
      {f.error || f.statusError || (nameHint && !f.form.name.trim()) ? (
        <div className="lb-banner" role="alert">
          {nameHint && !f.form.name.trim() ? "Give the agent a name first. " : null}
          {f.error ?? f.statusError}
        </div>
      ) : null}

      <div className="lb-body">
        {/* ---------------- left: tabs + cards ---------------- */}
        <div className="lb-left">
          <BuilderTabs
            tabs={tabs}
            active={tab}
            onChange={goTab}
            stepState={f.isCreate ? stepDone : null}
          />
          <div className="lb-panel" role="tabpanel" aria-labelledby={`lb-tab-${tab}`}>
            {tab === "prompt" ? <PromptTab f={f} nameRef={nameRef} /> : null}
            {tab === "avatar" ? <AvatarTab f={f} /> : null}
            {tab === "voice" ? <VoiceTab f={f} /> : null}
            {tab === "tools" ? <ToolsTab f={f} /> : null}
            {tab === "embed" && !f.isCreate ? <EmbedTab f={f} onGoLive={() => void handleSaveAndLive()} /> : null}
            {tab === "advanced" && !f.isCreate ? (
              <AdvancedTab
                f={f}
                canCascade={canCascade}
                testing={testMode !== null}
                onTestCascade={() => setTestMode("cascade")}
                onToggleLive={() => void handleToggleLive()}
                onDelete={() => void handleDelete()}
              />
            ) : null}
          </div>
          {f.isCreate ? (
            <footer className="lb-wizard">
              <button type="button" className="l-btn l-btn-ghost lb-btn-sm" disabled={tabIndex <= 0} onClick={() => goTab(CORE_TABS[tabIndex - 1].id)}>
                ← Back
              </button>
              {tabIndex < CORE_TABS.length - 1 ? (
                <button type="button" className="l-btn l-btn-primary lb-btn-sm" onClick={() => goTab(CORE_TABS[tabIndex + 1].id)}>
                  Next: {CORE_TABS[tabIndex + 1].label} →
                </button>
              ) : (
                <button type="button" className="l-btn l-btn-primary lb-btn-sm" disabled={f.busy || !f.form.avatarId} onClick={() => void handleCreate()}>
                  {f.busy ? "Creating…" : "Create agent"}
                </button>
              )}
            </footer>
          ) : null}
        </div>

        {/* ---------------- right: preview ---------------- */}
        <PreviewPanel
          f={f}
          testMode={testMode}
          setTestMode={setTestMode}
          canTest={canTest}
          statusText={statusText}
          onJump={goTab}
        />
      </div>

      {toast ? (
        <div className="lb-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

// Every tab is a visible tab. Embed and Advanced used to sit behind a "more"
// chevron at the end of the row (the spec's overflow menu); it read as if the
// two sections had been removed, so they are in the row like the rest.
function BuilderTabs({
  tabs,
  active,
  onChange,
  stepState,
}: {
  tabs: { id: TabId; label: string }[];
  active: TabId;
  onChange: (t: TabId) => void;
  stepState: Record<TabId, boolean> | null;
}) {
  const focusActive = useRef(false);

  // Arrow keys move focus with the selection, once the new tab is the active one.
  useEffect(() => {
    if (!focusActive.current) return;
    focusActive.current = false;
    document.getElementById(`lb-tab-${active}`)?.focus();
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      focusActive.current = tabs[next].id !== active;
      onChange(tabs[next].id);
    }
  }

  return (
    <div className="lb-tabs-wrap">
      <div className="lb-tabs" role="tablist" aria-label="Agent builder" onKeyDown={onKeyDown}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`lb-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            tabIndex={active === t.id ? 0 : -1}
            className={`lb-tab${active === t.id ? " lb-tab-active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {stepState ? (
              <span className={`lb-step${stepState[t.id] ? " lb-step-done" : ""}`} aria-hidden="true">
                {stepState[t.id] ? "✓" : i + 1}
              </span>
            ) : null}
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PreviewPanel({
  f,
  testMode,
  setTestMode,
  canTest,
  statusText,
  onJump,
}: {
  f: AgentForm;
  testMode: null | "live" | "cascade";
  setTestMode: (m: null | "live" | "cascade") => void;
  canTest: boolean;
  statusText: string;
  onJump: (t: TabId) => void;
}) {
  const avatar = f.selectedAvatar;
  const keyable = Boolean(avatar?.supports_transparency);
  const checker = f.form.transparent && keyable;
  const voice = voiceById(f.form.voice);
  return (
    <aside className="lb-right">
      <div className="lb-preview-wrap">
        <div className={`lb-preview${checker ? " lb-preview-checker" : ""}${testMode ? " lb-preview-live" : ""}`}>
          {testMode && f.agent ? (
            <LiveTestPanel
              key={testMode}
              agentId={f.agent.id}
              pipeline={testMode === "cascade" ? "cascade" : undefined}
              stopLabel="End call"
              stopClassName="lb-btn-endcall"
              onStopped={() => setTestMode(null)}
            />
          ) : (
            <>
              {avatar?.preview_image_url ? (
                <img className="lb-preview-media" src={avatar.preview_image_url} alt="" />
              ) : avatar?.preview_video_url ? (
                <video className="lb-preview-media" src={avatar.preview_video_url} muted loop autoPlay playsInline />
              ) : (
                <div className="lb-preview-media lb-preview-empty" aria-hidden="true">
                  {f.loaded ? (avatar?.name ?? "?").slice(0, 1).toUpperCase() : ""}
                </div>
              )}
              <button
                type="button"
                className="lb-call"
                disabled={!canTest || f.busy}
                title={canTest ? undefined : "Create the agent first"}
                onClick={() => setTestMode("live")}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3.6 1.8 5.8 1l1.5 3.4-1.4 1.1a8.6 8.6 0 0 0 4.6 4.6l1.1-1.4 3.4 1.5-.8 2.2c-.2.6-.8 1-1.4.9C6.7 12.8 3.2 9.3 2.7 3.2c0-.6.3-1.2.9-1.4z"
                    fill="currentColor"
                  />
                </svg>
                Start call
              </button>
            </>
          )}
        </div>
        <p className="lb-preview-note">
          {testMode === "cascade"
            ? "Cascade test (beta): speech-to-text → Gemini 3 Flash → Gemini TTS."
            : canTest
              ? "Start call opens a real, temporary live session — your mic will be requested. It's separate from going live on your site."
              : "Create the agent to test it here."}
        </p>
        <div className="lb-chips">
          <button type="button" className="lb-chip" onClick={() => onJump("avatar")}>
            <span className="lb-chip-label">Avatar</span>
            <span className="lb-chip-value">{avatar?.name ?? "—"}</span>
          </button>
          <button type="button" className="lb-chip" onClick={() => onJump("voice")}>
            <span className="lb-chip-label">Voice</span>
            <span className="lb-chip-value">{voiceName(voice)}</span>
          </button>
          <button type="button" className="lb-chip" onClick={() => onJump("tools")}>
            <span className="lb-chip-label">Tools</span>
            <span className="lb-chip-value">{f.form.tools.filter(isCustom).length}</span>
          </button>
          <button type="button" className="lb-chip" onClick={() => onJump(f.isCreate ? "prompt" : "advanced")}>
            <span className="lb-chip-label">Status</span>
            <span className="lb-chip-value">{statusText}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
