"use client";

/**
 * The builder's tab contents. Every field the old create form / edit dialog
 * had appears here exactly once (AGENT_BUILDER_REDESIGN.md section 3); the
 * logic is ported from those components, only the layout changed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VOICE_CATALOG, type VoiceTag } from "@/lib/voices";
import {
  CONNECTOR_PRESETS,
  DOC_EXTENSIONS,
  ToolTester,
  formatDocMeta,
  headersToText,
  newParam,
  newTool,
  textToHeaders,
  type AgentDocument,
  type Avatar,
  type ToolConfig,
  type ToolParameter,
  type ToolType,
} from "../shared";
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

const VOICE_FILTERS: (VoiceTag | "All")[] = ["All", "Male", "Female", "British"];

export function VoiceTab({ f }: { f: AgentForm }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [filter, setFilter] = useState<VoiceTag | "All">("All");
  const [query, setQuery] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);

  const visible = useMemo(
    () =>
      VOICE_CATALOG.filter((v) => (filter === "All" || v.tag === filter) && v.id.toLowerCase().includes(query.trim().toLowerCase())),
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
                aria-label={playing ? `Stop preview of ${voice.id}` : `Preview ${voice.id}`}
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
                  {voice.id}
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
/* TOOLS                                                              */
/* ------------------------------------------------------------------ */

export function ToolsTab({ f }: { f: AgentForm }) {
  const tools = f.form.tools;
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const setTools = (next: ToolConfig[]) => f.update("tools", next);
  const updateTool = (id: string, patch: Partial<ToolConfig>) => setTools(tools.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeTool = (id: string) => setTools(tools.filter((t) => t.id !== id));

  function add(type: ToolType) {
    const t = newTool(type);
    setTools([...tools, t]);
    setOpen(t.id);
    setMenu(false);
  }

  return (
    <>
      <div className="lb-tools-head">
        <span className="lb-help" style={{ margin: 0 }}>
          Create a tool for this agent
        </span>
        <div className="lb-menu" ref={menuRef}>
          <button type="button" className="l-btn l-btn-primary lb-btn-sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            + Add tool
          </button>
          {menu ? (
            <div className="lb-menu-pop" role="menu">
              <button type="button" role="menuitem" onClick={() => add("http_request")}>
                + API call tool
              </button>
              <button type="button" role="menuitem" onClick={() => add("tavily_search")}>
                + Web search (Tavily)
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <SectionCard n={1} title={`Tools · ${tools.length}`}>
        {tools.length === 0 ? (
          <p className="lb-help" style={{ margin: 0 }}>
            No tools yet. Add an API call or web search so the agent can act and look things up.
          </p>
        ) : (
          <ul className="lb-tool-list">
            {tools.map((tool) => {
              const expanded = open === tool.id;
              return (
                <li key={tool.id} className={`lb-tool${expanded ? " lb-tool-open" : ""}`}>
                  <div className="lb-tool-row">
                    <button
                      type="button"
                      className="lb-tool-toggle"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : tool.id)}
                    >
                      <span className="lb-tool-icon" aria-hidden="true">
                        {tool.type === "tavily_search" ? "⌕" : "{ }"}
                      </span>
                      <span className="lb-tool-text">
                        <span className="lb-tool-name">{tool.name || "(unnamed tool)"}</span>
                        <span className="lb-tool-desc">{tool.description || CONNECTOR_PRESETS[tool.type].label}</span>
                      </span>
                      <span className="lb-chev" aria-hidden="true">
                        {expanded ? "▴" : "▾"}
                      </span>
                    </button>
                    <button type="button" className="l-btn-delete" onClick={() => removeTool(tool.id)}>
                      Remove
                    </button>
                  </div>
                  {expanded ? (
                    <ToolForm
                      tool={tool}
                      agentId={f.agent?.id}
                      update={(patch) => updateTool(tool.id, patch)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

/* One tool's sub-form, unchanged from the old ToolEditor. */
function ToolForm({ tool, agentId, update }: { tool: ToolConfig; agentId?: string; update: (patch: Partial<ToolConfig>) => void }) {
  const isCustom = tool.type === "http_request";
  const updateParam = (i: number, patch: Partial<ToolParameter>) =>
    update({ parameters: tool.parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <div className="lb-tool-form l-field-scope">
      <span className="l-kicker">{CONNECTOR_PRESETS[tool.type].label}</span>
      <div className="l-field" style={{ marginTop: 10 }}>
        <label>Function name (what the agent calls it)</label>
        <input type="text" value={tool.name} onChange={(e) => update({ name: e.target.value })} placeholder="check_availability" />
      </div>
      <div className="l-field">
        <label>Description (tells the agent when to use this)</label>
        <input
          type="text"
          value={tool.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="Check appointment availability for a given date"
        />
      </div>
      {!isCustom ? (
        tool.type === "tavily_search" ? (
          <div className="l-field">
            <label>Tavily API key</label>
            <input type="text" spellCheck={false} value={tool.api_key} onChange={(e) => update({ api_key: e.target.value })} placeholder="tvly-..." />
            <p className="l-connector-note">
              Searches run against <em>your</em> Tavily account, so usage is billed to you, not shared
              platform-wide. Get a key at tavily.com — it&apos;s encrypted and shown only as
              &bull;&bull;&bull;&bull;1234 once saved; leave the dots alone to keep the saved key.
            </p>
          </div>
        ) : (
          <p className="l-connector-note">
            Built-in connector—no setup needed beyond the name and description above. The agent will pass its
            own search query automatically.
          </p>
        )
      ) : (
        <>
          <div className="l-tool-row">
            <div className="l-field" style={{ flex: "0 0 110px" }}>
              <label>Method</label>
              <select value={tool.method} onChange={(e) => update({ method: e.target.value })}>
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>
            </div>
            <div className="l-field" style={{ flex: 1, minWidth: 0 }}>
              <label>URL (use {"{param}"} to insert a parameter)</label>
              <input
                type="text"
                value={tool.url}
                onChange={(e) => update({ url: e.target.value })}
                placeholder="https://api.example.com/availability?date={date}"
              />
            </div>
          </div>
          <div className="l-field">
            <label>Parameters</label>
            {tool.parameters.map((param, i) => (
              <div className="l-param-row" key={i}>
                <input type="text" value={param.name} onChange={(e) => updateParam(i, { name: e.target.value })} placeholder="date" />
                <input
                  type="text"
                  value={param.description}
                  onChange={(e) => updateParam(i, { description: e.target.value })}
                  placeholder="Date in YYYY-MM-DD"
                />
                <label className="l-param-required">
                  <input type="checkbox" checked={param.required} onChange={(e) => updateParam(i, { required: e.target.checked })} />
                  required
                </label>
                <button
                  type="button"
                  className="l-btn-delete"
                  aria-label="Remove parameter"
                  onClick={() => update({ parameters: tool.parameters.filter((_, j) => j !== i) })}
                >
                  &times;
                </button>
              </div>
            ))}
            <button type="button" className="l-btn-expand" onClick={() => update({ parameters: [...tool.parameters, newParam()] })}>
              + Add parameter
            </button>
          </div>
          <div className="l-field">
            <label>Headers (one per line) — for API keys and auth</label>
            <textarea
              rows={2}
              spellCheck={false}
              value={headersToText(tool.headers)}
              onChange={(e) => update({ headers: textToHeaders(e.target.value) })}
              placeholder={"Authorization: Bearer your-api-key\nX-Api-Key: abc123"}
            />
            <p className="l-connector-note">
              {"{param}"} works here too. Keys are encrypted and shown only as &bull;&bull;&bull;&bull;1234 once
              saved — leave the dots alone to keep the saved key, or type a new value to replace it.
            </p>
          </div>
          {tool.method !== "GET" ? (
            <div className="l-field">
              <label>Request body (JSON) — {"{param}"} inserts a parameter</label>
              <textarea
                rows={3}
                spellCheck={false}
                value={tool.body_template ?? ""}
                onChange={(e) => update({ body_template: e.target.value || null })}
                placeholder={'{"subject": "{subject}", "source": "avatar"}'}
              />
            </div>
          ) : null}
          <ToolTester tool={tool} agentId={agentId} />
        </>
      )}
    </div>
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
    </>
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
