"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Room, RoomEvent, Track } from "livekit-client";
import type { RemoteTrack, RemoteTrackPublication, RemoteParticipant } from "livekit-client";
import FlowRail from "../FlowRail";
import { AvatarThumb, DialogPlaceholder, RowChevron, SkeletonRows, Spinner } from "../ui";

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
};

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

type Agent = {
  id: string;
  avatar_id: string;
  name: string;
  system_prompt: string;
  tools_json: ToolConfig[];
  status: "draft" | "live";
  created_at: string;
  documents: AgentDocument[];
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
  };
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
        <span className={`l-status-badge ${agent.status === "live" ? "l-status-ready" : "l-status-uploading"}`}>
          {agent.status === "live" ? "Live" : "Draft"}
        </span>
        <RowChevron />
      </div>
    </button>
  );
}

function ToolEditor({ tools, onChange }: { tools: ToolConfig[]; onChange: (tools: ToolConfig[]) => void }) {
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
              <p className="l-connector-note">
                Built-in connector—no setup needed beyond the name and description above. The
                agent will pass its own search query automatically.
              </p>
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
  const [systemPrompt, setSystemPrompt] = useState("");
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
      body: JSON.stringify({ avatar_id: avatarId, name: name.trim(), system_prompt: systemPrompt, tools }),
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
        <label htmlFor="agent-prompt">System prompt</label>
        <textarea
          id="agent-prompt"
          rows={5}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="You are a friendly front desk assistant for Acme Dental. Help visitors check appointment availability and answer questions about the clinic."
        />
      </div>

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
  | { id: string; kind: "tool"; name: string; status: "calling" | "done" | "failed" };

type TestState = "idle" | "connecting" | "connected" | "error";

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
    setActivity((prev) => [...prev.slice(-19), entry]);
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
        if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current);
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
            pushActivity({
              id: msg.id,
              kind: "tool",
              name: msg.name,
              status: msg.response?.success === false ? "failed" : "done",
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
      setState("connected"); // the avatar is visible even if the mic step below fails

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
            {state === "error" ? error || "Something went wrong." : "Connecting…"}
          </div>
        ) : null}
      </div>
      <div className="l-live-test-bar">
        <span className="l-live-test-status">
          {state === "connected"
            ? micOn
              ? "Live — mic on, talk to your agent"
              : `Live — ${micError || "mic unavailable"}`
            : state}
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
              <div key={e.id} className="l-live-test-line l-live-test-tool">
                {e.status === "calling" ? `Calling ${e.name}…` : e.status === "done" ? `${e.name} responded` : `${e.name} failed`}
              </div>
            )
          )}
        </div>
      ) : null}
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
  const [systemPrompt, setSystemPrompt] = useState("");
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (agent) {
      setName(agent.name);
      setSystemPrompt(agent.system_prompt);
      setTools(agent.tools_json);
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.close();
      setTesting(false);
    }
  }, [agent]);

  const avatar = agent ? avatars.find((a) => a.id === agent.avatar_id) : null;

  async function save(patch: Partial<{ name: string; system_prompt: string; tools: ToolConfig[]; status: string }>) {
    if (!agent) return;
    setBusy(true);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (res.ok) onChanged();
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

  return (
    <dialog ref={dialogRef} className="l-avatar-dialog l-agent-dialog" onClose={onClose} onCancel={onClose}>
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
              <span className={`l-status-badge ${agent.status === "live" ? "l-status-ready" : "l-status-uploading"}`}>
                {agent.status === "live" ? "Live" : "Draft"}
              </span>
            </div>
            <div className="l-avatar-meta">Built from {avatar ? avatar.name : "an avatar"}</div>

            <div className="l-field" style={{ marginTop: 18 }}>
              <label>Agent name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="l-field">
              <label>System prompt</label>
              <textarea rows={5} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
            </div>

            <KnowledgeFiles
              agentId={agent.id}
              initialDocuments={agent.documents ?? []}
              onChanged={onChanged}
            />

            <ToolEditor tools={tools} onChange={setTools} />

            <div className="l-upload-actions" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="l-btn l-btn-primary"
                disabled={busy}
                onClick={() => save({ name, system_prompt: systemPrompt, tools })}
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
                disabled={busy}
                onClick={() => save({ status: agent.status === "live" ? "draft" : "live" })}
              >
                {agent.status === "live" ? "Take offline" : "Make live"}
              </button>
            </div>
            <p className="l-connector-note" style={{ marginTop: 8 }}>
              Test agent talks to a real, temporary live session on our GPU box—your mic
              will be requested. It's separate from making the agent live for your own
              platform.
            </p>
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
