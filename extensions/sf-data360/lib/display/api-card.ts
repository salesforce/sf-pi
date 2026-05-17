/* SPDX-License-Identifier: Apache-2.0 */
/** Map raw d360_api responses into the standard Data 360 result card. */

import type { D360ResultCard, D360ResultSection } from "./card.ts";

export interface ApiCardOptions {
  method?: string;
  path?: string;
  targetOrg?: string;
  status?: number;
  ok?: boolean;
  action?: string;
  fullOutputPath?: string;
}

export function apiResultToCard(responseText: string, opts: ApiCardOptions = {}): D360ResultCard {
  const parsed = parseJson(responseText);
  const ok = opts.ok !== false;
  const isDryRun = opts.action === "dry_run";
  const method = stringValue(opts.method) ?? methodFromDryRun(parsed) ?? "?";
  const path = stringValue(opts.path) ?? pathFromDryRun(parsed) ?? "?";
  const status = opts.status;
  const statusText = status ? `HTTP ${status}` : isDryRun ? "dry run" : undefined;
  const sections = buildSections(parsed, responseText, isDryRun);

  return withArtifact(
    {
      status: ok ? "success" : "error",
      icon: "🔗",
      title: "Data 360 API",
      subtitle: [opts.targetOrg, method, path, statusText].filter(Boolean).join(" · "),
      summary: summarizeApiResponse(parsed, responseText, opts),
      facts: buildFacts(parsed, opts),
      sections,
      nextSteps: ok
        ? undefined
        : [
            "Inspect the full JSON for raw error details.",
            "Use d360 search/examples when a registry operation exists.",
          ],
    },
    opts.fullOutputPath,
  );
}

function buildSections(
  parsed: unknown,
  responseText: string,
  isDryRun: boolean,
): D360ResultSection[] {
  if (isDryRun && parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    return [
      {
        title: "Resolved request",
        icon: "🧭",
        lines: [
          `${stringValue(obj.method) ?? "?"} ${stringValue(obj.path) ?? "?"}`,
          obj.body ? `body: ${JSON.stringify(obj.body)}` : "body: none",
        ],
      },
    ];
  }

  const errorLines = errorSummaryLines(parsed);
  if (errorLines.length) return [{ title: "Error", icon: "❌", lines: errorLines }];

  const queryLines = queryResultLines(parsed);
  if (queryLines.length) return [{ title: "Result", icon: "📊", lines: queryLines }];

  const listLines = listPreviewLines(parsed);
  if (listLines.length) return [{ title: "Preview", icon: "📚", lines: listLines }];

  const preview = responseText.trim().split(/\r?\n/).slice(0, 5).join(" ");
  return preview ? [{ title: "Preview", icon: "☁️", lines: [clip(preview, 180)] }] : [];
}

function buildFacts(
  parsed: unknown,
  opts: ApiCardOptions,
): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  if (opts.status !== undefined) facts.push({ label: "Status", value: String(opts.status) });
  if (opts.targetOrg) facts.push({ label: "Target", value: opts.targetOrg });

  const obj = objectValue(parsed);
  const status = objectValue(obj.status);
  if (typeof obj.totalSize === "number")
    facts.push({ label: "totalSize", value: String(obj.totalSize) });
  if (typeof obj.returnedRows === "number")
    facts.push({ label: "returnedRows", value: String(obj.returnedRows) });
  if (typeof status.rowCount === "number")
    facts.push({ label: "rowCount", value: String(status.rowCount) });
  if (typeof status.rowsProcessed === "number")
    facts.push({ label: "rowsProcessed", value: String(status.rowsProcessed) });
  if (typeof status.completionStatus === "string") {
    facts.push({ label: "completion", value: status.completionStatus });
  }
  return facts;
}

function summarizeApiResponse(parsed: unknown, responseText: string, opts: ApiCardOptions): string {
  if (opts.action === "dry_run") return "Resolved Data 360 REST request without network call.";
  const errors = errorSummaryLines(parsed);
  if (errors.length) return errors[0];
  const obj = objectValue(parsed);
  const status = objectValue(obj.status);
  if (typeof status.completionStatus === "string") {
    return `Query ${status.completionStatus}${typeof obj.returnedRows === "number" ? ` · ${obj.returnedRows} row(s)` : ""}.`;
  }
  if (typeof obj.totalSize === "number") return `Returned totalSize=${obj.totalSize}.`;
  const keys = Object.keys(obj);
  if (keys.length) return `Returned ${keys.length} top-level key(s).`;
  return responseText ? "Data 360 API response received." : "No response body.";
}

function queryResultLines(parsed: unknown): string[] {
  const obj = objectValue(parsed);
  const rows = Array.isArray(obj.data) ? obj.data : [];
  const metadata = Array.isArray(obj.metadata) ? obj.metadata.map(objectValue) : [];
  if (rows.length === 1 && Array.isArray(rows[0]) && rows[0].length === 1) {
    return [`${stringValue(metadata[0]?.name) ?? "value"} = ${String(rows[0][0])}`];
  }
  if (rows.length > 0) return [`Rows: ${rows.length}`];
  return [];
}

function errorSummaryLines(parsed: unknown): string[] {
  if (Array.isArray(parsed)) {
    return parsed.flatMap(errorSummaryLines).slice(0, 4);
  }
  const obj = objectValue(parsed);
  const errorCode =
    stringValue(obj.errorCode) ??
    stringValue(obj.name) ??
    stringValue(objectValue(obj.error).errorCode);
  const message = cleanErrorMessage(
    stringValue(obj.message) ?? stringValue(objectValue(obj.error).message),
  );
  return [errorCode, message].filter((line): line is string => Boolean(line));
}

function listPreviewLines(parsed: unknown): string[] {
  const obj = objectValue(parsed);
  for (const key of [
    "dataSpaces",
    "dataModelObject",
    "dataLakeObjects",
    "segments",
    "activations",
    "items",
  ]) {
    const rows = Array.isArray(obj[key]) ? obj[key] : undefined;
    if (!rows) continue;
    if (rows.length === 0) return [`${key}: 0`];
    return rows.slice(0, 5).map((row) => rowLabel(row));
  }
  const collection = objectValue(obj.collection);
  if (Array.isArray(collection.items)) {
    if (collection.items.length === 0) return ["items: 0"];
    return collection.items.slice(0, 5).map((row) => rowLabel(row));
  }
  return [];
}

function rowLabel(row: unknown): string {
  const obj = objectValue(row);
  const name =
    stringValue(obj.displayName) ??
    stringValue(obj.label) ??
    stringValue(obj.name) ??
    stringValue(obj.id);
  const status =
    stringValue(obj.status) ??
    stringValue(obj.segmentStatus) ??
    stringValue(obj.calculatedInsightStatus);
  return `• ${name ?? clip(JSON.stringify(row), 120)}${status ? ` — ${status}` : ""}`;
}

function withArtifact(card: D360ResultCard, fullOutputPath: string | undefined): D360ResultCard {
  if (!fullOutputPath) return card;
  return {
    ...card,
    artifacts: [{ label: "Full JSON", path: fullOutputPath, kind: "json" }],
  };
}

function methodFromDryRun(parsed: unknown): string | undefined {
  return stringValue(objectValue(parsed).method);
}

function pathFromDryRun(parsed: unknown): string | undefined {
  return stringValue(objectValue(parsed).path);
}

function cleanErrorMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  try {
    const parsed = JSON.parse(message) as { primaryMessage?: string; errorMessage?: string };
    return parsed.primaryMessage ?? parsed.errorMessage ?? message;
  } catch {
    return message;
  }
}

function parseJson(text: string): unknown {
  try {
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function clip(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
