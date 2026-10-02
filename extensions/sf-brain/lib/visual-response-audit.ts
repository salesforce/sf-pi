/* SPDX-License-Identifier: Apache-2.0 */
/** Aggregate-only audit of terminal Mermaid and visual-icon usage in Pi sessions. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { analyzeVisualResponse } from "./visual-response.ts";

const VISUAL_ICON_PATTERN = /[✅❌⚠💡🔍🛠🧪🔒🚀🟢🟡🔴☁🗂📊🤖⚡📄📚⏳🧭❓]/u;
const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export interface VisualResponseAuditOptions {
  cwd: string;
  sessionDir: string;
  maxSessions?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  terminalWidth?: number;
  now?: Date;
}

export interface VisualResponseAuditReport {
  schemaVersion: 1;
  generatedAt: string;
  scope: {
    sessionsAvailable: number;
    sessionsSelected: number;
    maxSessions: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    terminalWidth: number;
  };
  summary: {
    sessionsAudited: number;
    sessionsSkippedForBounds: number;
    sessionsSkippedForScope: number;
    sessionsWithVisualInstruction: number;
    finalResponses: number;
    responsesWithMermaid: number;
    responsesWithVisualIcons: number;
    diagrams: number;
    supported: number;
    unsupported: number;
    malformed: number;
    withWarnings: number;
    topLevel: number;
    wouldRenderAtWidth: number;
  };
  diagramKinds: {
    flowchart: number;
    sequence: number;
    state: number;
    er: number;
    class: number;
    unsupported: number;
  };
  width: {
    samples: number;
    min?: number;
    median?: number;
    p90?: number;
    max?: number;
  };
  limitations: string[];
}

export function captureVisualResponseAudit(
  options: VisualResponseAuditOptions,
): VisualResponseAuditReport {
  const maxSessions = boundedPositiveInt(options.maxSessions, DEFAULT_MAX_SESSIONS, 500);
  const maxFileBytes = boundedPositiveInt(
    options.maxFileBytes,
    DEFAULT_MAX_FILE_BYTES,
    100 * 1024 * 1024,
  );
  const maxTotalBytes = boundedPositiveInt(
    options.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    1024 * 1024 * 1024,
  );
  const terminalWidth = boundedPositiveInt(options.terminalWidth, 80, 500);
  const files = listSessionFiles(options.sessionDir);
  const selected = files.slice(0, maxSessions);
  const summary: VisualResponseAuditReport["summary"] = {
    sessionsAudited: 0,
    sessionsSkippedForBounds: 0,
    sessionsSkippedForScope: 0,
    sessionsWithVisualInstruction: 0,
    finalResponses: 0,
    responsesWithMermaid: 0,
    responsesWithVisualIcons: 0,
    diagrams: 0,
    supported: 0,
    unsupported: 0,
    malformed: 0,
    withWarnings: 0,
    topLevel: 0,
    wouldRenderAtWidth: 0,
  };
  const diagramKinds: VisualResponseAuditReport["diagramKinds"] = {
    flowchart: 0,
    sequence: 0,
    state: 0,
    er: 0,
    class: 0,
    unsupported: 0,
  };
  const widths: number[] = [];
  let inspectedBytes = 0;

  for (const name of selected) {
    const filePath = path.join(options.sessionDir, name);
    let size: number;
    try {
      size = statSync(filePath).size;
    } catch {
      summary.sessionsSkippedForBounds += 1;
      continue;
    }
    if (size > maxFileBytes || inspectedBytes + size > maxTotalBytes) {
      summary.sessionsSkippedForBounds += 1;
      continue;
    }
    inspectedBytes += size;

    let entries: unknown[];
    try {
      entries = readFileSync(filePath, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as unknown];
          } catch {
            return [];
          }
        });
    } catch {
      summary.sessionsSkippedForBounds += 1;
      continue;
    }
    if (!sessionMatchesCwd(entries[0], options.cwd)) {
      summary.sessionsSkippedForScope += 1;
      continue;
    }

    summary.sessionsAudited += 1;
    let visualInstruction = false;
    for (const entry of entries) {
      if (isVisualInstructionEntry(entry)) visualInstruction = true;
      const response = finalAssistantText(entry);
      if (response === undefined) continue;
      summary.finalResponses += 1;
      if (VISUAL_ICON_PATTERN.test(response)) summary.responsesWithVisualIcons += 1;
      const analysis = analyzeVisualResponse(response, terminalWidth);
      if (analysis.diagrams.length > 0) summary.responsesWithMermaid += 1;
      for (const diagram of analysis.diagrams) {
        summary.diagrams += 1;
        diagramKinds[diagram.kind] += 1;
        if (diagram.supported) summary.supported += 1;
        else summary.unsupported += 1;
        if (diagram.supported && !diagram.syntaxValid) summary.malformed += 1;
        if (diagram.warnings > 0) summary.withWarnings += 1;
        if (diagram.topLevel) summary.topLevel += 1;
        if (diagram.renderableAtWidth) summary.wouldRenderAtWidth += 1;
        if (diagram.width !== undefined) widths.push(diagram.width);
      }
    }
    if (visualInstruction) summary.sessionsWithVisualInstruction += 1;
  }

  widths.sort((left, right) => left - right);
  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    scope: {
      sessionsAvailable: files.length,
      sessionsSelected: selected.length,
      maxSessions,
      maxFileBytes,
      maxTotalBytes,
      terminalWidth,
    },
    summary,
    diagramKinds,
    width: {
      samples: widths.length,
      ...(widths.length > 0
        ? {
            min: widths[0],
            median: percentile(widths, 0.5),
            p90: percentile(widths, 0.9),
            max: widths.at(-1),
          }
        : {}),
    },
    limitations: [
      "Session files retain Mermaid source, not historical terminal pixels.",
      "Renderability is replayed at the selected width with the installed renderer.",
      "The report contains aggregate counts only; transcript text and identifiers are never returned.",
    ],
  };
}

export function renderVisualResponseAuditMarkdown(report: VisualResponseAuditReport): string {
  const { scope, summary, diagramKinds, width } = report;
  return [
    "# Visual Response Audit",
    "",
    "Aggregate-only terminal Mermaid and icon facts. No transcript content or identifiers are included.",
    "",
    "## Scope",
    "",
    `- Sessions audited: ${summary.sessionsAudited} of ${scope.sessionsSelected} selected`,
    `- Terminal width: ${scope.terminalWidth} columns`,
    `- Bound skips: ${summary.sessionsSkippedForBounds}`,
    `- Scope skips: ${summary.sessionsSkippedForScope}`,
    "",
    "## Response facts",
    "",
    `- Final responses: ${summary.finalResponses}`,
    `- Responses with Mermaid: ${summary.responsesWithMermaid}`,
    `- Responses with visual icons: ${summary.responsesWithVisualIcons}`,
    `- Diagrams: ${summary.diagrams}`,
    `- Would render at width: ${summary.wouldRenderAtWidth}`,
    `- Unsupported: ${summary.unsupported}`,
    `- Malformed: ${summary.malformed}`,
    `- Parser warnings: ${summary.withWarnings}`,
    "",
    "## Diagram families",
    "",
    `- Flowchart: ${diagramKinds.flowchart}`,
    `- Sequence: ${diagramKinds.sequence}`,
    `- State: ${diagramKinds.state}`,
    `- ER: ${diagramKinds.er}`,
    `- Class: ${diagramKinds.class}`,
    `- Unsupported: ${diagramKinds.unsupported}`,
    "",
    "## Width",
    "",
    `- Samples: ${width.samples}`,
    `- Minimum: ${formatOptional(width.min)}`,
    `- Median: ${formatOptional(width.median)}`,
    `- P90: ${formatOptional(width.p90)}`,
    `- Maximum: ${formatOptional(width.max)}`,
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function listSessionFiles(sessionDir: string): string[] {
  if (!existsSync(sessionDir)) return [];
  try {
    return readdirSync(sessionDir)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function sessionMatchesCwd(entry: unknown, cwd: string): boolean {
  if (!entry || typeof entry !== "object") return false;
  const header = entry as { type?: unknown; cwd?: unknown };
  return (
    header.type === "session" &&
    typeof header.cwd === "string" &&
    path.resolve(header.cwd) === path.resolve(cwd)
  );
}

function isVisualInstructionEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { type?: unknown; customType?: unknown; content?: unknown };
  return (
    candidate.type === "custom_message" &&
    candidate.customType === "sf-brain-constitution" &&
    typeof candidate.content === "string" &&
    candidate.content.includes("7. SIMPLE, VISUAL COMMUNICATION")
  );
}

function finalAssistantText(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const candidate = entry as {
    type?: unknown;
    message?: { role?: unknown; stopReason?: unknown; content?: unknown };
  };
  if (
    candidate.type !== "message" ||
    candidate.message?.role !== "assistant" ||
    candidate.message.stopReason !== "stop"
  ) {
    return undefined;
  }
  if (typeof candidate.message.content === "string") return candidate.message.content;
  if (!Array.isArray(candidate.message.content)) return undefined;
  return candidate.message.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        !!block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function boundedPositiveInt(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value) || (value ?? 0) < 1) return fallback;
  return Math.min(Math.floor(value as number), maximum);
}

function percentile(sorted: number[], fraction: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function formatOptional(value: number | undefined): string {
  return value === undefined ? "n/a" : String(value);
}
