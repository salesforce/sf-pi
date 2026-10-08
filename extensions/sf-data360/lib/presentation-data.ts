/* SPDX-License-Identifier: Apache-2.0 */
/** Canonical, action-aware human presentation of heterogeneous sf_data360 results. */
import type { Data360Namespace, SfData360Input } from "./actions/action-types.ts";
import type {
  Data360CardKind,
  Data360DigestRow,
  Data360DigestTable,
  Data360RunSection,
} from "./types.ts";

export const EXPANDED_PAYLOAD_MAX_LINES = 5_000;
export const EXPANDED_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;

export interface BoundedPayloadLines {
  lines: string[];
  truncated: boolean;
  totalLines: number;
  totalBytes: number;
}

export function data360CardKind(
  namespace: Data360Namespace,
  result: Record<string, unknown>,
): Data360CardKind {
  if (
    namespace === "orchestrate" ||
    result.journey !== undefined ||
    result.journeys !== undefined ||
    Array.isArray(result.executionChain)
  ) {
    return "orchestration";
  }
  if (
    namespace === "observe" ||
    result.runbook !== undefined ||
    arrayValue(result.probes).some((probe) => Object.keys(objectValue(probe)).length > 0)
  ) {
    return "analysis";
  }
  if (namespace === "discover") return "local";
  return Object.keys(objectValue(result.request)).length ? "api" : "local";
}

export function previewSectionsFor(
  input: SfData360Input,
  result: Record<string, unknown>,
  cardKind: Data360CardKind,
): Data360RunSection[] {
  const action = stringValue(result.action) ?? input.action;
  if (action === "discover.action.search") return discoverSearchSections(input, result);
  if (action === "discover.action.list") return discoverActionListSections(result);
  if (action === "discover.route") return discoverRouteSections(result);
  if (action === "discover.action.describe") return discoverDescribeSections(result);
  if (action === "discover.readiness.probe") return readinessSections(result);
  if (action === "observe.trace.operation_latency_summary") {
    return operationLatencySections(input, result);
  }
  if (action === "observe.trace.trace_tree") return traceTreeSections(result);
  if (action === "observe.trace.join_interaction_trace") return interactionTraceSections(result);
  if (action === "orchestrate.journey.list") return journeyListSections(result);
  if (action === "orchestrate.journey.describe") return journeyDescribeSections(result);
  if (action === "orchestrate.intent.plan") return intentPlanSections(result);
  if (action.startsWith("query.")) return [];
  if (cardKind === "orchestration") {
    const orchestration = orchestrationSections(result);
    if (orchestration.length) return orchestration;
  }

  const canonical = canonicalDisplayPayload(result, cardKind);
  const collection = collectionFrom(canonical.value);
  if (collection) {
    const rows = collection.values.filter(isRecord);
    if (rows.length) {
      return [
        {
          icon: "📋",
          title: previewTitle(action, collection.key),
          table: tableFromObjects(rows),
          compact: true,
        },
      ];
    }
    return [emptyPreview(previewTitle(action, collection.key))];
  }
  if (isRecord(canonical.value)) {
    const rows = scalarRows(canonical.value);
    if (rows.length) {
      return [{ icon: "🔎", title: previewTitle(action), rows, compact: true }];
    }
  }
  if (result.ok !== false) {
    return [
      {
        icon: "🔎",
        title: "Preview",
        rows: [
          {
            icon: "ℹ️",
            label: "Summary",
            value: stringValue(result.summary) ?? "Operation completed without result data.",
          },
        ],
        compact: true,
      },
    ];
  }
  return [];
}

export function expandedPayloadFor(
  result: Record<string, unknown>,
  cardKind: Data360CardKind,
): unknown {
  if (cardKind === "api" && result.response !== undefined) return result.response;
  if (cardKind === "analysis" && result.result !== undefined) return result.result;
  const canonical = canonicalDisplayPayload(result, cardKind);
  return canonical.value === undefined ? result : canonical.value;
}

export function sanitizeData360Payload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeData360Payload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /(token|secret|authorization|password)/i.test(key)
        ? "[REDACTED]"
        : sanitizeData360Payload(entry),
    ]),
  );
}

export function boundedExpandedPayload(value: unknown): BoundedPayloadLines {
  const text = JSON.stringify(sanitizeData360Payload(value), null, 2) ?? "null";
  const allLines = text.split("\n");
  const totalBytes = Buffer.byteLength(text, "utf8");
  const lines: string[] = [];
  let bytes = 0;
  for (const line of allLines) {
    const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
    if (
      lines.length >= EXPANDED_PAYLOAD_MAX_LINES ||
      bytes + lineBytes > EXPANDED_PAYLOAD_MAX_BYTES
    ) {
      break;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  return {
    lines,
    truncated: lines.length < allLines.length,
    totalLines: allLines.length,
    totalBytes,
  };
}

interface CanonicalPayload {
  key?: string;
  value?: unknown;
}

function canonicalDisplayPayload(
  result: Record<string, unknown>,
  cardKind: Data360CardKind,
): CanonicalPayload {
  if (cardKind === "api" && result.response !== undefined) {
    return { key: "response", value: result.response };
  }
  const analysis = objectValue(result.result);
  const analysisData = objectValue(analysis.data);
  if (Array.isArray(analysisData.rows)) return { key: "rows", value: analysisData.rows };
  if (result.results !== undefined) return { key: "results", value: result.results };
  if (result.actions !== undefined) return { key: "actions", value: result.actions };
  if (result.journeys !== undefined) return { key: "journeys", value: result.journeys };
  if (result.contract !== undefined) return { key: "contract", value: result.contract };
  if (result.recommendedAction !== undefined) {
    return {
      key: "recommendedAction",
      value: [result.recommendedAction, ...arrayValue(result.alternatives)],
    };
  }
  if (result.executionChain !== undefined) {
    return { key: "executionChain", value: result.executionChain };
  }
  if (result.steps !== undefined) return { key: "steps", value: result.steps };
  if (result.probes !== undefined) return { key: "probes", value: result.probes };
  if (result.sections !== undefined) return { key: "sections", value: result.sections };
  if (result.journey !== undefined) return { key: "journey", value: result.journey };
  if (result.result !== undefined) return { key: "result", value: result.result };
  if (result.response !== undefined) return { key: "response", value: result.response };
  return { value: undefined };
}

function discoverSearchSections(
  input: SfData360Input,
  result: Record<string, unknown>,
): Data360RunSection[] {
  const query = stringValue(result.query) ?? stringValue(input.params?.query) ?? "(all actions)";
  const matches = arrayValue(result.results).filter(isRecord);
  return [
    {
      icon: "🔎",
      title: "Search",
      rows: [
        { icon: "🔤", label: "Query", value: query },
        { icon: "📊", label: "Matches", value: String(matches.length) },
      ],
      compact: true,
    },
    {
      icon: "📋",
      title: "Matching Actions",
      table: actionTable(matches),
      compact: true,
    },
  ];
}

function discoverActionListSections(result: Record<string, unknown>): Data360RunSection[] {
  const actions = arrayValue(result.actions).filter(isRecord);
  return [
    {
      icon: "📋",
      title: "Actions",
      table: actionTable(actions),
      compact: true,
    },
  ];
}

function discoverRouteSections(result: Record<string, unknown>): Data360RunSection[] {
  const recommended = objectValue(result.recommendedAction);
  const rows: Data360DigestRow[] = [];
  addRow(rows, "🎯", "Recommended", recommended.action);
  addRow(rows, "🧭", "Module", recommended.namespace);
  addRow(rows, "📝", "Description", recommended.description);
  addRow(rows, "📊", "Alternatives", arrayValue(result.alternatives).length);
  return [{ icon: "🧭", title: "Route", rows, compact: true }];
}

function discoverDescribeSections(result: Record<string, unknown>): Data360RunSection[] {
  const contract = objectValue(result.contract);
  const endpoint = objectValue(contract.endpoint);
  const rows: Data360DigestRow[] = [];
  addRow(rows, "🧭", "Module", contract.namespace);
  addRow(rows, "📚", "Family", contract.family);
  addRow(rows, "🔒", "Safety", contract.safety);
  addRow(rows, "🌐", "Endpoint", endpointText(endpoint));
  addRow(rows, "📥", "Required", arrayValue(contract.requiredParams).join(", ") || "none");
  addRow(rows, "📦", "Optional", arrayValue(contract.optionalParams).join(", ") || "none");
  return [{ icon: "📋", title: "Action Contract", rows, compact: true }];
}

function readinessSections(result: Record<string, unknown>): Data360RunSection[] {
  const probes = arrayValue(result.probes).filter(isRecord);
  return [
    {
      icon: "🩺",
      title: "Readiness Matrix",
      table: {
        columns: ["Surface", "State", "HTTP", "Resources"],
        rows: probes.map((probe) => [
          formatCell(probe.name),
          formatCell(probe.state),
          formatCell(probe.status),
          formatCell(probe.count),
        ]),
      },
      compact: true,
    },
  ];
}

function operationLatencySections(
  input: SfData360Input,
  result: Record<string, unknown>,
): Data360RunSection[] {
  const analysis = objectValue(result.result);
  const data = objectValue(analysis.data);
  const rows = arrayValue(data.rows).filter(isRecord);
  const scope: Data360DigestRow[] = [];
  addRow(scope, "🕐", "Window", input.params?.since ?? "default");
  addRow(scope, "🧭", "Data space", result.dataspaceName);
  return [
    { icon: "🔎", title: "Analysis Scope", rows: scope, compact: true },
    {
      icon: "📊",
      title: "Operation Latency",
      table: {
        columns: ["Operation", "Calls", "Average", "P95", "Maximum"],
        rows: rows.map((row) => [
          formatCell(row.operation ?? row.operation_name),
          formatCell(row.callCount ?? row.span_count),
          durationCell(row.averageMs, row.avg_duration_nanos),
          durationCell(row.p95Ms, row.p95_duration_nanos),
          durationCell(row.maxMs, row.max_duration_nanos),
        ]),
      },
      compact: true,
    },
  ];
}

function traceTreeSections(result: Record<string, unknown>): Data360RunSection[] {
  const data = objectValue(objectValue(result.result).data);
  const summary = objectValue(data.summary);
  const rows: Data360DigestRow[] = [];
  addRow(rows, "📦", "Spans", summary.totalSpans);
  addRow(rows, "🌳", "Roots", summary.rootCount);
  addRow(rows, "❌", "Errors", summary.errorCount);
  addRow(rows, "📏", "Max depth", summary.maxDepth);
  const spans = arrayValue(data.rows).filter(isRecord);
  return [
    { icon: "🌳", title: "Trace Summary", rows, compact: true },
    ...(spans.length
      ? [
          {
            icon: "📋",
            title: "Trace Spans",
            table: tableFromObjects(spans),
            compact: true,
          } satisfies Data360RunSection,
        ]
      : []),
  ];
}

function interactionTraceSections(result: Record<string, unknown>): Data360RunSection[] {
  const data = objectValue(objectValue(result.result).data);
  const summary = objectValue(data.summary);
  const rows: Data360DigestRow[] = [];
  addRow(rows, "💬", "Messages", arrayValue(data.messages).length);
  addRow(rows, "🧭", "Steps", arrayValue(data.steps).length);
  addRow(rows, "📦", "Spans", summary.totalSpans);
  addRow(rows, "❌", "Errors", summary.errorCount);
  addRow(rows, "🔗", "Trace available", data.traceAvailable);
  const messages = arrayValue(data.messages).filter(isRecord);
  return [
    { icon: "🔭", title: "Interaction Summary", rows, compact: true },
    ...(messages.length
      ? [
          {
            icon: "💬",
            title: "Messages",
            table: tableFromObjects(messages),
            compact: true,
          } satisfies Data360RunSection,
        ]
      : []),
  ];
}

function journeyListSections(result: Record<string, unknown>): Data360RunSection[] {
  const journeys = arrayValue(result.journeys).filter(isRecord);
  return [
    {
      icon: "🧭",
      title: "Outcome Journeys",
      table: {
        columns: ["Journey", "Summary", "Phases", "Plan", "Run"],
        rows: journeys.map((journey) => [
          formatCell(journey.name),
          formatCell(journey.summary),
          arrayValue(journey.phases).map(String).join(" → "),
          formatCell(journey.planAction),
          formatCell(journey.runAction),
        ]),
      },
      compact: true,
    },
  ];
}

function journeyDescribeSections(result: Record<string, unknown>): Data360RunSection[] {
  const journey = objectValue(result.journey);
  const rows: Data360DigestRow[] = [];
  addRow(rows, "🧭", "Journey", journey.name);
  addRow(rows, "📝", "Goal", journey.summary);
  addRow(rows, "🔀", "Phases", arrayValue(journey.phases).map(String).join(" → "));
  addRow(rows, "📥", "Required inputs", arrayValue(journey.requiredInputs).join(", ") || "none");
  addRow(rows, "🧪", "Verification", arrayValue(journey.verification).join(", ") || "none");
  const actions = arrayValue(journey.availableActions).filter(isRecord);
  return [
    { icon: "🧭", title: "Journey", rows, compact: true },
    ...(actions.length
      ? [
          {
            icon: "📋",
            title: "Available Actions",
            table: actionTable(actions),
            compact: true,
          } satisfies Data360RunSection,
        ]
      : []),
  ];
}

function intentPlanSections(result: Record<string, unknown>): Data360RunSection[] {
  const rows: Data360DigestRow[] = [];
  addRow(rows, "🎯", "Journey", result.recommendedJourney);
  addRow(rows, "📊", "Confidence", result.confidence);
  addRow(rows, "📥", "Missing inputs", arrayValue(result.missingInputs).join(", ") || "none");
  addRow(rows, "➡️", "Target action", result.targetAction);
  return [{ icon: "🧭", title: "Recommended Journey", rows, compact: true }];
}

function orchestrationSections(result: Record<string, unknown>): Data360RunSection[] {
  const chain = arrayValue(result.executionChain).length
    ? arrayValue(result.executionChain).filter(isRecord)
    : arrayValue(result.steps).filter(isRecord);
  if (!chain.length) return [];
  return [
    {
      icon: "🧭",
      title: "Execution Steps",
      table: {
        columns: ["Step", "Module", "Action", "Outcome"],
        rows: chain.map((step, index) => [
          String(index + 1),
          formatCell(step.namespace ?? step.tool),
          formatCell(step.action),
          step.ok === false ? "Failed" : step.ok === true ? "Passed" : "Planned",
        ]),
      },
      compact: true,
    },
  ];
}

function actionTable(actions: Record<string, unknown>[]): Data360DigestTable {
  return {
    columns: ["Module", "Action", "Family", "Safety", "API"],
    rows: actions.map((action) => [
      formatCell(action.namespace),
      formatCell(action.action),
      formatCell(action.family),
      formatCell(action.safety),
      endpointText(objectValue(action.endpoint)),
    ]),
  };
}

function tableFromObjects(values: Record<string, unknown>[]): Data360DigestTable {
  const columns = preferredColumns(values[0] ?? {});
  return {
    columns: columns.map(humanize),
    rows: values.map((row) => columns.map((column) => formatCell(row[column]))),
  };
}

function collectionFrom(value: unknown): { key?: string; values: unknown[] } | undefined {
  if (Array.isArray(value)) return { values: value };
  if (!isRecord(value)) return undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (["metadata", "fields", "dataFields"].includes(key) || !Array.isArray(entry)) continue;
    return { key, values: entry };
  }
  return undefined;
}

function scalarRows(value: Record<string, unknown>): Data360DigestRow[] {
  return Object.entries(value)
    .filter(([, entry]) => entry === null || ["string", "number", "boolean"].includes(typeof entry))
    .slice(0, 8)
    .map(([key, entry]) => ({ icon: "•", label: humanize(key), value: formatCell(entry) }));
}

function emptyPreview(title: string): Data360RunSection {
  return {
    icon: "📋",
    title,
    rows: [{ icon: "ℹ️", label: "Result", value: `No ${title.toLowerCase()} found` }],
    compact: true,
  };
}

function previewTitle(action: string, key?: string): string {
  if (action === "connect.connector.list" || key === "connectorInfoList") return "Connectors";
  if (action === "observe.stdm.find_sessions") return "Sessions";
  if (action === "observe.stdm.session_timeline") return "Session Timeline";
  if (action === "observe.trace.error_traces") return "Error Traces";
  if (key === "dataModelObject") return "Data Model Objects";
  if (key === "dataLakeObjects") return "Data Lake Objects";
  if (key === "dataStreams") return "Data Streams";
  if (key === "activations") return "Activations";
  if (key === "segments") return "Segments";
  return key ? humanize(key) : "Preview";
}

function preferredColumns(row: Record<string, unknown>): string[] {
  const preferred = [
    "name",
    "apiName",
    "developerName",
    "label",
    "operation",
    "operation_name",
    "status",
    "state",
    "type",
    "id",
  ];
  const selected = preferred.filter((key) => row[key] !== undefined);
  return (selected.length ? selected : Object.keys(row)).slice(0, 6);
}

function durationCell(milliseconds: unknown, nanoseconds: unknown): string {
  const ms = numberValue(milliseconds) ?? nanosToMs(numberValue(nanoseconds));
  if (ms === undefined) return "—";
  return ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(2)} s`;
}

function nanosToMs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value / 1_000_000;
}

function endpointText(endpoint: Record<string, unknown>): string {
  const method = stringValue(endpoint.method);
  const path = stringValue(endpoint.path);
  return [method, path].filter(Boolean).join(" ") || "Local";
}

function addRow(rows: Data360DigestRow[], icon: string, label: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  rows.push({ icon, label, value: formatCell(value) });
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value).slice(0, 160);
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
