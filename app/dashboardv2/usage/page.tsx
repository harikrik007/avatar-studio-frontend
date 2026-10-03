"use client";

/**
 * What each call used: LLM tokens and Anam seconds, per call, for widget (embedded) calls and for the
 * dashboard's test button. A client sees its own calls; an administrator (the backend's
 * USAGE_ADMIN_EMAILS) can switch to every client's. Numbers come from api/usage.py -- the agent's own
 * record of each Gemini report, and Anam's own record of the session once it has ended.
 *
 * Ditto / FlashHead / Wav2Lip calls are listed with their duration but no tokens: their Gemini session
 * runs on the GPU side, so the backend never sees it.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import "./usage.css";
import {
  KIND_FILTERS,
  endReasonLabel,
  flagLabel,
  formatMinutes,
  formatSeconds,
  formatTokens,
  kindLabel,
  rangeLastDays,
  statusBadgeClass,
  statusLabel,
  usageQuery,
  type GroupBy,
  type UsageCalls,
  type UsageEventRow,
  type UsageItem,
  type UsageSummary,
} from "@/lib/usage";

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];
const STATUSES = [
  { label: "Any status", value: "" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Lost", value: "lost" },
  { label: "Running", value: "active" },
];
const PAGE = 50;

type AgentOption = { id: string; name: string };
type Detail = UsageEventRow[] | "loading" | "error";

/** Tokens are only recorded where the brain runs in this backend (the Anam path). */
const hasTokens = (c: UsageItem) => c.renderer === "anam" && c.source !== "backfill";

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [agentId, setAgentId] = useState("");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [items, setItems] = useState<UsageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  // A slower answer to an older filter must not overwrite a newer one.
  const seq = useRef(0);

  const { from, to } = rangeLastDays(days);
  const filters = { from, to, kind, status, agent_id: scope === "mine" ? agentId : "", scope };
  const filterKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      const f = JSON.parse(filterKey) as Record<string, string>;
      const [s, c] = await Promise.all([
        fetch(`/api/usage/summary${usageQuery({ ...f, group_by: groupBy })}`),
        fetch(`/api/usage/calls${usageQuery({ ...f, limit: PAGE, offset: 0 })}`),
      ]);
      if (mine !== seq.current) return;
      if (!s.ok || !c.ok) {
        const body = await (s.ok ? c : s).json().catch(() => ({}));
        setError(typeof body.detail === "string" ? body.detail : "Could not load usage.");
        setLoaded(true);
        return;
      }
      const sj: UsageSummary = await s.json();
      const cj: UsageCalls = await c.json();
      if (mine !== seq.current) return;
      setSummary(sj);
      setItems(cj.items);
      setTotal(cj.total);
      setOpen(null);
    } catch {
      if (mine === seq.current) setError("Could not load usage.");
    }
    if (mine === seq.current) setLoaded(true);
  }, [filterKey, groupBy]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/agents");
      if (res.ok) {
        const list: { id: string; name: string }[] = await res.json();
        setAgents(list.map((a) => ({ id: a.id, name: a.name })));
      }
    })();
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/usage/calls${usageQuery({ ...JSON.parse(filterKey), limit: PAGE, offset: items.length })}`);
      if (res.ok) {
        const body: UsageCalls = await res.json();
        setItems((prev) => [...prev, ...body.items]);
        setTotal(body.total);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggle(call: UsageItem) {
    if (open === call.id) {
      setOpen(null);
      return;
    }
    setOpen(call.id);
    if (details[call.id] && details[call.id] !== "error") return;
    setDetails((d) => ({ ...d, [call.id]: "loading" }));
    try {
      const res = await fetch(`/api/usage/calls/${call.id}`);
      const body = await res.json();
      setDetails((d) => ({ ...d, [call.id]: res.ok ? (body.events as UsageEventRow[]) : "error" }));
    } catch {
      setDetails((d) => ({ ...d, [call.id]: "error" }));
    }
  }

  function chooseScope(next: "mine" | "all") {
    setScope(next);
    if (next === "mine" && groupBy === "client") setGroupBy("day");
    if (next === "all") setAgentId("");
  }

  const totals = summary?.totals;
  const isAdmin = summary?.is_admin ?? false;
  const showClient = scope === "all";
  const groupOptions: { value: GroupBy; label: string }[] = [
    { value: "day", label: "Day" },
    { value: "agent", label: "Agent" },
    { value: "kind", label: "Type" },
    ...(scope === "all" ? [{ value: "client" as GroupBy, label: "Client" }] : []),
  ];

  return (
    <div className="l-dash-shell lu-shell">
      <div className="l-dash-header">
        <span className="l-kicker">Dashboard</span>
        <h1>Usage</h1>
        <p>What each call used: language-model tokens and Anam seconds, for embedded widgets and the test button.</p>
      </div>

      <div className="lu-filters" role="group" aria-label="Filters">
        <div className="lu-pills" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.days} type="button" aria-pressed={days === r.days}
              className={`l-voice-filter-pill${days === r.days ? " l-voice-filter-active" : ""}`}
              onClick={() => setDays(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="lu-pills" role="group" aria-label="Type of call">
          {KIND_FILTERS.map((k) => (
            <button key={k.label} type="button" aria-pressed={kind === k.value}
              className={`l-voice-filter-pill${kind === k.value ? " l-voice-filter-active" : ""}`}
              onClick={() => setKind(k.value)}>
              {k.label}
            </button>
          ))}
        </div>
        <label className="lu-select">
          <span className="lu-sr">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        {scope === "mine" ? (
          <label className="lu-select">
            <span className="lu-sr">Agent</span>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        {isAdmin ? (
          <div className="lu-pills" role="group" aria-label="Whose usage">
            <button type="button" aria-pressed={scope === "mine"}
              className={`l-voice-filter-pill${scope === "mine" ? " l-voice-filter-active" : ""}`}
              onClick={() => chooseScope("mine")}>
              Mine
            </button>
            <button type="button" aria-pressed={scope === "all"}
              className={`l-voice-filter-pill${scope === "all" ? " l-voice-filter-active" : ""}`}
              onClick={() => chooseScope("all")}>
              All clients
            </button>
          </div>
        ) : null}
        <a className="l-btn l-btn-ghost lu-export" href={`/api/usage/export${usageQuery(filters)}`}>
          Export CSV
        </a>
      </div>

      {error ? <div className="lu-error" role="alert">{error}</div> : null}

      {!loaded ? (
        <div className="lu-skeleton" aria-busy="true">Loading usage…</div>
      ) : (
        <>
          {totals ? (
            <div className="lu-totals" aria-label="Totals for this period">
              <Stat label="Calls" value={formatTokens(totals.calls)}
                sub={[`${totals.completed} completed`, totals.failed ? `${totals.failed} failed` : "",
                  totals.lost ? `${totals.lost} lost` : "", totals.active ? `${totals.active} running` : ""]
                  .filter(Boolean).join(" · ")} warn={totals.failed > 0} />
              <Stat label="Anam time" value={formatMinutes(totals.anam_seconds)}
                sub={totals.other_renderer_seconds > 0 ? `+ ${formatSeconds(totals.other_renderer_seconds)} on GPU renderers` : "billed seconds where Anam has reported"} />
              <Stat label="Input tokens" value={formatTokens(totals.input_tokens)} sub="the whole conversation, each turn" />
              <Stat label="Output tokens" value={formatTokens(totals.output_tokens)}
                sub={totals.thought_tokens > 0 ? `+ ${formatTokens(totals.thought_tokens)} thinking` : undefined} />
              <Stat label="Tool calls" value={formatTokens(totals.tool_calls)} />
            </div>
          ) : null}

          {summary && summary.groups.length > 0 ? (
            <section className="lu-section" aria-label="Breakdown">
              <div className="lu-section-head">
                <h2>Breakdown</h2>
                <div className="lu-pills" role="group" aria-label="Group by">
                  {groupOptions.map((g) => (
                    <button key={g.value} type="button" aria-pressed={groupBy === g.value}
                      className={`l-voice-filter-pill${groupBy === g.value ? " l-voice-filter-active" : ""}`}
                      onClick={() => setGroupBy(g.value)}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="lu-table-wrap">
                <table className="lu-table lu-breakdown">
                  <thead>
                    <tr>
                      <th>{groupOptions.find((g) => g.value === groupBy)?.label}</th>
                      <th className="lu-num">Calls</th>
                      <th className="lu-num">Anam time</th>
                      <th className="lu-num">Input</th>
                      <th className="lu-num">Output</th>
                      <th className="lu-num">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.groups.map((g) => (
                      <tr key={`${g.key}`}>
                        <td>{groupBy === "kind" && g.key ? kindLabel(g.key) : g.label}</td>
                        <td className="lu-num">{formatTokens(g.calls)}</td>
                        <td className="lu-num">{formatMinutes(g.anam_seconds)}</td>
                        <td className="lu-num">{formatTokens(g.input_tokens)}</td>
                        <td className="lu-num">{formatTokens(g.output_tokens)}</td>
                        <td className="lu-num">{g.failed + g.lost > 0 ? formatTokens(g.failed + g.lost) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="lu-section" aria-label="Calls">
            <div className="lu-section-head">
              <h2>Calls</h2>
              <span className="lu-count">{formatTokens(total)} in this period</span>
            </div>
            {items.length === 0 ? (
              <div className="l-empty-state">
                <h2>No calls in this period</h2>
                <p>Calls appear here after a visitor talks to a widget or you press Test on an agent.</p>
              </div>
            ) : (
              <div className="lu-table-wrap">
                <table className="lu-table lu-calls">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>{showClient ? "Client · Agent" : "Agent"}</th>
                      <th>Type</th>
                      <th className="lu-num">Anam time</th>
                      <th className="lu-num">Input</th>
                      <th className="lu-num">Output</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => (
                      <Fragment key={c.id}>
                        <tr className={`lu-row${open === c.id ? " lu-row-open" : ""}`} onClick={() => void toggle(c)}>
                          <td>
                            <button type="button" className="lu-expand" aria-expanded={open === c.id}
                              aria-label={`Details for the call started ${c.started_at ?? ""}`}
                              onClick={(e) => { e.stopPropagation(); void toggle(c); }}>
                              {c.started_at ? new Date(c.started_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                            </button>
                          </td>
                          <td>
                            {showClient ? <div className="lu-sub">{c.client_company || c.client_email}</div> : null}
                            {c.agent_name ?? "(deleted agent)"}
                          </td>
                          <td>
                            <span className={`lu-kind lu-kind-${c.kind}`}>{kindLabel(c.kind)}</span>
                            {c.renderer !== "anam" ? <div className="lu-sub">{c.renderer}</div> : null}
                          </td>
                          <td className="lu-num">
                            {c.renderer === "anam" ? formatSeconds(c.seconds) : formatSeconds(c.renderer_seconds)}
                            {c.flags.includes("anam_mismatch") ? <div className="lu-sub lu-warn">differs from Anam</div> : null}
                          </td>
                          <td className="lu-num">{hasTokens(c) ? formatTokens(c.input_tokens) : "—"}</td>
                          <td className="lu-num">{hasTokens(c) ? formatTokens(c.output_tokens) : "—"}</td>
                          <td>
                            <span className={`l-status-badge ${statusBadgeClass(c.status)}`}>{statusLabel(c.status)}</span>
                          </td>
                        </tr>
                        {open === c.id ? (
                          <tr className="lu-detail-row">
                            <td colSpan={7}><CallDetail call={c} events={details[c.id]} /></td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {items.length < total ? (
              <div className="lu-more">
                <button type="button" className="l-btn l-btn-ghost" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : `Show more (${formatTokens(total - items.length)} left)`}
                </button>
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`lu-stat${warn ? " lu-stat-warn" : ""}`}>
      <div className="lu-stat-label">{label}</div>
      <div className="lu-stat-value">{value}</div>
      {sub ? <div className="lu-stat-sub">{sub}</div> : null}
    </div>
  );
}

function CallDetail({ call, events }: { call: UsageItem; events: Detail | undefined }) {
  const tokens = hasTokens(call);
  return (
    <div className="lu-detail">
      <dl className="lu-facts">
        <div><dt>How it ended</dt><dd>{call.status === "active" ? "Still running" : endReasonLabel(call.end_reason)}</dd></div>
        <div><dt>Call length</dt><dd>{formatSeconds(call.duration_seconds)}</dd></div>
        {call.renderer === "anam" ? (
          <>
            <div><dt>Anam time (ours)</dt><dd>{formatSeconds(call.renderer_seconds)}</dd></div>
            <div><dt>Anam time (billed)</dt><dd>{call.anam_seconds_billed === null ? "not reported yet" : formatSeconds(call.anam_seconds_billed)}</dd></div>
          </>
        ) : (
          <div><dt>Renderer time</dt><dd>{formatSeconds(call.renderer_seconds)}</dd></div>
        )}
        <div><dt>Pipeline</dt><dd>{call.pipeline === "cascade" ? "Cascade" : "Gemini Live"}{call.model ? ` · ${call.model.replace("models/", "")}` : ""}</dd></div>
        <div><dt>Voice</dt><dd>{call.voice ?? "—"}</dd></div>
        {call.origin ? <div><dt>Page</dt><dd>{call.origin}</dd></div> : null}
        {tokens ? (
          <>
            <div><dt>Input</dt><dd>{formatTokens(call.input_tokens)} <span className="lu-sub">({formatTokens(call.input_audio_tokens)} audio)</span></dd></div>
            <div><dt>Output</dt><dd>{formatTokens(call.output_tokens)} <span className="lu-sub">({formatTokens(call.output_audio_tokens)} audio)</span></dd></div>
            <div><dt>Thinking</dt><dd>{formatTokens(call.thought_tokens)}</dd></div>
            <div><dt>Responses · tools</dt><dd>{call.generations} · {call.tool_calls}</dd></div>
          </>
        ) : (
          <div><dt>Tokens</dt><dd>{call.source === "backfill" ? "not recorded (before usage logging)" : "not recorded: this renderer's brain runs on the GPU side"}</dd></div>
        )}
      </dl>
      {call.error ? <div className="lu-error lu-error-inline" role="note">{call.error}</div> : null}
      {call.flags.length > 0 ? (
        <div className="lu-flags">{call.flags.map((f) => <span key={f} className="lu-flag">{flagLabel(f)}</span>)}</div>
      ) : null}
      {tokens ? (
        events === "loading" || events === undefined ? <div className="lu-sub">Loading reports…</div>
          : events === "error" ? <div className="lu-sub lu-warn">Could not load the reports.</div>
          : events.length === 0 ? <div className="lu-sub">No model reports were recorded for this call.</div> : (
            <div className="lu-table-wrap">
              <table className="lu-table lu-events">
                <thead>
                  <tr><th>#</th><th>Part</th><th className="lu-num">Input text</th><th className="lu-num">Input audio</th>
                    <th className="lu-num">Output</th><th className="lu-num">Thinking</th><th className="lu-num">Total</th></tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.seq}>
                      <td>{e.seq}</td>
                      <td>{partLabel(e.component)}</td>
                      <td className="lu-num">{formatTokens(e.input_text_tokens + e.input_other_tokens)}</td>
                      <td className="lu-num">{formatTokens(e.input_audio_tokens)}</td>
                      <td className="lu-num">{formatTokens(e.output_text_tokens + e.output_audio_tokens + e.output_other_tokens)}</td>
                      <td className="lu-num">{formatTokens(e.thought_tokens)}</td>
                      <td className="lu-num">{e.component === "stt" && e.audio_seconds ? `${e.audio_seconds.toFixed(1)} s audio` : formatTokens(e.total_tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      ) : null}
    </div>
  );
}

function partLabel(component: string): string {
  return ({ live: "Gemini Live", llm: "Language model", tts: "Speech", stt: "Transcription" } as Record<string, string>)[component] ?? component;
}
