"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatCount,
  minutesValue,
  niceScale,
  type Bucket,
  type BucketUnit,
  type CategoryRow,
} from "@/lib/usage";

/**
 * The breakdown as a graph (the Usage page): Sessions or Minutes, by day (hours for one day, weeks or months for long ranges),
 * by agent or by type. One measure at a time, so one colour and no legend; the title names it. Every bar answers on hover,
 * tap or the arrow keys with the breakdown's numbers (Sessions · Minutes · Failed), and "Show as table" gives them as a table.
 * Drawn here as SVG and HTML: no chart library.
 */

export type Metric = "calls" | "minutes";
export type View = "time" | "agent" | "kind";

const VIEWS: { value: View; label: string }[] = [
  { value: "time", label: "Day" },
  { value: "agent", label: "Agent" },
  { value: "kind", label: "Type" },
];
const UNIT_WORD: Record<BucketUnit, string> = { hour: "hour", day: "day", week: "week", month: "month" };
const UNIT_COLUMN: Record<BucketUnit, string> = { hour: "Hour", day: "Day", week: "Week", month: "Month" };

const value = (m: Metric, r: { calls: number; call_seconds: number }) => (m === "calls" ? r.calls : r.call_seconds / 60);

function averageText(m: Metric, avg: number) {
  const n = avg < 10 ? avg.toLocaleString("en-US", { maximumFractionDigits: 1 }) : Math.round(avg).toLocaleString("en-US");
  return m === "calls" ? `Average ${n}` : `Average ${n} min`;
}

export default function UsageChart({
  metric, view, onView, unit, buckets, categories, tzLabel, busy,
}: {
  metric: Metric;
  view: View;
  onView: (v: View) => void;
  unit: BucketUnit;
  buckets: Bucket[];
  categories: CategoryRow[];
  tzLabel: string;
  busy: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  const word = metric === "calls" ? "Sessions" : "Minutes";
  const title = view === "time" ? `${word} per ${UNIT_WORD[unit]} · ${tzLabel}` : `${word} by ${view === "agent" ? "agent" : "type"}`;
  const shown = buckets.filter((b) => !b.future);
  const avg = shown.length ? shown.reduce((s, b) => s + value(metric, b), 0) / shown.length : 0;
  const empty = view === "time" ? shown.every((b) => b.calls === 0) : categories.length === 0;

  return (
    <div className="lu-chart-card" aria-busy={busy}>
      <div className="lu-chart-head">
        <h2 className="lu-chart-title">{title}</h2>
        <div className="lu-chart-tools">
          <div className="lu-seg" role="group" aria-label="Breakdown by">
            {VIEWS.map((v) => (
              <button key={v.value} type="button" aria-pressed={view === v.value}
                className={`lu-seg-btn${view === v.value ? " lu-seg-on" : ""}`} onClick={() => onView(v.value)}>
                {v.label}
              </button>
            ))}
          </div>
          {view === "time" && !empty && !asTable ? (
            <span className="lu-avg-key"><span className="lu-avg-swatch" aria-hidden="true" />{averageText(metric, avg)}</span>
          ) : null}
        </div>
      </div>

      {asTable ? (
        <BreakdownTable view={view} unit={unit} buckets={buckets} categories={categories} />
      ) : empty ? (
        <div className="lu-chart-empty">No sessions in this period</div>
      ) : view === "time" ? (
        <TimeBars metric={metric} buckets={buckets} avg={avg} label={title} />
      ) : (
        <CategoryBars metric={metric} rows={categories} label={title} />
      )}

      <div className="lu-chart-foot">
        <button type="button" className="lu-link-btn" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
          {asTable ? "Show as graph" : "Show as table"}
        </button>
      </div>
    </div>
  );
}

function Tip({ heading, row, style }: { heading: string; row: { calls: number; call_seconds: number; failed: number }; style: React.CSSProperties }) {
  return (
    <div className="lu-tip" role="status" style={style}>
      <div className="lu-tip-head">{heading}</div>
      <div className="lu-tip-row"><span>Sessions</span><strong>{formatCount(row.calls)}</strong></div>
      <div className="lu-tip-row"><span>Minutes</span><strong>{minutesValue(row.call_seconds)}</strong></div>
      <div className="lu-tip-row"><span>Failed</span><strong className={row.failed ? "lu-warn" : undefined}>{formatCount(row.failed)}</strong></div>
    </div>
  );
}

const H = 240;
const PAD = { left: 40, right: 8, top: 12, bottom: 28 };

function TimeBars({ metric, buckets, avg, label }: { metric: Metric; buckets: Bucket[]; avg: number; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = buckets.length;
  const W = Math.max(width, 280);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(1, Math.min(44, slot * 0.72, slot - 2));
  const max = Math.max(...buckets.map((b) => value(metric, b)), 0);
  const { top, step } = niceScale(max, metric === "calls");
  const y = (v: number) => PAD.top + plotH * (1 - v / top);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(56 / slot));
  const lastShown = buckets.reduce((last, b, i) => (b.future ? last : i), 0);

  function at(clientX: number) {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.floor((clientX - r.left - PAD.left) / slot);
    setActive(i >= 0 && i < n && !buckets[i].future ? i : null);
  }

  function onKey(e: React.KeyboardEvent) {
    const cur = active ?? lastShown;
    let next = cur;
    if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "ArrowRight") next = Math.min(lastShown, cur + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = lastShown;
    else return;
    e.preventDefault();
    setActive(next);
  }

  const b = active !== null ? buckets[active] : null;
  const cx = active !== null ? PAD.left + slot * (active + 0.5) : 0;
  const tipLeft = Math.min(Math.max(cx, 84), W - 84);
  const tipTop = b ? Math.max(y(value(metric, b)) - 10, 70) : 0;

  return (
    <div ref={wrap} className="lu-time" tabIndex={0} role="group"
      aria-label={`${label}. Use the left and right arrow keys to read each bar.`}
      onPointerMove={(e) => at(e.clientX)} onPointerDown={(e) => at(e.clientX)} onPointerLeave={() => setActive(null)}
      onFocus={() => setActive((a) => a ?? lastShown)} onBlur={() => setActive(null)} onKeyDown={onKey}>
      {width > 0 ? (
        <svg width={W} height={H} className="lu-svg" aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? "lu-axis" : "lu-grid"} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="lu-tick">
                {Number.isInteger(t) ? t.toLocaleString("en-US") : t.toLocaleString("en-US", { maximumFractionDigits: 1 })}
              </text>
            </g>
          ))}
          {active !== null ? (
            <rect x={PAD.left + slot * active} y={PAD.top} width={slot} height={plotH} className="lu-hover-band" />
          ) : null}
          {buckets.map((bk, i) => {
            const v = value(metric, bk);
            if (bk.future || v <= 0) return null;
            const h = Math.max(1, plotH * (v / top));
            const x = PAD.left + slot * i + (slot - barW) / 2;
            const r = Math.min(4, barW / 2, h);
            const y0 = PAD.top + plotH;
            const d = `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + barW - r} Q${x + barW},${y0 - h} ${x + barW},${y0 - h + r} V${y0} Z`;
            return <path key={bk.key} d={d} className={`lu-bar${bk.partial ? " lu-bar-partial" : ""}`} />;
          })}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(avg)} y2={y(avg)} className="lu-avg-line" />
          {buckets.map((bk, i) => {
            if ((n - 1 - i) % labelEvery !== 0) return null;
            // centred under its slot, moved in only as far as it takes to stay inside the graph (about 6 px a letter)
            const half = bk.tick.length * 3.2;
            const x = Math.min(Math.max(PAD.left + slot * (i + 0.5), half), W - half);
            return (
              <text key={bk.key} x={x} y={H - 8} textAnchor="middle" className={`lu-tick${bk.future ? " lu-tick-dim" : ""}`}>
                {bk.tick}
              </text>
            );
          })}
        </svg>
      ) : (
        <div style={{ height: H }} />
      )}
      {b ? (
        <Tip heading={`${b.title}${b.partial ? " (so far)" : ""}`} row={b}
          style={{ left: tipLeft, top: tipTop, transform: "translate(-50%, -100%)" }} />
      ) : null}
    </div>
  );
}

function CategoryBars({ metric, rows, label }: { metric: Metric; rows: CategoryRow[]; label: string }) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => value(metric, r)), 0) || 1;
  return (
    <ul className="lu-hbars" aria-label={label}>
      {rows.map((r) => {
        const v = value(metric, r);
        return (
          <li key={r.key} className={`lu-hbar${active === r.key ? " lu-hbar-on" : ""}`} tabIndex={0}
            onPointerEnter={() => setActive(r.key)} onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(r.key)} onBlur={() => setActive(null)}>
            <span className="lu-hbar-label" title={r.label}>{r.label}</span>
            <span className="lu-hbar-track">
              <span className="lu-hbar-fill" style={{ width: `${v > 0 ? Math.max(1, (v / max) * 100) : 0}%` }} />
            </span>
            <span className="lu-hbar-value">{metric === "calls" ? formatCount(r.calls) : minutesValue(r.call_seconds)}</span>
            {/* under the row: above it, the first row's would cover the Day / Agent / Type switch */}
            {active === r.key ? <Tip heading={r.label} row={r} style={{ right: 0, top: "calc(100% + 4px)" }} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function BreakdownTable({ view, unit, buckets, categories }: { view: View; unit: BucketUnit; buckets: Bucket[]; categories: CategoryRow[] }) {
  const rows: { key: string; label: string; calls: number; call_seconds: number; failed: number }[] = view === "time"
    ? buckets.filter((b) => b.calls > 0).reverse().map((b) => ({ ...b, label: b.title }))
    : categories;
  const head = view === "time" ? UNIT_COLUMN[unit] : view === "agent" ? "Agent" : "Type";
  if (rows.length === 0) return <div className="lu-chart-empty">No sessions in this period</div>;
  return (
    <div className="lu-table-wrap lu-breakdown-wrap">
      <table className="lu-table lu-breakdown">
        <thead>
          <tr>
            <th>{head}</th>
            <th className="lu-num">Sessions</th>
            <th className="lu-num">Minutes</th>
            <th className="lu-num">Failed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="lu-num">{formatCount(r.calls)}</td>
              <td className="lu-num">{minutesValue(r.call_seconds)}</td>
              <td className="lu-num">{r.failed > 0 ? formatCount(r.failed) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
