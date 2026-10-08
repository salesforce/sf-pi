/* SPDX-License-Identifier: Apache-2.0 */
/** Grounded, bounded Mermaid projection of observed sf_data360 API calls in one turn. */
import type { Data360Namespace } from "./actions/action-types.ts";
import { getPublicData360Actions } from "./actions/action-registry.ts";
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
  layout: "sequence" | "fanout";
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

  const resources = sumRuns(runs, "resources");
  const rows = sumRuns(runs, "rows");
  const layout = isProvenSequence(runs, calls) ? "sequence" : "fanout";
  const projection =
    layout === "sequence" ? sequenceProjection(calls) : fanoutProjection(runs, calls);
  const outcome = `${calls.length} API calls${resources > 0 ? ` · ${resources} resources` : ""}${rows > 0 ? ` · ${rows} rows` : ""}`;
  if (layout === "sequence") {
    projection.lines.push(`    outcome(["${outcome}"])`);
    projection.lines.push(`    ${projection.nodeIds.at(-1)} --> outcome`);
  } else {
    projection.lines.push(`    D-->>D: ${outcome}`);
  }
  return {
    mermaid: projection.lines.join("\n"),
    calls: calls.length,
    ...(resources > 0 ? { resources } : {}),
    ...(rows > 0 ? { rows } : {}),
    nodes: projection.nodeIds.length + 2,
    truncated: projection.truncated,
    layout,
  };
}

interface TraceCall {
  run: Data360TraceRun;
  call: Data360ApiCallRailItem;
}

interface TraceProjection {
  lines: string[];
  nodeIds: string[];
  truncated: boolean;
}

function isProvenSequence(runs: Data360TraceRun[], calls: TraceCall[]): boolean {
  if (runs.length === 1) return true;
  return (
    new Set(runs.map((run) => run.action)).size === 1 &&
    calls.every(({ call }) => call.pagination?.kind === "offset")
  );
}

function sequenceProjection(calls: TraceCall[]): TraceProjection {
  const truncated = calls.length > 6;
  const shown = truncated ? calls.slice(0, 5) : calls;
  const lines = ["flowchart TD", '    start(["Resolved Data 360 work"])'];
  const nodeIds: string[] = [];
  shown.forEach(({ run, call }, index) => {
    const id = `call${index + 1}`;
    nodeIds.push(id);
    lines.push(`    ${id}["${callLabel(run, call)}"]`);
  });
  if (truncated) {
    const firstHidden = shown.length + 1;
    const id = "more";
    const last = calls.at(-1);
    nodeIds.push(id);
    if (last) {
      lines.push(
        `    ${id}["Pages ${firstHidden}–${calls.length} · ${endpointLabel(last.run, last.call)}"]`,
      );
    }
  }
  lines.push(`    start --> ${nodeIds[0]}`);
  for (let index = 0; index < nodeIds.length - 1; index++) {
    lines.push(`    ${nodeIds[index]} --> ${nodeIds[index + 1]}`);
  }
  return { lines, nodeIds, truncated };
}

function fanoutProjection(runs: Data360TraceRun[], calls: TraceCall[]): TraceProjection {
  const groups = new Map<Data360Namespace, Data360TraceRun[]>();
  for (const run of runs) {
    if (!run.apiCalls.some((call) => call.transport !== "LOCAL")) continue;
    groups.set(run.namespace, [...(groups.get(run.namespace) ?? []), run]);
  }
  const entries = [...groups.entries()];
  const shown = entries.slice(0, 2);
  const remaining = entries.slice(shown.length);
  const lines = ["sequenceDiagram", "    participant D as Data 360"];
  const nodeIds: string[] = ["D"];
  shown.forEach(([namespace], index) => {
    const id = `M${index + 1}`;
    nodeIds.push(id);
    lines.push(`    participant ${id} as ${namespace.toUpperCase()}`);
  });
  if (remaining.length) {
    nodeIds.push("O");
    lines.push("    participant O as Other");
  }
  shown.forEach(([namespace, moduleRuns], index) => {
    const moduleCalls = calls.filter(({ run }) => run.namespace === namespace);
    const firstCall = moduleCalls[0];
    const label =
      moduleCalls.length === 1 && firstCall
        ? independentCallMessage(firstCall.run, firstCall.call)
        : moduleSummaryLabel(moduleRuns, moduleCalls);
    lines.push(`    D->>M${index + 1}: ${label}`);
  });
  if (remaining.length) {
    const shownRemaining = remaining.slice(0, 4);
    for (const [namespace, moduleRuns] of shownRemaining) {
      const moduleCalls = calls.filter(({ run }) => run.namespace === namespace);
      const first = moduleCalls[0];
      if (!first) continue;
      const message =
        moduleCalls.length === 1
          ? `${namespace.toUpperCase()} · ${endpointLabel(first.run, first.call)} · ${runGroupOutcome(moduleRuns)}`
          : `${namespace.toUpperCase()} · ${moduleCalls.length} calls · ${endpointLabel(first.run, first.call)} · ${runGroupOutcome(moduleRuns)}`;
      lines.push(`    D->>O: ${mermaidLabel(message, 112)}`);
    }
    if (remaining.length > shownRemaining.length) {
      const hidden = remaining.slice(shownRemaining.length);
      const hiddenCalls = hidden.reduce(
        (total, [namespace]) =>
          total + calls.filter(({ run }) => run.namespace === namespace).length,
        0,
      );
      lines.push(
        `    D->>O: ${hidden.map(([namespace]) => namespace.toUpperCase()).join(", ")} · ${hiddenCalls} grouped calls`,
      );
    }
  }
  return { lines, nodeIds, truncated: remaining.length > 0 };
}

function callLabel(run: Data360TraceRun, call: Data360ApiCallRailItem): string {
  const page = call.pagination ? ` · ${call.pagination.label}` : "";
  const state = call.outcome === "failed" ? " · FAILED" : "";
  return mermaidLabel(
    `${run.namespace.toUpperCase()} · ${actionLabel(run.action)} · ${endpointLabel(run, call)}${page}${state}`,
    132,
  );
}

function independentCallMessage(run: Data360TraceRun, call: Data360ApiCallRailItem): string {
  return mermaidLabel(`${endpointLabel(run, call)} · ${runOutcome(run)}`, 96);
}

function moduleSummaryLabel(runs: Data360TraceRun[], calls: TraceCall[]): string {
  const endpoints = [...new Set(calls.map(({ run, call }) => endpointLabel(run, call)))];
  const resources = sumRuns(runs, "resources");
  const rows = sumRuns(runs, "rows");
  const result =
    resources > 0 ? `${resources} resources` : rows > 0 ? `${rows} rows` : "no results";
  return mermaidLabel(
    `${calls.length} calls · ${endpoints[0] ?? "Data 360 API"}${endpoints.length > 1 ? ` · +${endpoints.length - 1} endpoints` : ""} · ${result}`,
    132,
  );
}

function endpointLabel(run: Data360TraceRun, call: Data360ApiCallRailItem): string {
  const actions = getPublicData360Actions();
  const definition = actions.find(
    (action) =>
      action.action === run.action ||
      action.action === call.detail ||
      action.operationId === call.detail ||
      action.capability === call.detail,
  );
  if (definition?.endpoint?.path) return `${call.method} ${definition.endpoint.path}`;
  try {
    const url = new URL(call.url, "https://sf-pi.invalid");
    const path = url.pathname.replace(/^\/services\/data\/v\d+(?:\.\d+)?/, "");
    return `${call.method} ${path || "Data 360 endpoint"}`;
  } catch {
    return `${call.method} Data 360 endpoint`;
  }
}

function runOutcome(run: Data360TraceRun): string {
  if (run.resources !== undefined) {
    return run.resources === 0 ? "no resources" : `${run.resources} resources`;
  }
  if (run.rows !== undefined) return run.rows === 0 ? "no rows" : `${run.rows} rows`;
  return run.status === "fail" ? "failed" : "completed";
}

function runGroupOutcome(runs: Data360TraceRun[]): string {
  const resources = sumRuns(runs, "resources");
  if (resources > 0) return `${resources} resources`;
  const rows = sumRuns(runs, "rows");
  if (rows > 0) return `${rows} rows`;
  return "no results";
}

function sumRuns(runs: Data360TraceRun[], field: "resources" | "rows"): number {
  return runs.reduce((total, run) => total + (typeof run[field] === "number" ? run[field] : 0), 0);
}

export function data360TraceMarkdown(trace: Data360OrchestrationTrace): string {
  const note = trace.truncated
    ? `\n\n_Trace is bounded; ${trace.calls} observed API calls are summarized._`
    : "";
  return `### Data 360 Orchestration\n\n_Observed API work grouped by Data 360 business module; arrows represent only grounded relationships._\n\n\`\`\`mermaid\n${trace.mermaid}\n\`\`\`${note}`;
}

function actionLabel(action: string): string {
  return action
    .split(".")
    .slice(1)
    .flatMap((part) => part.split(/[_-]+/))
    .map((part, index) => {
      const acronym = ACRONYMS[part.toLowerCase()];
      if (acronym) return acronym;
      return index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part;
    })
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
