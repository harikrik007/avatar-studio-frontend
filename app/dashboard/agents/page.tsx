"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Room, RoomEvent, Track } from "livekit-client";
import type { RemoteTrack, RemoteTrackPublication, RemoteParticipant } from "livekit-client";
import FlowRail from "../FlowRail";
import { AvatarThumb, DialogPlaceholder, RowChevron, SkeletonRows, Spinner } from "../ui";
import { VoicePickerDialog } from "@/components/voice-picker-dialog";
import { voiceById, DEFAULT_VOICE } from "@/lib/voices";

type Avatar = {
  id: string;
  name: string;
  status: "uploading" | "processing" | "quality_check" | "ready" | "failed";
  // GET /api/avatars already returns this; the agent list just never read it,
  // which is why agent rows rendered an empty thumbnail.
  preview_video_url?: string | null;
};

type ToolParameter = {
  name: string;
  type: string;
  description: string;
  required: boolean;
};

type ToolType = "http_request" | "tavily_search";

type ToolConfig = {
  id: string;
  type: ToolType;
  name: string;
  description: string;
  parameters: ToolParameter[];
  method: string;
  url: string;
  headers: Record<string, string>;
  body_template?: string | null;
  // A built-in connector's own credential (e.g. tavily_search's Tavily key)
  // -- masked as ••••1234 once saved, same convention as header values.
  api_key: string;
};

// Headers are stored as an object but edited as text, one "Name: value" per
// line. A row-per-header UI has to keep its own identity while a name is
// half-typed, and this is both less code and the form people already have
// in hand -- an auth header is usually pasted straight from an API's docs.
function headersToText(headers: Record<string, string>): string {
  return Object.entries(headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function textToHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // Split on the first colon only: values contain them (Bearer tokens,
    // URLs) and must survive intact.
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    if (key) out[key] = line.slice(at + 1).trim();
  }
  return out;
}

// Built-in connectors: zero-config beyond a name -- realtime-avatar's
// agent/connectors.py already knows how to run these server-side, so the
// dashboard only needs to know their label and sensible defaults, not a
// URL/method/headers form. Custom "http_request" stays the general escape
// hatch for a business's own API.
const CONNECTOR_PRESETS: Record<ToolType, { label: string; defaultName: string; defaultDescription: string }> = {
  http_request: {
    label: "Custom API call",
    defaultName: "",
    defaultDescription: "",
  },
  tavily_search: {
    label: "Web search (Tavily)",
    defaultName: "web_search",
    defaultDescription: "Search the web for current, up-to-date information.",
  },
};

type AgentDocument = {
  id: string;
  filename: string;
  char_count: number;
  size_bytes: number;
  created_at: string;
};

type EmbedKey = {
  public_key: string;
  allowed_origins: string[];
  is_active: boolean;
  max_concurrent: number;
  accent_color: string;
  greeting_label: string;
};

type Deployment = {
  role: "primary" | "scaleout";
  status: "provisioning" | "running" | "draining" | "stopping" | "stopped" | "failed";
  status_detail: string | null;
  max_concurrent_sessions: number;
};

type Agent = {
  id: string;
  avatar_id: string;
  name: string;
  system_prompt: string;
  opening_intro: string;
  voice: string;
  tools_json: ToolConfig[];
  // "provisioning" is server-derived only -- set while a real RunPod pod is
  // booting after Make live was clicked (see backend's _set_agent_live).
  // Never sent by this dashboard as a PATCH value.
  status: "draft" | "provisioning" | "live";
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

const DOC_EXTENSIONS = ".pdf,.txt,.md,.csv,.docx";

function newTool(type: ToolType = "http_request"): ToolConfig {
  const preset = CONNECTOR_PRESETS[type];
  return {
    id: crypto.randomUUID(),
    type,
    name: preset.defaultName,
    description: preset.defaultDescription,
    parameters: [],
    method: "GET",
    url: "",
    headers: {},
    body_template: null,
    api_key: "",
  };
}

/* Runs one tool once against the real executor and shows what came back.
   Before this, checking a tool meant booting a GPU worker and talking to
   the avatar to find out a URL had a typo in it. */
function ToolTester({ tool, agentId }: { tool: ToolConfig; agentId?: string }) {
  const [open, setOpen] = useState(false);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; ms?: number } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    // Numbers must go over as numbers: a tool declaring latitude as a
    // number gets one from the model at runtime, so sending "51.5" here
    // would test something subtly different from the real call.
    const typed: Record<string, unknown> = {};
    for (const p of tool.parameters) {
      const raw = args[p.name] ?? "";
      if (raw === "") continue;
      typed[p.name] =
        p.type === "number" || p.type === "integer"
          ? Number(raw)
          : p.type === "boolean"
            ? raw === "true"
            : raw;
    }
    const res = await fetch("/api/tools/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args: typed, agent_id: agentId ?? null }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setResult({ ok: false, text: body.detail || body.error || "Test failed." });
      return;
    }
    setResult({
      ok: body.success,
      ms: body.duration_ms,
      text: JSON.stringify(body.success ? body.response.result ?? body.response : body.response, null, 2),
    });
  }

  if (tool.type !== "http_request") return null;

  return (
    <div className="l-tool-test">
      <button type="button" className="l-btn-expand" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide test" : "Test this tool"}
      </button>
      {open ? (
        <div className="l-tool-test-body">
          {tool.parameters.length > 0 ? (
            tool.parameters.map((p) => (
              <div className="l-field" key={p.name}>
                <label>{p.name || "(unnamed parameter)"}</label>
                <input
                  type="text"
                  value={args[p.name] ?? ""}
                  placeholder={p.description || `sample ${p.name}`}
                  onChange={(e) => setArgs((prev) => ({ ...prev, [p.name]: e.target.value }))}
                />
              </div>
            ))
          ) : (
            <p className="l-connector-note">This tool takes no parameters.</p>
          )}
          <button type="button" className="l-btn l-btn-ghost" disabled={busy} onClick={() => void run()}>
            {busy ? "Running…" : "Run"}
          </button>
          {result ? (
            <>
              <p className={`l-tool-test-status ${result.ok ? "l-ok" : "l-fail"}`}>
                {result.ok ? `Success${result.ms != null ? ` in ${result.ms} ms` : ""}` : "Failed"}
              </p>
              <pre className="l-tool-test-output">{result.text.slice(0, 4000)}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function newParam(): ToolParameter {
  return { name: "", type: "string", description: "", required: true };
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Agent | null>(null);
  // Distinguishes "still loading" from "genuinely empty" -- the empty state
  // used to flash on every page load before the first fetch resolved.
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [agentsRes, avatarsRes] = await Promise.all([fetch("/api/agents"), fetch("/api/avatars")]);
    if (agentsRes.ok) setAgents(await agentsRes.json());
    if (avatarsRes.ok) setAvatars(await avatarsRes.json());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while a real RunPod pod is booting for a just-made-live agent
  // (30-90s+) -- same pattern as dashboard/avatars/page.tsx polling while
  // an avatar is uploading/processing, since this is the same shape of
  // problem: a slow background operation the dashboard finds out about by
  // asking again, not by pushing.
  useEffect(() => {
    const anyProvisioning = agents.some((a) => a.status === "provisioning");
    if (!anyProvisioning) return;
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [agents, refresh]);

  // Keep the open dialog's data in sync with polling -- e.g. a provisioning
  // agent the user is looking at flips to live without them having to close
  // and reopen it.
  useEffect(() => {
    if (!selected) return;
    const fresh = agents.find((a) => a.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [agents, selected]);

  const readyAvatars = avatars.filter((a) => a.status === "ready");

  return (
    <div className="l-dash-shell">
      <div className="l-dash-header">
        <span className="l-kicker">Dashboard</span>
        <h1>Agents</h1>
        <p>Give an avatar a system prompt and tools, then take it live.</p>
      </div>

      <FlowRail
        hasAvatar={readyAvatars.length > 0}
        hasAgent={agents.length > 0}
        hasLiveAgent={agents.some((a) => a.status === "live")}
      />

      {creating ? (
        <CreateAgentForm
          readyAvatars={readyAvatars}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refresh();
          }}
        />
      ) : !loaded ? (
        <SkeletonRows />
      ) : agents.length === 0 ? (
        <div className="l-empty-state">
          {readyAvatars.length === 0 ? (
            <>
              <h2>Create an avatar first</h2>
              <p>An agent needs a face to speak with. Build one from a 6-second video, then come back.</p>
              <Link href="/dashboard/avatars" className="l-btn l-btn-primary">
                Create an avatar
              </Link>
            </>
          ) : (
            <>
              <h2>No agents yet</h2>
              <p>
                An agent is one of your avatars given a system prompt and a set of tools, so it can hold a
                live conversation on your behalf.
              </p>
              <button type="button" className="l-btn l-btn-primary" onClick={() => setCreating(true)}>
                Create agent
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="l-list-actions">
            <button type="button" className="l-btn l-btn-primary" onClick={() => setCreating(true)}>
              Create agent
            </button>
          </div>
          <div className="l-avatar-list">
            {agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} avatars={avatars} onOpen={() => setSelected(agent)} />
            ))}
          </div>
        </>
      )}

      <AgentDialog
        agent={selected}
        avatars={avatars}
        onClose={() => setSelected(null)}
        onChanged={() => void refresh()}
      />
    </div>
  );
}

function agentStatusLabel(status: Agent["status"]): string {
  if (status === "live") return "Live";
  if (status === "provisioning") return "Starting…";
  return "Draft";
}

function agentStatusBadgeClass(status: Agent["status"]): string {
  if (status === "live") return "l-status-ready";
  if (status === "provisioning") return "l-status-processing";
  return "l-status-uploading";
}

function AgentRow({ agent, avatars, onOpen }: { agent: Agent; avatars: Avatar[]; onOpen: () => void }) {
  const avatar = avatars.find((a) => a.id === agent.avatar_id);
  return (
    <button type="button" className="l-avatar-row" onClick={onOpen}>
      <div className="l-avatar-row-main">
        <AvatarThumb
          src={avatar?.status === "ready" ? avatar.preview_video_url : null}
          name={avatar?.name ?? agent.name}
        />
        <div className="l-avatar-info">
          <div className="l-avatar-name">{agent.name}</div>
          <div className="l-avatar-meta">
            {avatar ? avatar.name : "Unknown avatar"} — {agent.tools_json.length} tool
            {agent.tools_json.length === 1 ? "" : "s"}
            {agent.documents?.length
              ? ` · ${agent.documents.length} knowledge file${agent.documents.length === 1 ? "" : "s"}`
              : ""}
          </div>
        </div>
      </div>
      <div className="l-avatar-row-end">
        <span className={`l-status-badge ${agentStatusBadgeClass(agent.status)}`}>
          {agentStatusLabel(agent.status)}
        </span>
        <RowChevron />
      </div>
    </button>
  );
}

function ToolEditor({ tools, onChange, agentId }: { tools: ToolConfig[]; onChange: (tools: ToolConfig[]) => void; agentId?: string }) {
  function updateTool(id: string, patch: Partial<ToolConfig>) {
    onChange(tools.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function removeTool(id: string) {
    onChange(tools.filter((t) => t.id !== id));
  }
  function addParam(toolId: string) {
    updateTool(toolId, { parameters: [...(tools.find((t) => t.id === toolId)?.parameters ?? []), newParam()] });
  }
  function updateParam(toolId: string, index: number, patch: Partial<ToolParameter>) {
    const tool = tools.find((t) => t.id === toolId);
    if (!tool) return;
    const parameters = tool.parameters.map((p, i) => (i === index ? { ...p, ...patch } : p));
    updateTool(toolId, { parameters });
  }
  function removeParam(toolId: string, index: number) {
    const tool = tools.find((t) => t.id === toolId);
    if (!tool) return;
    updateTool(toolId, { parameters: tool.parameters.filter((_, i) => i !== index) });
  }

  return (
    <div className="l-tool-list">
      {tools.map((tool) => {
        const isCustom = tool.type === "http_request";
        return (
          <div className="l-tool-card" key={tool.id}>
            <div className="l-tool-card-header">
              <span className="l-kicker">{CONNECTOR_PRESETS[tool.type].label}</span>
              <button type="button" className="l-btn-delete" onClick={() => removeTool(tool.id)}>
                Remove
              </button>
            </div>
            <div className="l-field">
              <label>Function name (what the agent calls it)</label>
              <input
                type="text"
                value={tool.name}
                onChange={(e) => updateTool(tool.id, { name: e.target.value })}
                placeholder="check_availability"
              />
            </div>
            <div className="l-field">
              <label>Description (tells the agent when to use this)</label>
              <input
                type="text"
                value={tool.description}
                onChange={(e) => updateTool(tool.id, { description: e.target.value })}
                placeholder="Check appointment availability for a given date"
              />
            </div>

            {!isCustom ? (
              <>
                {tool.type === "tavily_search" ? (
                  <div className="l-field">
                    <label>Tavily API key</label>
                    <input
                      type="text"
                      spellCheck={false}
                      value={tool.api_key}
                      onChange={(e) => updateTool(tool.id, { api_key: e.target.value })}
                      placeholder="tvly-..."
                    />
                    <p className="l-connector-note">
                      Searches run against <em>your</em> Tavily account, so usage is billed to
                      you, not shared platform-wide. Get a key at tavily.com — it&apos;s
                      encrypted and shown only as &bull;&bull;&bull;&bull;1234 once saved; leave
                      the dots alone to keep the saved key.
                    </p>
                  </div>
                ) : (
                  <p className="l-connector-note">
                    Built-in connector—no setup needed beyond the name and description above. The
                    agent will pass its own search query automatically.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="l-tool-row">
                  <div className="l-field" style={{ flex: "0 0 110px" }}>
                    <label>Method</label>
                    <select value={tool.method} onChange={(e) => updateTool(tool.id, { method: e.target.value })}>
                      <option>GET</option>
                      <option>POST</option>
                      <option>PUT</option>
                      <option>DELETE</option>
                    </select>
                  </div>
                  <div className="l-field" style={{ flex: 1 }}>
                    <label>URL (use {"{param}"} to insert a parameter)</label>
                    <input
                      type="text"
                      value={tool.url}
                      onChange={(e) => updateTool(tool.id, { url: e.target.value })}
                      placeholder="https://api.example.com/availability?date={date}"
                    />
                  </div>
                </div>

                <div className="l-field">
                  <label>Parameters</label>
                  {tool.parameters.map((param, i) => (
                    <div className="l-param-row" key={i}>
                      <input
                        type="text"
                        value={param.name}
                        onChange={(e) => updateParam(tool.id, i, { name: e.target.value })}
                        placeholder="date"
                      />
                      <input
                        type="text"
                        value={param.description}
                        onChange={(e) => updateParam(tool.id, i, { description: e.target.value })}
                        placeholder="Date in YYYY-MM-DD"
                      />
                      <label className="l-param-required">
                        <input
                          type="checkbox"
                          checked={param.required}
                          onChange={(e) => updateParam(tool.id, i, { required: e.target.checked })}
                        />
                        required
                      </label>
                      <button type="button" className="l-btn-delete" onClick={() => removeParam(tool.id, i)}>
                        &times;
                      </button>
                    </div>
                  ))}
                  <button type="button" className="l-btn-expand" onClick={() => addParam(tool.id)}>
                    + Add parameter
                  </button>
                </div>

                <div className="l-field">
                  <label>Headers (one per line) — for API keys and auth</label>
                  <textarea
                    rows={2}
                    spellCheck={false}
                    value={headersToText(tool.headers)}
                    onChange={(e) => updateTool(tool.id, { headers: textToHeaders(e.target.value) })}
                    placeholder={"Authorization: Bearer your-api-key\nX-Api-Key: abc123"}
                  />
                  <p className="l-connector-note">
                    {"{param}"} works here too. Keys are encrypted and shown only as
                    &bull;&bull;&bull;&bull;1234 once saved — leave the dots alone to keep the
                    saved key, or type a new value to replace it.
                  </p>
                </div>

                {tool.method !== "GET" ? (
                  <div className="l-field">
                    <label>Request body (JSON) — {"{param}"} inserts a parameter</label>
                    <textarea
                      rows={3}
                      spellCheck={false}
                      value={tool.body_template ?? ""}
                      onChange={(e) => updateTool(tool.id, { body_template: e.target.value || null })}
                      placeholder={'{"subject": "{subject}", "source": "avatar"}'}
                    />
                  </div>
                ) : null}

                <ToolTester tool={tool} agentId={agentId} />
              </>
            )}
          </div>
        );
      })}
      <div className="l-tool-add-row">
        <button type="button" className="l-btn l-btn-ghost" onClick={() => onChange([...tools, newTool("http_request")])}>
          + Add API call tool
        </button>
        <button
          type="button"
          className="l-btn l-btn-ghost"
          onClick={() => onChange([...tools, newTool("tavily_search")])}
        >
          + Add web search (Tavily)
        </button>
      </div>
    </div>
  );
}

function formatDocMeta(doc: AgentDocument): string {
  const kb = doc.size_bytes / 1024;
  const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  return `${size} · ${doc.char_count.toLocaleString()} characters of text`;
}

/* Knowledge files for an agent already saved in the database: uploads and
   deletes take effect immediately, since there is an agent id to hang them
   off. The create form uses PendingKnowledgeFiles instead. */
function KnowledgeFiles({
  agentId,
  initialDocuments,
  onChanged,
}: {
  agentId: string;
  initialDocuments: AgentDocument[];
  onChanged: () => void;
}) {
  // This component owns its list rather than reading the dialog's `agent`
  // prop. That prop is a snapshot taken when the row was clicked, so it
  // would never show a newly uploaded file -- and re-syncing it from the
  // refreshed list would reset the name/prompt/tools fields underneath the
  // user's unsaved edits.
  const [documents, setDocuments] = useState<AgentDocument[]>(initialDocuments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDocuments(initialDocuments);
    setError(null);
    // Re-seed when the dialog is opened on a different agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/documents`);
    if (res.ok) setDocuments(await res.json());
    onChanged(); // keeps the list behind the dialog in step
  }, [agentId, onChanged]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    // Sequential, not Promise.all: the backend caps files per agent, and a
    // parallel burst would race that check and report confusing errors.
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/agents/${agentId}/documents`, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || body.error || `Couldn't upload ${file.name}.`);
        break;
      }
    }
    if (inputRef.current) inputRef.current.value = "";
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
    <div className="l-field">
      <label>Knowledge files</label>
      <p className="l-connector-note">
        Menus, price lists, policies, FAQs. The agent answers from these and won&apos;t invent
        details they don&apos;t cover. PDF, Word, text, Markdown or CSV.
      </p>

      {documents.length > 0 ? (
        <div className="l-doc-list">
          {documents.map((doc) => (
            <div className="l-doc-row" key={doc.id}>
              <div className="l-doc-info">
                <span className="l-doc-name">{doc.filename}</span>
                <span className="l-doc-meta">{formatDocMeta(doc)}</span>
              </div>
              <button type="button" className="l-btn-delete" disabled={busy} onClick={() => remove(doc)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DOC_EXTENSIONS}
        disabled={busy}
        onChange={(e) => void upload(e.target.files)}
        className="l-doc-input"
      />
      {busy ? <p className="l-connector-note">Uploading…</p> : null}
      {error ? <p className="l-error-text">{error}</p> : null}
    </div>
  );
}

/* The create form has no agent id yet, so files are held here and uploaded
   by the caller once the agent row exists. */
function PendingKnowledgeFiles({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="l-field">
      <label>Knowledge files (optional)</label>
      <p className="l-connector-note">
        Menus, price lists, policies, FAQs. The agent answers from these and won&apos;t invent
        details they don&apos;t cover. PDF, Word, text, Markdown or CSV.
      </p>
      {files.length > 0 ? (
        <div className="l-doc-list">
          {files.map((file, i) => (
            <div className="l-doc-row" key={`${file.name}-${i}`}>
              <div className="l-doc-info">
                <span className="l-doc-name">{file.name}</span>
                <span className="l-doc-meta">
                  {Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB · uploads when you
                  create the agent
                </span>
              </div>
              <button
                type="button"
                className="l-btn-delete"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DOC_EXTENSIONS}
        className="l-doc-input"
        onChange={(e) => {
          onChange([...files, ...Array.from(e.target.files ?? [])]);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}

// Always this one compact row, in both the create form and the edit
// dialog -- the full 24-voice grid only ever appears in its own separate
// VoicePickerDialog, never inline here, so neither form's height changes
// whether voice is untouched or being actively browsed.
function VoiceRowCompact({ voiceId, onChangeClick }: { voiceId: string; onChangeClick: () => void }) {
  const voice = voiceById(voiceId);
  return (
    <div className="l-voice-row-compact">
      <span className="l-voice-glyph" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path
            d="M4 5v4M7 2v10M10 5v4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </span>
      <span className="l-voice-info">
        <span className="l-voice-name">{voice.id}</span>
        <span className="l-voice-descriptor">{voice.descriptor}</span>
      </span>
      <button type="button" className="l-btn l-btn-ghost" onClick={onChangeClick}>
        Change voice
      </button>
    </div>
  );
}

function CreateAgentForm({
  readyAvatars,
  onCancel,
  onCreated,
}: {
  readyAvatars: Avatar[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [avatarId, setAvatarId] = useState(readyAvatars[0]?.id ?? "");
  const [name, setName] = useState("");
  const [openingIntro, setOpeningIntro] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!avatarId || !name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avatar_id: avatarId,
        name: name.trim(),
        opening_intro: openingIntro,
        system_prompt: systemPrompt,
        voice,
        tools,
      }),
    });
    if (!res.ok) {
      setBusy(false);
      const body = await res.json().catch(() => ({}));
      setError(body.error || body.detail || "Couldn't create the agent.");
      return;
    }

    // Documents need an agent id, so they upload after the row exists. A
    // failure here is reported but does not discard the agent -- it was
    // created, and the files can be added again from the edit dialog.
    const created = await res.json().catch(() => null);
    if (created?.id && docFiles.length > 0) {
      for (const file of docFiles) {
        const form = new FormData();
        form.append("file", file);
        const docRes = await fetch(`/api/agents/${created.id}/documents`, { method: "POST", body: form });
        if (!docRes.ok) {
          const body = await docRes.json().catch(() => ({}));
          setBusy(false);
          setError(
            `Agent created, but ${file.name} could not be added: ${
              body.detail || body.error || "upload failed"
            }. You can add it from the agent's settings.`
          );
          onCreated();
          return;
        }
      }
    }

    setBusy(false);
    onCreated();
  }

  return (
    <form className="l-dropzone" onSubmit={submit} style={{ textAlign: "left" }}>
      <div className="l-field">
        <label htmlFor="agent-avatar">Avatar</label>
        <select id="agent-avatar" value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
          {readyAvatars.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="l-field">
        <label htmlFor="agent-name">Agent name</label>
        <input
          id="agent-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Front Desk Assistant"
        />
      </div>
      <div className="l-field">
        <label htmlFor="agent-intro">Opening intro</label>
        <textarea
          id="agent-intro"
          rows={2}
          value={openingIntro}
          onChange={(e) => setOpeningIntro(e.target.value)}
          placeholder="Hi, thanks for calling Acme Dental! I'm here to help with appointments and questions — what can I do for you?"
        />
        <p className="l-connector-note">
          Spoken word-for-word the moment a session starts — before anything else. Leave blank
          for a generic, improvised greeting instead.
        </p>
      </div>
      <div className="l-field">
        <label htmlFor="agent-prompt">System prompt</label>
        <textarea
          id="agent-prompt"
          rows={5}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="You are a friendly front desk assistant for Acme Dental. Help visitors check appointment availability and answer questions about the clinic."
        />
      </div>
      <div className="l-field">
        <label>Voice</label>
        <VoiceRowCompact voiceId={voice} onChangeClick={() => setVoicePickerOpen(true)} />
      </div>
      <VoicePickerDialog
        open={voicePickerOpen}
        currentVoice={voice}
        onSelect={(v) => {
          setVoice(v);
          setVoicePickerOpen(false);
        }}
        onClose={() => setVoicePickerOpen(false)}
      />

      <PendingKnowledgeFiles files={docFiles} onChange={setDocFiles} />

      <ToolEditor tools={tools} onChange={setTools} />

      <div className="l-upload-actions">
        <button className="l-btn l-btn-primary" type="submit" disabled={busy || !avatarId || !name.trim()}>
          {busy ? (
            <>
              <Spinner />
              Creating…
            </>
          ) : (
            "Create agent"
          )}
        </button>
        <button type="button" className="l-btn l-btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {!busy && !name.trim() ? <span className="l-helper-text">Give the agent a name first.</span> : null}
      </div>
      {error ? <p className="l-error-text">{error}</p> : null}
    </form>
  );
}

type ActivityEntry =
  | { id: string; kind: "transcript"; role: "user" | "assistant"; text: string }
  // `detail` carries the tool's own error text. Without it the feed only
  // said "failed", which tells you a tool broke but not whether the URL
  // was wrong, the API rejected the request, or it timed out -- and the
  // session's logs are deleted on teardown, so there is nowhere else to
  // look afterwards.
  | { id: string; kind: "tool"; name: string; status: "calling" | "done" | "failed"; detail?: string };

type TestState = "idle" | "connecting" | "warming" | "connected" | "error";

// Bounded polling of GET /test-session/{room} while "warming" -- catches a
// real RunPod job failure (the worker never booted) instead of leaving the
// customer staring at "warming up" forever. Not tight: the bot's own
// LiveKit track subscription is what actually ends the warming state on
// the happy path, this is only the unhappy-path backstop.
const WARMING_POLL_MS = 4000;
const WARMING_MAX_POLLS = 25; // ~100s, just past the "up to 90s" copy below

// Talks to a real LiveKit room -- the same one agent.main just published its
// avatar video/audio tracks into -- so this is the actual test drive, not a
// mockup: real Gemini, real tool calls, real GPU-rendered video.
function LiveTestPanel({
  agentId,
  onStopped,
}: {
  agentId: string;
  onStopped: () => void;
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

      const res = await fetch(`/api/agents/${agentId}/test-session`, { method: "POST" });
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
          if (msg.type === "transcript" && msg.text) {
            pushActivity({ id: crypto.randomUUID(), kind: "transcript", role: msg.role, text: msg.text });
          } else if (msg.type === "tool_call") {
            pushActivity({ id: msg.id, kind: "tool", name: msg.name, status: "calling" });
          } else if (msg.type === "tool_result") {
            const failed = msg.response?.success === false;
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
      // start, ~40-90s) -- "connected" only fires once its video track
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
  }, [agentId]);

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
          setError("The test session's GPU worker failed to start. Try again.");
          setState("error");
        }
      } catch {
        // A transient status-check failure isn't itself a reason to give
        // up -- only RunPod's own reported FAILED/CANCELLED is.
      }
      if (polls >= WARMING_MAX_POLLS && !cancelled) {
        setError("Still warming up after a while -- the GPU worker may be slow to start. You can keep waiting or stop and try again.");
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
                ? "Warming up your agent — this can take up to 90 seconds…"
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
                ? error || "Error"
                : "Connecting…"}
        </span>
        <button type="button" className="l-btn l-btn-ghost" onClick={handleStopClick}>
          Stop test
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

function EmbedWidgetPanel({
  agentId,
  embed,
  status,
  onChanged,
}: {
  agentId: string;
  embed: EmbedKey;
  status: Agent["status"];
  onChanged: () => void;
}) {
  const [origins, setOrigins] = useState(embed.allowed_origins.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [studioOrigin, setStudioOrigin] = useState("");

  useEffect(() => {
    // window.location isn't available during SSR -- the snippet has to
    // point at wherever this dashboard is actually being served from
    // (staging, production, a future domain), never a hardcoded value.
    setStudioOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    setOrigins(embed.allowed_origins.join("\n"));
  }, [embed.allowed_origins]);

  const snippet = `<script src="${studioOrigin}/widget.js" data-key="${embed.public_key}"></script>`;

  async function saveOrigins() {
    setBusy(true);
    setError(null);
    const list = origins
      .split(/[\n,]/)
      .map((o) => o.trim())
      .filter(Boolean);
    const res = await fetch(`/api/agents/${agentId}/embed`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_origins: list }),
    });
    setBusy(false);
    if (res.ok) {
      onChanged();
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
    <div className="l-embed-panel" style={{ marginTop: 16, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <p style={{ fontWeight: 600, margin: 0 }}>Embeddable chat widget</p>
      <p className="l-connector-note" style={{ marginTop: 4 }}>
        {status === "live"
          ? "Anyone on an allowed website below can talk to this agent through a chat bubble."
          : status === "provisioning"
            ? "Starting up — the widget will go live automatically in about a minute, with no further action needed here."
            : "This widget is offline while the agent is in Draft — take it live to reactivate it. The install snippet below still works once you do; nothing needs to change on the customer's site."}
      </p>

      <label style={{ display: "block", marginTop: 12, fontSize: 13, fontWeight: 600 }}>
        Allowed websites (one per line, e.g. https://example.com — no trailing slash)
      </label>
      <textarea
        className="l-input"
        rows={3}
        value={origins}
        onChange={(e) => setOrigins(e.target.value)}
        placeholder="https://example.com"
        style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
      />
      {embed.allowed_origins.length === 0 ? (
        <p className="l-connector-note" style={{ color: "#b45309" }}>
          No website is allowed yet — the widget will not render anywhere until you add one.
        </p>
      ) : null}
      {error ? <p className="l-connector-note" style={{ color: "#b91c1c" }}>{error}</p> : null}
      <button type="button" className="l-btn l-btn-ghost" disabled={busy} onClick={() => void saveOrigins()} style={{ marginTop: 8 }}>
        {busy ? "Saving…" : "Save allowed websites"}
      </button>

      <label style={{ display: "block", marginTop: 16, fontSize: 13, fontWeight: 600 }}>
        Install snippet
      </label>
      <pre
        style={{
          background: "#0b0f14",
          color: "#e5e7eb",
          padding: 10,
          borderRadius: 8,
          fontSize: 12,
          overflowX: "auto",
          margin: "6px 0",
        }}
      >
        {snippet}
      </pre>
      <button type="button" className="l-btn l-btn-ghost" onClick={copySnippet}>
        {copied ? "Copied!" : "Copy snippet"}
      </button>
      <p className="l-connector-note" style={{ marginTop: 8 }}>
        Paste this into the HTML of any website listed above. It only starts talking to this
        agent — pricing/plans/etc. text is whatever this agent's own instructions say.
      </p>
    </div>
  );
}

function AgentDialog({
  agent,
  avatars,
  onClose,
  onChanged,
}: {
  agent: Agent | null;
  avatars: Avatar[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [openingIntro, setOpeningIntro] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (agent) {
      setName(agent.name);
      setOpeningIntro(agent.opening_intro);
      setSystemPrompt(agent.system_prompt);
      setVoice(agent.voice);
      setTools(agent.tools_json);
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.close();
      setTesting(false);
      setStatusError(null);
    }
  }, [agent]);

  const avatar = agent ? avatars.find((a) => a.id === agent.avatar_id) : null;

  async function save(patch: Partial<{ name: string; opening_intro: string; system_prompt: string; voice: string; tools: ToolConfig[]; status: string }>) {
    if (!agent) return;
    setBusy(true);
    if (patch.status) setStatusError(null);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (res.ok) {
      onChanged();
      return;
    }
    if (patch.status) {
      // Real, common failure here: no persistent GPU serving configured
      // for this avatar yet, or RunPod couldn't provision a pod right now
      // (capacity/connectivity) -- see backend's _set_agent_live. This
      // used to fail completely silently (button just stopped spinning).
      // The proxy route forwards FastAPI's raw body, so the message is
      // under `detail`, not `error` (unlike this dashboard's other proxy
      // routes, which reshape it -- see app/api/agents/[id]/route.ts).
      const payload = await res.json().catch(() => null);
      setStatusError(payload?.detail ?? "Couldn't change this agent's live status. Try again shortly.");
    }
  }

  async function handleDelete() {
    if (!agent) return;
    if (!window.confirm(`Delete agent "${agent.name}"?`)) return;
    const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    if (res.ok) {
      onClose();
      onChanged();
    }
  }

  // React bubbles a <dialog>'s close/cancel events through the *React
  // component tree*, not the real DOM -- so VoicePickerDialog's own
  // dialog (portaled to document.body, a real DOM sibling of this one)
  // still shows up here as a bubbled event, since it's still a React
  // child of this component. e.target !== e.currentTarget is how to tell
  // "some descendant dialog closed" apart from "this dialog itself
  // closed" -- confirmed via a real repro: without this check, picking a
  // voice silently closed the whole agent editor.
  function onOuterDialogClose(e: React.SyntheticEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="l-avatar-dialog l-agent-dialog"
      onClose={onOuterDialogClose}
      onCancel={onOuterDialogClose}
    >
      {agent ? (
        <>
          <button type="button" className="l-dialog-close" onClick={onClose} aria-label="Close">
            &times;
          </button>

          <div className="l-agent-dialog-split">
          <div className="l-agent-dialog-media">
          {testing ? (
            <LiveTestPanel agentId={agent.id} onStopped={() => setTesting(false)} />
          ) : avatar?.preview_video_url ? (
            <video
              className="l-avatar-dialog-video"
              src={avatar.preview_video_url}
              muted
              loop
              autoPlay
              playsInline
            />
          ) : (
            <DialogPlaceholder name={avatar?.name ?? agent.name} />
          )}
          </div>

          <div className="l-avatar-dialog-body l-agent-dialog-config">
            <div className="l-avatar-dialog-header">
              <h2>{agent.name}</h2>
              <span className={`l-status-badge ${agentStatusBadgeClass(agent.status)}`}>
                {agentStatusLabel(agent.status)}
              </span>
            </div>
            <div className="l-avatar-meta">Built from {avatar ? avatar.name : "an avatar"}</div>

            <div className="l-field" style={{ marginTop: 18 }}>
              <label>Agent name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="l-field">
              <label>Opening intro</label>
              <textarea
                rows={2}
                value={openingIntro}
                onChange={(e) => setOpeningIntro(e.target.value)}
                placeholder="Hi, thanks for calling Acme Dental! I'm here to help with appointments and questions — what can I do for you?"
              />
              <p className="l-connector-note">
                Spoken word-for-word the moment a session starts — before anything else. Leave
                blank for a generic, improvised greeting instead.
              </p>
            </div>
            <div className="l-field">
              <label>System prompt</label>
              <textarea rows={5} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
            </div>
            <div className="l-field">
              <label>Voice</label>
              <VoiceRowCompact voiceId={voice} onChangeClick={() => setVoicePickerOpen(true)} />
            </div>
            <VoicePickerDialog
              open={voicePickerOpen}
              currentVoice={voice}
              onSelect={(v) => {
                setVoice(v);
                setVoicePickerOpen(false);
              }}
              onClose={() => setVoicePickerOpen(false)}
            />

            <KnowledgeFiles
              agentId={agent.id}
              initialDocuments={agent.documents ?? []}
              onChanged={onChanged}
            />

            <ToolEditor tools={tools} onChange={setTools} agentId={agent.id} />

            <div className="l-upload-actions" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="l-btn l-btn-primary"
                disabled={busy}
                onClick={() => save({ name, opening_intro: openingIntro, system_prompt: systemPrompt, voice, tools })}
              >
                {busy ? (
                  <>
                    <Spinner />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </button>
              <button
                type="button"
                className="l-btn l-btn-ghost"
                disabled={busy || testing}
                onClick={() => setTesting(true)}
              >
                {testing ? "Testing…" : "Test agent"}
              </button>
              <button
                type="button"
                className="l-btn l-btn-ghost"
                disabled={busy || agent.status === "provisioning"}
                onClick={() => save({ status: agent.status === "draft" ? "live" : "draft" })}
              >
                {agent.status === "provisioning" ? (
                  <>
                    <Spinner />
                    Starting your dedicated server…
                  </>
                ) : agent.status === "live" ? (
                  "Take offline"
                ) : (
                  "Make live"
                )}
              </button>
            </div>
            {agent.status === "provisioning" ? (
              <p className="l-connector-note" style={{ marginTop: 8 }}>
                Provisioning a dedicated GPU server for this agent — this usually takes under
                two minutes. The widget below goes live automatically the moment it's ready;
                no need to keep this open.
              </p>
            ) : null}
            {statusError ? (
              <p className="l-connector-note" style={{ marginTop: 8, color: "#b91c1c" }}>
                {statusError}
              </p>
            ) : null}
            <p className="l-connector-note" style={{ marginTop: 8 }}>
              Test agent talks to a real, temporary live session on our GPU box—your mic
              will be requested. It's separate from making the agent live for your own
              platform.
            </p>
            {agent.embed ? (
              <EmbedWidgetPanel agentId={agent.id} embed={agent.embed} status={agent.status} onChanged={onChanged} />
            ) : null}
            <button type="button" className="l-btn-delete l-dialog-delete" onClick={handleDelete}>
              Delete agent
            </button>
          </div>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
