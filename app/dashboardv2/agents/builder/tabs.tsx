"use client";

/**
 * The builder's tab contents. Every field the old create form / edit dialog
 * had appears here exactly once (AGENT_BUILDER_REDESIGN.md section 3); the
 * logic is ported from those components, only the layout changed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VOICE_CATALOG, VOICE_FILTERS, matchesVoiceFilter, voiceName, type VoiceFilter } from "@/lib/voices";
import type { ClientTool, Tool } from "@/lib/tools/model";
import { DOC_EXTENSIONS, formatDocMeta, type AgentDocument, type Avatar } from "../shared";
import type { AgentForm } from "../useAgentForm";

/* ------------------------------------------------------------------ */
/* building blocks                                                    */
/* ------------------------------------------------------------------ */

export function SectionCard({
  n,
  title,
  children,
  footer,
  action,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="lb-card">
      <header className="lb-card-head">
        <span className="lb-card-num">{String(n).padStart(2, "0")}</span>
        <h3 className="lb-card-title">{title}</h3>
        {action ? <span className="lb-card-action">{action}</span> : null}
      </header>
      <div className="lb-card-body">{children}</div>
      {footer ? <div className="lb-card-foot">{footer}</div> : null}
    </section>
  );
}

// Same stroke as the dashboard's RowChevron; the text glyphs (⌄ ▾ ‹) fall back
// to whatever font has them and came out a different size on every machine.
const CHEVRON_PATHS = { down: "m3.5 6 4.5 5 4.5-5", up: "m3.5 10 4.5-5 4.5 5", left: "m10 3.5-5 4.5 5 4.5" };

export function Chevron({ dir, size = 14 }: { dir: keyof typeof CHEVRON_PATHS; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d={CHEVRON_PATHS[dir]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={`lb-switch${checked ? " lb-switch-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="lb-switch-knob" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* PROMPT                                                             */
/* ------------------------------------------------------------------ */

export function PromptTab({ f, nameRef }: { f: AgentForm; nameRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <>
      <SectionCard n={1} title="Agent name">
        <input
          ref={nameRef}
          id="lb-agent-name"
          className="lb-input"
          type="text"
          value={f.form.name}
          onChange={(e) => f.update("name", e.target.value)}
          placeholder="e.g. Front Desk Assistant"
          aria-required="true"
        />
      </SectionCard>
      <SectionCard n={2} title="Opening intro">
        <textarea
          className="lb-input"
          rows={3}
          value={f.form.openingIntro}
          onChange={(e) => f.update("openingIntro", e.target.value)}
          placeholder="Hi, thanks for calling Acme Dental! I'm here to help with appointments and questions — what can I do for you?"
        />
        <p className="lb-help">
          Spoken word-for-word the moment a session starts — before anything else. Leave blank for a
          generic, improvised greeting instead.
        </p>
      </SectionCard>
      <SectionCard n={3} title="System prompt">
        <textarea
          className="lb-input lb-textarea-tall"
          value={f.form.systemPrompt}
          onChange={(e) => f.update("systemPrompt", e.target.value)}
          placeholder="You are a friendly front desk assistant for Acme Dental. Help visitors check appointment availability and answer questions about the clinic."
        />
      </SectionCard>
      <SectionCard n={4} title="Knowledge">
        <p className="lb-help" style={{ marginTop: 0 }}>
          Menus, price lists, policies, FAQs. The agent answers from these and won&apos;t invent
          details they don&apos;t cover. PDF, Word, text, Markdown or CSV.
        </p>
        {f.isCreate || !f.agent ? (
          <PendingKnowledge files={f.pendingFiles} onChange={f.setPendingFiles} />
        ) : (
          <SavedKnowledge
            agentId={f.agent.id}
            initialDocuments={f.agent.documents ?? []}
            onChanged={() => void f.refreshAgent()}
          />
        )}
      </SectionCard>
    </>
  );
}

function DropZone({ disabled, onFiles }: { disabled?: boolean; onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`lb-drop${over ? " lb-drop-over" : ""}${disabled ? " lb-drop-disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFiles(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      <span className="lb-drop-text">Drop files here, or</span>
      <button type="button" className="l-btn l-btn-ghost lb-btn-sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Upload documents
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DOC_EXTENSIONS}
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}

/* Saved agent: uploads and deletes take effect immediately (ported from KnowledgeFiles). */
function SavedKnowledge({
  agentId,
  initialDocuments,
  onChanged,
}: {
  agentId: string;
  initialDocuments: AgentDocument[];
  onChanged: () => void;
}) {
  // Owns its list rather than reading the agent prop, so a new upload shows
  // up without re-seeding (and so wiping) the user's unsaved field edits.
  const [documents, setDocuments] = useState<AgentDocument[]>(initialDocuments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDocuments(initialDocuments);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/documents`);
    if (res.ok) setDocuments(await res.json());
    onChanged();
  }, [agentId, onChanged]);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    // Sequential: the backend caps files per agent and a parallel burst races that check.
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/agents/${agentId}/documents`, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || body.error || `Couldn't upload ${file.name}.`);
        break;
      }
    }
    await reload();
    setBusy(false);
  }

  async function remove(doc: AgentDocument) {
    if (!window.confirm(`Remove "${doc.filename}" from this agent's knowledge?`)) return;
    setBusy(true);
    await fetch(`/api/agents/${agentId}/documents/${doc.id}`, { method: "DELETE" });
    await reload();
    setBusy(false);
  }

  return (
    <>
      {documents.length > 0 ? (
        <ul className="lb-files">
          {documents.map((doc) => (
            <li key={doc.id} className="lb-file">
              <span className="lb-file-info">
                <span className="lb-file-name">{doc.filename}</span>
                <span className="lb-file-meta">{formatDocMeta(doc)}</span>
              </span>
              <button type="button" className="lb-x" aria-label={`Remove ${doc.filename}`} disabled={busy} onClick={() => void remove(doc)}>
                &times;
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <DropZone disabled={busy} onFiles={(fs) => void upload(fs)} />
      {busy ? <p className="lb-help">Uploading…</p> : null}
      {error ? <p className="lb-error">{error}</p> : null}
    </>
  );
}

/* Create mode: held until the agent exists (ported from PendingKnowledgeFiles). */
function PendingKnowledge({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  return (
    <>
      {files.length > 0 ? (
        <ul className="lb-files">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="lb-file">
              <span className="lb-file-info">
                <span className="lb-file-name">{file.name}</span>
                <span className="lb-file-meta">
                  {Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB · uploads when you create the agent
                </span>
              </span>
              <button
                type="button"
                className="lb-x"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <DropZone onFiles={(fs) => onChange([...files, ...fs])} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* AVATAR                                                             */
/* ------------------------------------------------------------------ */

export function AvatarTab({ f }: { f: AgentForm }) {
  const [query, setQuery] = useState("");
  const shown = f.pickable.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = f.selectedAvatar;
  const keyable = Boolean(selected?.supports_transparency);
  return (
    <>
      <SectionCard n={1} title="Select avatar">
        <input
          className="lb-input lb-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search avatars by name…"
          aria-label="Search avatars"
        />
        <div className="lb-avatar-grid" role="radiogroup" aria-label="Avatar">
          {!f.loaded
            ? Array.from({ length: 6 }, (_, i) => <div key={i} className="lb-avatar-card lb-skeleton" aria-hidden="true" />)
            : shown.map((a) => (
                <AvatarCard key={a.id} avatar={a} selected={a.id === f.form.avatarId} onSelect={() => f.update("avatarId", a.id)} />
              ))}
        </div>
        {f.loaded && shown.length === 0 ? (
          <p className="lb-help">{f.pickable.length === 0 ? "No avatars are available on this environment yet." : "No avatar matches that name."}</p>
        ) : null}
        {f.agent?.status === "live" && f.form.avatarId !== f.agent.avatar_id ? (
          <p className="lb-help">
            This agent is live. Saving swaps the face for new conversations — anyone already talking to it
            keeps the one they started with.
          </p>
        ) : null}
      </SectionCard>
      <SectionCard
        n={2}
        title="Display mode"
        footer={
          <div className="lb-toggle-row">
            <span className="lb-toggle-text">
              <span className="lb-toggle-label">Transparent (frameless)</span>
              <span className="lb-help" style={{ margin: 0 }}>
                The avatar floats on the customer&apos;s page with its background removed, instead of sitting in
                a chat panel. Needs an avatar built against a green screen — on any other avatar the background
                stays.
              </span>
            </span>
            <Switch
              checked={f.form.transparent}
              onChange={(v) => f.update("transparent", v)}
              label="Transparent (frameless)"
              title={keyable ? undefined : "Needs a green-screen avatar"}
            />
          </div>
        }
      >
        {f.form.transparent && !keyable ? (
          <p className="lb-warn">
            {selected?.name ? `"${selected.name}"` : "This avatar"} wasn&apos;t shot against a green screen, so
            there is no background to remove — it will appear in a plain rectangle. Pick an avatar marked{" "}
            <strong>Transparent ready</strong> instead.
          </p>
        ) : (
          <p className="lb-help" style={{ margin: 0 }}>
            {keyable ? "This avatar is transparent-ready." : "This avatar keeps its background."}
          </p>
        )}
      </SectionCard>
    </>
  );
}

function AvatarCard({ avatar, selected, onSelect }: { avatar: Avatar; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={`lb-avatar-card${selected ? " lb-avatar-selected" : ""}`} onClick={onSelect}>
      {avatar.preview_image_url ? (
        <img className="lb-avatar-img" src={avatar.preview_image_url} alt="" />
      ) : (
        <span className="lb-avatar-img lb-avatar-initial" aria-hidden="true">
          {avatar.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="lb-avatar-name" title={avatar.name}>
        {avatar.name}
      </span>
      {avatar.supports_transparency ? (
        <span className="lb-badge-green" title="Shot against a green screen — can be shown with no background">
          TRANSPARENT READY
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* VOICE (replaces the voice picker dialog in this dashboard)         */
/* ------------------------------------------------------------------ */

export function VoiceTab({ f }: { f: AgentForm }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [filter, setFilter] = useState<VoiceFilter>("All");
  const [query, setQuery] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);

  const visible = useMemo(
    () =>
      VOICE_CATALOG.filter(
        (v) =>
          matchesVoiceFilter(v, filter) &&
          `${voiceName(v)} ${v.id}`.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [filter, query]
  );

  // one preview at a time; stop it when leaving the tab
  useEffect(() => () => audioRef.current?.pause(), []);

  function togglePlay(id: string) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = `/voice-samples/${id}.wav`;
    void audio.play();
    setPlayingId(id);
  }

  function select(id: string) {
    f.update("voice", id);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocused((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocused((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const v = visible[focused];
      if (v) select(v.id);
    } else if (e.key === " ") {
      e.preventDefault();
      const v = visible[focused];
      if (v) togglePlay(v.id);
    }
  }

  return (
    <SectionCard n={1} title="Select voice">
      <div className="lb-voice-controls">
        <div className="l-voice-filters" role="group" aria-label="Filter voices">
          {VOICE_FILTERS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={filter === v}
              className={`l-voice-filter-pill${filter === v ? " l-voice-filter-active" : ""}`}
              onClick={() => {
                setFilter(v);
                setFocused(0);
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <input
          className="lb-input lb-search"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocused(0);
          }}
          placeholder="Search voices…"
          aria-label="Search voices"
        />
      </div>
      <div className="lb-voice-list" role="listbox" aria-label="Voices" tabIndex={0} onKeyDown={onKeyDown}>
        {visible.map((voice, i) => {
          const playing = playingId === voice.id;
          const current = f.form.voice === voice.id;
          return (
            <div
              key={voice.id}
              role="option"
              aria-selected={current}
              className={`l-voice-row${current ? " l-voice-row-current" : ""}${i === focused ? " l-voice-row-focused" : ""}`}
              onClick={() => select(voice.id)}
            >
              <button
                type="button"
                className={`l-voice-play${playing ? " l-voice-play-active" : ""}`}
                aria-label={playing ? `Stop preview of ${voiceName(voice)}` : `Preview ${voiceName(voice)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay(voice.id);
                }}
              >
                {playing ? (
                  <span className="l-voice-eq" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2 1.5v9l8-4.5-8-4.5z" fill="currentColor" />
                  </svg>
                )}
              </button>
              <div className="l-voice-info">
                <span className="l-voice-name">
                  {voiceName(voice)}
                  {current ? <span className="l-voice-current-tag">Current</span> : null}
                </span>
                <span className="l-voice-descriptor">{voice.descriptor}</span>
              </div>
              <span className="l-voice-tag">{voice.tag}</span>
            </div>
          );
        })}
        {visible.length === 0 ? <p className="lb-help">No voice matches.</p> : null}
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* EMBED (edit mode)                                                  */
/* ------------------------------------------------------------------ */

export function EmbedTab({ f, onGoLive }: { f: AgentForm; onGoLive: () => void }) {
  const agent = f.agent;
  const embed = agent?.embed ?? null;
  const [origins, setOrigins] = useState(embed?.allowed_origins.join("\n") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [studioOrigin, setStudioOrigin] = useState("");

  useEffect(() => setStudioOrigin(window.location.origin), []);
  useEffect(() => {
    if (embed) setOrigins(embed.allowed_origins.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed?.allowed_origins?.join("\n")]);

  if (!agent) return null;
  if (!embed) {
    return (
      <SectionCard n={1} title="Embed widget">
        <p className="lb-help" style={{ marginTop: 0 }}>
          The chat widget and its install snippet are created the first time the agent goes live.
        </p>
        <button type="button" className="l-btn l-btn-primary lb-btn-sm" disabled={f.busy} onClick={onGoLive}>
          Go live
        </button>
        {f.statusError ? <p className="lb-error">{f.statusError}</p> : null}
      </SectionCard>
    );
  }

  const snippet = `<script src="${studioOrigin}/widget.js" data-key="${embed.public_key}"></script>`;

  async function saveOrigins() {
    setBusy(true);
    setError(null);
    const list = origins
      .split(/[\n,]/)
      .map((o) => o.trim())
      .filter(Boolean);
    const res = await fetch(`/api/agents/${agent!.id}/embed`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_origins: list }),
    });
    setBusy(false);
    if (res.ok) {
      void f.refreshAgent();
    } else {
      const payload = await res.json().catch(() => null);
      setError(payload?.error ?? "Unable to save the allowed websites.");
    }
  }

  function copySnippet() {
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      <p className="lb-help lb-tab-intro">
        {agent.status === "live"
          ? "Anyone on an allowed website below can talk to this agent through a chat bubble."
          : agent.status === "provisioning"
            ? "Starting up — the widget will go live automatically in about a minute, with no further action needed here."
            : "This widget is offline while the agent is in Draft — take it live to reactivate it. The install snippet below still works once you do; nothing needs to change on the customer's site."}
      </p>
      <SectionCard
        n={1}
        title="Allowed websites"
        footer={
          <button type="button" className="l-btn l-btn-ghost lb-btn-sm" disabled={busy} onClick={() => void saveOrigins()}>
            {busy ? "Saving…" : "Save allowed websites"}
          </button>
        }
      >
        <textarea
          className="lb-input lb-mono"
          rows={4}
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          placeholder="https://example.com"
          aria-label="Allowed websites, one per line"
        />
        <p className="lb-help">One per line, e.g. https://example.com — no trailing slash.</p>
        {embed.allowed_origins.length === 0 ? (
          <p className="lb-warn">No website is allowed yet — the widget will not render anywhere until you add one.</p>
        ) : null}
        {error ? <p className="lb-error">{error}</p> : null}
      </SectionCard>
      <SectionCard
        n={2}
        title="Install snippet"
        footer={
          <button type="button" className="l-btn l-btn-ghost lb-btn-sm" onClick={copySnippet}>
            {copied ? "Copied ✓" : "Copy snippet"}
          </button>
        }
      >
        <pre className="lb-code">{snippet}</pre>
        <p className="lb-help">
          Paste this into the HTML of any website listed above. It only starts talking to this agent —
          pricing/plans/etc. text is whatever this agent&apos;s own instructions say.
        </p>
      </SectionCard>
      <ClientToolsSnippet tools={f.form.tools} />
    </>
  );
}

/** Shown once the agent has client tools: the page code that answers them. */
function ClientToolsSnippet({ tools }: { tools: Tool[] }) {
  const [copied, setCopied] = useState(false);
  const clientTools = tools.filter((t): t is ClientTool => t.type === "client");
  if (!clientTools.length) return null;
  const code = [
    "<script>",
    "  // after the widget.js tag. One handler per client tool; registered before",
    "  // a visitor starts talking. A tool with no handler answers an error.",
    ...clientTools.map((t) => {
      const args = Object.keys(t.parameters?.properties ?? {});
      return [
        `  AvatarStudio.registerToolHandler("${t.name}", async (${args.length ? `{ ${args.join(", ")} }` : "args"}) => {`,
        `    // ${t.awaitResult ? "your code here; the return value is sent back to the agent" : "your code here (the agent does not wait for a result)"}`,
        "    return { ok: true };",
        "  });",
      ].join("\n");
    }),
    "</script>",
  ].join("\n");
  function copy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <SectionCard
      n={3}
      title="Client tool handlers"
      footer={
        <button type="button" className="l-btn l-btn-ghost lb-btn-sm" onClick={copy}>
          {copied ? "Copied ✓" : "Copy code"}
        </button>
      }
    >
      <pre className="lb-code">{code}</pre>
      <p className="lb-help">
        Client tools run in the customer&apos;s page. Add this after the install snippet and fill in what each tool
        should do — open a form, go to a page, read the cart. Calls with no handler reach the agent as an error.
      </p>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* ADVANCED (edit mode)                                               */
/* ------------------------------------------------------------------ */

export function AdvancedTab({
  f,
  canCascade,
  testing,
  onTestCascade,
  onToggleLive,
  onDelete,
}: {
  f: AgentForm;
  canCascade: boolean;
  testing: boolean;
  onTestCascade: () => void;
  onToggleLive: () => void;
  onDelete: () => void;
}) {
  const status = f.agent?.status;
  let n = 0;
  return (
    <>
      {canCascade ? (
        <SectionCard
          n={++n}
          title="Test cascade (beta)"
          footer={
            <button type="button" className="l-btn l-btn-ghost lb-btn-sm" disabled={testing || f.busy} onClick={onTestCascade}>
              Test cascade
            </button>
          }
        >
          <p className="lb-help" style={{ margin: 0 }}>
            Runs this agent on speech-to-text → Gemini 3 Flash → Gemini TTS instead of Gemini Live, in the
            preview on the right. Test only — your live widget is unchanged.
          </p>
        </SectionCard>
      ) : null}
      <SectionCard
        n={++n}
        title="Availability"
        footer={
          <button
            type="button"
            className={status === "live" ? "l-btn l-btn-ghost lb-btn-sm" : "l-btn l-btn-primary lb-btn-sm"}
            disabled={f.busy || status === "provisioning"}
            onClick={onToggleLive}
          >
            {status === "provisioning" ? "Starting…" : status === "live" ? "Take offline" : "Go live"}
          </button>
        }
      >
        <p className="lb-help" style={{ margin: 0 }}>
          {status === "live"
            ? "Live: the embed widget answers visitors on your allowed websites."
            : status === "provisioning"
              ? "Going live — this takes a moment."
              : "Offline (Draft): the embed widget is off until the agent goes live."}
        </p>
        {f.statusError ? <p className="lb-error">{f.statusError}</p> : null}
      </SectionCard>
      <SectionCard
        n={++n}
        title="Danger zone"
        footer={
          <button type="button" className="lb-btn-danger" onClick={onDelete}>
            Delete agent
          </button>
        }
      >
        <p className="lb-help" style={{ margin: 0 }}>
          Deletes the agent, its knowledge files and its embed widget. This can&apos;t be undone.
        </p>
      </SectionCard>
    </>
  );
}
