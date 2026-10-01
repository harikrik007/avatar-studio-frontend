/**
 * Agent tools (v2): shape, defaults, validation, and the Query/Body rows <->
 * JSON Schema compile step. Mirrors the backend's studio_tools/model.py --
 * same rules, same messages; both run the shared cases in
 * realtime-avatar-studio/studio_tools/tools_fixtures.json
 * (`node lib/tools/check-fixtures.mjs`), so the two copies cannot drift.
 *
 * One file with no runtime imports on purpose: the fixture check runs it
 * straight under Node's type stripping.
 */

export type ToolDataType = "string" | "number" | "boolean" | "array";
export type SchemaType = ToolDataType | "integer" | "object";
export type EnumValue = string | number | boolean;

export type SchemaProp = {
  type: SchemaType;
  description?: string;
  enum?: EnumValue[];
  items?: SchemaProp;
  properties?: Record<string, SchemaProp>;
  required?: string[];
};

export type ToolParameters = {
  type: "object";
  properties: Record<string, SchemaProp>;
  required?: string[];
  additionalProperties?: boolean;
};

export type HeaderEntry = { name: string; value: string; secret: boolean };
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ParamIn = "query" | "body";

type BaseTool = {
  id: string;
  name: string;
  description: string; // "Instructions" in the UI
  parameters: ToolParameters;
  strict?: boolean;
  enabled: boolean;
  interruptible: boolean;
  created_at?: string;
  updated_at?: string;
};

export type WebhookTool = BaseTool & {
  type: "server";
  subtype: "webhook";
  url: string;
  method: HttpMethod;
  headers: HeaderEntry[];
  param_in: Record<string, ParamIn>;
  awaitResponse: boolean;
  // Only on tools migrated from the old form that had one; replaces the
  // JSON body built from Body rows.
  body_template?: string | null;
};

export type ClientTool = BaseTool & {
  type: "client";
  awaitResult: boolean;
  timeout_s: number;
};

export type KnowledgeTool = BaseTool & { type: "server"; subtype: "knowledge"; document_ids: string[] };

export type SystemTool = { id: string; type: "system"; name: string; enabled: boolean };

export type Tool = WebhookTool | ClientTool | KnowledgeTool | SystemTool;
export type CustomTool = WebhookTool | ClientTool;
export type ToolKind = "webhook" | "client" | "knowledge" | "system";

export const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
export const DATA_TYPES: { id: ToolDataType; label: string }[] = [
  { id: "string", label: "String" },
  { id: "number", label: "Number" },
  { id: "boolean", label: "Boolean" },
  { id: "array", label: "Array" },
];
const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

// Built-in tools: toggled, never edited. Their names are reserved.
export const SYSTEM_TOOLS: Record<string, string> = {
  end_call: "Allows the user to end the call. The agent says a short goodbye, then hangs up.",
};

export const NAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;
export const PARAM_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const TOKEN_RE = /\{(\w+)\}/g;
export const CLIENT_TIMEOUT_DEFAULT_S = 10;
export const MASK_PREFIX = "••••";

export function toolKind(tool: Tool): ToolKind {
  if (tool.type === "system") return "system";
  if (tool.type === "client") return "client";
  return tool.subtype === "knowledge" ? "knowledge" : "webhook";
}

export function isCustom(tool: Tool): tool is CustomTool {
  const k = toolKind(tool);
  return k === "webhook" || k === "client";
}

export function isMasked(value: string): boolean {
  return value.startsWith(MASK_PREFIX);
}

export function defaultParamIn(method: string): ParamIn {
  return method.toUpperCase() === "GET" ? "query" : "body";
}

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptySchema(): ToolParameters {
  return { type: "object", properties: {} };
}

export function newWebhook(): WebhookTool {
  return {
    id: uuid(),
    type: "server",
    subtype: "webhook",
    name: "",
    description: "",
    parameters: emptySchema(),
    enabled: true,
    method: "POST",
    url: "",
    headers: [],
    param_in: {},
    awaitResponse: true,
    interruptible: true,
  };
}

export function newClientTool(): ClientTool {
  return {
    id: uuid(),
    type: "client",
    name: "",
    description: "",
    parameters: emptySchema(),
    enabled: true,
    awaitResult: false,
    timeout_s: CLIENT_TIMEOUT_DEFAULT_S,
    interruptible: false,
  };
}

/** Defaults and the await/interruptible coupling -- same as normalize() in model.py. */
export function normalize<T extends Tool>(tool: T): T {
  if (tool.type === "system") return tool;
  const t = { ...tool } as CustomTool;
  t.name = (t.name ?? "").trim();
  t.description = (t.description ?? "").trim();
  t.enabled = t.enabled ?? true;
  if (!t.parameters || typeof t.parameters !== "object") t.parameters = emptySchema();
  if (t.type === "server") {
    const w = t as WebhookTool;
    w.method = (w.method ?? "POST").toUpperCase() as HttpMethod;
    w.url = (w.url ?? "").trim();
    w.headers = (w.headers ?? []).map((h) => ({ name: h.name.trim(), value: h.value, secret: h.secret ?? true }));
    const props = Object.keys(w.parameters.properties ?? {});
    const given = w.param_in ?? {};
    w.param_in = Object.fromEntries(
      props.map((p) => [p, given[p] === "query" || given[p] === "body" ? given[p] : defaultParamIn(w.method)])
    );
    w.awaitResponse = w.awaitResponse ?? true;
    w.interruptible = (w.interruptible ?? true) && w.awaitResponse;
    if (!w.body_template) delete w.body_template;
  } else {
    const c = t as ClientTool;
    c.awaitResult = c.awaitResult ?? false;
    c.timeout_s = Number.isFinite(Number(c.timeout_s)) && c.timeout_s ? Math.trunc(Number(c.timeout_s)) : CLIENT_TIMEOUT_DEFAULT_S;
    c.interruptible = (c.interruptible ?? true) && c.awaitResult;
  }
  return t as T;
}

/* ------------------------------------------------------------------ */
/* validation -- messages match studio_tools/model.py exactly          */
/* ------------------------------------------------------------------ */

function typeOk(value: unknown, t: string): boolean {
  if (t === "string") return typeof value === "string";
  if (t === "integer") return typeof value === "number" && Number.isInteger(value);
  if (t === "number") return typeof value === "number";
  if (t === "boolean") return typeof value === "boolean";
  return true;
}

function validateSchema(schema: unknown, errors: string[], where = "") {
  const s = schema as ToolParameters | null;
  if (!s || typeof s !== "object" || s.type !== "object" || (s.properties != null && typeof s.properties !== "object")) {
    errors.push("Parameters must be a JSON object schema.");
    return;
  }
  const props = s.properties ?? {};
  for (const [name, prop] of Object.entries(props)) {
    const label = `${where}${name}`;
    if (!PARAM_NAME_RE.test(name)) {
      errors.push(`Parameter names must start with a letter (${label}).`);
      continue;
    }
    if (!prop || typeof prop !== "object") {
      errors.push(`Parameter ${label} must be an object.`);
      continue;
    }
    const ptype = prop.type ?? "string";
    if (!SCHEMA_TYPES.has(ptype)) {
      errors.push(`Parameter ${label} has an unknown type '${ptype}'.`);
      continue;
    }
    if (prop.enum != null && (!Array.isArray(prop.enum) || !prop.enum.every((v) => typeOk(v, ptype)))) {
      errors.push(`Allowed values must all be ${ptype} (${label}).`);
    }
    if (ptype === "object") {
      validateSchema({ type: "object", properties: prop.properties ?? {}, required: prop.required ?? [] }, errors, `${label}.`);
    }
    if (ptype === "array" && prop.items && typeof prop.items === "object") {
      const itype = prop.items.type ?? "string";
      if (!SCHEMA_TYPES.has(itype)) errors.push(`Parameter ${label} has an unknown item type '${itype}'.`);
    }
  }
  const required = s.required ?? [];
  if (!Array.isArray(required) || required.some((r) => !(r in props))) {
    errors.push("Every required parameter must be defined.");
  }
}

function tokens(text: string): string[] {
  return [...new Set([...(text ?? "").matchAll(TOKEN_RE)].map((m) => m[1]))].sort();
}

function parseUrl(url: string): { scheme: string; host: string } | null {
  try {
    const u = new URL(url);
    return u.hostname ? { scheme: u.protocol.replace(":", ""), host: u.hostname } : null;
  } catch {
    return null;
  }
}

/** Errors for one tool (already normalized). `storedUrl`: the URL it had when last saved --
 * an existing http:// URL keeps working until changed. */
export function validateTool(tool: Tool, opts: { storedUrl?: string | null } = {}): string[] {
  const errors: string[] = [];
  const k = toolKind(tool);
  if (k === "system") {
    if (!(tool.name in SYSTEM_TOOLS)) errors.push(`'${tool.name}' isn't a built-in tool.`);
    return errors;
  }
  if (k === "knowledge") return ["Knowledge tools aren't available yet."];
  const t = tool as CustomTool;
  if (!NAME_RE.test(t.name)) errors.push("Use letters, numbers, underscores, dots or hyphens.");
  else if (t.name in SYSTEM_TOOLS) errors.push("An agent tool with this name already exists.");
  if (!t.description || t.description.length > 1024) errors.push("Tell the model when to use this tool.");
  validateSchema(t.parameters, errors);
  const props = t.parameters?.properties ?? {};

  if (k === "webhook") {
    const w = t as WebhookTool;
    if (!METHODS.includes(w.method)) errors.push(`Method must be one of ${METHODS.join(", ")}.`);
    const parsed = parseUrl(w.url);
    if (!w.url || !parsed) errors.push("Enter an https:// endpoint.");
    else if (parsed.scheme !== "https" && !(parsed.scheme === "http" && w.url === opts.storedUrl)) {
      errors.push("Enter an https:// endpoint.");
    }
    const texts = [w.url, w.body_template ?? ""];
    for (const h of w.headers) {
      if (!h.name) errors.push("Every header needs a name.");
      else if (!HEADER_NAME_RE.test(h.name)) errors.push(`'${h.name}' isn't a valid header name.`);
      if (/[\r\n]/.test(h.value)) errors.push(`Header ${h.name} can't contain a line break.`);
      texts.push(h.value);
    }
    for (const text of texts) {
      for (const tok of tokens(text)) {
        if (!(tok in props)) errors.push(`{${tok}} isn't a parameter on this tool.`);
      }
    }
    if (Object.values(w.param_in ?? {}).some((v) => v !== "query" && v !== "body")) {
      errors.push("Each parameter is sent in the query or the body.");
    }
  } else {
    const c = t as ClientTool;
    if (!(c.timeout_s >= 1 && c.timeout_s <= 60)) errors.push("Timeout must be between 1 and 60 seconds.");
  }
  return [...new Set(errors)];
}

export function duplicateName(tools: Tool[], tool: Tool): boolean {
  return tools.some((t) => t.id !== tool.id && t.type !== "system" && t.name === tool.name);
}

/* ------------------------------------------------------------------ */
/* Query / Body rows <-> parameters + param_in                         */
/* ------------------------------------------------------------------ */

export type ParamRow = {
  key: string; // React key only
  dataType: ToolDataType;
  identifier: string;
  required: boolean;
  description: string;
  allowed: string[]; // enum values as typed; converted by dataType on compile
};

export function newParamRow(): ParamRow {
  return { key: uuid(), dataType: "string", identifier: "", required: false, description: "", allowed: [] };
}

function rowFromProp(name: string, prop: SchemaProp, required: boolean): ParamRow {
  const dataType: ToolDataType =
    prop.type === "integer" ? "number" : prop.type === "object" ? "string" : (prop.type as ToolDataType);
  return {
    key: uuid(),
    dataType,
    identifier: name,
    required,
    description: prop.description ?? "",
    allowed: (prop.enum ?? []).map((v) => String(v)),
  };
}

export function rowsFromWebhook(tool: WebhookTool): { query: ParamRow[]; body: ParamRow[] } {
  const props = tool.parameters?.properties ?? {};
  const required = new Set(tool.parameters?.required ?? []);
  const query: ParamRow[] = [];
  const body: ParamRow[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const where = tool.param_in?.[name] ?? defaultParamIn(tool.method);
    (where === "body" && tool.method !== "GET" ? body : query).push(rowFromProp(name, prop, required.has(name)));
  }
  return { query, body };
}

function enumValue(raw: string, dataType: ToolDataType): EnumValue {
  if (dataType === "number") return Number(raw);
  if (dataType === "boolean") return raw.trim().toLowerCase() === "true";
  return raw;
}

/** Rows -> one flat schema the model is given, plus where each property is sent.
 * Body rows on a GET are sent in the query (there is no body). An integer
 * property keeps its integer type if it was one. */
export function compileRows(
  query: ParamRow[],
  body: ParamRow[],
  method: string,
  previous?: ToolParameters
): { parameters: ToolParameters; param_in: Record<string, ParamIn> } {
  const properties: Record<string, SchemaProp> = {};
  const required: string[] = [];
  const param_in: Record<string, ParamIn> = {};
  const add = (row: ParamRow, where: ParamIn) => {
    const name = row.identifier.trim();
    if (!name) return;
    const wasInteger = previous?.properties?.[name]?.type === "integer" && row.dataType === "number";
    const prop: SchemaProp = { type: wasInteger ? "integer" : row.dataType };
    if (row.description.trim()) prop.description = row.description.trim();
    if (row.dataType === "array") prop.items = { type: "string" };
    if (row.allowed.length && row.dataType !== "array") prop.enum = row.allowed.map((v) => enumValue(v, row.dataType));
    properties[name] = prop;
    if (row.required) required.push(name);
    param_in[name] = method === "GET" ? "query" : where;
  };
  query.forEach((r) => add(r, "query"));
  body.forEach((r) => add(r, "body"));
  const parameters: ToolParameters = { type: "object", properties };
  if (required.length) parameters.required = required;
  return { parameters, param_in };
}

/** Rows whose identifier is used twice (the second would silently overwrite the first). */
export function duplicateIdentifiers(rows: ParamRow[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) {
    const id = r.identifier.trim();
    if (!id) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/** Sample arguments for "Test this tool": enum[0], else a type-appropriate dummy. */
export function sampleArgs(parameters: ToolParameters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(parameters.properties ?? {})) {
    if (prop.enum?.length) out[name] = prop.enum[0];
    else if (prop.type === "number" || prop.type === "integer") out[name] = 1;
    else if (prop.type === "boolean") out[name] = true;
    else if (prop.type === "array") out[name] = ["sample"];
    else out[name] = `sample ${name}`;
  }
  return out;
}

export function toolTypeChip(tool: Tool): string {
  const k = toolKind(tool);
  if (k === "webhook") return `SERVER · ${(tool as WebhookTool).method}`;
  if (k === "client") return "CLIENT";
  if (k === "knowledge") return "KNOWLEDGE";
  return "SYSTEM";
}

/* ------------------------------------------------------------------ */
/* client tools: example JSON -> schema                                 */
/* ------------------------------------------------------------------ */

export const WEATHER_EXAMPLE = `{
  "location": "San Francisco, CA",
  "unit": "celsius"
}`;

function inferProp(value: unknown): SchemaProp {
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (Array.isArray(value)) return { type: "array", items: value.length ? inferProp(value[0]) : { type: "string" } };
  if (value && typeof value === "object") {
    const props = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inferProp(v)]));
    return { type: "object", properties: props, required: Object.keys(props) };
  }
  return { type: "string" };
}

/** The spec's "Convert example to schema": the type of each value, every key
 * required, no descriptions invented. Throws on invalid JSON or a non-object. */
export function inferSchema(exampleJson: string): ToolParameters {
  const value = JSON.parse(exampleJson);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The example must be a JSON object, like {\"location\": \"Paris\"}.");
  }
  const prop = inferProp(value);
  return { type: "object", properties: prop.properties ?? {}, required: prop.required ?? [] };
}

/** Parse the SCHEMA textarea. Returns the schema or a readable error. */
export function parseSchemaText(text: string): { schema?: ToolParameters; error?: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { error: `Schema isn't valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const v = value as ToolParameters | null;
  if (!v || typeof v !== "object" || Array.isArray(v) || v.type !== "object") {
    return { error: "Parameters must be a JSON object schema." };
  }
  return { schema: { ...v, properties: v.properties ?? {} } };
}

export function schemaText(schema: ToolParameters): string {
  return JSON.stringify(schema, null, 2);
}

/** Rows for a webhook from any schema (client -> webhook switch keeps the parameters). */
export function rowsFromSchema(schema: ToolParameters, method: string): { query: ParamRow[]; body: ParamRow[] } {
  return rowsFromWebhook({ ...newWebhook(), method: method as HttpMethod, parameters: schema, param_in: {} });
}
