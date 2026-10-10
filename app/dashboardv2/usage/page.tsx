"use client";

/**
 * How long each session ran, for widget (embedded) sessions and for the dashboard's test button: the totals, the breakdown as a
 * graph (by day, agent or type, in sessions or minutes) and the sessions themselves, a page at a time, with a CSV. A customer is
 * billed in minutes (a plan's minutes will come later), so this page speaks minutes and nothing else: no prices, no token
 * counts, no provider names. Every client's usage, tokens and cost live in the separate admin dashboard (avatar-studio-admin),
 * not here, whoever is signed in.
 *
 * The time range at the top applies to everything; the Type, Status and Agent filters sit on the sessions table and apply to
 * it (and its CSV) only. Ditto / FlashHead / Wav2Lip sessions are listed with their length like the others.
 */

import { useEffect, useRef, useState } from "react";
import "./usage.css";
import RangePicker, { Chevron } from "./RangePicker";
import SessionsTable from "./SessionsTable";
import UsageChart, { type Metric, type View } from "./UsageChart";
import {
  KIND_FILTERS,
  buildBuckets,
  buildCategories,
  bucketUnit,
  daysBetween,
  formatClock,
  formatCount,
  formatDayRange,
  groupByFor,
  localDay,
  minutesValue,
  periodRange,
  tzOffsetMinutes,
  usageQuery,
  utcLabel,
  type PeriodId,
  type UsageCalls,
  type UsageItem,
  type UsageSummary,
} from "@/lib/usage";

const STATUSES = [
  { label: "Any status", value: "" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Lost", value: "lost" },
  { label: "Running", value: "active" },
];
const TYPES = KIND_FILTERS.map((k) => ({ ...k, label: k.value ? k.label : "All types" }));

type AgentOption = { id: string; name: string };

export default function UsagePage() {
  // A dropdown choice or a range picked by hand.
  const [period, setPeriod] = useState<PeriodId | "custom">("30d");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [metric, setMetric] = useState<Metric>("calls");
  const [view, setView] = useState<View>("time");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [agentId, setAgentId] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [calls, setCalls] = useState<{ items: UsageItem[]; total: number } | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A slower answer to an older choice must not overwrite a newer one.
  const summarySeq = useRef(0);
  const callsSeq = useRef(0);

  const today = localDay(new Date());
  const { from, to } = period === "custom" ? { from: custom.from || today, to: custom.to || today } : periodRange(period);
  // Days are the viewer's own: the backend reads from/to and the Day / Hour grouping in this offset.
  const tz = tzOffsetMinutes();
  const unit = bucketUnit(from, to);
  const groupBy = view === "time" ? groupByFor(unit) : view;
  const range = { from, to, tz };
  const tableFilters = { ...range, kind, status, agent_id: agentId };
  const summaryKey = JSON.stringify({ ...range, group_by: groupBy });
  const callsKey = JSON.stringify({ ...tableFilters, limit: pageSize, offset: page * pageSize });

  useEffect(() => {
    const mine = ++summarySeq.current;
    setSummaryBusy(true);
    void (async () => {
      try {
        const res = await fetch(`/api/usage/summary${usageQuery(JSON.parse(summaryKey))}`);
        const body = await res.json().catch(() => ({}));
        if (mine !== summarySeq.current) return;
        if (!res.ok) setError(typeof body.detail === "string" ? body.detail : "Could not load usage.");
        else { setSummary(body as UsageSummary); setError(null); }
      } catch {
        if (mine === summarySeq.current) setError("Could not load usage.");
      }
      if (mine === summarySeq.current) setSummaryBusy(false);
    })();
  }, [summaryKey]);

  useEffect(() => {
    const mine = ++callsSeq.current;
    void (async () => {
      try {
        const res = await fetch(`/api/usage/calls${usageQuery(JSON.parse(callsKey))}`);
        const body = await res.json().catch(() => ({}));
        if (mine !== callsSeq.current) return;
        if (!res.ok) setError(typeof body.detail === "string" ? body.detail : "Could not load usage.");
        else setCalls({ items: (body as UsageCalls).items, total: (body as UsageCalls).total });
      } catch {
        if (mine === callsSeq.current) setError("Could not load usage.");
      }
    })();
  }, [callsKey]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/agents?summary=true");
      if (res.ok) {
        const list: { id: string; name: string }[] = await res.json();
        setAgents(list.map((a) => ({ id: a.id, name: a.name })));
      }
    })();
  }, []);

  // Any change of what the table shows starts it again at its first page.
  function choosePreset(id: PeriodId) { setPeriod(id); setPage(0); }
  function chooseCustom(f: string, t: string) { setCustom({ from: f, to: t }); setPeriod("custom"); setPage(0); }
  function filter(set: (v: string) => void) { return (v: string) => { set(v); setPage(0); }; }

  const loaded = summary !== null && calls !== null;
  const totals = summary?.totals;
  const days = daysBetween(from, to) + 1;
  const failed = totals ? totals.failed + totals.lost : 0;

  return (
    <div className="l-dash-shell lu-shell">
      <div className="lu-head">
        <div className="l-dash-header">
          <span className="l-kicker">Dashboard</span>
          <h1>Usage</h1>
          <p>How long each session ran, for embedded widgets and the test button.</p>
        </div>
        {loaded ? (
          <RangePicker period={period} from={from} to={to} today={today} onPreset={choosePreset} onCustom={chooseCustom} />
        ) : null}
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

          <section className="lu-overview" aria-label="Totals and breakdown">
            <div className="lu-tiles">
              <button type="button" className={`lu-tile lu-tile-tab${metric === "calls" ? " lu-tile-on" : ""}`}
                aria-pressed={metric === "calls"} onClick={() => setMetric("calls")}>
                <span className="lu-tile-label">Sessions</span>
                <span className="lu-tile-value">{formatCount(totals?.calls)}</span>
                <span className="lu-tile-sub">
                  {days > 1 ? `${perDay(totals?.calls ?? 0, days)} a day on average` : `${formatCount(totals?.completed)} completed`}
                  {failed > 0 ? <span className="lu-warn"> · {formatCount(failed)} failed</span> : null}
                </span>
              </button>
              <button type="button" className={`lu-tile lu-tile-tab${metric === "minutes" ? " lu-tile-on" : ""}`}
                aria-pressed={metric === "minutes"} onClick={() => setMetric("minutes")}>
                <span className="lu-tile-label">Minutes</span>
                <span className="lu-tile-value">{minutesValue(totals?.call_seconds)}</span>
                <span className="lu-tile-sub">
                  {totals && totals.calls > 0 ? `${formatClock(totals.call_seconds / totals.calls)} average length` : "No sessions yet"}
                </span>
              </button>
              <div className="lu-tile">
                <span className="lu-tile-label">Tool calls</span>
                <span className="lu-tile-value">{formatCount(totals?.tool_calls)}</span>
                <span className="lu-tile-sub">
                  {totals && totals.calls > 0 ? `${perDay(totals.tool_calls, totals.calls)} per session on average` : " "}
                </span>
              </div>
            </div>
            <UsageChart metric={metric} view={view} onView={setView} unit={unit} tzLabel={utcLabel(tz)} busy={summaryBusy}
              buckets={view === "time" && summary ? buildBuckets(summary.groups, unit, from, to) : []}
              categories={view !== "time" && summary ? buildCategories(summary.groups, view, metric) : []} />
          </section>

          <section className="lu-card lu-sessions" aria-label="Sessions">
            <div className="lu-toolbar">
              <div className="lu-toolbar-title">
                <h2>Sessions</h2>
                <span className="lu-count">{formatCount(calls.total)} in this period</span>
              </div>
              <div className="lu-toolbar-tools">
                <Select label="Type" value={kind} options={TYPES} onChange={filter(setKind)} />
                <Select label="Status" value={status} options={STATUSES} onChange={filter(setStatus)} />
                <Select label="Agent" value={agentId} onChange={filter(setAgentId)}
                  options={[{ label: "All agents", value: "" }, ...agents.map((a) => ({ label: a.name, value: a.id }))]} />
                <a className="l-btn l-btn-ghost lu-export" href={`/api/usage/export${usageQuery(tableFilters)}`}>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M7 1.5v7.5M3.8 6 7 9.2 10.2 6M2 12h10" fill="none" stroke="currentColor" strokeWidth="1.4"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Export
                </a>
              </div>
            </div>
            {calls.items.length === 0 ? (
              <div className="l-empty-state lu-empty">
                <h2>No sessions in this period</h2>
                <p>Sessions appear here after a visitor talks to a widget or you press Test on an agent.</p>
              </div>
            ) : (
              <SessionsTable items={calls.items} total={calls.total} page={page} pageSize={pageSize}
                onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0); }} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** 36 · 2.4: a per-day (or per-session) average, one decimal while it is small. */
function perDay(n: number, over: number): string {
  const v = over > 0 ? n / over : 0;
  return v < 10 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : Math.round(v).toLocaleString("en-US");
}

function Select({ label, value, options, onChange }: {
  label: string; value: string; options: { label: string; value: string }[]; onChange: (v: string) => void;
}) {
  return (
    <label className="lu-select">
      <span className="lu-sr">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Chevron />
    </label>
  );
}
