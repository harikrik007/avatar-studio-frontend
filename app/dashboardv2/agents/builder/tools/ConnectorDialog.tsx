"use client";

/**
 * A connector tool for an agent: one action of an app its owner has connected (a calendar, a mailbox, a sheet, a chat
 * workspace). Three steps in one dialog:
 *
 *   apps      the apps on offer, each Connected or with a Connect button. Connect opens the app's own sign-in in a new tab;
 *             this dialog waits (it is told by the return tab, and also asks every few seconds).
 *   actions   the connected app's actions, searchable, each marked Reads or Changes things.
 *   edit      the tool: its name and instructions, which of the action's parameters the agent fills in (ticked), and a
 *             fixed value for any of the others. A real action can take 27 parameters; the agent should get a handful.
 *
 * Editing an existing connector tool opens straight on the third step. Like every tool edit, nothing is stored until the
 * agent itself is saved. What an agent may run is checked again by the server on save and on every call.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONNECTORS_CHANNEL,
  KIND_LABEL,
  buildConnectorTool,
  defaultTicks,
  fixedText,
  parseFixed,
  showDefault,
  toolNameFor,
  type ConnectorAction,
  type ConnectorApp,
} from "@/lib/connectors";
import { duplicateName, validateTool, type ConnectorTool, type SchemaProp, type Tool } from "@/lib/tools/model";
import { Switch } from "../tabs";
import { SearchIcon, XIcon } from "./icons";

type Step = "apps" | "actions" | "edit";
type TestResult = { ok: boolean; ms: number; sent: string; text: string; error?: string };

const POLL_MS = 2500;
const WAIT_MS = 5 * 60 * 1000;

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : typeof body.error === "string" ? body.error : fallback;
}

export default function ConnectorDialog({
  tool,
  allTools,
  onSave,
  onClose,
}: {
  /** the connector tool being edited; null to add one */
  tool: ConnectorTool | null;
  allTools: Tool[];
  onSave: (tool: ConnectorTool) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const isNew = tool === null;
  const [step, setStep] = useState<Step>(isNew ? "apps" : "edit");
  const [apps, setApps] = useState<ConnectorApp[] | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [app, setApp] = useState<string | null>(tool?.app ?? null);
  const [waiting, setWaiting] = useState<string | null>(null);        // the app being connected in the other tab
  const [busy, setBusy] = useState<string | null>(null);              // the app a request is out for
  const [actions, setActions] = useState<ConnectorAction[] | null>(null);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<ConnectorAction | null>(null);
  // the draft
  const [id] = useState(() => tool?.id ?? uuid());
  const [name, setName] = useState(tool?.name ?? "");
  const [description, setDescription] = useState(tool?.description ?? "");
  const [interruptible, setInterruptible] = useState(tool?.interruptible ?? true);
  const [ticked, setTicked] = useState<string[]>(() => Object.keys(tool?.parameters.properties ?? {}));
  const [fixed, setFixed] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(tool?.fixed ?? {}).map(([k, v]) => [k, fixedText(v)]))
  );
  const [attempted, setAttempted] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // ---- the apps, and waiting for one to be connected in the other tab
  const loadApps = useCallback(async (): Promise<ConnectorApp[] | null> => {
    try {
      const res = await fetch("/api/connectors/apps", { cache: "no-store" });
      if (!res.ok) {
        setAppsError(await readError(res, "The apps could not be loaded."));
        return null;
      }
      const list: ConnectorApp[] = (await res.json()).apps ?? [];
      setApps(list);
      setAppsError(null);
      return list;
    } catch {
      setAppsError("The apps could not be loaded.");
      return null;
    }
  }, []);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const started = Date.now();
    const check = async () => {
      const list = await loadApps();
      if (!live) return;
      if (list?.find((a) => a.slug === waiting)?.connected) setWaiting(null);
      else if (Date.now() - started > WAIT_MS) setWaiting(null);
    };
    const timer = setInterval(() => void check(), POLL_MS);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CONNECTORS_CHANNEL);
      channel.onmessage = () => void check();
    } catch {
      /* no BroadcastChannel: the timer alone finds out */
    }
    return () => {
      live = false;
      clearInterval(timer);
      channel?.close();
    };
  }, [waiting, loadApps]);

  async function connect(slug: string) {
    // The tab is opened now, on the click, and pointed at the sign-in once we have its address: a tab opened after a
    // request has come back is treated as a pop-up and blocked.
    const tab = window.open("", "_blank");
    setBusy(slug);
    setAppsError(null);
    try {
      const res = await fetch(`/api/connectors/apps/${encodeURIComponent(slug)}/connect`, { method: "POST" });
      if (!res.ok) {
        tab?.close();
        setAppsError(await readError(res, "The app could not be reached. Try again in a moment."));
        return;
      }
      const url: string = (await res.json()).redirect_url;
      if (tab) tab.location.href = url;
      else window.location.assign(url);       // pop-ups blocked altogether: this tab goes, and comes back to the dashboard
      setWaiting(slug);
    } catch {
      tab?.close();
      setAppsError("The app could not be reached. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(a: ConnectorApp) {
    if (!window.confirm(`Disconnect ${a.name}? Agents that use it will stop being able to until it is connected again.`)) return;
    setBusy(a.slug);
    try {
      const res = await fetch(`/api/connectors/apps/${encodeURIComponent(a.slug)}/connection`, { method: "DELETE" });
      if (!res.ok) setAppsError(await readError(res, "The app could not be disconnected."));
      await loadApps();
    } finally {
      setBusy(null);
    }
  }

  // ---- an app's actions
  const loadActions = useCallback(async (slug: string) => {
    setActions(null);
    setActionsError(null);
    try {
      const res = await fetch(`/api/connectors/apps/${encodeURIComponent(slug)}/actions`, { cache: "no-store" });
      if (!res.ok) {
        setActionsError(await readError(res, "The app's actions could not be loaded."));
        return;
      }
      setActions((await res.json()).actions ?? []);
    } catch {
      setActionsError("The app's actions could not be loaded.");
    }
  }, []);

  useEffect(() => {
    if (app) void loadActions(app);
  }, [app, loadActions]);

  // an existing tool: its action, once the app's actions are here
  useEffect(() => {
    if (tool && actions && !action) setAction(actions.find((a) => a.action === tool.action) ?? null);
  }, [tool, actions, action]);

  function chooseApp(slug: string) {
    setApp(slug);
    setSearch("");
    setStep("actions");
  }

  function chooseAction(a: ConnectorAction) {
    setAction(a);
    setName(toolNameFor(a.action, app ?? "", allTools, id));
    setDescription(a.description.slice(0, 1024));
    setTicked(defaultTicks(a));
    setFixed({});
    setAttempted(false);
    setTestOpen(false);
    setStep("edit");
  }

  const appInfo = apps?.find((a) => a.slug === app) ?? null;
  const shownActions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (actions ?? []).filter((a) => !q || `${a.name} ${a.description} ${a.action}`.toLowerCase().includes(q));
  }, [actions, search]);

  // ---- the tool being built
  const props: Record<string, SchemaProp> = action?.parameters.properties ?? tool?.parameters.properties ?? {};
  const fixedParsed = useMemo(() => {
    const values: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const [n, text] of Object.entries(fixed)) {
      if (ticked.includes(n) || !props[n]) continue;
      const r = parseFixed(props[n], text);
      if (r.error) errors[n] = r.error;
      else if (r.value !== undefined) values[n] = r.value;
    }
    return { values, errors };
  }, [fixed, ticked, props]);

  const built: ConnectorTool | null = useMemo(() => {
    const base = { id, name, description, enabled: tool?.enabled ?? true, interruptible, app: app ?? "" };
    if (action) return buildConnectorTool(base, action, ticked, fixedParsed.values);
    // the action is no longer offered (or its list did not load): the tool keeps what it had; only its words can change
    return tool ? { ...tool, name: name.trim(), description: description.trim(), interruptible } : null;
  }, [id, name, description, interruptible, app, action, ticked, fixedParsed, tool]);

  const errors = useMemo(() => {
    if (!built) return ["Pick an action."];
    const e = [...validateTool(built)];
    if (duplicateName(allTools, built)) e.push("An agent tool with this name already exists.");
    for (const [n, msg] of Object.entries(fixedParsed.errors)) e.push(`${n}: ${msg}`);
    return [...new Set(e)];
  }, [built, allTools, fixedParsed]);

  function save() {
    setAttempted(true);
    if (errors.length || !built) return;
    onSave(built);
  }

  function toggle(n: string, on: boolean) {
    setTicked((t) => (on ? [...t.filter((x) => x !== n), n] : t.filter((x) => x !== n)));
  }

  const required = new Set(action?.parameters.required ?? []);
  const names = Object.keys(props);

  return (
    <dialog ref={ref} className="lb-dialog lb-cx" aria-labelledby="lb-cx-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}>
      <div className="lb-dialog-inner">
        <header className="lb-dialog-head">
          <div>
            <h2 id="lb-cx-title">{isNew ? "Add connector" : "Edit connector"}</h2>
            <p>
              {step === "apps" ? "Connect an app, then pick what your agent may do in it."
                : step === "actions" ? `Pick one thing your agent may do in ${appInfo?.name ?? "this app"}.`
                : "Choose what the agent fills in. Everything else is fixed by you, or left to the app."}
            </p>
          </div>
          <button type="button" className="lb-icon-btn" aria-label="Close" onClick={onClose}>
            <XIcon size={16} />
          </button>
        </header>

        {step === "apps" ? (
          <div className="lb-dialog-body">
            {appsError ? <p className="lb-error" role="alert">{appsError}</p> : null}
            {apps === null && !appsError ? <p className="lb-help">Loading apps…</p> : null}
            <ul className="lb-cx-apps">
              {(apps ?? []).map((a) => (
                <li key={a.slug} className="lb-cx-app">
                  <AppLogo app={a} />
                  <div className="lb-cx-app-text">
                    <span className="lb-cx-app-name">
                      {a.name}
                      {a.connected ? <span className="lb-cx-chip lb-cx-on">Connected</span> : null}
                    </span>
                    <span className="lb-help lb-cx-app-desc">{a.description}</span>
                    {waiting === a.slug ? (
                      <span className="lb-cx-waiting" role="status">
                        Finish connecting in the tab that opened. This page will notice.{" "}
                        <button type="button" className="lb-link" onClick={() => setWaiting(null)}>Stop waiting</button>
                      </span>
                    ) : null}
                  </div>
                  <div className="lb-cx-app-actions">
                    {a.connected ? (
                      <>
                        <button type="button" className="lb-link" disabled={busy === a.slug} onClick={() => void disconnect(a)}>
                          Disconnect
                        </button>
                        <button type="button" className="l-btn l-btn-primary lb-btn-sm" onClick={() => chooseApp(a.slug)}>
                          Choose
                        </button>
                      </>
                    ) : (
                      <button type="button" className="l-btn l-btn-ghost lb-btn-sm" disabled={busy === a.slug || waiting === a.slug}
                        onClick={() => void connect(a.slug)}>
                        {busy === a.slug ? "Opening…" : waiting === a.slug ? "Waiting…" : "Connect"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="lb-help" style={{ margin: 0 }}>
              One account per app, shared by all your agents. The agent acts as that account, only through the actions you pick.
            </p>
          </div>
        ) : null}

        {step === "actions" ? (
          <div className="lb-dialog-body">
            <div className="lb-cx-bar">
              <button type="button" className="lb-link" onClick={() => setStep("apps")}>‹ Apps</button>
              {appInfo ? <span className="lb-cx-bar-app"><AppLogo app={appInfo} small />{appInfo.name}</span> : null}
            </div>
            <div className="lb-tool-search">
              <span className="lb-search-icon"><SearchIcon /></span>
              <input className="lb-input" value={search} placeholder="Search actions…" aria-label="Search actions"
                onChange={(e) => setSearch(e.target.value)} />
            </div>
            {actionsError ? <p className="lb-error" role="alert">{actionsError}</p> : null}
            {actions === null && !actionsError ? <p className="lb-help">Loading actions…</p> : null}
            {actions && shownActions.length === 0 ? <p className="lb-help">No actions match your search.</p> : null}
            <ul className="lb-cx-actions">
              {shownActions.map((a) => (
                <li key={a.action}>
                  <button type="button" className="lb-cx-action" onClick={() => chooseAction(a)}>
                    <span className="lb-cx-action-top">
                      <span className="lb-cx-action-name">{a.name}</span>
                      <span className={`lb-cx-chip lb-cx-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                    </span>
                    <span className="lb-help lb-cx-action-desc">{a.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {step === "edit" ? (
          <div className="lb-dialog-body">
            <div className="lb-cx-bar">
              {isNew ? <button type="button" className="lb-link" onClick={() => setStep("actions")}>‹ Actions</button> : null}
              <span className="lb-cx-bar-app">
                {appInfo ? <AppLogo app={appInfo} small /> : null}
                {appInfo?.name ?? app}
                <span className="lb-faint"> · {action?.name ?? tool?.action}</span>
              </span>
              {action ? <span className={`lb-cx-chip lb-cx-${action.kind}`}>{KIND_LABEL[action.kind]}</span> : null}
            </div>
            {actionsError ? <p className="lb-error" role="alert">{actionsError}</p> : null}
            {!isNew && actions && !action ? (
              <p className="lb-note" role="note">
                This action is no longer offered by the app. The tool is kept as it is; you can change its name and instructions, or delete it.
              </p>
            ) : null}
            {action?.kind === "read" ? (
              <p className="lb-note" role="note">
                The agent can tell a visitor whatever this returns. Give it only if that is fine for anyone who talks to your agent.
              </p>
            ) : null}

            <label className="lb-field">
              <span className="lb-label">Name <span className="lb-req">*</span></span>
              <input className="lb-input lb-mono" value={name} maxLength={64} aria-label="Tool name" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="lb-field">
              <span className="lb-label">Instructions <span className="lb-req">*</span></span>
              <textarea className="lb-input" rows={3} value={description} maxLength={1024} aria-label="Instructions"
                onChange={(e) => setDescription(e.target.value)} />
              <span className="lb-help">Tell the agent when to use this, in your own words.</span>
            </label>

            {!isNew && !actions && !actionsError ? <p className="lb-help">Loading the action…</p> : null}
            {names.length ? (
              <div className="lb-field">
                <span className="lb-label">
                  What the agent fills in <span className="lb-faint">· {ticked.filter((n) => n in props).length} of {names.length}</span>
                </span>
                <ul className="lb-cx-params">
                  {names.map((n) => {
                    const on = ticked.includes(n);
                    const p = props[n];
                    const hasDefault = action ? n in action.defaults : false;
                    return (
                      <li key={n} className={`lb-cx-param${on ? " lb-cx-param-on" : ""}`}>
                        <label className="lb-cx-param-main">
                          <input type="checkbox" checked={on} disabled={!action} aria-label={`The agent fills in ${n}`}
                            onChange={(e) => toggle(n, e.target.checked)} />
                          <span className="lb-cx-param-text">
                            <span className="lb-mono lb-cx-param-name">
                              {n} <span className="lb-faint">{p.type}{required.has(n) ? " · required" : ""}</span>
                            </span>
                            {p.description ? <span className="lb-help lb-cx-param-desc">{p.description}</span> : null}
                          </span>
                        </label>
                        {on ? null : (
                          <label className="lb-cx-fixed">
                            <span className="lb-sr">Fixed value for {n}</span>
                            <input className={`lb-input lb-mono${fixedParsed.errors[n] ? " lb-invalid" : ""}`} value={fixed[n] ?? ""} disabled={!action}
                              placeholder={hasDefault ? `Fixed value (app default: ${showDefault(action?.defaults[n])})` : "Fixed value (empty: not sent)"}
                              aria-label={`Fixed value for ${n}`} aria-invalid={Boolean(fixedParsed.errors[n])}
                              onChange={(e) => setFixed((f) => ({ ...f, [n]: e.target.value }))} />
                            {fixedParsed.errors[n] ? <span className="lb-error">{fixedParsed.errors[n]}</span> : null}
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : action ? (
              <p className="lb-help">This action takes no parameters.</p>
            ) : null}

            <div className="lb-toggle-row lb-toggle-tight">
              <div className="lb-toggle-text">
                <span className="lb-toggle-label">Interruptible</span>
                <span className="lb-help">On: if the visitor starts talking while it runs, the agent stops waiting for it.</span>
              </div>
              <Switch checked={interruptible} label="Interruptible" onChange={setInterruptible} />
            </div>

            {built && action ? (
              <>
                <div className="lb-help lb-help-row">
                  <span>A test runs for real on the connected account.</span>
                  <button type="button" className="lb-link" onClick={() => setTestOpen((v) => !v)} aria-expanded={testOpen}>
                    {testOpen ? "Hide test" : "Test this tool"}
                  </button>
                </div>
                {testOpen ? <ConnectorTest tool={built} disabled={errors.length > 0} /> : null}
              </>
            ) : null}
          </div>
        ) : null}

        <footer className="lb-dialog-foot">
          {step === "edit" && attempted && errors.length ? (
            <ul className="lb-dialog-errors" role="alert">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : null}
          <div className="lb-dialog-actions">
            <button type="button" className="l-btn l-btn-ghost lb-btn-sm" onClick={onClose}>Cancel</button>
            {step === "edit" ? (
              <button type="button" className="l-btn l-btn-primary lb-btn-sm" onClick={save}>
                {isNew ? "Add tool" : "Save changes"}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </dialog>
  );
}

function AppLogo({ app, small }: { app: ConnectorApp; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = `lb-cx-logo${small ? " lb-cx-logo-sm" : ""}`;
  if (!app.logo || broken) return <span className={`${cls} lb-cx-logo-fallback`} aria-hidden="true">{app.name.slice(0, 1)}</span>;
  return <img className={cls} src={app.logo} alt="" onError={() => setBroken(true)} />;
}

function ConnectorTest({ tool, disabled }: { tool: ConnectorTool; disabled: boolean }) {
  const props = tool.parameters.properties;
  const [args, setArgs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    // typed like the model would send them
    const typed: Record<string, unknown> = {};
    for (const [n, p] of Object.entries(props)) {
      const r = parseFixed(p, args[n] ?? "");
      if (r.value !== undefined) typed[n] = r.value;
    }
    try {
      const res = await fetch("/api/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args: typed }),
      });
      if (!res.ok) {
        setResult({ ok: false, ms: 0, sent: "", text: "", error: await readError(res, "The test failed.") });
        return;
      }
      const body = await res.json();
      const model = body.response?.model ?? {};
      setResult({
        ok: Boolean(body.success),
        ms: body.duration_ms ?? 0,
        sent: JSON.stringify(body.sent ?? {}, null, 2),
        text: model.result === undefined ? "" : typeof model.result === "string" ? model.result : JSON.stringify(model.result, null, 2),
        error: model.error,
      });
    } catch {
      setResult({ ok: false, ms: 0, sent: "", text: "", error: "The test failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lb-test">
      {Object.keys(props).length ? (
        <div className="lb-test-args">
          {Object.entries(props).map(([n, p]) => (
            <label key={n}>
              <span className="lb-sublabel lb-mono">{n} <span className="lb-faint">{p.type}</span></span>
              <input className="lb-input lb-mono" value={args[n] ?? ""} aria-label={`Test value for ${n}`}
                onChange={(e) => setArgs((a) => ({ ...a, [n]: e.target.value }))} />
            </label>
          ))}
        </div>
      ) : (
        <p className="lb-help">The agent fills in nothing for this tool.</p>
      )}
      <button type="button" className="l-btn l-btn-ghost lb-btn-sm" disabled={busy || disabled} onClick={() => void run()}>
        {busy ? "Running…" : "Run"}
      </button>
      {result ? (
        <div className={`lb-test-result${result.ok ? " lb-ok" : " lb-fail"}`}>
          <div className="lb-test-meta">
            <strong>{result.ok ? "OK" : "Failed"}</strong>
            {result.ms ? <span>{result.ms} ms</span> : null}
            {result.error ? <span>{result.error}</span> : null}
          </div>
          {result.sent ? (
            <>
              <span className="lb-sublabel">Sent to the app</span>
              <pre className="lb-code lb-test-body">{result.sent}</pre>
            </>
          ) : null}
          {result.text ? (
            <>
              <span className="lb-sublabel">What the agent is given</span>
              <pre className="lb-code lb-test-body">{result.text.slice(0, 20000)}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
