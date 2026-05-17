/* SPDX-License-Identifier: Apache-2.0 */
/** Map d360 facade result payloads into the standard Data 360 result card. */

import { renderCardForLlm, type D360ResultCard, type D360ResultSection } from "./card.ts";

export interface FacadeCardBuildOptions {
  fullOutputPath?: string;
}

export function facadeResultToCard(
  result: Record<string, unknown>,
  opts: FacadeCardBuildOptions = {},
): D360ResultCard {
  const action = stringValue(result.action) ?? "d360";
  switch (action) {
    case "search":
      return searchCard(result, opts);
    case "examples":
      return examplesCard(result, opts);
    case "execute":
      return executeCard(result, opts);
    case "runbook":
      return runbookCard(result, opts);
    default:
      return genericCard(result, opts);
  }
}

export function facadeResultToLlmText(
  result: Record<string, unknown>,
  opts: FacadeCardBuildOptions = {},
): { card: D360ResultCard; text: string } {
  const card = facadeResultToCard(result, opts);
  return { card, text: renderCardForLlm(card) };
}

function searchCard(result: Record<string, unknown>, opts: FacadeCardBuildOptions): D360ResultCard {
  const query = stringValue(result.query) ?? "";
  const matches = arrayValue(result.results);
  const lines = matches.slice(0, 6).map((entry, index) => {
    const row = objectValue(entry);
    const family = stringValue(row.family) ?? "Unknown";
    const runbooks = arrayValue(row.runbooks).length;
    const operations = arrayValue(row.operations).length;
    return `${index + 1}. ${family} · ${operations} operation(s) · ${runbooks} runbook(s)`;
  });
  return withArtifacts(
    {
      status: "success",
      icon: "💠",
      title: "Data 360 search",
      subtitle: query ? `query: ${query}` : undefined,
      summary: `${matches.length} Data 360 family match(es).`,
      sections: [{ title: "Matches", icon: "🔎", lines }],
      nextSteps: ["Use d360 examples with an operation or runbook name."],
    },
    opts,
  );
}

function examplesCard(
  result: Record<string, unknown>,
  opts: FacadeCardBuildOptions,
): D360ResultCard {
  const operation = objectValue(result.operation);
  const runbook = objectValue(result.runbook);
  const name = stringValue(operation.name) ?? stringValue(runbook.name) ?? "examples";
  const required = arrayValue(operation.requiredParams ?? runbook.requiredParams).map(String);
  const optional = arrayValue(operation.optionalParams ?? runbook.optionalParams).map(String);
  const lines = [
    ...(required.length ? [`Required: ${required.join(", ")}`] : ["Required: none"]),
    ...(optional.length ? [`Optional: ${optional.join(", ")}`] : []),
  ];
  return withArtifacts(
    {
      status: result.ok === false ? "warning" : "success",
      icon: "📘",
      title: "Data 360 examples",
      subtitle: name,
      summary: stringValue(result.summary) ?? `Example for ${name}`,
      sections: [{ title: "Shape", icon: "📘", lines }],
      nextSteps: [
        runbook.name
          ? "Use d360 runbook with these params."
          : "Use d360 execute with these params.",
      ],
    },
    opts,
  );
}

function executeCard(
  result: Record<string, unknown>,
  opts: FacadeCardBuildOptions,
): D360ResultCard {
  const operation =
    stringValue(result.operation) ?? stringValue(objectValue(result.operation).name) ?? "execute";
  const status = numberValue(result.status);
  const ok = result.ok !== false;
  const response = objectValue(result.response);
  const sections: D360ResultSection[] = [];
  const responseLines = summarizeResponse(response);
  if (responseLines.length)
    sections.push({ title: "Result", icon: ok ? "✅" : "❌", lines: responseLines });
  if (result.dryRun === true) {
    const request = objectValue(result.request);
    sections.push({
      title: "Resolved request",
      icon: "🧭",
      lines: [
        `${stringValue(request.method) ?? "?"} ${stringValue(request.path) ?? "?"}`,
        request.body ? `body: ${JSON.stringify(request.body)}` : "body: none",
      ],
    });
  }
  return withArtifacts(
    {
      status: ok ? "success" : "error",
      icon: "💠",
      title: "Data 360 execute",
      subtitle: [stringValue(result.targetOrg), operation, status ? `HTTP ${status}` : undefined]
        .filter(Boolean)
        .join(" · "),
      summary: stringValue(result.summary) ?? `${operation}${status ? ` HTTP ${status}` : ""}`,
      sections,
      nextSteps: ok ? undefined : ["Inspect the full JSON for raw error details."],
    },
    opts,
  );
}

function runbookCard(
  result: Record<string, unknown>,
  opts: FacadeCardBuildOptions,
): D360ResultCard {
  const runbook = stringValue(result.runbook) ?? "runbook";
  const ok = result.ok !== false;
  const runbookResult = objectValue(result.result);
  const markdown = stringValue(runbookResult.markdown);
  const lines = markdown ? markdown.split("\n").slice(1).filter(Boolean) : [];
  const data = objectValue(runbookResult.data);
  const rowCount = (numberValue(data.rowCount) ?? arrayValue(data.rows).length) || undefined;
  const facts = [
    fact("Target", stringValue(result.targetOrg)),
    fact("Data space", stringValue(result.dataspaceName)),
    fact("Rows", rowCount === undefined ? undefined : String(rowCount)),
  ].filter((f): f is { label: string; value: string } => Boolean(f));
  const error = stringValue(result.error);
  return withArtifacts(
    {
      status: ok ? "success" : "error",
      icon: runbook.includes("stdm") ? "💬" : runbook.includes("trace") ? "🌳" : "☁️",
      title: runbookTitle(runbook),
      subtitle: [stringValue(result.targetOrg), stringValue(result.dataspaceName)]
        .filter(Boolean)
        .join(" · "),
      summary: ok ? (stringValue(result.summary) ?? runbook) : (error ?? `${runbook} failed`),
      facts,
      sections: lines.length
        ? [{ title: "Preview", icon: "💬", lines }]
        : error
          ? [{ title: "Error", icon: "❌", lines: [error] }]
          : undefined,
      nextSteps: ok
        ? ["Read full JSON only if raw rows or SQL are needed."]
        : ["Inspect the full JSON for raw error details."],
    },
    opts,
  );
}

function genericCard(
  result: Record<string, unknown>,
  opts: FacadeCardBuildOptions,
): D360ResultCard {
  return withArtifacts(
    {
      status: result.ok === false ? "error" : "success",
      icon: "☁️",
      title: "Data 360 result",
      summary: stringValue(result.summary) ?? "Data 360 facade completed.",
    },
    opts,
  );
}

function withArtifacts(card: D360ResultCard, opts: FacadeCardBuildOptions): D360ResultCard {
  if (!opts.fullOutputPath) return card;
  return {
    ...card,
    artifacts: [
      ...(card.artifacts ?? []),
      { label: "Full JSON", path: opts.fullOutputPath, kind: "json" },
    ],
  };
}

function summarizeResponse(response: Record<string, unknown>): string[] {
  if (response.errorCode || response.message || response.name) {
    return [
      stringValue(response.errorCode) ?? stringValue(response.name) ?? "Error",
      cleanErrorMessage(stringValue(response.message)),
    ].filter(Boolean) as string[];
  }
  const rows = arrayValue(response.data);
  const metadata = arrayValue(response.metadata).map(objectValue);
  if (rows.length === 1 && Array.isArray(rows[0]) && rows[0].length === 1) {
    const name = stringValue(metadata[0]?.name) ?? "value";
    return [`${name} = ${String(rows[0][0])}`];
  }
  if (rows.length) return [`Rows: ${rows.length}`];
  for (const key of ["totalSize", "returnedRows"]) {
    const value = response[key];
    if (typeof value === "number") return [`${key}: ${value}`];
  }
  for (const key of [
    "segments",
    "activations",
    "dataSpaces",
    "dataLakeObjects",
    "dataModelObject",
  ]) {
    const value = response[key];
    if (Array.isArray(value)) return [`${key}: ${value.length}`];
  }
  const collection = objectValue(response.collection);
  if (typeof collection.total === "number") return [`total: ${collection.total}`];
  return Object.keys(response).length ? [`Keys: ${Object.keys(response).join(", ")}`] : [];
}

function runbookTitle(runbook: string): string {
  if (runbook.endsWith("stdm_session_timeline")) return "STDM session timeline";
  if (runbook.endsWith("join_interaction_trace")) return "STDM ↔ Platform Trace";
  if (runbook.endsWith("platform_trace_tree")) return "Platform trace tree";
  if (runbook.endsWith("platform_error_traces")) return "Platform error traces";
  if (runbook.endsWith("operation_latency_summary")) return "Operation latency summary";
  return runbook;
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

function fact(
  label: string,
  value: string | undefined,
): { label: string; value: string } | undefined {
  return value ? { label, value } : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
