/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Red/green decision logic and tool-result rendering for sf-agentscript-assist.
 *
 * The agent-facing surface is:
 *
 *   File has errors/actionable warnings   → append a `LSP feedback:` block
 *   File was broken, now clean            → append a `LSP now clean:` note
 *   First time SDK is unavailable         → append a one-time `LSP setup note:`
 *   Clean file that was never broken      → stay silent
 *
 * We reuse the `LSP ...` prefixes even though this extension isn't LSP-backed,
 * because (a) it matches what agents already pattern-match on from `sf-lsp`,
 * and (b) the framing — "your write triggered a check, here's what came back"
 * — is exactly the same. If you need to tell sf-lsp from
 * sf-agentscript-assist in debug, read the first line: we prefix dialect info
 * in the feedback header for `.agent` files, which sf-lsp never does.
 */

import path from "node:path";
import type { ToolResultEvent } from "@mariozechner/pi-coding-agent";
import {
  buildDiagnosticsSummary,
  diagnosticFileName,
  mergeSfPiDiagnosticsDetails,
  severityFromLsp,
  type SfPiDiagnosticFixMetadata,
  type SfPiDiagnosticMetadataItem,
  type SfPiDiagnosticsMetadata,
} from "../../../lib/common/display/diagnostics.ts";
import type {
  AgentScriptCheckResult,
  AgentScriptDiagnostic,
  AgentScriptDialectInfo,
  AgentScriptQuickFix,
} from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

/** One item from Pi's tool_result `content` array. */
export type ToolResultContentPart = ToolResultEvent["content"][number];

/**
 * Patch object returned from a tool_result handler to modify the result.
 * Returning `undefined` means "leave the tool result unchanged".
 */
export interface ToolResultUpdate {
  content?: ToolResultContentPart[];
  details?: unknown;
  isError?: boolean;
}

/** Remembered per-file status. */
export type AgentScriptFileStatus = "clean" | "error";

/**
 * In-memory state for one Pi session.
 *
 * - `lastStatusByFile`: previous status per file, used to emit "now clean" only
 *   when a file transitions from error → clean.
 * - `sdkUnavailableReported`: whether we've already told the agent the SDK is
 *   unavailable. We report this once per session to avoid spamming.
 * - `dialectReportedByFile`: whether we've already told the agent the resolved
 *   dialect for this file. Once per file per session.
 */
export interface AgentScriptAssistState {
  lastStatusByFile: Map<string, AgentScriptFileStatus>;
  sdkUnavailableReported: boolean;
  dialectReportedByFile: Set<string>;
}

// -------------------------------------------------------------------------------------------------
// Limits
// -------------------------------------------------------------------------------------------------

const MAX_RENDERED_FEEDBACK_BYTES = 8 * 1024;
const MAX_SINGLE_DIAGNOSTIC_BYTES = 240;
const MAX_UNAVAILABLE_REASON_BYTES = 400;
const MAX_FIXES_PER_DIAGNOSTIC = 3;

// -------------------------------------------------------------------------------------------------
// State management
// -------------------------------------------------------------------------------------------------

export function createState(): AgentScriptAssistState {
  return {
    lastStatusByFile: new Map<string, AgentScriptFileStatus>(),
    sdkUnavailableReported: false,
    dialectReportedByFile: new Set<string>(),
  };
}

export function resetState(state: AgentScriptAssistState): void {
  state.lastStatusByFile.clear();
  state.sdkUnavailableReported = false;
  state.dialectReportedByFile.clear();
}

// -------------------------------------------------------------------------------------------------
// Rendering helpers
// -------------------------------------------------------------------------------------------------

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let truncated = "";
  for (const character of value) {
    const next = `${truncated}${character}`;
    if (Buffer.byteLength(next, "utf8") > maxBytes - 3) break;
    truncated = next;
  }
  return `${truncated}...`;
}

function sortDiagnosticsByLocation(
  left: AgentScriptDiagnostic,
  right: AgentScriptDiagnostic,
): number {
  if (left.range.start.line !== right.range.start.line) {
    return left.range.start.line - right.range.start.line;
  }
  return left.range.start.character - right.range.start.character;
}

function fixesForDiagnostic(
  diagnostic: AgentScriptDiagnostic,
  quickFixes: AgentScriptQuickFix[],
): AgentScriptQuickFix[] {
  return quickFixes.filter(
    (fix) =>
      fix.diagnosticLine === diagnostic.range.start.line && fix.diagnosticCode === diagnostic.code,
  );
}

function renderRange(range: AgentScriptQuickFix["edits"][number]["range"]): string {
  const sameLine = range.start.line === range.end.line;
  if (sameLine) {
    return `L${range.start.line + 1}:${range.start.character}-${range.end.character}`;
  }
  return `L${range.start.line + 1}:${range.start.character}-L${range.end.line + 1}:${range.end.character}`;
}

function renderFixPreview(fix: AgentScriptQuickFix): string {
  // Show the first edit in compact form so the agent can see roughly what the
  // fix does without us dumping the entire WorkspaceEdit structure.
  const firstEdit = fix.edits[0];
  if (!firstEdit) return fix.title;

  const replacementPreview = firstEdit.newText.length === 0 ? "(delete)" : firstEdit.newText;
  const shortReplacement = truncateByBytes(replacementPreview.replace(/\n/g, "\\n"), 60);
  const suffix = fix.edits.length > 1 ? ` (+${fix.edits.length - 1} more edits)` : "";
  return `${fix.title}  ${renderRange(firstEdit.range)} → "${shortReplacement}"${suffix}`;
}

function renderDiagnosticLine(diagnostic: AgentScriptDiagnostic): string {
  const line = diagnostic.range.start.line + 1;
  const body = truncateByBytes(
    normalizeWhitespace(diagnostic.message),
    MAX_SINGLE_DIAGNOSTIC_BYTES,
  );
  const severityTag = diagnostic.severity === 2 ? " [warning]" : "";
  return `- L${line}${severityTag}: ${body}`;
}

// -------------------------------------------------------------------------------------------------
// Top-level renderers
// -------------------------------------------------------------------------------------------------

function renderDialectHeader(dialect: AgentScriptDialectInfo | undefined): string | null {
  if (!dialect) return null;
  if (dialect.unknown) {
    const available = dialect.availableNames?.join(", ") ?? "agentforce";
    return `Agent Script dialect: unknown '${dialect.name}' (available: ${available})`;
  }
  const version = dialect.version ? ` ${dialect.version}` : "";
  return `Agent Script dialect: ${dialect.name}${version}`;
}

export function renderErrorFeedback(
  filePath: string,
  dialectHeader: string | null,
  diagnostics: AgentScriptDiagnostic[],
  quickFixes: AgentScriptQuickFix[],
): string {
  const header = `LSP feedback: ${path.basename(filePath)}`;
  const lines: string[] = [];
  lines.push(header);
  if (dialectHeader) lines.push(`(${dialectHeader})`);

  const sorted = [...diagnostics].sort(sortDiagnosticsByLocation);
  let bytesUsed = lines.reduce((sum, item) => sum + Buffer.byteLength(`${item}\n`, "utf8"), 0);

  let rendered = 0;
  for (const diagnostic of sorted) {
    const line = renderDiagnosticLine(diagnostic);
    const fixes = fixesForDiagnostic(diagnostic, quickFixes).slice(0, MAX_FIXES_PER_DIAGNOSTIC);

    const block: string[] = [line];
    for (const fix of fixes) {
      block.push(`    fix: ${renderFixPreview(fix)}`);
    }

    const bytesForBlock = block.reduce(
      (sum, item) => sum + Buffer.byteLength(`${item}\n`, "utf8"),
      0,
    );
    if (bytesUsed + bytesForBlock > MAX_RENDERED_FEEDBACK_BYTES) break;

    lines.push(...block);
    bytesUsed += bytesForBlock;
    rendered += 1;
  }

  const omitted = sorted.length - rendered;
  if (omitted > 0) lines.push(`(+${omitted} more)`);

  return lines.join("\n");
}

export function renderSuccessFeedback(filePath: string): string {
  return `LSP now clean: ${path.basename(filePath)}`;
}

export function renderUnavailableFeedback(reason: string): string {
  const cleanReason = truncateByBytes(normalizeWhitespace(reason), MAX_UNAVAILABLE_REASON_BYTES);
  return `LSP setup note: Agent Script SDK is unavailable. Reason: ${cleanReason} Run /sf-agentscript-assist doctor for diagnostics.`;
}

// -------------------------------------------------------------------------------------------------
// Decision logic
// -------------------------------------------------------------------------------------------------

interface BuildToolResultUpdateOptions {
  filePath: string;
  existingContent: ToolResultContentPart[];
  existingDetails?: unknown;
  checkResult: AgentScriptCheckResult;
  state: AgentScriptAssistState;
}

/**
 * Convert a check result into a tool result update (or undefined to skip).
 */
export function buildToolResultUpdate(
  options: BuildToolResultUpdateOptions,
): ToolResultUpdate | undefined {
  const { filePath, existingContent, existingDetails, checkResult, state } = options;

  // SDK unavailable: report once per session, then stay silent.
  if (!checkResult.ok) {
    if (state.sdkUnavailableReported) return undefined;
    state.sdkUnavailableReported = true;
    const unavailableReason =
      checkResult.unavailableReason ?? "The Agent Script SDK failed to load.";
    const renderedText = renderUnavailableFeedback(unavailableReason);
    return appendTextPart(
      existingContent,
      renderedText,
      buildAgentScriptMetadata({
        filePath,
        status: "unavailable",
        renderedText,
        diagnostics: [],
        quickFixes: [],
        unavailableReason,
      }),
      existingDetails,
    );
  }

  // Decide whether to include a dialect header this turn. Only include it the
  // first time we feed back anything for this file, so we don't repeat it on
  // every edit.
  const firstFeedbackForFile = !state.dialectReportedByFile.has(filePath);
  const dialectHeader = firstFeedbackForFile ? renderDialectHeader(checkResult.dialect) : null;

  if (checkResult.diagnostics.length > 0) {
    state.lastStatusByFile.set(filePath, "error");
    state.dialectReportedByFile.add(filePath);
    const renderedText = renderErrorFeedback(
      filePath,
      dialectHeader,
      checkResult.diagnostics,
      checkResult.quickFixes,
    );
    return appendTextPart(
      existingContent,
      renderedText,
      buildAgentScriptMetadata({
        filePath,
        status: "error",
        renderedText,
        diagnostics: checkResult.diagnostics,
        quickFixes: checkResult.quickFixes,
        dialect: dialectHeader ?? undefined,
      }),
      existingDetails,
    );
  }

  const wasBroken = state.lastStatusByFile.get(filePath) === "error";
  state.lastStatusByFile.set(filePath, "clean");
  state.dialectReportedByFile.add(filePath);

  if (!wasBroken) return undefined;
  const renderedText = renderSuccessFeedback(filePath);
  return appendTextPart(
    existingContent,
    renderedText,
    buildAgentScriptMetadata({
      filePath,
      status: "clean",
      renderedText,
      diagnostics: [],
      quickFixes: [],
      dialect: dialectHeader ?? undefined,
    }),
    existingDetails,
  );
}

function appendTextPart(
  existingContent: ToolResultContentPart[],
  text: string,
  metadata: SfPiDiagnosticsMetadata,
  existingDetails: unknown,
): ToolResultUpdate {
  const textPart: ToolResultContentPart = { type: "text", text };
  return {
    content: [...existingContent, textPart],
    details: mergeSfPiDiagnosticsDetails(existingDetails, metadata),
  };
}

function fixPreviewText(value: string): string {
  if (value.length === 0) return "(delete)";
  return truncateByBytes(value.replace(/\n/g, "\\n"), 80);
}

function toFixMetadata(fix: AgentScriptQuickFix): SfPiDiagnosticFixMetadata {
  const firstEdit = fix.edits[0];
  return {
    title: fix.title,
    preferred: fix.preferred,
    diagnosticLine: fix.diagnosticLine + 1,
    diagnosticCode: fix.diagnosticCode,
    editCount: fix.edits.length,
    ...(firstEdit
      ? {
          firstEdit: {
            range: firstEdit.range,
            newTextPreview: fixPreviewText(firstEdit.newText),
          },
        }
      : {}),
  };
}

function toDiagnosticItem(
  diagnostic: AgentScriptDiagnostic,
  quickFixes: AgentScriptQuickFix[],
): SfPiDiagnosticMetadataItem {
  const fixes = fixesForDiagnostic(diagnostic, quickFixes).map(toFixMetadata);
  return {
    severity: severityFromLsp(diagnostic.severity),
    message: normalizeWhitespace(diagnostic.message),
    line: diagnostic.range.start.line + 1,
    character: diagnostic.range.start.character,
    code: diagnostic.code,
    source: diagnostic.source,
    range: diagnostic.range,
    ...(fixes.length > 0 ? { fixes } : {}),
  };
}

function buildAgentScriptMetadata(options: {
  filePath: string;
  status: SfPiDiagnosticsMetadata["status"];
  renderedText: string;
  diagnostics: AgentScriptDiagnostic[];
  quickFixes: AgentScriptQuickFix[];
  dialect?: string;
  unavailableReason?: string;
}): SfPiDiagnosticsMetadata {
  const fileName = diagnosticFileName(options.filePath);
  const diagnostics = options.diagnostics.map((diagnostic) =>
    toDiagnosticItem(diagnostic, options.quickFixes),
  );
  return {
    source: "sf-agentscript-assist",
    status: options.status,
    filePath: options.filePath,
    fileName,
    language: "agentscript",
    generatedAt: new Date().toISOString(),
    summary: buildDiagnosticsSummary({
      status: options.status,
      fileName,
      diagnostics,
      unavailableReason: options.unavailableReason,
    }),
    renderedText: options.renderedText,
    diagnostics,
    dialect: options.dialect,
    unavailableReason: options.unavailableReason,
  };
}
