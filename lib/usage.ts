// Shapes returned by the backend's /usage endpoints (api/usage.py), and how the dashboard shows them.

export type UsageKind = "embed" | "test" | "cascade_test";
export type UsageStatus = "active" | "completed" | "failed" | "lost";

export type UsageItem = {
  id: string;
  room: string;
  kind: UsageKind;
  agent_id: string | null;
  agent_name: string | null;
  origin: string | null;
  renderer: string;
  pipeline: string;
  model: string | null;
  voice: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: UsageStatus;
  end_reason: string | null;
  error: string | null;
  flags: string[];
  source: string;
  /** Anam's billed seconds when reconciled, otherwise what we measured. */
  seconds: number | null;
  renderer_seconds: number | null;
  anam_seconds_billed: number | null;
  duration_seconds: number | null;
  input_tokens: number;
  input_audio_tokens: number;
  output_tokens: number;
  output_audio_tokens: number;
  thought_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  generations: number;
  tool_calls: number;
  stt_audio_seconds: number;
  client_id?: string;
  client_email?: string | null;
  client_company?: string | null;
};

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
};

export type UsageTotals = {
  calls: number;
  completed: number;
  failed: number;
  lost: number;
  active: number;
  anam_seconds: number;
  other_renderer_seconds: number;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  total_tokens: number;
  tool_calls: number;
};

export type UsageGroup = UsageTotals & { key: string | null; label: string };
export type UsageSummary = {
  is_admin: boolean;
  scope: "mine" | "all";
  group_by: GroupBy;
  totals: UsageTotals;
  groups: UsageGroup[];
};
export type UsageCalls = { total: number; limit: number; offset: number; is_admin: boolean; items: UsageItem[] };

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
    anam_mismatch: "Anam seconds differ",
    anam_still_running: "Anam still running",
    anam_unknown: "Anam has no record",
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

/** Anam minutes with one decimal, the unit their plans are quoted in. */
export function formatMinutes(s: number): string {
  return `${(s / 60).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} min`;
}

export function formatTokens(n: number | null | undefined): string {
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

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** from/to (inclusive days) for "the last N days". */
export function rangeLastDays(days: number, now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(now) };
}
