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

export type GroupBy = "day" | "agent" | "kind";

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

/** 0:07 · 2:41 · 1:02:05: how far into the call a turn began. */
export function formatOffset(s: number | null | undefined): string {
  if (s === null || s === undefined) return "";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** 42 s · 3 m 12 s · 1 h 05 m. Null when the call has no measurement. */
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
  return `${((s ?? 0) / 60).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} min`;
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
