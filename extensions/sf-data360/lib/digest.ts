/* SPDX-License-Identifier: Apache-2.0 */
/** Build action-aware Data 360 Run Digests from thin SDK operation results. */
import type { Data360Namespace } from "./actions/action-types.ts";
import { formatData360Sql } from "./sql-format.ts";
import type {
  BuildData360DigestInput,
  Data360ApiCallRailItem,
  Data360DigestRow,
  Data360RunDigest,
  Data360RunSection,
  Data360RunStatus,
  Data360StructuredResult,
  Data360Transport,
} from "./types.ts";

const NAMESPACE_META: Record<Data360Namespace, { icon: string; label: string }> = {
  discover: { icon: "🔎", label: "Discover" },
  connect: { icon: "🔌", label: "Connect" },
  prepare: { icon: "🧱", label: "Prepare" },
  harmonize: { icon: "🧩", label: "Harmonize" },
  segment: { icon: "🎯", label: "Segment" },
  activate: { icon: "🚀", label: "Activate" },
  query: { icon: "🧮", label: "Query" },
  semantic: { icon: "🧠", label: "Semantic" },
  observe: { icon: "🔭", label: "Observe" },
  orchestrate: { icon: "🧭", label: "Orchestrate" },
  api: { icon: "🔗", label: "API" },
};

export function namespacePresentation(namespace: Data360Namespace): {
  icon: string;
  label: string;
} {
  return NAMESPACE_META[namespace];
}

export function buildData360Digest(input: BuildData360DigestInput): Data360RunDigest {
  const { result, artifactPath } = input;
  const action = stringValue(result.action) ?? input.input.action;
  const namespace = namespaceFor(action, result.namespace);
  const presentation = namespacePresentation(namespace);
  const status = statusFor(result);
  const summary =
    stringValue(result.summary) ?? `${action} ${status === "fail" ? "failed" : "completed"}`;
  const transport = transportFor(result);
  const sections: Data360RunSection[] = [];

  sections.push({ icon: "🎯", title: "Outcome", rows: outcomeRows(result, status, transport) });
  if (namespace === "query") sections.push(...querySections(input));
  if (["prepare", "harmonize", "semantic"].includes(namespace)) {
    const metadata = metadataSection(result);
    if (metadata) sections.push(metadata);
  }
  const collection = collectionSection(result);
  if (collection) sections.push(collection);
  const request = requestSection(result, transport);
  if (request) sections.push(request);
  const response = responseSection(result);
  if (response) sections.push(response);
  const warning = warningSection(result, transport);
  if (warning) sections.push(warning);
  const failure = failureSection(result);
  if (failure) sections.push(failure);
  if (artifactPath) {
    sections.push({
      icon: "📄",
      title: "Evidence",
      rows: [{ icon: "📁", label: "Raw result", value: artifactPath }],
    });
  }
  const nextActions = nextActionsFor(result);
  const nextStep = nextActions[0] ?? defaultNextStep(action, status, artifactPath);
  if (nextStep) {
    sections.push({
      icon: "➡️",
      title: "Next Step",
      rows: [{ icon: "→", label: "Action", value: nextStep }],
    });
  }

  return {
    action,
    namespace,
    status,
    icon: presentation.icon,
    title: `Data 360 ${presentation.label}`,
    summary,
    target:
      stringValue(result.targetOrg) ||
      stringValue(result.apiVersion) ||
      stringValue(result.dataspaceName)
        ? {
            alias: stringValue(result.targetOrg),
            apiVersion: stringValue(result.apiVersion),
            dataspace: stringValue(result.dataspaceName),
          }
        : undefined,
    ...(transport ? { transport } : {}),
    api_calls: apiCallsFor(result, transport),
    sections: sections.filter((section) =>
      Boolean(section.rows?.length || section.code?.lines.length || section.table?.rows.length),
    ),
    artifacts: artifactPath
      ? [{ path: artifactPath, kind: "json", label: "Raw result" }]
      : undefined,
    next_step: nextStep,
  };
}

export function structuredResultFromDigest(
  digest: Data360RunDigest,
  result: Record<string, unknown>,
): Data360StructuredResult {
  return JSON.parse(
    JSON.stringify({
      outcome: {
        action: digest.action,
        namespace: digest.namespace,
        status: digest.status,
        summary: digest.summary,
      },
      data: result.response ?? result.result ?? result.results ?? result.actions,
      transport: digest.transport,
      artifacts: digest.artifacts,
    }),
  ) as Data360StructuredResult;
}

export function compactDigestText(digest: Data360RunDigest): string {
  const status =
    digest.status === "pass"
      ? "succeeded"
      : digest.status === "warning"
        ? "succeeded with warnings"
        : digest.status === "planned"
          ? "planned"
          : digest.status === "fail"
            ? "failed"
            : "completed";
  const facts = digest.sections.find((section) => section.title === "Outcome")?.rows ?? [];
  const useful = facts
    .filter((row) => ["Rows", "Resources", "Transport"].includes(row.label))
    .slice(0, 3)
    .map((row) =>
      row.label === "Rows"
        ? `${row.value} rows`
        : row.label === "Resources"
          ? `${row.value} ${row.value === "1" ? "resource" : "resources"}`
          : `${row.label}: ${row.value}`,
    );
  const fallback = digest.transport?.fallback
    ? ` ${transportLabel(digest.transport.fallback.from)} was unavailable; ${transportLabel(digest.transport.used)} fallback was used.`
    : "";
  const evidence = digest.artifacts?.[0]?.path ? ` Evidence: ${digest.artifacts[0].path}.` : "";
  return `${statusIcon(digest.status)} ${digest.action} ${status}: ${digest.summary}${useful.length ? ` · ${useful.join(" · ")}` : ""}.${fallback}${evidence}`
    .replace(/\.\./g, ".")
    .trim();
}

function outcomeRows(
  result: Record<string, unknown>,
  status: Data360RunStatus,
  transport: Data360RunDigest["transport"],
): Data360DigestRow[] {
  const rows: Data360DigestRow[] = [
    { icon: statusIcon(status), label: "Status", value: outcomeStatus(result, status) },
  ];
  const returned = rowCount(result);
  if (returned !== undefined) rows.push({ icon: "📊", label: "Rows", value: String(returned) });
  const resources = resourceCount(result);
  if (resources !== undefined)
    rows.push({ icon: "📦", label: "Resources", value: String(resources) });
  if (typeof result.status === "number") {
    rows.push({
      icon: result.status < 400 ? "🌐" : "❌",
      label: "HTTP",
      value: String(result.status),
    });
  }
  if (transport) {
    rows.push({
      icon: transport.fallback ? "⚠️" : "🔀",
      label: "Transport",
      value: transport.fallback
        ? `${transportLabel(transport.used)} fallback`
        : transportLabel(transport.used),
    });
  }
  const operation = stringValue(result.operationId) ?? stringValue(result.operation);
  if (operation) rows.push({ icon: "⚙️", label: "Operation", value: operation });
  return rows;
}

function querySections(input: BuildData360DigestInput): Data360RunSection[] {
  const result = input.result;
  const response = objectValue(result.response);
  const request = objectValue(result.request);
  const requestBody = objectValue(request.body);
  const nestedInput = objectValue(input.input.params?.input);
  const sql = firstString([
    input.input.params?.sql,
    nestedInput.sql,
    requestBody.sql,
    objectValue(result.result).sql,
  ]);
  const sections: Data360RunSection[] = [];
  if (sql) {
    sections.push({
      icon: "🧾",
      title: "SQL",
      code: codeBlock(formatData360Sql(sql), input.outputMode === "inline" ? 80 : 50),
    });
  }
  const queryStatus = objectValue(response.status);
  if (Object.keys(queryStatus).length) {
    const rows: Data360DigestRow[] = [];
    addRow(rows, "✅", "Completion", queryStatus.completionStatus);
    addRow(rows, "📊", "Produced", queryStatus.rowCount);
    addRow(rows, "⚙️", "Processed", queryStatus.rowsProcessed);
    addRow(rows, "📦", "Chunks", queryStatus.chunkCount);
    const wallClock = numberValue(queryStatus.wallClockTime);
    if (wallClock !== undefined)
      rows.push({ icon: "⏱️", label: "Query time", value: formatDuration(wallClock * 1000) });
    addRow(rows, "🆔", "Query ID", queryStatus.queryId);
    sections.push({ icon: "📈", title: "Query Status", rows });
  }
  const table = queryTable(response);
  if (table) sections.push({ icon: "📋", title: "Results", table });
  return sections;
}

function metadataSection(result: Record<string, unknown>): Data360RunSection | undefined {
  const response = objectValue(result.response);
  const fields = arrayValue(response.fields).length
    ? arrayValue(response.fields)
    : arrayValue(response.dataFields);
  const rows: Data360DigestRow[] = [];
  addRow(rows, "🏷️", "API name", result.apiName ?? response.name);
  addRow(rows, "📝", "Label", response.label ?? response.displayName);
  addRow(rows, "🗂️", "Category", response.category);
  addRow(rows, "🧭", "Data space", response.dataSpaceName ?? result.dataspaceName);
  addRow(rows, "✅", "Enabled", boolValue(response.isEnabled));
  addRow(rows, "✏️", "Editable", boolValue(response.isEditable));
  addRow(rows, "🎯", "Segmentable", boolValue(response.isSegmentable));
  addRow(rows, "🔢", "Fields", (result.fieldCount ?? fields.length) || undefined);
  const normalizedFields = fields.map((field) => {
    const value = objectValue(field);
    return {
      name: value.name,
      label: value.label,
      type: value.dataType ?? value.type,
      primaryKey: boolValue(value.isPrimaryKey),
      mapped: boolValue(value.isMapped),
    };
  });
  const requestedFields = numberValue(result.shownFieldCount) ?? 12;
  const table = normalizedFields.length
    ? objectTable(
        normalizedFields,
        ["name", "label", "type", "primaryKey", "mapped"],
        Math.min(12, requestedFields),
      )
    : undefined;
  return rows.length || table ? { icon: "🗂️", title: "Data Object", rows, table } : undefined;
}

function collectionSection(result: Record<string, unknown>): Data360RunSection | undefined {
  const response = objectValue(result.response);
  for (const [key, value] of Object.entries(response)) {
    if (
      !Array.isArray(value) ||
      !value.length ||
      ["data", "metadata", "fields", "dataFields"].includes(key)
    )
      continue;
    const objects = value.filter(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
    );
    if (!objects.length) continue;
    return {
      icon: "📚",
      title: humanize(key),
      table: objectTable(objects, preferredColumns(objects[0] as Record<string, unknown>), 10),
    };
  }
  return undefined;
}

function requestSection(
  result: Record<string, unknown>,
  transport: Data360RunDigest["transport"],
): Data360RunSection | undefined {
  const request = objectValue(result.request);
  if (!Object.keys(request).length) return undefined;
  const rows: Data360DigestRow[] = [];
  addRow(rows, "🔀", "Transport", transport ? transportLabel(transport.used) : undefined);
  addRow(rows, "📨", "Method", request.method);
  addRow(rows, "🔗", "URL", completeUrl(result, request));
  addRow(rows, "⚙️", "Operation", result.operationId ?? result.operation);
  addRow(rows, "🔒", "Safety", result.safety);
  const body = request.body;
  const bodyRecord = objectValue(body);
  const payloadWithoutSql = Object.fromEntries(
    Object.entries(bodyRecord).filter(([key]) => key !== "sql"),
  );
  const hasPayload =
    body !== undefined &&
    body !== null &&
    (Object.keys(payloadWithoutSql).length > 0 || !Object.keys(bodyRecord).length);
  return {
    icon: "📥",
    title: "Request",
    rows,
    code: hasPayload ? jsonCode(payloadWithoutSql, 40) : undefined,
  };
}

function responseSection(result: Record<string, unknown>): Data360RunSection | undefined {
  if (result.response === undefined) return undefined;
  const response = objectValue(result.response);
  const rows: Data360DigestRow[] = [];
  addRow(rows, "🌐", "HTTP", result.status);
  addRow(rows, "🧾", "Returned rows", response.returnedRows);
  addRow(rows, "📦", "Total", response.totalSize ?? response.total ?? response.count);
  addRow(rows, "🗝️", "Keys", Object.keys(response).join(", ") || undefined);
  return {
    icon: "📤",
    title: "Response",
    rows,
    code: jsonCode(sanitizePayload(result.response), 45),
    expandedOnly: true,
  };
}

function warningSection(
  result: Record<string, unknown>,
  transport: Data360RunDigest["transport"],
): Data360RunSection | undefined {
  const warnings = arrayValue(result.warnings).map(String);
  const fallback = transport?.fallback;
  if (fallback && !warnings.some((warning) => warning.includes(fallback.reason))) {
    warnings.unshift(fallback.reason);
  }
  return warnings.length
    ? {
        icon: "⚠️",
        title: "Warnings",
        rows: warnings
          .slice(0, 8)
          .map((warning) => ({ icon: "⚠️", label: "Notice", value: warning })),
      }
    : undefined;
}

function failureSection(result: Record<string, unknown>): Data360RunSection | undefined {
  if (result.ok !== false) return undefined;
  const rows: Data360DigestRow[] = [];
  addRow(rows, "❌", "Error", result.error ?? result.errorCode);
  addRow(rows, "🧭", "Category", classifyFailure(result));
  addRow(rows, "💡", "Recovery", objectValue(result.recover_via).action ?? result.suggestion);
  return { icon: "❌", title: "Failure", rows };
}

function apiCallsFor(
  result: Record<string, unknown>,
  transport: Data360RunDigest["transport"],
): Data360ApiCallRailItem[] | undefined {
  const request = objectValue(result.request);
  const chain = arrayValue(result.executionChain).map(objectValue);
  const probes = arrayValue(result.probes).map(objectValue);
  if (!Object.keys(request).length && !transport?.fallback && !chain.length && !probes.length) {
    return undefined;
  }
  const calls: Data360ApiCallRailItem[] = [];
  if (transport?.fallback) {
    const tokenUrl = stringValue(result.instanceUrl)
      ? `${stringValue(result.instanceUrl)}/services/a360/token`
      : "Data 360 tenant token exchange";
    calls.push({
      transport: transportRailLabel(transport.fallback.from),
      method: "AUTH",
      url: tokenUrl,
      outcome: "warning",
      detail: transport.fallback.reason,
    });
  }
  if (Object.keys(request).length) {
    calls.push(apiCallFromRequest(result, request, transport?.used ?? inferTransport(result)));
  }
  for (const step of chain.slice(0, 8 - calls.length)) {
    const stepRequest = objectValue(step.request);
    if (!Object.keys(stepRequest).length) continue;
    calls.push(apiCallFromRequest(step, stepRequest, inferTransport(step)));
  }
  for (const probe of probes.slice(0, 8 - calls.length)) {
    const path = stringValue(probe.path);
    if (!path) continue;
    calls.push({
      transport: "CONNECT",
      method: "GET",
      url: stringValue(probe.url) ?? completeUrl(result, { path }) ?? path,
      outcome:
        probe.state === "feature_gated" || probe.state === "not_found" ? "warning" : "success",
      detail: [probe.name, probe.state].filter(Boolean).join(" · "),
    });
  }
  return calls;
}

function apiCallFromRequest(
  result: Record<string, unknown>,
  request: Record<string, unknown>,
  transport: Data360Transport,
): Data360ApiCallRailItem {
  return {
    transport: transportRailLabel(transport),
    method: stringValue(request.method) ?? "CALL",
    url: completeUrl(result, request) ?? stringValue(request.path) ?? "(endpoint unavailable)",
    status: numberValue(result.status),
    durationMs: durationFor(result),
    outcome:
      result.ok === false
        ? "failed"
        : result.dryRun === true
          ? "planned"
          : warningsFor(result)
            ? "warning"
            : "success",
    detail:
      stringValue(result.operationId) ??
      stringValue(result.operation) ??
      stringValue(result.action),
  };
}

function transportFor(result: Record<string, unknown>): Data360RunDigest["transport"] | undefined {
  const used = inferTransport(result);
  if (!used) return undefined;
  const warning = arrayValue(result.warnings)
    .map(String)
    .find((value) => /query api v3 unavailable/i.test(value));
  return {
    preferred: warning ? "query-v3" : used,
    used,
    fallback: warning
      ? { from: "query-v3", reason: warning.replace(/^Query API V3 unavailable;\s*/i, "") }
      : undefined,
  };
}

function inferTransport(result: Record<string, unknown>): Data360Transport | undefined {
  const explicit = stringValue(result.transport);
  if (explicit === "connect") return "connect";
  if (explicit === "query-v3") return "query-v3";
  if (explicit === "ingestion") return "ingestion";
  const request = objectValue(result.request);
  const path = stringValue(request.path) ?? "";
  const namespace = stringValue(result.namespace);
  if (!path && ["discover", "orchestrate"].includes(namespace ?? "")) return "local";
  if (path.startsWith("/api/v3/query")) return "query-v3";
  if (path.startsWith("/api/v1/ingest")) return "ingestion";
  if (path.startsWith("/local/")) return "local";
  if (path.startsWith("/services/data/") || /^https:\/\/.*\/services\/data\//i.test(path)) {
    return "connect";
  }
  return undefined;
}

function queryTable(
  response: Record<string, unknown>,
): Data360RunDigest["sections"][number]["table"] | undefined {
  const rows = arrayValue(response.data);
  const metadata = arrayValue(response.metadata).map(objectValue);
  if (!rows.length || !metadata.length) return undefined;
  const columns = metadata.map(
    (column, index) => stringValue(column.name) ?? `column_${index + 1}`,
  );
  const shown = rows
    .slice(0, 10)
    .map((row) =>
      Array.isArray(row)
        ? row.map(formatCell)
        : columns.map((column) => formatCell(objectValue(row)[column])),
    );
  return { columns, rows: shown, omittedRows: Math.max(0, rows.length - shown.length) };
}

function objectTable(
  values: unknown[],
  columns: string[],
  maxRows: number,
): Data360RunDigest["sections"][number]["table"] {
  const shown = values.slice(0, maxRows).map((value) => {
    const row = objectValue(value);
    return columns.map((column) => formatCell(row[column]));
  });
  return {
    columns: columns.map(humanize),
    rows: shown,
    omittedRows: Math.max(0, values.length - shown.length),
  };
}

function preferredColumns(row: Record<string, unknown>): string[] {
  const preferred = ["name", "apiName", "developerName", "label", "status", "state", "type", "id"];
  const selected = preferred.filter((key) => row[key] !== undefined);
  return (selected.length ? selected : Object.keys(row)).slice(0, 6);
}

function completeUrl(
  result: Record<string, unknown>,
  request: Record<string, unknown>,
): string | undefined {
  const explicit = stringValue(request.url);
  if (explicit) return explicit;
  const path = stringValue(request.path);
  if (!path) return undefined;
  if (/^https:\/\//i.test(path)) return path;
  const instance = stringValue(result.instanceUrl);
  return instance
    ? `${instance.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
    : path;
}

function statusFor(result: Record<string, unknown>): Data360RunStatus {
  if (result.dryRun === true) return "planned";
  if (result.ok === false) return "fail";
  return warningsFor(result) ? "warning" : "pass";
}
function warningsFor(result: Record<string, unknown>): boolean {
  return (
    (Array.isArray(result.warnings) && result.warnings.length > 0) ||
    result.readiness === "partial" ||
    (Array.isArray(result.missingSurfaces) && result.missingSurfaces.length > 0)
  );
}
function outcomeStatus(result: Record<string, unknown>, status: Data360RunStatus): string {
  const responseStatus = stringValue(objectValue(result.response).status);
  return (
    responseStatus ??
    stringValue(objectValue(objectValue(result.response).status).completionStatus) ??
    (status === "pass"
      ? "Succeeded"
      : status === "planned"
        ? "Dry run · not executed"
        : status === "warning"
          ? "Succeeded with warnings"
          : "Failed")
  );
}
function namespaceFor(action: string, value: unknown): Data360Namespace {
  const candidate = stringValue(value) ?? action.split(".")[0];
  return candidate in NAMESPACE_META ? (candidate as Data360Namespace) : "api";
}
function resourceCount(result: Record<string, unknown>): number | undefined {
  const response = objectValue(result.response);
  for (const source of [result, response]) {
    for (const key of ["count", "total", "totalSize", "resourceCount"]) {
      const count = numberValue(source[key]);
      if (count !== undefined) return count;
    }
  }
  for (const [key, value] of Object.entries(response)) {
    if (["data", "metadata", "fields", "dataFields"].includes(key) || !Array.isArray(value)) {
      continue;
    }
    if (value.length === 0 || value.some((entry) => entry && typeof entry === "object")) {
      return value.length;
    }
  }
  return undefined;
}
function rowCount(result: Record<string, unknown>): number | undefined {
  const response = objectValue(result.response);
  return (
    numberValue(response.returnedRows) ??
    (Array.isArray(response.data) ? response.data.length : undefined) ??
    numberValue(objectValue(objectValue(result.result).data).rowCount)
  );
}
function nextActionsFor(result: Record<string, unknown>): string[] {
  return arrayValue(result.next_actions)
    .map((entry) => (typeof entry === "string" ? entry : stringValue(objectValue(entry).action)))
    .filter((entry): entry is string => Boolean(entry));
}
function defaultNextStep(
  action: string,
  status: Data360RunStatus,
  artifactPath?: string,
): string | undefined {
  if (status === "fail")
    return artifactPath
      ? "Inspect the raw evidence, correct the failure, and retry the same action."
      : "Correct the reported failure and retry the same action.";
  if (status === "planned")
    return "Review the resolved request, then rerun with allow_mutation=true if execution is intentional.";
  if (action === "query.sql.run")
    return "Use query.sql.metadata for schema or query.sql.rows for additional pages.";
  return artifactPath ? "Inspect the raw evidence only when more detail is required." : undefined;
}
function classifyFailure(result: Record<string, unknown>): string {
  const blob = JSON.stringify(result).toLowerCase();
  if (blob.includes("functionality_not_enabled")) return "feature_gated";
  if (blob.includes("permission") || result.status === 401 || result.status === 403)
    return "permission";
  if (blob.includes("missing") || blob.includes("required")) return "invalid_input";
  if (typeof result.status === "number" && result.status >= 500) return "platform_error";
  return "api_error";
}
function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /(token|secret|authorization|password)/i.test(key) ? "[REDACTED]" : sanitizePayload(entry),
    ]),
  );
}
function jsonCode(value: unknown, maxLines: number): Data360RunSection["code"] | undefined {
  if (value === undefined) return undefined;
  const lines = JSON.stringify(value, null, 2).split("\n");
  return {
    language: "json",
    lines: lines.slice(0, maxLines),
    omittedLines: Math.max(0, lines.length - maxLines),
  };
}
function codeBlock(value: string, maxLines: number): NonNullable<Data360RunSection["code"]> {
  const lines = value.split("\n");
  return {
    language: "sql",
    lines: lines.slice(0, maxLines),
    omittedLines: Math.max(0, lines.length - maxLines),
  };
}
function durationFor(result: Record<string, unknown>): number | undefined {
  const durationMs = numberValue(result.durationMs);
  if (durationMs !== undefined) return durationMs;
  const wallClockSeconds = numberValue(
    objectValue(objectValue(result.response).status).wallClockTime,
  );
  return wallClockSeconds === undefined ? undefined : wallClockSeconds * 1000;
}
function transportLabel(value: Data360Transport): string {
  return value === "query-v3"
    ? "Query API V3"
    : value === "connect"
      ? "Connect API"
      : value === "ingestion"
        ? "Ingestion API"
        : "Local";
}
function transportRailLabel(value: Data360Transport): Data360ApiCallRailItem["transport"] {
  return value === "query-v3"
    ? "QUERY V3"
    : value === "connect"
      ? "CONNECT"
      : value === "ingestion"
        ? "INGEST"
        : "LOCAL";
}
function statusIcon(status: Data360RunStatus): string {
  return status === "pass"
    ? "✅"
    : status === "warning"
      ? "⚠️"
      : status === "fail"
        ? "❌"
        : status === "planned"
          ? "🟡"
          : "ℹ️";
}
function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
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
function boolValue(value: unknown): string | undefined {
  return typeof value === "boolean" ? (value ? "yes" : "no") : undefined;
}
function addRow(rows: Data360DigestRow[], icon: string, label: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  rows.push({ icon, label, value: formatCell(value) });
}
function firstString(values: unknown[]): string | undefined {
  return values
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
    ?.trim();
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
