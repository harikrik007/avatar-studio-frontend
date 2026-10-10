// Shapes returned by the backend's /usage endpoints (api/usage.py) as a customer gets them, and how the dashboard shows them.
// A customer sees how long their calls ran and how they ended: no tokens, no provider names, no prices (they are billed in minutes).
// Everything else (tokens, cost, every client's calls) is the separate admin dashboard's, not this app's.

export type UsageKind = "embed" | "test" | "cascade_test";
export type UsageStatus = "active" | "completed" | "failed" | "lost";

export type UsageItem = {
  id: string;
  kind: UsageKind;
  agent_id: string | null;
  agent_name: string | null;
  origin: string | null;
  voice: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: UsageStatus;
  end_reason: string | null;
  flags: string[];
  source: string;
  /** How long the call ran, in seconds (the provider's billed seconds once reconciled, otherwise what we measured). */
  call_seconds: number | null;
  duration_seconds: number | null;
  tool_calls: number;
};

export type UsageTotals = {
  calls: number;
  completed: number;
  failed: number;
  lost: number;
  active: number;
  call_seconds: number;
  tool_calls: number;
};

export type UsageGroup = UsageTotals & { key: string | null; label: string };
export type UsageSummary = { group_by: GroupBy; totals: UsageTotals; groups: UsageGroup[] };
export type UsageCalls = { total: number; limit: number; offset: number; items: UsageItem[] };

export type GroupBy = "day" | "hour" | "agent" | "kind";

export const KIND_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Embedded", value: "embed" },
  // The dashboard's test button, on either pipeline.
  { label: "Test", value: "test,cascade_test" },
];

export function kindLabel(kind: string): string {
  if (kind === "embed") return "Embedded";
  if (kind === "cascade_test") return "Cascade test";
  return "Test";
}

export function statusLabel(status: string): string {
  if (status === "active") return "Running";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** The badge class from landing.css that fits a call status. */
export function statusBadgeClass(status: string): string {
  if (status === "completed") return "l-status-ready";
  if (status === "failed") return "l-status-failed";
  return "l-status-processing"; // active, lost
}

export function endReasonLabel(reason: string | null): string {
  if (!reason) return "—";
  const map: Record<string, string> = {
    visitor_closed: "Visitor closed the widget",
    user_stopped: "Stopped from the dashboard",
    empty_room: "Visitor left",
    idle_timeout: "Idle timeout",
    hard_timeout: "Time limit",
    agent_ended: "Agent ended the call",
    agent_crashed: "Agent crashed",
    agent_exited: "Agent stopped",
    backend_shutdown: "Server restarted",
    room_disconnected: "Connection lost",
    lost: "Lost (server restarted)",
  };
  return map[reason] ?? reason.replace(/_/g, " ");
}

/** One turn of a call's conversation (GET /api/usage/calls/:id/transcript): the visitor's words or the agent's. */
export type TranscriptLine = { n: number; at: string | null; role: "visitor" | "agent"; text: string; offset_seconds: number | null };
export type CallTranscript = { call_id: string; agent_name: string | null; started_at: string | null; lines: TranscriptLine[] };

/** 0:07 · 2:41 · 1:02:05: how far into the session a turn began. */
export function formatOffset(s: number | null | undefined): string {
  if (s === null || s === undefined) return "";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** 1:05 · 12:40 · 1:02:05: a session's length, as the Sessions table shows it; "—" when it has no measurement. */
export function formatClock(s: number | null | undefined): string {
  return s === null || s === undefined ? "—" : formatOffset(s);
}

/** 42 s · 3 m 12 s · 1 h 05 m. Null when the session has no measurement. */
export function formatSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const total = Math.round(s);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${m} m ${String(total % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

/** Minutes with one decimal: the unit customers are billed in. */
export function formatMinutes(s: number | null | undefined): string {
  return `${minutesValue(s)} min`;
}

/** The same number without the unit, where the column or tile is already called Minutes: 1,215.4. */
export function minutesValue(s: number | null | undefined): string {
  return ((s ?? 0) / 60).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** A whole number with thousands separators (calls, tool calls). */
export function formatCount(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US");
}

/** Query string for the usage endpoints; empty values are left out. */
export function usageQuery(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// Days are the viewer's own, not UTC: the backend takes the browser's offset (`tz`) and reads from/to and the Day
// grouping in it, so a call at 2:16 AM in India on the 4th is on the 4th, not on the 3rd.

/** YYYY-MM-DD of a date in the browser's timezone. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** from/to (inclusive days) for "the last N days"; 1 = today. */
export function rangeLastDays(days: number, now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { from: localDay(from), to: localDay(now) };
}

/** The browser's offset from UTC in minutes, east positive (India = 330): what the backend's `tz` takes. */
export function tzOffsetMinutes(now: Date = new Date()): number {
  return -now.getTimezoneOffset() || 0;
}

/** UTC+5:30, UTC-7, UTC. */
export function utcLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "UTC";
  const a = Math.abs(offsetMinutes);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `UTC${offsetMinutes < 0 ? "-" : "+"}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The time choices of the Usage page's dropdown (Custom range is the page's own). Days are calendar days in the viewer's
 * timezone, so "Today" stands where a dashboard counting rolling hours would say "Last 24 hours". */
export const PERIODS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "6m", label: "Last 6 months" },
  { id: "1y", label: "Last year" },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];

/** from/to (inclusive days) of a dropdown choice. */
export function periodRange(id: PeriodId, now: Date = new Date()): { from: string; to: string } {
  const days: Partial<Record<PeriodId, number>> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };
  const n = days[id];
  if (n) return rangeLastDays(n, now);
  const from = new Date(now);
  if (id === "6m") from.setMonth(from.getMonth() - 6);
  else from.setFullYear(from.getFullYear() - 1);
  from.setDate(from.getDate() + 1);
  return { from: localDay(from), to: localDay(now) };
}

/** Today, 2:27 PM · Yesterday, 9:02 AM · Oct 4, 6:10 PM · Oct 4, 2025, 6:10 PM. */
export function formatStarted(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (localDay(d) === localDay(now)) return `Today, ${time}`;
  if (localDay(d) === localDay(yesterday)) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { dateStyle: "medium" });
  return `${date}, ${time}`;
}

/** example.com/pricing for https://example.com/pricing: the page an embedded session ran on, short. */
export function shortOrigin(origin: string | null): string {
  if (!origin) return "";
  try {
    const u = new URL(origin);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return origin;
  }
}

// ---- the graph's bars (UsageChart.tsx) ------------------------------------------------------------------------
// The backend sends the days (or, for one day, the hours) that had sessions; the graph wants every slot of the range,
// empty ones too, and for long ranges weeks or months. All of it is worked out here from those same numbers.

export type BucketUnit = "hour" | "day" | "week" | "month";
export type Bucket = {
  key: string;
  /** under the bar: 2 PM · Sep 10 · Sep 8 · Oct */
  tick: string;
  /** the tooltip's heading: 2 PM – 3 PM · Thu, Sep 10 · Sep 8 – 14 · October 2026 */
  title: string;
  calls: number;
  call_seconds: number;
  failed: number;
  /** the slot holding "now": still filling up */
  partial: boolean;
  /** an hour of today still to come */
  future: boolean;
};

export function daysBetween(from: string, to: string): number {
  return Math.round((dayDate(to).getTime() - dayDate(from).getTime()) / 86400000);
}

/** Hours for one day, days up to about three months, weeks up to about six, months beyond. */
export function bucketUnit(from: string, to: string): BucketUnit {
  if (from === to) return "hour";
  const days = daysBetween(from, to) + 1;
  if (days <= 92) return "day";
  if (days <= 200) return "week";
  return "month";
}

/** The summary's group_by for a graph of that unit: weeks and months are added up from days in the browser. */
export function groupByFor(unit: BucketUnit): GroupBy {
  return unit === "hour" ? "hour" : "day";
}

export function buildBuckets(groups: UsageGroup[], unit: BucketUnit, from: string, to: string, now: Date = new Date()): Bucket[] {
  const sums = new Map<string, { calls: number; call_seconds: number; failed: number }>();
  for (const g of groups) {
    if (g.key) sums.set(g.key, { calls: g.calls, call_seconds: g.call_seconds, failed: g.failed + g.lost });
  }
  const today = localDay(now);
  const md = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (unit === "hour") {
    const hourOf = (h: number) => {
      const d = dayDate(from);
      d.setHours(h);
      return d.toLocaleTimeString(undefined, { hour: "numeric" });
    };
    return Array.from({ length: 24 }, (_, h) => {
      const key = `${from} ${String(h).padStart(2, "0")}`;
      const v = sums.get(key);
      return {
        key, tick: hourOf(h), title: `${hourOf(h)} – ${hourOf((h + 1) % 24)}`,
        calls: v?.calls ?? 0, call_seconds: v?.call_seconds ?? 0, failed: v?.failed ?? 0,
        partial: from === today && h === now.getHours(), future: from === today && h > now.getHours(),
      };
    });
  }
  const out: Bucket[] = [];
  const end = dayDate(to);
  let current: Bucket | null = null;
  let firstDay = "";
  let lastDay = "";
  const close = () => {
    if (!current) return;
    if (unit === "week") {
      const a = dayDate(firstDay);
      const b = dayDate(lastDay);
      current.title = firstDay === lastDay ? md(a)
        : a.getMonth() === b.getMonth() ? `${md(a)} – ${b.getDate()}` : `${md(a)} – ${md(b)}`;
    }
    out.push(current);
  };
  for (let d = dayDate(from); d <= end; d.setDate(d.getDate() + 1)) {
    const day = localDay(d);
    let key = day;
    if (unit === "week") {
      const monday = new Date(d);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      key = localDay(monday);
    } else if (unit === "month") {
      key = day.slice(0, 7);
    }
    if (!current || current.key !== key) {
      close();
      firstDay = day;
      const tick = unit === "month"
        ? d.toLocaleDateString(undefined, d.getMonth() === 0 || out.length === 0 ? { month: "short", year: "numeric" } : { month: "short" })
        : md(d);
      const title = unit === "month" ? d.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      current = { key, tick, title, calls: 0, call_seconds: 0, failed: 0, partial: false, future: false };
    }
    lastDay = day;
    const v = sums.get(day);
    if (v) {
      current.calls += v.calls;
      current.call_seconds += v.call_seconds;
      current.failed += v.failed;
    }
    if (day === today) current.partial = true;
  }
  close();
  return out;
}

/** Agents or types as horizontal bars: biggest first by the shown measure, past ten folded into "Other (N agents)". */
export type CategoryRow = { key: string; label: string; calls: number; call_seconds: number; failed: number };

export function buildCategories(groups: UsageGroup[], by: "agent" | "kind", metric: "calls" | "minutes", max = 10): CategoryRow[] {
  const rows: CategoryRow[] = groups.map((g) => ({
    key: g.key ?? "none",
    label: by === "kind" && g.key ? kindLabel(g.key) : g.label,
    calls: g.calls, call_seconds: g.call_seconds, failed: g.failed + g.lost,
  }));
  const value = (r: CategoryRow) => (metric === "calls" ? r.calls : r.call_seconds);
  rows.sort((a, b) => value(b) - value(a) || a.label.localeCompare(b.label));
  if (rows.length <= max) return rows;
  const rest = rows.slice(max - 1);
  const other = rest.reduce((o, r) => ({ ...o, calls: o.calls + r.calls, call_seconds: o.call_seconds + r.call_seconds, failed: o.failed + r.failed }),
    { key: "other", label: `Other (${rest.length} ${by === "agent" ? "agents" : "types"})`, calls: 0, call_seconds: 0, failed: 0 });
  return [...rows.slice(0, max - 1), other];
}

/** A round top for the y axis and its step, four steps high: 0 · 45 · 90 · 135 · 180. Whole steps for counts. */
export function niceScale(max: number, whole: boolean): { top: number; step: number } {
  if (!(max > 0)) return { top: 4, step: 1 };
  if (whole && max <= 4) return { top: Math.ceil(max), step: 1 };      // 0 · 1 for a single session, not 0 to 4
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  let step = steps.map((m) => m * mag).find((c) => c >= raw) ?? 10 * mag;
  if (whole) step = Math.max(1, Math.ceil(step));
  return { top: step * 4, step };
}

/** "Oct 4, 2026" for one day, "Sep 5 – Oct 4, 2026" for a range. */
export function formatDayRange(from: string, to: string): string {
  const a = dayDate(from);
  const b = dayDate(to);
  const full = (d: Date) => d.toLocaleDateString(undefined, { dateStyle: "medium" });
  if (from === to) return full(a);
  const sameYear = a.getFullYear() === b.getFullYear();
  const start = a.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { dateStyle: "medium" });
  return `${start} – ${full(b)}`;
}
