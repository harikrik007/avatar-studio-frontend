"use client";

/**
 * New tool / Edit tool dialog (AGENT_TOOLS_CLIENT_SERVER.md §2). Owns one
 * draft tool; "Create tool" / "Save changes" hand it to the Tools tab, which
 * puts it in the builder's tools list -- the agent's own Save persists it.
 *
 * A native <dialog> opened with showModal(): focus trap, Esc to close and
 * the inert page behind it come from the browser.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DATA_TYPES,
  METHODS,
  WEATHER_EXAMPLE,
  compileRows,
  duplicateIdentifiers,
  duplicateName,
  emptySchema,
  inferSchema,
  isMasked,
  newClientTool,
  newParamRow,
  newWebhook,
  normalize,
  parseSchemaText,
  rowsFromSchema,
  rowsFromWebhook,
  sampleArgs,
  schemaText,
  validateTool,
  type ClientTool,
  type CustomTool,
  type HeaderEntry,
  type HttpMethod,
  type ParamRow,
  type Tool,
  type ToolDataType,
  type WebhookTool,
} from "@/lib/tools/model";
import { Switch } from "../tabs";
import { BoltIcon, BracesIcon, DocIcon, InfoIcon, XIcon } from "./icons";

type Kind = "webhook" | "client" | "knowledge";

const KINDS: { id: Kind; label: string; sub: string; icon: React.ReactNode; soon?: boolean }[] = [
  { id: "client", label: "Client", sub: "Calls your app", icon: <BracesIcon /> },
  { id: "knowledge", label: "Knowledge", sub: "Searches your content", icon: <DocIcon />, soon: true },
  { id: "webhook", label: "Webhook", sub: "Calls an external endpoint", icon: <BoltIcon /> },
];

const PLACEHOLDERS = {
  client: { name: "get_weather", instructions: "Use this when the user asks for the current weather in a place." },
  webhook: { name: "send_webhook", instructions: "Use this to call the endpoint when the user asks for that action." },
};

const HELP: Record<Kind, string> = {
  client: "Client tools run in your app. Use one when the browser or app code handles the action.",
  knowledge: "Knowledge tools search selected folders. Use one when the answer should come from your documents.",
  webhook: "Webhook tools call an HTTP endpoint. Use one when your backend or another API should handle the action.",
};

export default function ToolDialog({
  tool,
  isNew,
  allTools,
  storedUrl,
  agentId,
  onSave,
  onClose,
}: {
  tool: CustomTool;
  isNew: boolean;
  allTools: Tool[];
  storedUrl?: string | null;
  agentId?: string;
  onSave: (tool: CustomTool) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const startedAs: "webhook" | "client" = tool.type === "client" ? "client" : "webhook";
  const [kind, setKind] = useState<"webhook" | "client">(startedAs);
  const [name, setName] = useState(tool.name);
  const [description, setDescription] = useState(tool.description);
  // Both kinds keep their own half of the draft (deep clones: Cancel must leave
  // the list exactly as it was), so switching type and back loses nothing.
  const [hook, setHook] = useState<WebhookTool>(() =>
    tool.type === "server" ? (structuredClone(tool) as WebhookTool) : { ...newWebhook(), id: tool.id }
  );
  const initialRows = useMemo(
    () => (tool.type === "server" ? rowsFromWebhook(tool as WebhookTool) : { query: [], body: [] }),
    [tool]
  );
  const [query, setQuery] = useState<ParamRow[]>(initialRows.query);
  const [body, setBody] = useState<ParamRow[]>(initialRows.body);
  const [client, setClient] = useState<ClientTool>(() =>
    tool.type === "client" ? (structuredClone(tool) as ClientTool) : { ...newClientTool(), id: tool.id }
  );
  const [schema, setSchema] = useState(() =>
    schemaText(tool.type === "client" ? { ...tool.parameters, ...(tool.strict ? { strict: true } : {}) } : emptySchema())
  );
  const [attempted, setAttempted] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(() =>
    tool.type === "client"
      ? Object.keys(tool.parameters?.properties ?? {}).length > 0 || (tool as ClientTool).awaitResult
      : hook.headers.length > 0 || initialRows.query.length > 0 || initialRows.body.length > 0 ||
        !hook.awaitResponse || Boolean(hook.body_template)
  );
  const [testOpen, setTestOpen] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // showModal() focuses the first focusable element (the close button);
    // the name is where both creating and editing start
    nameRef.current?.focus();
  }, []);

  const set = (patch: Partial<WebhookTool>) => setHook((d) => ({ ...d, ...patch }));

  function setMethod(method: HttpMethod) {
    // a GET has no body: its body parameters move to the query
    if (method === "GET" && body.length) {
      setQuery((q) => [...q, ...body]);
      setBody([]);
    }
    set({ method });
  }

  /** Switching type keeps Name, Instructions and the parameters (§2.3). */
  function switchKind(next: "webhook" | "client") {
    if (next === kind) return;
    if (next === "client") {
      const { parameters } = compileRows(query, body, hook.method, hook.parameters);
      setSchema(schemaText(parameters));
    } else {
      const parsed = parseSchemaText(schema);
      if (parsed.schema) {
        const rows = rowsFromSchema(parsed.schema, hook.method);
        setQuery(rows.query);
        setBody(rows.body);
      }
    }
    setKind(next);
  }

  /** The draft as it would be saved. */
  const { built, schemaError } = useMemo((): { built: CustomTool; schemaError: string | null } => {
    if (kind === "webhook") {
      const { parameters, param_in } = compileRows(query, body, hook.method, hook.parameters);
      return { built: normalize({ ...hook, name, description, parameters, param_in }), schemaError: null };
    }
    const parsed = parseSchemaText(schema);
    // `strict` is written in the schema box (as the helper says) but stored on the tool
    const { strict, ...parameters } = (parsed.schema ?? emptySchema()) as ClientTool["parameters"] & { strict?: boolean };
    const out: ClientTool = { ...client, name, description, parameters };
    if (strict) out.strict = true;
    else delete out.strict;
    return { built: normalize(out), schemaError: parsed.error ?? null };
  }, [kind, hook, query, body, client, schema, name, description]);

  const errors = useMemo(() => {
    const e = schemaError ? [schemaError] : [];
    e.push(...validateTool(built, { storedUrl: kind === "webhook" ? storedUrl : null }));
    if (built.name && duplicateName(allTools, built)) e.push("An agent tool with this name already exists.");
    if (kind === "webhook") {
      for (const id of duplicateIdentifiers([...query, ...body])) e.push(`Parameter ${id} is defined twice.`);
    }
    return [...new Set(e)];
  }, [built, schemaError, storedUrl, allTools, query, body, kind]);

  function save() {
    setAttempted(true);
    if (errors.length) return;
    onSave(built);
  }

  return (
    <dialog
      ref={ref}
      className="lb-dialog"
      aria-labelledby="lb-tool-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="lb-dialog-inner">
        <header className="lb-dialog-head">
          <div>
            <h2 id="lb-tool-dialog-title">{isNew ? "New tool" : "Edit tool"}</h2>
            <p>Set up a tool your agent can call.</p>
          </div>
          <button type="button" className="lb-icon-btn" aria-label="Close" onClick={onClose}>
            <XIcon size={16} />
          </button>
        </header>

        <div className="lb-seg" role="tablist" aria-label="Editor">
          <button type="button" role="tab" aria-selected="true" className="lb-seg-on">
            Form
          </button>
          <button type="button" role="tab" aria-selected="false" disabled title="Coming next">
            JSON
          </button>
        </div>

        <div className="lb-dialog-body">
          <div className="lb-field">
            <span className="lb-label">Type</span>
            <div className="lb-kinds" role="radiogroup" aria-label="Tool type">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={k.id === kind}
                  disabled={k.soon}
                  title={k.soon ? "Coming soon" : undefined}
                  className={`lb-kind${k.id === kind ? " lb-kind-on" : ""}`}
                  onClick={() => (k.id === "knowledge" ? undefined : switchKind(k.id))}
                >
                  <span className="lb-kind-icon">{k.icon}</span>
                  <span className="lb-kind-text">
                    <span className="lb-kind-label">{k.label}</span>
                    <span className="lb-kind-sub">{k.soon ? "Coming soon" : k.sub}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="lb-help">{HELP[kind]}</p>
          </div>

          <label className="lb-field">
            <span className="lb-label">
              Name <Info text="The function name the agent calls. Letters, numbers, underscores, dots or hyphens." />
            </span>
            <input
              ref={nameRef}
              className="lb-input lb-mono"
              value={name}
              placeholder={PLACEHOLDERS[kind].name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="lb-field">
            <span className="lb-label">
              Instructions <Info text="Tells the agent when to use this tool. Sent to the model as the tool's description." />
            </span>
            <textarea
              className="lb-input"
              rows={3}
              value={description}
              placeholder={PLACEHOLDERS[kind].instructions}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          {kind === "client" ? (
            <ClientFields
              client={client}
              onClient={(patch) => setClient((c) => ({ ...c, ...patch }))}
              schema={schema}
              onSchema={setSchema}
              schemaError={schemaError}
              open={optionalOpen}
              onOpen={setOptionalOpen}
            />
          ) : (
          <>
          <div className="lb-field">
            <div className="lb-method-url">
              <label className="lb-method">
                <span className="lb-label">Method</span>
                <select className="lb-input" value={hook.method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="lb-url">
                <span className="lb-label">
                  URL <span className="lb-req">*</span>
                </span>
                <input
                  className="lb-input"
                  type="url"
                  required
                  value={hook.url}
                  placeholder="https://api.example.com/endpoint"
                  onChange={(e) => set({ url: e.target.value })}
                />
              </label>
            </div>
            <div className="lb-help lb-help-row">
              <span>5s timeout. Turn off response waiting below for fire-and-forget calls.</span>
              <button type="button" className="lb-link" onClick={() => setTestOpen((v) => !v)} aria-expanded={testOpen}>
                {testOpen ? "Hide test" : "Test this tool"}
              </button>
            </div>
            {testOpen && built.type === "server" ? <TestPanel tool={built as WebhookTool} agentId={agentId} /> : null}
          </div>

          <details className="lb-optional" open={optionalOpen} onToggle={(e) => setOptionalOpen(e.currentTarget.open)}>
            <summary>Optional settings</summary>

            <RowsSection title="Headers" onAdd={() => set({ headers: [...hook.headers, { name: "", value: "", secret: true }] })}>
              <HeaderRows headers={hook.headers} onChange={(headers) => set({ headers })} />
            </RowsSection>

            <RowsSection title="Query" sub="Sent in the URL." onAdd={() => setQuery([...query, newParamRow()])}>
              <ParamRows rows={query} onChange={setQuery} />
            </RowsSection>

            {hook.method !== "GET" ? (
              <RowsSection title="Body" sub="Sent in the request body." onAdd={() => setBody([...body, newParamRow()])}>
                <ParamRows rows={body} onChange={setBody} />
              </RowsSection>
            ) : null}

            {hook.body_template ? (
              <label className="lb-field">
                <span className="lb-label">Custom body template</span>
                <textarea
                  className="lb-input lb-mono"
                  rows={3}
                  value={hook.body_template}
                  onChange={(e) => set({ body_template: e.target.value || null })}
                />
                <span className="lb-help">
                  Kept from the earlier tool form and sent instead of the Body parameters. {"{param}"} is replaced by
                  the parameter&apos;s value. Clear it to use the Body parameters.
                </span>
              </label>
            ) : null}

            <div className="lb-toggle-row lb-toggle-tight">
              <div className="lb-toggle-text">
                <span className="lb-toggle-label">
                  Wait for response <Info text="On: the agent waits up to 5 s for the endpoint and uses its answer. Off: the call is sent and the agent carries on at once." />
                </span>
              </div>
              <Switch
                checked={hook.awaitResponse}
                label="Wait for response"
                onChange={(v) => set({ awaitResponse: v, interruptible: v })}
              />
            </div>
            <div className={`lb-toggle-row lb-toggle-tight${hook.awaitResponse ? "" : " lb-disabled"}`}>
              <div className="lb-toggle-text">
                <span className="lb-toggle-label">
                  Interruptible <Info text="On: if the visitor starts talking while the call runs, it is cancelled. Off: the call finishes first, and the visitor can't interrupt it." />
                </span>
              </div>
              <Switch
                checked={hook.awaitResponse && hook.interruptible}
                disabled={!hook.awaitResponse}
                label="Interruptible"
                title={hook.awaitResponse ? undefined : "Only when waiting for the response"}
                onChange={(v) => set({ interruptible: v })}
              />
            </div>
          </details>
          </>
          )}
        </div>

        <footer className="lb-dialog-foot">
          {attempted && errors.length ? (
            <ul className="lb-dialog-errors" role="alert">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          <div className="lb-dialog-actions">
            <button type="button" className="l-btn l-btn-ghost lb-btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="l-btn l-btn-primary lb-btn-sm" onClick={save}>
              {isNew ? "Create tool" : "Save changes"}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ */

function Info({ text }: { text: string }) {
  return (
    <span className="lb-info" title={text} aria-label={text} role="img">
      <InfoIcon size={13} />
    </span>
  );
}

function RowsSection({
  title,
  sub,
  onAdd,
  children,
}: {
  title: string;
  sub?: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="lb-rows-section">
      <div className="lb-rows-head">
        <div>
          <span className="lb-label">{title}</span>
          {sub ? <span className="lb-help lb-help-inline">{sub}</span> : null}
        </div>
        <button type="button" className="l-btn l-btn-ghost lb-btn-xs" onClick={onAdd} aria-label={`Add ${title.toLowerCase()} row`}>
          Add
        </button>
      </div>
      {children}
    </section>
  );
}

function HeaderRows({ headers, onChange }: { headers: HeaderEntry[]; onChange: (h: HeaderEntry[]) => void }) {
  const update = (i: number, patch: Partial<HeaderEntry>) => onChange(headers.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  if (!headers.length) return null;
  return (
    <div className="lb-rows">
      {headers.map((h, i) => (
        <div className="lb-row-card" key={i}>
          <div className="lb-row-grid">
            <label>
              <span className="lb-sublabel">Name</span>
              <input
                className="lb-input lb-mono"
                value={h.name}
                placeholder="Authorization"
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </label>
            <label>
              <span className="lb-sublabel">Value</span>
              <input
                className={`lb-input lb-mono${isMasked(h.value) ? " lb-masked" : ""}`}
                value={h.value}
                placeholder="Bearer token_here"
                // a masked secret is replaced wholesale, never edited around the dots
                onFocus={(e) => isMasked(h.value) && e.currentTarget.select()}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            </label>
          </div>
          <div className="lb-row-foot">
            <label className="lb-check">
              <input type="checkbox" checked={h.secret} onChange={(e) => update(i, { secret: e.target.checked })} />
              Secret
              <Info text="Secret values are encrypted and shown only as ••••1234 once saved. Leave the dots to keep the saved value, or type a new one." />
            </label>
            <button type="button" className="lb-link lb-link-danger" onClick={() => onChange(headers.filter((_, j) => j !== i))}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ParamRows({ rows, onChange }: { rows: ParamRow[]; onChange: (r: ParamRow[]) => void }) {
  const update = (key: string, patch: Partial<ParamRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  if (!rows.length) return null;
  return (
    <div className="lb-rows">
      {rows.map((r) => (
        <ParamRowCard key={r.key} row={r} update={(p) => update(r.key, p)} remove={() => onChange(rows.filter((x) => x.key !== r.key))} />
      ))}
    </div>
  );
}

function ParamRowCard({ row, update, remove }: { row: ParamRow; update: (p: Partial<ParamRow>) => void; remove: () => void }) {
  const [enumDraft, setEnumDraft] = useState("");
  function addEnum() {
    const v = enumDraft.trim();
    if (!v || row.allowed.includes(v)) return;
    update({ allowed: [...row.allowed, v] });
    setEnumDraft("");
  }
  return (
    <div className="lb-row-card">
      <div className="lb-row-grid">
        <label>
          <span className="lb-sublabel">Data type</span>
          <select
            className="lb-input"
            value={row.dataType}
            onChange={(e) => update({ dataType: e.target.value as ToolDataType, allowed: [] })}
          >
            {DATA_TYPES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="lb-sublabel">Identifier</span>
          <input
            className="lb-input lb-mono"
            value={row.identifier}
            placeholder="param_name"
            onChange={(e) => update({ identifier: e.target.value })}
          />
        </label>
      </div>
      <label className="lb-check">
        <input type="checkbox" checked={row.required} onChange={(e) => update({ required: e.target.checked })} />
        Required
      </label>
      <label>
        <span className="lb-sublabel">Description</span>
        <textarea
          className="lb-input"
          rows={2}
          value={row.description}
          placeholder="What this should contain"
          onChange={(e) => update({ description: e.target.value })}
        />
      </label>
      {row.dataType !== "array" ? (
        <div>
          <span className="lb-sublabel">Allowed values</span>
          <div className="lb-enum-add">
            <input
              className="lb-input"
              value={enumDraft}
              placeholder="Enter an enum value"
              inputMode={row.dataType === "number" ? "decimal" : undefined}
              onChange={(e) => setEnumDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addEnum();
                }
              }}
            />
            <button type="button" className="l-btn l-btn-ghost lb-btn-xs" aria-label="Add allowed value" onClick={addEnum}>
              +
            </button>
          </div>
          {row.allowed.length ? (
            <div className="lb-chips-inline">
              {row.allowed.map((v) => (
                <span className="lb-enum-chip" key={v}>
                  {v}
                  <button type="button" aria-label={`Remove ${v}`} onClick={() => update({ allowed: row.allowed.filter((x) => x !== v) })}>
                    <XIcon size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <span className="lb-help">Optional. Limits the value to this list.</span>
        </div>
      ) : null}
      <div className="lb-row-foot lb-row-foot-end">
        <button type="button" className="lb-link lb-link-danger" onClick={remove}>
          Delete
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type TestResult = { ok: boolean; status: number | null; ms: number; text: string; error?: string };

function argText(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function TestPanel({ tool, agentId }: { tool: WebhookTool; agentId?: string }) {
  const props = tool.parameters.properties;
  const [args, setArgs] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(sampleArgs(tool.parameters)).map(([k, v]) => [k, argText(v)]))
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    // typed like the model would send them, so the test is the real call
    const typed: Record<string, unknown> = {};
    for (const [name, prop] of Object.entries(props)) {
      const raw = args[name] ?? "";
      if (raw === "") continue;
      if (prop.type === "number" || prop.type === "integer") typed[name] = Number(raw);
      else if (prop.type === "boolean") typed[name] = raw.trim().toLowerCase() === "true";
      else if (prop.type === "array") {
        try {
          const parsed = JSON.parse(raw);
          typed[name] = Array.isArray(parsed) ? parsed : [raw];
        } catch {
          typed[name] = raw.split(",").map((s) => s.trim()).filter(Boolean);
        }
      } else typed[name] = raw;
    }
    try {
      const res = await fetch("/api/tools/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args: typed, agent_id: agentId ?? null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, status: null, ms: 0, text: "", error: body.detail || body.error || "Test failed." });
        return;
      }
      const r = body.response ?? {};
      setResult({
        ok: Boolean(body.success),
        status: body.status_code ?? null,
        ms: body.duration_ms ?? 0,
        text: r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2),
        error: r.error,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lb-test">
      {Object.keys(props).length ? (
        <div className="lb-test-args">
          {Object.entries(props).map(([name, prop]) => (
            <label key={name}>
              <span className="lb-sublabel lb-mono">
                {name} <span className="lb-faint">{prop.type}</span>
              </span>
              <input
                className="lb-input lb-mono"
                value={args[name] ?? ""}
                onChange={(e) => setArgs((a) => ({ ...a, [name]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="lb-help">This tool takes no parameters.</p>
      )}
      <button type="button" className="l-btn l-btn-ghost lb-btn-sm" disabled={busy || !tool.url} onClick={() => void run()}>
        {busy ? "Running…" : "Run"}
      </button>
      {result ? (
        <div className={`lb-test-result${result.ok ? " lb-ok" : " lb-fail"}`}>
          <div className="lb-test-meta">
            {result.status != null ? <strong>{result.status}</strong> : <strong>{result.ok ? "OK" : "Failed"}</strong>}
            {result.ms ? <span>{result.ms} ms</span> : null}
            {result.error ? <span>{result.error}</span> : null}
          </div>
          {result.text ? <pre className="lb-code lb-test-body">{result.text.slice(0, 20000)}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CLIENT (§2.5)                                                       */
/* ------------------------------------------------------------------ */

function ClientFields({
  client,
  onClient,
  schema,
  onSchema,
  schemaError,
  open,
  onOpen,
}: {
  client: ClientTool;
  onClient: (patch: Partial<ClientTool>) => void;
  schema: string;
  onSchema: (text: string) => void;
  schemaError: string | null;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<"example" | "schema">("schema");
  const [example, setExample] = useState("");
  const [exampleError, setExampleError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  function convert() {
    try {
      onSchema(schemaText(inferSchema(example)));
      setExampleError(null);
      setTab("schema");
      setToast("Schema generated from example!");
    } catch (e) {
      setExampleError(example.trim() ? (e instanceof Error ? e.message : String(e)) : "Paste an example first, or press Try example.");
    }
  }

  return (
    <details className="lb-optional" open={open} onToggle={(e) => onOpen(e.currentTarget.open)}>
      <summary>Optional settings</summary>

      <div className="lb-field">
        <span className="lb-label">Parameters schema</span>
        <div className="lb-seg lb-seg-full" role="tablist" aria-label="Parameters schema">
          <button type="button" role="tab" aria-selected={tab === "example"} className={tab === "example" ? "lb-seg-on" : undefined} onClick={() => setTab("example")}>
            Example JSON
          </button>
          <button type="button" role="tab" aria-selected={tab === "schema"} className={tab === "schema" ? "lb-seg-on" : undefined} onClick={() => setTab("schema")}>
            Schema
          </button>
        </div>
        {tab === "example" ? (
          <>
            <div className="lb-help-row">
              <span className="lb-sublabel">Example JSON</span>
              <span className="lb-help-row-end">
                <button type="button" className="lb-link" onClick={() => setExample(WEATHER_EXAMPLE)}>
                  Try example
                </button>
                <Info text="Paste the arguments your app expects, as one JSON object. Every key becomes a required parameter of the type its value has." />
              </span>
            </div>
            <textarea
              className="lb-input lb-mono lb-json"
              rows={6}
              value={example}
              placeholder={WEATHER_EXAMPLE}
              aria-label="Example JSON"
              onChange={(e) => setExample(e.target.value)}
            />
            {exampleError ? <p className="lb-error">{exampleError}</p> : null}
            <button type="button" className="l-btn l-btn-primary lb-btn-sm lb-btn-block" onClick={convert}>
              ⚡ Convert example to schema
            </button>
          </>
        ) : (
          <>
            <textarea
              className={`lb-input lb-mono lb-json${schemaError ? " lb-invalid" : ""}`}
              rows={8}
              value={schema}
              aria-label="Parameters schema"
              spellCheck={false}
              onChange={(e) => onSchema(e.target.value)}
            />
            {schemaError ? <p className="lb-error">{schemaError}</p> : null}
          </>
        )}
        <p className="lb-help">
          Add <code className="lb-mono">strict:true</code> to ensure the response always follows this schema.{" "}
          <Info text="Stored with the tool. Gemini does not enforce strict schemas yet, so treat it as documentation for now." />
        </p>
        {toast ? (
          <div className="lb-dialog-toast" role="status">
            {toast}
          </div>
        ) : null}
      </div>

      <div className="lb-toggle-row lb-toggle-tight">
        <div className="lb-toggle-text">
          <span className="lb-toggle-label">Await result</span>
          <span className="lb-help" style={{ margin: 0 }}>
            Pause the conversation until your app sends a result back.
          </span>
        </div>
        <Switch
          checked={client.awaitResult}
          label="Await result"
          onChange={(v) => onClient({ awaitResult: v, interruptible: v })}
        />
      </div>
      {client.awaitResult ? (
        <label className="lb-field lb-timeout">
          <span className="lb-label">Timeout (seconds)</span>
          <input
            className="lb-input"
            type="number"
            min={1}
            max={60}
            value={client.timeout_s || ""}
            placeholder="10"
            onChange={(e) => onClient({ timeout_s: e.target.value === "" ? 0 : Number(e.target.value) })}
          />
          <span className="lb-help" style={{ margin: 0 }}>
            How long the engine waits before timing out. Default is 10s.
          </span>
        </label>
      ) : null}
      <div className={`lb-toggle-row lb-toggle-tight${client.awaitResult ? "" : " lb-disabled"}`}>
        <div className="lb-toggle-text">
          <span className="lb-toggle-label">
            Interruptible <Info text="On: if the visitor starts talking while your app works, the call is dropped. Off: the visitor can't interrupt it." />
          </span>
        </div>
        <Switch
          checked={client.awaitResult && client.interruptible}
          disabled={!client.awaitResult}
          label="Interruptible"
          title={client.awaitResult ? undefined : "Only when awaiting the result"}
          onChange={(v) => onClient({ interruptible: v })}
        />
      </div>
    </details>
  );
}
