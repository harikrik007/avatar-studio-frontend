"use client";

/**
 * How long each call ran, for widget (embedded) calls and for the dashboard's test button, with the day / agent / type breakdown,
 * the filters and a CSV. A customer is billed in minutes (a plan's minutes will come later), so this page speaks minutes and
 * nothing else: no prices, no token counts, no provider names. Every client's usage, tokens and cost live in the separate admin
 * dashboard (avatar-studio-admin), not here, whoever is signed in.
 *
 * Ditto / FlashHead / Wav2Lip calls are listed with their duration like the others.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import "./usage.css";
import TranscriptDialog from "./TranscriptDialog";
import {
  KIND_FILTERS,
  endReasonLabel,
  formatCount,
  formatDayRange,
  formatMinutes,
  formatSeconds,
  kindLabel,
  localDay,
  rangeLastDays,
  statusBadgeClass,
  statusLabel,
  tzOffsetMinutes,
  usageQuery,
  utcLabel,
  type GroupBy,
  type UsageCalls,
  type UsageItem,
  type UsageSummary,
} from "@/lib/usage";

const RANGES = [
  { label: "Today", days: 1 },
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
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "agent", label: "Agent" },
  { value: "kind", label: "Type" },
];
const PAGE = 50;

type AgentOption = { id: string; name: string };

export default function UsagePage() {
  // A preset (1 = today, 7, 30, 90 days) or a range picked by hand.
  const [period, setPeriod] = useState<number | "custom">(30);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [agentId, setAgentId] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [items, setItems] = useState<UsageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // A slower answer to an older filter must not overwrite a newer one.
  const seq = useRef(0);

  const todayStr = localDay(new Date());
  const { from, to } = period === "custom" ? { from: customFrom || todayStr, to: customTo || todayStr } : rangeLastDays(period);
  // Days are the viewer's own: the backend reads from/to and the Day grouping in this offset.
  const tz = tzOffsetMinutes();
  const filters = { from, to, kind, status, agent_id: agentId, tz };
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
      const res = await fetch("/api/agents?summary=true");
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

  function chooseCustom() {
    if (period === "custom") return;
    setCustomFrom(from);          // start from what is on screen, so the inputs are never empty
    setCustomTo(to);
    setPeriod("custom");
  }

  // The two dates always stay in order and never pass today.
  function pickFrom(v: string) {
    if (!v) return;
    const day = v > todayStr ? todayStr : v;
    setCustomFrom(day);
    if (day > customTo) setCustomTo(day);
  }

  function pickTo(v: string) {
    if (!v) return;
    const day = v > todayStr ? todayStr : v;
    setCustomTo(day);
    if (day < customFrom) setCustomFrom(day);
  }

  const totals = summary?.totals;

  return (
    <div className="l-dash-shell lu-shell">
      <div className="l-dash-header">
        <span className="l-kicker">Dashboard</span>
        <h1>Usage</h1>
        <p>How long each call ran, for embedded widgets and the test button.</p>
      </div>

      <div className="lu-filters" role="group" aria-label="Filters">
        <div className="lu-pills" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.days} type="button" aria-pressed={period === r.days}
              className={`l-voice-filter-pill${period === r.days ? " l-voice-filter-active" : ""}`}
              onClick={() => setPeriod(r.days)}>
              {r.label}
            </button>
          ))}
          <button type="button" aria-pressed={period === "custom"}
            className={`l-voice-filter-pill${period === "custom" ? " l-voice-filter-active" : ""}`}
            onClick={chooseCustom}>
            Custom
          </button>
        </div>
        {period === "custom" ? (
          <div className="lu-dates" role="group" aria-label="Date range">
            <label className="lu-date">
              <span>From</span>
              <input type="date" value={customFrom} max={todayStr} aria-label="From date" onChange={(e) => pickFrom(e.target.value)} />
            </label>
            <label className="lu-date">
              <span>To</span>
              <input type="date" value={customTo} max={todayStr} aria-label="To date" onChange={(e) => pickTo(e.target.value)} />
            </label>
          </div>
        ) : null}
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
        <label className="lu-select">
          <span className="lu-sr">Agent</span>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <a className="l-btn l-btn-ghost lu-export" href={`/api/usage/export${usageQuery(filters)}`}>
          Export CSV
        </a>
      </div>

      {error ? <div className="lu-error" role="alert">{error}</div> : null}

      {!loaded ? (
        <div className="lu-skeleton" aria-busy="true">Loading usage…</div>
      ) : (
        <>
          {/* Only after the first load: the dates and offset are the browser's, which the server render cannot know
              (it runs in UTC), and a different server and browser text fails hydration. */}
          <p className="lu-range" aria-live="polite">
            Showing <strong>{formatDayRange(from, to)}</strong> · days and times in your timezone ({utcLabel(tz)})
          </p>

          {totals ? (
            <div className="lu-totals lu-totals-three" aria-label="Totals for this period">
              <Stat label="Calls" value={formatCount(totals.calls)}
                sub={[`${totals.completed} completed`, totals.failed ? `${totals.failed} failed` : "",
                  totals.lost ? `${totals.lost} lost` : "", totals.active ? `${totals.active} running` : ""]
                  .filter(Boolean).join(" · ")} warn={totals.failed > 0} />
              <Stat label="Call time" value={formatMinutes(totals.call_seconds)} />
              <Stat label="Tool calls" value={formatCount(totals.tool_calls)} />
            </div>
          ) : null}

          {summary && summary.groups.length > 0 ? (
            <section className="lu-section" aria-label="Breakdown">
              <div className="lu-section-head">
                <h2>Breakdown</h2>
                <div className="lu-pills" role="group" aria-label="Group by">
                  {GROUPS.map((g) => (
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
                      <th>{GROUPS.find((g) => g.value === groupBy)?.label}</th>
                      <th className="lu-num">Calls</th>
                      <th className="lu-num">Call time</th>
                      <th className="lu-num">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.groups.map((g) => (
                      <tr key={`${g.key}`}>
                        <td>{groupBy === "kind" && g.key ? kindLabel(g.key) : g.label}</td>
                        <td className="lu-num">{formatCount(g.calls)}</td>
                        <td className="lu-num">{formatMinutes(g.call_seconds)}</td>
                        <td className="lu-num">{g.failed + g.lost > 0 ? formatCount(g.failed + g.lost) : "—"}</td>
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
              <span className="lu-count">{formatCount(total)} in this period</span>
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
                      <th>Agent</th>
                      <th>Type</th>
                      <th className="lu-num">Call time</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => (
                      <Fragment key={c.id}>
                        <tr className={`lu-row${open === c.id ? " lu-row-open" : ""}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
                          <td>
                            <button type="button" className="lu-expand" aria-expanded={open === c.id}
                              aria-label={`Details for the call started ${c.started_at ?? ""}`}
                              onClick={(e) => { e.stopPropagation(); setOpen(open === c.id ? null : c.id); }}>
                              {c.started_at ? new Date(c.started_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                            </button>
                          </td>
                          <td>{c.agent_name ?? "(deleted agent)"}</td>
                          <td><span className={`lu-kind lu-kind-${c.kind}`}>{kindLabel(c.kind)}</span></td>
                          <td className="lu-num">{formatSeconds(c.call_seconds)}</td>
                          <td>
                            <span className={`l-status-badge ${statusBadgeClass(c.status)}`}>{statusLabel(c.status)}</span>
                          </td>
                        </tr>
                        {open === c.id ? (
                          <tr className="lu-detail-row">
                            <td colSpan={5}><CallDetail call={c} /></td>
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
                  {loadingMore ? "Loading…" : `Show more (${formatCount(total - items.length)} left)`}
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

// The flags a call's owner is told about; anything else on a call (an administrator's own notes) is not shown here.
const FLAG_LABELS: Record<string, string> = { failed: "Failed", lost: "Lost" };

function CallDetail({ call }: { call: UsageItem }) {
  const [transcript, setTranscript] = useState(false);
  const flags = call.flags.filter((f) => f in FLAG_LABELS);
  return (
    <div className="lu-detail">
      <dl className="lu-facts">
        <div><dt>How it ended</dt><dd>{call.status === "active" ? "Still running" : endReasonLabel(call.end_reason)}</dd></div>
        <div><dt>Call length</dt><dd>{formatSeconds(call.duration_seconds)}</dd></div>
        <div><dt>Voice</dt><dd>{call.voice ?? "—"}</dd></div>
        {call.origin ? <div><dt>Page</dt><dd>{call.origin}</dd></div> : null}
        <div><dt>Tool calls</dt><dd>{formatCount(call.tool_calls)}</dd></div>
        <div>
          <dt>Transcript</dt>
          <dd>
            <button type="button" className="l-btn l-btn-ghost lu-transcript-btn" onClick={() => setTranscript(true)}>
              View transcript
            </button>
          </dd>
        </div>
      </dl>
      {flags.length > 0 ? (
        <div className="lu-flags">{flags.map((f) => <span key={f} className="lu-flag">{FLAG_LABELS[f]}</span>)}</div>
      ) : null}
      {transcript ? <TranscriptDialog call={call} onClose={() => setTranscript(false)} /> : null}
    </div>
  );
}
