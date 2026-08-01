"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Avatar = {
  id: string;
  name: string;
  status: "uploading" | "processing" | "quality_check" | "ready" | "failed";
};

type ToolParameter = {
  name: string;
  type: string;
  description: string;
  required: boolean;
};

type ToolConfig = {
  id: string;
  type: "http_request";
  name: string;
  description: string;
  parameters: ToolParameter[];
  method: string;
  url: string;
  headers: Record<string, string>;
};

type Agent = {
  id: string;
  avatar_id: string;
  name: string;
  system_prompt: string;
  tools_json: ToolConfig[];
  status: "draft" | "live";
  created_at: string;
};

function newTool(): ToolConfig {
  return {
    id: crypto.randomUUID(),
    type: "http_request",
    name: "",
    description: "",
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

  const refresh = useCallback(async () => {
    const [agentsRes, avatarsRes] = await Promise.all([fetch("/api/agents"), fetch("/api/avatars")]);
    if (agentsRes.ok) setAgents(await agentsRes.json());
    if (avatarsRes.ok) setAvatars(await avatarsRes.json());
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
        <p>Turn an avatar into a live agent -- give it a system prompt and connect the tools it needs.</p>
      </div>

      {creating ? (
        <CreateAgentForm
          readyAvatars={readyAvatars}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refresh();
          }}
        />
      ) : (
        <div className="l-dropzone" style={{ textAlign: "center" }}>
          {readyAvatars.length === 0 ? (
            <p style={{ color: "var(--l-muted)", fontSize: 14, margin: 0 }}>
              You need at least one ready avatar before you can create an agent.
            </p>
          ) : (
            <button type="button" className="l-btn l-btn-primary" onClick={() => setCreating(true)}>
              Create agent
            </button>
          )}
        </div>
      )}

      {agents.length === 0 ? (
        <div className="l-empty-state">No agents yet.</div>
      ) : (
        <div className="l-avatar-list">
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} avatars={avatars} onOpen={() => setSelected(agent)} />
          ))}
        </div>
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
        <div className="l-avatar-thumb" />
        <div className="l-avatar-info">
          <div className="l-avatar-name">{agent.name}</div>
          <div className="l-avatar-meta">
            {avatar ? avatar.name : "Unknown avatar"} -- {agent.tools_json.length} tool
            {agent.tools_json.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <span className={`l-status-badge ${agent.status === "live" ? "l-status-ready" : "l-status-uploading"}`}>
        {agent.status === "live" ? "Live" : "Draft"}
      </span>
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
      {tools.map((tool) => (
        <div className="l-tool-card" key={tool.id}>
          <div className="l-tool-card-header">
            <span className="l-kicker">API call</span>
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
        </div>
      ))}
      <button type="button" className="l-btn l-btn-ghost" onClick={() => onChange([...tools, newTool()])}>
        + Add API call tool
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
  const [systemPrompt, setSystemPrompt] = useState("");
  const [tools, setTools] = useState<ToolConfig[]>([]);
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
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || body.detail || "Couldn't create the agent.");
      return;
    }
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

      <ToolEditor tools={tools} onChange={setTools} />

      <div className="l-upload-actions">
        <button className="l-btn l-btn-primary" type="submit" disabled={busy || !avatarId || !name.trim()}>
          {busy ? "Creating..." : "Create agent"}
        </button>
        <button type="button" className="l-btn l-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? <p className="l-error-text">{error}</p> : null}
    </form>
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
          <div className="l-avatar-dialog-body">
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

            <ToolEditor tools={tools} onChange={setTools} />

            <div className="l-upload-actions" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="l-btn l-btn-primary"
                disabled={busy}
                onClick={() => save({ name, system_prompt: systemPrompt, tools })}
              >
                Save changes
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
            <button type="button" className="l-btn-delete l-dialog-delete" onClick={handleDelete}>
              Delete agent
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
