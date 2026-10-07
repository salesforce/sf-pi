/* SPDX-License-Identifier: Apache-2.0 */
/** Grounded, bounded Mermaid projection of observed sf_data360 API calls in one turn. */
import type { Data360Namespace } from "./actions/action-types.ts";
import type { Data360ApiCallRailItem, Data360RunDigest, Data360RunStatus } from "./types.ts";

export interface Data360TraceRun {
  action: string;
  namespace: Data360Namespace;
  status: Data360RunStatus;
  resources?: number;
  rows?: number;
  apiCalls: Data360ApiCallRailItem[];
}

export interface Data360OrchestrationTrace {
  mermaid: string;
  calls: number;
  resources?: number;
  rows?: number;
  nodes: number;
  truncated: boolean;
}

export function data360TraceRunFromDetails(details: unknown): Data360TraceRun | undefined {
  const record = objectValue(details);
  const digest = objectValue(record.digest) as unknown as Partial<Data360RunDigest>;
  if (
    typeof digest.action !== "string" ||
    !isNamespace(digest.namespace) ||
    !isStatus(digest.status) ||
    !Array.isArray(digest.api_calls)
  ) {
    return undefined;
  }
  const apiCalls = digest.api_calls.filter(isApiCall);
  if (!apiCalls.length) return undefined;
  const outcome = Array.isArray(digest.sections)
    ? digest.sections.find((section) => section?.title === "Outcome")
    : undefined;
  const resources = outcome?.rows?.find((row) => row.label === "Resources")?.value;
  const rows = outcome?.rows?.find((row) => row.label === "Rows")?.value;
  const parsedResources = resources === undefined ? undefined : Number(resources);
  const parsedRows = rows === undefined ? undefined : Number(rows);
  return {
    action: digest.action,
    namespace: digest.namespace,
    status: digest.status,
    ...(Number.isFinite(parsedResources) ? { resources: parsedResources } : {}),
    ...(Number.isFinite(parsedRows) ? { rows: parsedRows } : {}),
    apiCalls,
  };
}

export function buildData360OrchestrationTrace(
  runs: Data360TraceRun[],
): Data360OrchestrationTrace | undefined {
  const calls = runs.flatMap((run) =>
    run.apiCalls.filter((call) => call.transport !== "LOCAL").map((call) => ({ run, call })),
  );
  if (calls.length < 2) return undefined;

  const resources = runs.reduce(
    (total, run) => total + (typeof run.resources === "number" ? run.resources : 0),
    0,
  );
  const rows = runs.reduce(
    (total, run) => total + (typeof run.rows === "number" ? run.rows : 0),
    0,
  );
  const truncated = calls.length > 6;
  const shown = truncated ? calls.slice(0, 5) : calls;
  const lines = ["flowchart TD", '    start(["Data 360 request"])'];
  const nodeIds: string[] = [];
  shown.forEach(({ run, call }, index) => {
    const id = `call${index + 1}`;
    nodeIds.push(id);
    const page = call.pagination ? ` · ${call.pagination.label}` : "";
    const state = call.outcome === "failed" ? " · FAILED" : "";
    const label = mermaidLabel(
      `${run.namespace.toUpperCase()} · ${actionLabel(run.action)} · ${call.method}${page}${state}`,
      112,
    );
    lines.push(`    ${id}["${label}"]`);
  });
  if (truncated) {
    const id = "more";
    nodeIds.push(id);
    lines.push(`    ${id}["${calls.length - shown.length} more API calls"]`);
  }
  const outcomeId = "outcome";
  const outcome = `${calls.length} API calls${resources > 0 ? ` · ${resources} resources` : ""}${rows > 0 ? ` · ${rows} rows` : ""}`;
  lines.push(`    ${outcomeId}(["${outcome}"])`);
  lines.push(`    start --> ${nodeIds[0]}`);
  for (let index = 0; index < nodeIds.length - 1; index++) {
    lines.push(`    ${nodeIds[index]} --> ${nodeIds[index + 1]}`);
  }
  lines.push(`    ${nodeIds.at(-1)} --> ${outcomeId}`);
  return {
    mermaid: lines.join("\n"),
    calls: calls.length,
    ...(resources > 0 ? { resources } : {}),
    ...(rows > 0 ? { rows } : {}),
    nodes: nodeIds.length + 2,
    truncated,
  };
}

export function data360TraceMarkdown(trace: Data360OrchestrationTrace): string {
  const note = trace.truncated
    ? `\n\n_Trace is bounded; ${trace.calls} observed API calls are summarized._`
    : "";
  return `### Data 360 Orchestration\n\n_Observed API call sequence grouped by Data 360 business module._\n\n\`\`\`mermaid\n${trace.mermaid}\n\`\`\`${note}`;
}

function actionLabel(action: string): string {
  return action
    .split(".")
    .slice(1)
    .flatMap((part) => part.split(/[_-]+/))
    .map((part) => ACRONYMS[part.toLowerCase()] ?? part)
    .join(" ");
}

const ACRONYMS: Record<string, string> = {
  ai: "AI",
  api: "API",
  ci: "CI",
  dlo: "DLO",
  dmo: "DMO",
  ir: "IR",
  ml: "ML",
  sql: "SQL",
  stdm: "STDM",
};

function mermaidLabel(value: string, maxLength: number): string {
  const clean = value
    .replace(/["“”]/g, "'")
    .replace(/[|\r\n]+/g, " ")
    .trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

function isApiCall(value: unknown): value is Data360ApiCallRailItem {
  const call = objectValue(value);
  return (
    ["CONNECT", "QUERY V3", "INGEST", "LOCAL"].includes(String(call.transport)) &&
    typeof call.method === "string" &&
    typeof call.url === "string"
  );
}

function isNamespace(value: unknown): value is Data360Namespace {
  return [
    "discover",
    "connect",
    "prepare",
    "harmonize",
    "segment",
    "activate",
    "query",
    "semantic",
    "observe",
    "orchestrate",
    "api",
  ].includes(String(value));
}

function isStatus(value: unknown): value is Data360RunStatus {
  return ["pass", "warning", "fail", "planned", "info"].includes(String(value));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
