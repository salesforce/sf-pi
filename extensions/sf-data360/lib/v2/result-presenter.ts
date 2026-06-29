/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Presentation seam for the active Data 360 v2 family tools.
 *
 * Execution still returns heterogeneous dispatcher payloads. This module turns
 * those payloads into one stable presentation contract:
 *   - compact Data 360 Run Digest for the LLM
 *   - Data 360 Result Card for humans / TUI renderers
 *   - Data 360 Artifacts for raw evidence and SQL drill-down
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

import type { SfPiToolResultEnvelope } from "../../../../lib/common/display/types.ts";
import { buildD360Envelope, type D360OutputMode, type D360TruncatedOutput } from "../truncation.ts";
import type { D360ArtifactKind, D360ResultCard, D360ResultFact } from "../display/card.ts";
import type { Data360V2Input, Data360V2ToolName } from "./action-types.ts";

export type Data360RunSource =
  "meta" | "rest" | "runbook" | "journey" | "readiness" | "local" | "tenant_ingest";

export interface Data360Artifact {
  label: string;
  path: string;
  kind: D360ArtifactKind;
}

export interface Data360RunDigest {
  source: Data360RunSource;
  tool: Data360V2ToolName;
  action: string;
  requestedAction?: string;
  phase?: string;
  family?: string;
  capability?: string;
  operation?: string;
  runbook?: string;
  targetOrg?: string;
  apiVersion?: string;
  dataspaceName?: string;
  status: "success" | "warning" | "error";
  summaryLine: string;
  facts: D360ResultFact[];
  preview: string[];
  artifacts: Data360Artifact[];
  nextActions: string[];
  notes: string[];
  stats: {
    steps: number;
    failed: number;
    warnings: number;
    rows?: number;
    resources?: number;
    bytes?: number;
    durationMs?: number;
  };
}

export interface PresentedData360Result {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

interface ArtifactWriteResult {
  artifactDir?: string;
  artifacts: Data360Artifact[];
  rawOutput?: D360TruncatedOutput;
}

export async function presentData360Result(
  input: Data360V2Input,
  result: Record<string, unknown>,
  outputMode: D360OutputMode,
): Promise<PresentedData360Result> {
  const rawText = stringify(result);
  const artifactWrite = await writeArtifactsForRun(input, result, rawText);
  const digest = buildDigest(input, result, artifactWrite.artifacts, rawText);
  await maybeWriteSummaryArtifact(input, digest, artifactWrite);
  const text = renderDigestForLlm(digest, outputMode);
  const card = buildResultCard(digest, result);
  const sfPi = buildD360Envelope(
    digest.action,
    result.ok !== false,
    text,
    result,
    artifactWrite.rawOutput,
  ) as
    | SfPiToolResultEnvelope<{ digest: Data360RunDigest; card: D360ResultCard }>
    | (SfPiToolResultEnvelope & { data?: { digest: Data360RunDigest; card: D360ResultCard } });
  sfPi.data = { digest, card };
  sfPi.renderHints = { profile: "balanced", collapsedLines: 10, expandedMaxLines: 140 };

  return {
    content: [{ type: "text", text }],
    details: {
      ...result,
      digest,
      card,
      artifacts: artifactWrite.artifacts,
      sfPi,
    },
  };
}

async function writeArtifactsForRun(
  input: Data360V2Input,
  result: Record<string, unknown>,
  rawText: string,
): Promise<ArtifactWriteResult> {
  if (!shouldWriteArtifacts(input, result, rawText)) return { artifacts: [] };

  const dir = await mkdtemp(join(tmpdir(), "pi-d360-"));
  const rawPath = join(dir, rawArtifactFileName(input, result));
  await writeArtifact(rawPath, rawText);
  const artifacts: Data360Artifact[] = [{ label: "Raw result", path: rawPath, kind: "json" }];

  const sql = sqlFromResult(result);
  if (sql) {
    if (typeof sql === "string") {
      const path = join(dir, "query.sql");
      await writeArtifact(path, sql);
      artifacts.push({ label: "SQL", path, kind: "sql" });
    } else {
      for (const [name, value] of Object.entries(sql)) {
        const path = join(dir, `${safeFileName(name)}.sql`);
        await writeArtifact(path, value);
        artifacts.push({ label: `SQL: ${name}`, path, kind: "sql" });
      }
    }
  }

  return {
    artifactDir: dir,
    artifacts,
    rawOutput: { text: rawText, fullOutputPath: rawPath, outputMode: "file_only" },
  };
}

async function maybeWriteSummaryArtifact(
  input: Data360V2Input,
  digest: Data360RunDigest,
  artifactWrite: ArtifactWriteResult,
): Promise<void> {
  if (!artifactWrite.artifactDir || !shouldWriteSummaryArtifact(input, digest)) return;
  const path = join(artifactWrite.artifactDir, summaryArtifactFileName(input));
  await writeArtifact(path, renderDigestMarkdown(digest));
  digest.artifacts.push({ label: "Summary", path, kind: "markdown" });
}

function rawArtifactFileName(input: Data360V2Input, result: Record<string, unknown>): string {
  if (input.action === "stdm.session_otel") return "otel.json";
  if (input.action === "readiness.probe") return "readiness.json";
  if (input.tool === "data360_api") return "raw-response.json";
  if (result.journey || result.steps || result.plan) return "journey.json";
  if (result.dryRun === true) return "dry-run.json";
  if (result.runbook || result.capabilityKind === "runbook") return "runbook-result.json";
  return "raw-result.json";
}

function summaryArtifactFileName(input: Data360V2Input): string {
  if (input.action === "stdm.session_otel") return "otel-summary.md";
  return "summary.md";
}

function shouldWriteSummaryArtifact(input: Data360V2Input, digest: Data360RunDigest): boolean {
  return input.tool === "data360_observe" && digest.artifacts.length > 0;
}

function shouldWriteArtifacts(
  input: Data360V2Input,
  result: Record<string, unknown>,
  rawText: string,
): boolean {
  if (input.action === "help" || input.action === "actions.list") return false;
  if (input.action === "actions.search" || input.action === "action.describe")
    return rawText.length > 10_000;
  if (input.action === "examples.get" || input.action === "catalog.search")
    return rawText.length > 10_000;
  return Boolean(
    result.targetOrg ||
    result.status !== undefined ||
    result.request ||
    result.response ||
    result.runbook ||
    result.dataspaceName ||
    result.journey ||
    result.steps ||
    result.dryRun ||
    rawText.length > 10_000,
  );
}

async function writeArtifact(path: string, content: string): Promise<void> {
  await withFileMutationQueue(path, async () => {
    await writeFile(path, content, "utf8");
  });
}

function buildDigest(
  input: Data360V2Input,
  result: Record<string, unknown>,
  artifacts: Data360Artifact[],
  rawText: string,
): Data360RunDigest {
  const tool = (stringValue(result.tool) ?? input.tool) as Data360V2ToolName;
  const action = stringValue(result.action) ?? input.action;
  const facts = baseFacts(result);
  const source = sourceFor(input, result);
  const stats = statsFor(input, result, rawText);
  const preview = previewFor(input, result);
  const status = result.ok === false ? "error" : warningsFor(result).length ? "warning" : "success";

  return {
    source,
    tool,
    action,
    requestedAction: stringValue(result.requestedAction),
    phase: stringValue(result.phase),
    family: stringValue(result.family),
    capability: stringValue(result.capability),
    operation: stringValue(result.operation),
    runbook: stringValue(result.runbook),
    targetOrg: stringValue(result.targetOrg),
    apiVersion: stringValue(result.apiVersion),
    dataspaceName: stringValue(result.dataspaceName),
    status,
    summaryLine: stringValue(result.summary) ?? `${tool} ${action} completed`,
    facts,
    preview,
    artifacts,
    nextActions: nextActionsFor(result),
    notes: notesFor(input, result),
    stats,
  };
}

function sourceFor(input: Data360V2Input, result: Record<string, unknown>): Data360RunSource {
  if (input.action.startsWith("actions.") || input.action === "action.describe") return "meta";
  if (input.action === "readiness.probe") return "readiness";
  if (result.runbook || result.capabilityKind === "runbook") return "runbook";
  if (result.journey || result.steps || result.plan) return "journey";
  if (result.auth || String(result.action).startsWith("auth.")) return "tenant_ingest";
  if (result.request || result.response || result.status !== undefined) {
    return input.tool === "data360_api" ? "rest" : "local";
  }
  return "local";
}

function baseFacts(result: Record<string, unknown>): D360ResultFact[] {
  const facts = [
    fact("Target", stringValue(result.targetOrg)),
    fact("API", stringValue(result.apiVersion)),
    fact("Data space", stringValue(result.dataspaceName)),
    fact("Status", result.status === undefined ? undefined : `HTTP ${String(result.status)}`),
    fact("Capability", stringValue(result.capability)),
    fact("Runbook", stringValue(result.runbook)),
    fact("Phase", stringValue(result.phase)),
    fact("Family", stringValue(result.family)),
  ];
  return facts.filter((entry): entry is D360ResultFact => Boolean(entry));
}

function fact(label: string, value: string | undefined): D360ResultFact | undefined {
  return value ? { label, value } : undefined;
}

function statsFor(
  input: Data360V2Input,
  result: Record<string, unknown>,
  rawText: string,
): Data360RunDigest["stats"] {
  if (input.action === "stdm.session_otel") {
    const otel = summarizeOtel(objectValue(result.response));
    return {
      steps: otel.spans,
      failed: otel.errors,
      warnings: warningsFor(result).length,
      resources: otel.resourceSpans,
      bytes: Buffer.byteLength(rawText, "utf8"),
    };
  }
  if (input.action === "readiness.probe") {
    const readiness = summarizeReadinessProbes(result);
    return {
      steps: readiness.total,
      failed: readiness.problem,
      warnings: readiness.problem,
      resources: readiness.ready,
      bytes: Buffer.byteLength(rawText, "utf8"),
    };
  }

  const rows = rowsFromResult(result);
  const traceStats = traceStatsFor(input, result);
  const nonTraceSteps =
    arrayValue(result.steps).length || arrayValue(result.probes).length || rows || 1;
  const steps = traceStats?.spans ?? nonTraceSteps;
  const failed = traceStats?.errors ?? countFailed(result);
  return {
    steps,
    failed,
    warnings: warningsFor(result).length,
    ...(rows !== undefined ? { rows } : {}),
    bytes: Buffer.byteLength(rawText, "utf8"),
  };
}

function previewFor(input: Data360V2Input, result: Record<string, unknown>): string[] {
  if (input.action === "readiness.probe") return readinessPreview(result);
  if (input.action === "stdm.find_sessions") return stdmSessionPreview(result);
  if (input.action === "stdm.session_otel") return otelPreview(result);
  if (input.action === "trace.trace_tree") return traceTreePreview(result);
  if (input.action === "trace.error_traces") return errorTracePreview(result);
  if (input.action === "stdm.session_timeline") return timelinePreview(result);
  if (input.action === "trace.join_interaction_trace") return joinedTracePreview(result);
  if (result.report && typeof result.report === "string")
    return result.report.split("\n").slice(0, 8);
  const runbook = objectValue(result.result);
  const markdown = stringValue(runbook.markdown);
  if (markdown) return markdown.split("\n").slice(0, 8);
  const summary = stringValue(result.summary);
  return summary ? [summary] : [];
}

function readinessPreview(result: Record<string, unknown>): string[] {
  const summary = summarizeReadinessProbes(result);
  const lines = [
    `Data 360 readiness: ${stringValue(result.state) ?? "unknown"}`,
    `Ready surfaces: ${summary.ready}`,
    `Empty surfaces: ${summary.empty}`,
    `Problem surfaces: ${summary.problem}`,
  ];
  for (const group of readinessGroups(summary.probes)) {
    lines.push(`${group.label}: ${group.ready}/${group.total} ready`);
  }
  const agentTracing = summary.probes.find((probe) => probe.name === "agent_platform_tracing_dlo");
  if (agentTracing) lines.push(`Agent Platform Tracing: ${agentTracing.state}`);
  const problems = summary.probes.filter((probe) => !isReadyProbeState(probe.state)).slice(0, 5);
  for (const problem of problems) {
    lines.push(
      `${problem.name}: ${problem.state}${problem.message ? ` · ${clipOneLine(problem.message, 120)}` : ""}`,
    );
  }
  const guidance = stringValue(result.guidance);
  if (guidance) lines.push(`Guidance: ${clipOneLine(guidance, 180)}`);
  return lines;
}

function stdmSessionPreview(result: Record<string, unknown>): string[] {
  const rows = rowsArray(result).slice(0, 5);
  return rows.map((row, index) => {
    const session = stringValue(row.session_id) ?? "?";
    const agent = stringValue(row.agent_api_name) ?? "?";
    const channel = normalizeNotSet(stringValue(row.channel)) ?? "?";
    const interactions = row.interaction_count === undefined ? "?" : String(row.interaction_count);
    return `${index + 1}. ${session} · ${agent} · ${channel} · ${interactions} interactions`;
  });
}

function otelPreview(result: Record<string, unknown>): string[] {
  const response = objectValue(result.response);
  const summary = summarizeOtel(response);
  const lines = [
    `OTel resource spans: ${summary.resourceSpans}`,
    `OTel spans: ${summary.spans}`,
    `Errors: ${summary.errors}`,
  ];
  if (summary.operations.length)
    lines.push(`Operations: ${summary.operations.slice(0, 5).join(", ")}`);
  return lines;
}

function traceTreePreview(result: Record<string, unknown>): string[] {
  const summary = objectValue(objectValue(objectValue(result.result).data).summary);
  const lines = [
    `Spans: ${String(summary.totalSpans ?? "?")}`,
    `Errors: ${String(summary.errorCount ?? "?")}`,
    `Max depth: ${String(summary.maxDepth ?? "?")}`,
  ];
  const markdown = stringValue(objectValue(result.result).markdown);
  if (markdown) lines.push(...markdown.split("\n").slice(2, 7));
  return lines;
}

function errorTracePreview(result: Record<string, unknown>): string[] {
  const rows = rowsArray(result).slice(0, 5);
  if (!rows.length) return ["No recent ERROR spans matched the query."];
  return rows.map((row, index) => {
    const operation =
      stringValue(row.ssot__OperationName__c) ?? stringValue(row.operation_name) ?? "?";
    const trace = stringValue(row.ssot__TelemetryTrace__c) ?? stringValue(row.trace_id) ?? "?";
    const span = stringValue(row.ssot__Id__c) ?? stringValue(row.span_id) ?? "?";
    return `${index + 1}. ${operation} · trace=${trace} · span=${span}`;
  });
}

function timelinePreview(result: Record<string, unknown>): string[] {
  const rows = rowsArray(result);
  if (!rows.length) return ["No STDM interaction messages returned for this session."];

  const uniqueLines: string[] = [];
  let hiddenDuplicates = 0;
  let previousKey = "";
  for (const row of rows) {
    const who =
      row.who === "Input" ? "User" : row.who === "Output" ? "Agent" : String(row.who ?? "Event");
    const topic = normalizeNotSet(stringValue(row.topic));
    const text = stringValue(row.text) ?? "";
    const key = `${who}\u0000${topic ?? ""}\u0000${text.replace(/\s+/g, " ").trim()}`;
    if (key === previousKey) {
      hiddenDuplicates++;
      continue;
    }
    previousKey = key;
    uniqueLines.push(`${who}${topic ? ` · ${topic}` : ""}: ${clipOneLine(text, 160)}`);
    if (uniqueLines.length >= 8) break;
  }

  const numbered = uniqueLines.map((line, index) => `${index + 1}. ${line}`);
  if (hiddenDuplicates > 0) {
    numbered.push(
      `${hiddenDuplicates} adjacent duplicate timeline row${hiddenDuplicates === 1 ? "" : "s"} hidden`,
    );
  }
  return numbered;
}

function joinedTracePreview(result: Record<string, unknown>): string[] {
  const data = objectValue(objectValue(result.result).data);
  const messages = arrayValue(data.messages);
  const steps = arrayValue(data.steps);
  const traceAvailable = data.traceAvailable !== false;
  return [
    `Messages: ${messages.length}`,
    `STDM steps: ${steps.length}`,
    `Platform trace: ${traceAvailable ? "available" : "unavailable"}`,
  ];
}

function traceStatsFor(
  input: Data360V2Input,
  result: Record<string, unknown>,
): { spans: number; errors: number } | undefined {
  if (input.action === "trace.trace_tree") {
    const summary = objectValue(objectValue(objectValue(result.result).data).summary);
    return {
      spans: numberValue(summary.totalSpans) ?? rowsFromResult(result) ?? 0,
      errors: numberValue(summary.errorCount) ?? 0,
    };
  }
  if (input.action === "trace.error_traces") {
    const rows = rowsFromResult(result) ?? 0;
    return { spans: rows, errors: rows };
  }
  return undefined;
}

function renderDigestForLlm(digest: Data360RunDigest, outputMode: D360OutputMode): string {
  const lines = [
    `Data 360 Run Digest ${statusGlyph(digest.status)}`,
    `Tool: ${digest.tool}`,
    `Action: ${digest.action}`,
    `Source: ${digest.source}`,
    `Summary: ${digest.summaryLine}`,
  ];

  if (digest.targetOrg) lines.push(`Target: ${digest.targetOrg}`);
  if (digest.dataspaceName) lines.push(`Data space: ${digest.dataspaceName}`);
  if (digest.stats.rows !== undefined) lines.push(`Rows: ${digest.stats.rows}`);
  if (digest.action.startsWith("trace.")) lines.push(`Spans: ${digest.stats.steps}`);
  if (digest.source === "readiness" && digest.stats.resources !== undefined) {
    lines.push(`Ready surfaces: ${digest.stats.resources}`);
  } else if (digest.stats.resources !== undefined) {
    lines.push(`OTel resource spans: ${digest.stats.resources}`);
  }
  if (digest.action === "stdm.session_otel") {
    lines.push(`OTel spans: ${digest.stats.steps}`);
    lines.push(`Errors: ${digest.stats.failed}`);
  } else if (digest.source === "readiness") {
    lines.push(`Total surfaces: ${digest.stats.steps}`);
    if (digest.stats.failed > 0) lines.push(`Problem surfaces: ${digest.stats.failed}`);
  } else if (!digest.action.startsWith("trace.")) {
    lines.push(`Steps: ${digest.stats.steps}`);
    if (digest.stats.failed > 0) lines.push(`Failures: ${digest.stats.failed}`);
  } else {
    lines.push(`Errors: ${digest.stats.failed}`);
  }

  const previewLimit =
    outputMode === "inline"
      ? 8
      : outputMode === "file_only"
        ? 0
        : digest.source === "readiness"
          ? 9
          : 5;
  if (previewLimit > 0 && digest.preview.length) {
    lines.push("", "Preview:", ...digest.preview.slice(0, previewLimit).map((line) => `- ${line}`));
  }

  if (digest.artifacts.length) {
    lines.push(
      "",
      "Artifacts:",
      ...digest.artifacts.map((artifact) => `- ${artifact.label}: ${artifact.path}`),
    );
  }

  if (digest.nextActions.length) {
    lines.push("", "Next:", ...digest.nextActions.slice(0, 4).map((action) => `- ${action}`));
  }

  if (digest.notes.length) {
    lines.push("", "Notes:", ...digest.notes.map((note) => `- ${note}`));
  }

  return lines.join("\n");
}

function buildResultCard(
  digest: Data360RunDigest,
  result: Record<string, unknown>,
): D360ResultCard {
  const sections = [];
  if (digest.preview.length) {
    sections.push({ title: "Preview", icon: previewIcon(digest), lines: digest.preview });
  }

  return {
    status: digest.status,
    icon: toolIcon(digest.tool),
    title: titleForTool(digest.tool),
    subtitle: [digest.action, digest.targetOrg, digest.dataspaceName].filter(Boolean).join(" · "),
    summary: digest.summaryLine,
    stage: {
      key:
        digest.source === "meta" ? "discover" : digest.status === "error" ? "execute" : "summarize",
      label:
        digest.source === "meta" ? "Discover" : digest.status === "error" ? "Execute" : "Summarize",
      index: digest.source === "meta" ? 2 : digest.status === "error" ? 4 : 5,
      total: 5,
      description:
        digest.source === "meta"
          ? "Resolving local Data 360 action metadata without calling the org."
          : "Summarizing the Data 360 run while preserving full evidence as artifacts.",
    },
    request: requestForCard(result, digest),
    facts: digest.facts,
    sections: sections.length ? sections : undefined,
    lineage: {
      lines: lineageLines(digest, result),
    },
    artifacts: digest.artifacts.length ? digest.artifacts : undefined,
    nextSteps: digest.nextActions.length ? digest.nextActions : defaultNextSteps(digest),
  };
}

function requestForCard(
  result: Record<string, unknown>,
  digest: Data360RunDigest,
): D360ResultCard["request"] | undefined {
  const request = objectValue(result.request);
  if (!Object.keys(request).length && !digest.capability && !digest.runbook) return undefined;
  return {
    method: stringValue(request.method),
    path: stringValue(request.path),
    targetOrg: digest.targetOrg,
    apiVersion: digest.apiVersion,
    capability: digest.capability,
    safety: safetyText(result),
    payload: request.body ?? null,
  };
}

function lineageLines(digest: Data360RunDigest, result: Record<string, unknown>): string[] {
  const request = objectValue(result.request);
  return [
    "Tool call",
    `  ↳ ${digest.tool} ${digest.action}`,
    ...(digest.runbook ? [`     ↳ Runbook: ${digest.runbook}`] : []),
    ...(digest.capability ? [`     ↳ Capability: ${digest.capability}`] : []),
    ...(stringValue(request.method) || stringValue(request.path)
      ? [
          `     ↳ Request: ${stringValue(request.method) ?? "?"} ${stringValue(request.path) ?? "?"}`,
        ]
      : []),
    ...digest.artifacts.map((artifact) => `     ↳ ${artifact.label}: ${artifact.path}`),
  ];
}

function defaultNextSteps(digest: Data360RunDigest): string[] | undefined {
  if (digest.source === "readiness") return readinessNextSteps(digest);
  if (digest.action === "stdm.find_sessions") {
    return [
      "Pick a session_id and run data360_observe stdm.session_otel for a full OTel export.",
      "Use data360_observe stdm.session_timeline for a compact conversation timeline.",
    ];
  }
  if (digest.action === "stdm.session_otel") {
    return ["Use the raw OTel artifact for deep trace inspection when the digest is not enough."];
  }
  return digest.artifacts.length
    ? ["Inspect artifacts only when raw details are needed."]
    : undefined;
}

function nextActionsFor(result: Record<string, unknown>): string[] {
  if (result.action === "readiness.probe") return readinessNextActions(result);
  return arrayValue(result.next_actions)
    .map((entry) => {
      const action = objectValue(entry);
      const tool = stringValue(action.tool);
      const actionName = stringValue(action.action);
      if (!tool && !actionName) return undefined;
      return [tool, actionName].filter(Boolean).join(" ");
    })
    .filter((entry): entry is string => Boolean(entry));
}

function readinessNextActions(result: Record<string, unknown>): string[] {
  const summary = summarizeReadinessProbes(result);
  if (summary.problem === 0)
    return ["Proceed with the intended Data 360 workflow; core readiness is healthy."];
  const actions = ["Inspect readiness.json for per-surface errors before running broad workflows."];
  const agentTracing = summary.probes.find((probe) => probe.name === "agent_platform_tracing_dlo");
  if (agentTracing && !isReadyProbeState(agentTracing.state)) {
    actions.push("Enable or grant access to Agent Platform Tracing before trace-tree workflows.");
  }
  const core = readinessGroups(summary.probes).find((group) => group.label === "Core Data 360");
  if (core && core.ready < core.total) {
    actions.push("Resolve Data 360 provisioning or permissions before querying DMOs/DLOs.");
  }
  return actions;
}

function notesFor(input: Data360V2Input, result: Record<string, unknown>): string[] {
  const notes: string[] = [];
  if (input.action === "stdm.session_otel") {
    notes.push("Agentforce Session Trace OTel API is single-session and recent-window oriented.");
  }
  if (result.dryRun === true) notes.push("Dry run resolved the request without executing it.");
  return notes;
}

function warningsFor(result: Record<string, unknown>): string[] {
  return arrayValue(result.warnings).map(String);
}

function readinessNextSteps(digest: Data360RunDigest): string[] | undefined {
  if (digest.stats.failed === 0) {
    return ["Proceed with the intended Data 360 workflow; core readiness is healthy."];
  }
  const steps = ["Inspect readiness.json for per-surface errors before running broad workflows."];
  if (digest.preview.some((line) => line.includes("Agent Platform Tracing: feature_gated"))) {
    steps.push("Enable or grant access to Agent Platform Tracing before trace-tree workflows.");
  }
  if (digest.preview.some((line) => /Core Data 360: [01]\//.test(line))) {
    steps.push("Resolve Data 360 provisioning or permissions before querying DMOs/DLOs.");
  }
  return steps;
}

function readinessGroups(probes: Array<{ name: string; state: string }>): Array<{
  label: string;
  total: number;
  ready: number;
}> {
  const groups = [
    { label: "Core Data 360", names: ["data_spaces", "dmo_catalog"] },
    { label: "Observe", names: ["agent_platform_tracing_dlo"] },
    {
      label: "Query metadata",
      names: ["dlo_catalog", "metadata_entities_dmo", "profile_metadata"],
    },
    { label: "Delivery", names: ["segments", "activations", "data_actions"] },
  ];
  return groups.map((group) => {
    const selected = probes.filter((probe) => group.names.includes(probe.name));
    return {
      label: group.label,
      total: selected.length,
      ready: selected.filter((probe) => isReadyProbeState(probe.state)).length,
    };
  });
}

function summarizeReadinessProbes(result: Record<string, unknown>): {
  total: number;
  ready: number;
  empty: number;
  problem: number;
  probes: Array<{ name: string; state: string; message?: string }>;
} {
  const probes = arrayValue(result.probes).map((probe) => {
    const row = objectValue(probe);
    return {
      name: stringValue(row.name) ?? "unknown_probe",
      state: stringValue(row.state) ?? "unknown",
      message: stringValue(row.message),
    };
  });
  return {
    total: probes.length,
    ready: probes.filter((probe) => isReadyProbeState(probe.state)).length,
    empty: probes.filter((probe) => probe.state === "enabled_empty").length,
    problem: probes.filter((probe) => !isReadyProbeState(probe.state)).length,
    probes,
  };
}

function isReadyProbeState(state: string | undefined): boolean {
  return state === "enabled_populated" || state === "enabled_empty" || state === "ok";
}

function countFailed(result: Record<string, unknown>): number {
  const probes = arrayValue(result.probes).map(objectValue);
  if (probes.length)
    return probes.filter((probe) => !isReadyProbeState(stringValue(probe.state))).length;
  const steps = arrayValue(result.steps).map(objectValue);
  if (steps.length) return steps.filter((step) => step.ok === false).length;
  return result.ok === false ? 1 : 0;
}

function rowsFromResult(result: Record<string, unknown>): number | undefined {
  const data = objectValue(objectValue(result.result).data);
  const rowCount = numberValue(data.rowCount);
  if (rowCount !== undefined) return rowCount;
  const rows = arrayValue(data.rows);
  if (rows.length) return rows.length;
  return undefined;
}

function rowsArray(result: Record<string, unknown>): Record<string, unknown>[] {
  const data = objectValue(objectValue(result.result).data);
  return arrayValue(data.rows).map(objectValue);
}

function summarizeOtel(response: Record<string, unknown>): {
  resourceSpans: number;
  spans: number;
  errors: number;
  operations: string[];
} {
  const resources = arrayValue(response.resourceSpans).map(objectValue);
  let spans = 0;
  let errors = 0;
  const operations: string[] = [];
  for (const resource of resources) {
    for (const scopeSpan of arrayValue(resource.scopeSpans).map(objectValue)) {
      for (const span of arrayValue(scopeSpan.spans).map(objectValue)) {
        spans++;
        const name = stringValue(span.name);
        if (name) operations.push(name);
        const status = objectValue(span.status);
        const code = stringValue(status.code) ?? String(status.code ?? "");
        if (/ERROR|2/.test(code)) errors++;
      }
    }
  }
  return { resourceSpans: resources.length, spans, errors, operations: unique(operations) };
}

function sqlFromResult(
  result: Record<string, unknown>,
): string | Record<string, string> | undefined {
  const sql = objectValue(result.result).sql;
  if (typeof sql === "string" && sql.trim()) return sql;
  if (sql && typeof sql === "object" && !Array.isArray(sql)) {
    const entries = Object.entries(sql as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0,
      )
      .map(([key, value]) => [key, value.trim()] as const);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return undefined;
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "query";
}

function safetyText(result: Record<string, unknown>): string | undefined {
  const safety = result.safety;
  if (typeof safety === "string") return safety;
  const safetyObj = objectValue(safety);
  return stringValue(safetyObj.level);
}

function normalizeNotSet(value: string | undefined): string | undefined {
  return value && value !== "NOT_SET" ? value : undefined;
}

function statusGlyph(status: Data360RunDigest["status"]): string {
  if (status === "error") return "❌";
  if (status === "warning") return "⚠️";
  return "✅";
}

function toolIcon(tool: Data360V2ToolName): string {
  if (tool === "data360_observe") return "🔭";
  if (tool === "data360_query") return "🔎";
  if (tool === "data360_orchestrate") return "🧭";
  return "☁️";
}

function titleForTool(tool: Data360V2ToolName): string {
  return tool.replace(/^data360_/, "Data 360 ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function previewIcon(digest: Data360RunDigest): string {
  if (digest.action.startsWith("stdm.")) return "💬";
  if (digest.action.startsWith("trace.")) return "🌳";
  return "📋";
}

function renderDigestMarkdown(digest: Data360RunDigest): string {
  return [
    `# Data 360 Run Digest — ${digest.action}`,
    "",
    `- Status: ${digest.status}`,
    `- Tool: ${digest.tool}`,
    `- Source: ${digest.source}`,
    digest.targetOrg ? `- Target: ${digest.targetOrg}` : undefined,
    digest.dataspaceName ? `- Data space: ${digest.dataspaceName}` : undefined,
    digest.stats.rows !== undefined ? `- Rows: ${digest.stats.rows}` : undefined,
    digest.action.startsWith("trace.") ? `- Spans: ${digest.stats.steps}` : undefined,
    digest.stats.failed ? `- Failures: ${digest.stats.failed}` : undefined,
    "",
    "## Summary",
    "",
    digest.summaryLine,
    "",
    ...(digest.preview.length
      ? ["## Preview", "", ...digest.preview.map((line) => `- ${line}`)]
      : []),
    ...(digest.notes.length
      ? ["", "## Notes", "", ...digest.notes.map((line) => `- ${line}`)]
      : []),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function clipOneLine(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
