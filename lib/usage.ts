// Shapes returned by the backend's /usage endpoints (api/usage.py), and how the dashboard shows them.

export type UsageKind = "embed" | "test" | "cascade_test";
export type UsageStatus = "active" | "completed" | "failed" | "lost";

export type UsageItem = {
  id: string;
  kind: UsageKind;
  agent_id: string | null;
  agent_name: string | null;
  origin: string | null;
  pipeline: string;
  model: string | null;
  voice: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: UsageStatus;
  end_reason: string | null;
  flags: string[];
  source: string;
  /** How long the call ran, in seconds: what it is charged on (the provider's billed seconds once reconciled, otherwise what we measured). */
  call_seconds: number | null;
  /** What the client is charged for it. Everyone gets this. */
  charge: UsageCharge | null;
  duration_seconds: number | null;
  tool_calls: number;
  // Administrators only: the backend leaves all of these out of a client's response.
  room?: string;
  error?: string | null;
  renderer?: string;
  seconds?: number | null;
  renderer_seconds?: number | null;
  anam_seconds_billed?: number | null;
  input_tokens?: number;
  input_audio_tokens?: number;
  output_tokens?: number;
  output_audio_tokens?: number;
  thought_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
  generations?: number;
  stt_audio_seconds?: number;
  /** Administrators only: the backend leaves it out for everyone else. null = nothing to price (GPU renderer). */
  cost?: UsageCost | null;
  client_id?: string;
  client_email?: string | null;
  client_company?: string | null;
};

/** What a client is charged, USD: a flat rate on the call's seconds. `approx`: the seconds are approximate (a call from before usage logging). */
export type UsageCharge = { currency: string; usd: number; approx: boolean };
/** The client's rate, as the backend has it (US$0.20 a minute, billed by the second). */
export type UsageBilling = { currency: string; per_minute: number; per_second: number };

/** The estimate, USD. `partial`: some usage had no rate. `approx`: priced from approximate (pre-logging) seconds. */
export type UsageCost = { currency: string; llm: number; anam: number; total: number; partial: boolean; approx: boolean };
export type UsagePricing = { currency: string; as_of: string; anam_per_minute: number; basis: string };

export type UsageEventRow = {
  seq: number;
  at: string | null;
  component: string;
  model: string | null;
  input_text_tokens: number;
  input_audio_tokens: number;
  input_other_tokens: number;
  output_text_tokens: number;
  output_audio_tokens: number;
  output_other_tokens: number;
  thought_tokens: number;
  total_tokens: number;
  audio_seconds: number | null;
  /** Administrators only. null = the model has no rate. */
  est_cost?: number | null;
};

export type UsageTotals = {
  calls: number;
  completed: number;
  failed: number;
  lost: number;
  active: number;
  call_seconds: number;
  charge: UsageCharge;
  tool_calls: number;
  // Administrators only: the backend leaves all of these out of a client's response.
  anam_seconds?: number;
  other_renderer_seconds?: number;
  input_tokens?: number;
  output_tokens?: number;
  thought_tokens?: number;
  total_tokens?: number;
  backfill_calls?: number;
  cost?: UsageCost;
};

export type UsageGroup = UsageTotals & { key: string | null; label: string };
export type UsageSummary = {
  is_admin: boolean;
  scope: "mine" | "all";
  group_by: GroupBy;
  totals: UsageTotals;
  groups: UsageGroup[];
  billing: UsageBilling;
  pricing?: UsagePricing;
};
export type UsageCalls = {
  total: number;
  limit: number;
  offset: number;
  is_admin: boolean;
  billing: UsageBilling;
  items: UsageItem[];
};

export type GroupBy = "day" | "agent" | "kind" | "client";

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

export function flagLabel(flag: string): string {
  const map: Record<string, string> = {
    failed: "Failed",
    lost: "Lost",
    anam_mismatch: "Call seconds differ",
    anam_still_running: "Call still running",
    anam_unknown: "No record of the call",
  };
  return map[flag] ?? flag.replace(/_/g, " ");
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

/** Minutes with one decimal. */
export function formatMinutes(s: number | null | undefined): string {
  return `${((s ?? 0) / 60).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} min`;
}

export function formatTokens(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US");
}

/** US dollars. Calls cost fractions of a cent, so below a dollar four decimals: $0.0079; $35.02 above. */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.0001) return "<$0.0001";
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** What a client pays, in dollars: cents above a dollar ($88.60), up to four decimals below ($0.20, $0.0767, $0.0033). */
export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.0001) return "<$0.0001";
  if (n < 1) return `$${n.toFixed(4).replace(/0{1,2}$/, "")}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A call's or a group's charge for a table cell; "≈" when its seconds are approximate. */
export function formatCharge(charge: UsageCharge | null | undefined): string {
  if (!charge) return "—";
  return `${charge.approx ? "≈ " : ""}${formatMoney(charge.usd)}`;
}

/** "$0.20 a minute · $0.0033 a second" */
export function rateText(b: UsageBilling): string {
  return `${formatMoney(b.per_minute)} a minute · ${formatMoney(b.per_second)} a second`;
}

/** A call's or a group's estimate for a table cell; "≈" when it rests on approximate seconds. */
export function formatCost(cost: UsageCost | null | undefined): string {
  if (!cost) return "—";
  return `${cost.approx ? "≈ " : ""}${formatUsd(cost.total)}`;
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
