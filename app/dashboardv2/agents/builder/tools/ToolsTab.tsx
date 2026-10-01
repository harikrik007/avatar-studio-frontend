"use client";

/**
 * The builder's TOOLS tab (AGENT_TOOLS_CLIENT_SERVER.md §2.1, §2.9): an
 * "+ Add tool" menu, then one list of the agent's tools with search, a type
 * filter and SYSTEM / CUSTOM groups. Rows toggle a tool on or off; editing
 * happens in ToolDialog. Every change here only edits the builder's form --
 * the agent's own Save persists it, as with every other tab.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  isCustom,
  newClientTool,
  newWebhook,
  toolKind,
  toolTypeChip,
  type CustomTool,
  type Tool,
  type ToolKind,
} from "@/lib/tools/model";
import type { AgentForm } from "../../useAgentForm";
import { SectionCard, Switch } from "../tabs";
import ToolDialog from "./ToolDialog";
import { BoltIcon, BracesIcon, CopyIcon, FilterIcon, PencilIcon, SearchIcon, TrashIcon } from "./icons";

type TypeFilter = "all" | ToolKind;
const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All Types" },
  { id: "system", label: "System" },
  { id: "client", label: "Client" },
  { id: "webhook", label: "Webhook" },
  { id: "knowledge", label: "Knowledge" },
];

// The providers whose runtime executes tools today. Ditto and FlashHead
// receive the list but do not run it yet (PLAN.md decision 1).
const TOOL_PROVIDERS = new Set(["anam"]);

export default function ToolsTab({ f }: { f: AgentForm }) {
  const tools = f.form.tools;
  const setTools = (next: Tool[]) => f.update("tools", next);
  const [editing, setEditing] = useState<{ tool: CustomTool; isNew: boolean } | null>(null);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const addRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const visible = useMemo(
    () =>
      tools.filter((t) => {
        if (typeFilter !== "all" && toolKind(t) !== typeFilter) return false;
        if (!debounced) return true;
        const desc = isCustom(t) ? t.description : "";
        return t.name.toLowerCase().includes(debounced) || desc.toLowerCase().includes(debounced);
      }),
    [tools, typeFilter, debounced]
  );
  const system = visible.filter((t) => toolKind(t) === "system");
  const custom = visible.filter((t) => toolKind(t) !== "system");

  const storedUrl = (id: string) => {
    const stored = f.agent?.tools_json.find((t) => t.id === id);
    return stored && toolKind(stored) === "webhook" ? (stored as { url: string }).url : null;
  };

  function openNew(kind: "client" | "webhook") {
    setMenu(false);
    setEditing({ tool: kind === "client" ? newClientTool() : newWebhook(), isNew: true });
  }

  function closeDialog() {
    setEditing(null);
    // focus goes back to where the dialog was opened from
    setTimeout(() => addRef.current?.focus(), 0);
  }

  function saveTool(tool: CustomTool) {
    const exists = tools.some((t) => t.id === tool.id);
    setTools(exists ? tools.map((t) => (t.id === tool.id ? tool : t)) : [...tools, tool]);
    closeDialog();
  }

  function remove(tool: Tool) {
    if (!window.confirm(`Delete tool "${tool.name || "unnamed"}"? This takes effect when you save the agent.`)) return;
    setTools(tools.filter((t) => t.id !== tool.id));
  }

  const provider = f.selectedAvatar?.provider;
  const runsHere = !provider || TOOL_PROVIDERS.has(provider);

  return (
    <>
      <div className="lb-tools-head">
        <span className="lb-help" style={{ margin: 0 }}>
          Create a tool for this agent
        </span>
        <div className="lb-menu" ref={menuRef}>
          <button
            ref={addRef}
            type="button"
            className="l-btn l-btn-primary lb-btn-sm"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            + Add tool
          </button>
          {menu ? (
            <AddMenu onClient={() => openNew("client")} onServer={() => openNew("webhook")} onClose={() => setMenu(false)} />
          ) : null}
        </div>
      </div>

      {!runsHere ? (
        <p className="lb-note" role="note">
          Tools run on Anam avatars for now. On this avatar they are saved with the agent but not used in calls yet.
        </p>
      ) : null}

      <SectionCard n={1} title="Select tools" action={<span className="lb-count">{tools.length} tools</span>}>
        <div className="lb-tool-search">
          <span className="lb-search-icon">
            <SearchIcon />
          </span>
          <input
            className="lb-input"
            value={search}
            placeholder="Search tools..."
            aria-label="Search tools"
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className={`lb-icon-btn${filterOpen || typeFilter !== "all" ? " lb-icon-btn-on" : ""}`}
            aria-label="Filter tools"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <FilterIcon />
          </button>
        </div>
        {filterOpen ? (
          <div className="lb-filter-row">
            <label className="lb-type-chip">
              <span className="lb-sr">Type</span>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
                {TYPE_FILTERS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id === "all" ? "Type: All Types" : `Type: ${t.label}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {tools.length === 0 ? (
          <p className="lb-help" style={{ margin: "12px 0 0" }}>
            No tools yet. Add a server tool so the agent can call your API, or a client tool so it can act in your page.
          </p>
        ) : visible.length === 0 ? (
          <p className="lb-help" style={{ margin: "12px 0 0" }}>
            No tools match your search.
          </p>
        ) : (
          <>
            {system.length ? (
              <ToolGroup label="System">
                {system.map((t) => (
                  <ToolRow key={t.id} tool={t} onToggle={(v) => setTools(tools.map((x) => (x.id === t.id ? { ...x, enabled: v } : x)))} />
                ))}
              </ToolGroup>
            ) : null}
            {custom.length ? (
              <ToolGroup label="Custom">
                {custom.map((t) => (
                  <ToolRow
                    key={t.id}
                    tool={t}
                    onToggle={(v) => setTools(tools.map((x) => (x.id === t.id ? { ...x, enabled: v } : x)))}
                    onEdit={isCustom(t) ? () => setEditing({ tool: t, isNew: false }) : undefined}
                    onDelete={() => remove(t)}
                  />
                ))}
              </ToolGroup>
            ) : null}
          </>
        )}
      </SectionCard>

      {editing ? (
        <ToolDialog
          tool={editing.tool}
          isNew={editing.isNew}
          allTools={tools}
          storedUrl={storedUrl(editing.tool.id)}
          agentId={f.agent?.id}
          onSave={saveTool}
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */

function AddMenu({ onClient, onServer, onClose }: { onClient: () => void; onServer: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, []);
  function onKeyDown(e: React.KeyboardEvent) {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  }
  return (
    <div className="lb-menu-pop lb-menu-right lb-add-menu" role="menu" ref={ref} onKeyDown={onKeyDown}>
      <button type="button" role="menuitem" onClick={onClient}>
        <span className="lb-menu-icon">
          <BracesIcon />
        </span>
        <span className="lb-menu-text">
          Client tool<span className="lb-menu-sub">Calls your app</span>
        </span>
      </button>
      <button type="button" role="menuitem" onClick={onServer}>
        <span className="lb-menu-icon">
          <BoltIcon />
        </span>
        <span className="lb-menu-text">
          Server tool<span className="lb-menu-sub">Calls an external endpoint</span>
        </span>
      </button>
    </div>
  );
}

function ToolGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="lb-tool-group">
      <div className="lb-group-label">{label}</div>
      <ul className="lb-tool-list">{children}</ul>
    </div>
  );
}

function ToolRow({
  tool,
  onToggle,
  onEdit,
  onDelete,
}: {
  tool: Tool;
  onToggle: (enabled: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const description = isCustom(tool) ? tool.description : "";
  async function copyId() {
    try {
      await navigator.clipboard.writeText(tool.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }
  return (
    <li className={`lb-tool-item${tool.enabled ? "" : " lb-tool-off"}`}>
      <Switch checked={tool.enabled} label={`${tool.enabled ? "Disable" : "Enable"} ${tool.name || "tool"}`} onChange={onToggle} />
      <button type="button" className="lb-tool-main" onClick={onEdit} disabled={!onEdit} aria-label={onEdit ? `Edit ${tool.name}` : undefined}>
        <span className="lb-tool-name">{tool.name || "(unnamed tool)"}</span>
        <span className="lb-tool-desc">{description}</span>
        <span className="lb-type-tag">{toolTypeChip(tool)}</span>
      </button>
      <div className="lb-tool-actions">
        <button type="button" className="lb-icon-btn" title={copied ? "Copied ✓" : `Copy tool ID for ${tool.name}`} aria-label={`Copy tool ID for ${tool.name}`} onClick={() => void copyId()}>
          {copied ? <span className="lb-copied">✓</span> : <CopyIcon />}
        </button>
        {onEdit ? (
          <button type="button" className="lb-icon-btn" title="Edit" aria-label={`Edit ${tool.name}`} onClick={onEdit}>
            <PencilIcon />
          </button>
        ) : null}
        {onDelete ? (
          <button type="button" className="lb-icon-btn lb-icon-danger" title="Delete" aria-label={`Delete ${tool.name}`} onClick={onDelete}>
            <TrashIcon />
          </button>
        ) : null}
      </div>
    </li>
  );
}
