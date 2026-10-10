// Connectors in the agent builder: the shapes the backend's /connectors endpoints return (api/connectors.py), and how a picked
// action becomes a connector tool (lib/tools/model.ts, kind "connector"). No runtime imports besides the tool model.

import { normalize, type ConnectorTool, type SchemaProp, type Tool, type ToolParameters } from "./tools/model";

/** The return tab tells the builder's tab on this channel that an app has been connected (app/dashboardv2/connectors/return). */
export const CONNECTORS_CHANNEL = "avatar-studio-connectors";

export type ConnectorApp = { slug: string; name: string; logo: string | null; description: string; connected: boolean };

/** read: only looks. write: creates or changes something. risky: deletes, clears or changes who has access (administrators only). */
export type ActionKind = "read" | "write" | "risky";

export type ConnectorAction = {
  action: string; // "GOOGLECALENDAR_FIND_FREE_SLOTS"
  name: string; // "Find free slots"
  description: string;
  kind: ActionKind;
  /** every parameter the action takes, in the tool schema's own shape */
  parameters: ToolParameters;
  /** what the app uses for a parameter nobody sets */
  defaults: Record<string, unknown>;
};

export const KIND_LABEL: Record<ActionKind, string> = { read: "Reads", write: "Changes things", risky: "Admin only" };

/** find_free_slots for GOOGLECALENDAR_FIND_FREE_SLOTS, made unique among the agent's tools (find_free_slots_2). */
export function toolNameFor(action: string, app: string, tools: Tool[], ownId?: string): string {
  const prefix = app.replace(/[^a-z0-9]/gi, "").toUpperCase() + "_";
  const base = (action.toUpperCase().startsWith(prefix) ? action.slice(prefix.length) : action).toLowerCase().slice(0, 56) || "action";
  const taken = new Set(tools.filter((t) => t.id !== ownId).map((t) => t.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** What the agent fills in to begin with: what the action requires, then what has no default of its own, eight at most.
 * (A real action can take 27 parameters; a voice agent should be asked for a handful.) */
export function defaultTicks(action: ConnectorAction): string[] {
  const names = Object.keys(action.parameters.properties ?? {});
  const required = (action.parameters.required ?? []).filter((n) => names.includes(n));
  const rest = names.filter((n) => !required.includes(n) && !(n in action.defaults));
  return [...required, ...rest].slice(0, Math.max(required.length, 8));
}

/** A fixed value as the owner types it -> the value sent. Text stays text; numbers, yes/no and lists are read as such.
 * { error } when it cannot be read as the parameter's type. Empty text = no fixed value. */
export function parseFixed(prop: SchemaProp, text: string): { value?: unknown; error?: string } {
  const raw = text.trim();
  if (raw === "") return {};
  if (prop.type === "number" || prop.type === "integer") {
    const n = Number(raw);
    if (!Number.isFinite(n) || (prop.type === "integer" && !Number.isInteger(n))) return { error: prop.type === "integer" ? "Enter a whole number." : "Enter a number." };
    return { value: n };
  }
  if (prop.type === "boolean") {
    if (!/^(true|false|yes|no)$/i.test(raw)) return { error: "Enter true or false." };
    return { value: /^(true|yes)$/i.test(raw) };
  }
  if (prop.type === "array") {
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return { value: parsed };
      } catch {
        /* falls through to the error */
      }
      return { error: "Enter a list: one, two (or JSON: [\"one\", \"two\"])." };
    }
    return { value: raw.split(",").map((s) => s.trim()).filter(Boolean) };
  }
  if (prop.type === "object") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { value: parsed };
    } catch {
      /* falls through to the error */
    }
    return { error: "Enter JSON: {\"key\": \"value\"}." };
  }
  return { value: text };
}

/** A stored fixed value back as text for its input. */
export function fixedText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string" && !v.includes(","))) return value.join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function showDefault(value: unknown): string {
  const text = fixedText(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** The connector tool for an action: `ticked` are the parameters the agent fills in, `fixed` the owner's set values. */
export function buildConnectorTool(
  base: Pick<ConnectorTool, "id" | "name" | "description" | "enabled" | "interruptible" | "app">,
  action: ConnectorAction,
  ticked: string[],
  fixed: Record<string, unknown>
): ConnectorTool {
  const all = action.parameters.properties ?? {};
  const properties = Object.fromEntries(Object.entries(all).filter(([name]) => ticked.includes(name)));
  const required = (action.parameters.required ?? []).filter((n) => n in properties);
  const parameters: ToolParameters = { type: "object", properties, ...(required.length ? { required } : {}) };
  return normalize({
    ...base,
    type: "server",
    subtype: "connector",
    action: action.action,
    parameters,
    fixed: Object.fromEntries(Object.entries(fixed).filter(([name]) => name in all && !(name in properties))),
  } as ConnectorTool);
}
