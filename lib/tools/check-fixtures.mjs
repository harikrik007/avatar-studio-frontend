// Runs the shared tool-rule cases (realtime-avatar-studio/studio_tools/
// tools_fixtures.json) against lib/tools/model.ts, so the frontend's
// validation says exactly what the backend's does.
//   node lib/tools/check-fixtures.mjs   (Node 23.6+: type stripping)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileRows, rowsFromWebhook, validateTool } from "./model.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  fs.readFileSync(path.resolve(here, "../../../realtime-avatar-studio/studio_tools/tools_fixtures.json"), "utf8")
);
let pass = 0;
let fail = 0;
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

for (const c of fixtures.validate) {
  const got = validateTool(c.tool);
  if (same(got, c.errors)) pass++;
  else {
    fail++;
    console.log(`FAIL validate "${c.name}"\n  want ${JSON.stringify(c.errors)}\n  got  ${JSON.stringify(got)}`);
  }
}

// rows round trip: every webhook in the fixtures decompiles into rows and
// compiles back to the same schema and param_in
const hooks = [...fixtures.validate.map((c) => c.tool), ...fixtures.upgrade.map((c) => c.expected)].filter(
  (t) => t.type === "server" && t.subtype === "webhook" && Object.keys(t.parameters.properties).every((n) => /^[a-zA-Z_]/.test(n))
);
for (const t of hooks) {
  const { query, body } = rowsFromWebhook(t);
  const { parameters, param_in } = compileRows(query, body, t.method, t.parameters);
  const norm = (p) => JSON.stringify({ ...p, required: [...(p.required ?? [])].sort() });
  if (norm(parameters) === norm(t.parameters) && JSON.stringify(param_in) === JSON.stringify(t.param_in)) pass++;
  else {
    fail++;
    console.log(`FAIL rows round trip "${t.name}"\n  want ${norm(t.parameters)} ${JSON.stringify(t.param_in)}\n  got  ${norm(parameters)} ${JSON.stringify(param_in)}`);
  }
}
console.log(`fixtures: PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
