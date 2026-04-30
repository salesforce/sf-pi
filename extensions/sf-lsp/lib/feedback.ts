/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Red/green decision logic and feedback rendering for sf-lsp.
 *
 * Converts LSP results into advisory text appended to tool results:
 * - Error diagnostics → always appended
 * - Clean file → only appended when the file previously had errors
 * - Unavailable LSP → noted once per language per session
 */

import path from "node:path";
import type { ToolResultEvent } from "@mariozechner/pi-coding-agent";
import {
  buildDiagnosticsSummary,
  diagnosticFileName,
  mergeSfPiDiagnosticsDetails,
  severityFromLsp,
  type SfPiDiagnosticMetadataItem,
  type SfPiDiagnosticsMetadata,
} from "../../../lib/common/display/diagnostics.ts";
import type { LspDiagnostic, LspDoctorStatus, SupportedLanguage } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

/**
 * One item from Pi's tool result `content` array.
 */
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

/**
 * Remembered per-file status.
 */
export type SfLspFileStatus = "clean" | "error";

/**
 * In-memory state for one Pi session.
 */
export interface SfLspState {
  lastStatusByFile: Map<string, SfLspFileStatus>;
  reportedUnavailableByLanguage: Set<SupportedLanguage>;
}

/**
 * Minimal LSP result shape used by the decision logic.
 */
export interface SfLspCheckResult {
  diagnostics: LspDiagnostic[];
  unavailable?: LspDoctorStatus;
}

interface BuildToolResultUpdateOptions {
  filePath: string;
  language: SupportedLanguage;
  existingContent: ToolResultContentPart[];
  existingDetails?: unknown;
  lspResult: SfLspCheckResult;
  state: SfLspState;
}

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const MAX_RENDERED_FEEDBACK_BYTES = 8 * 1024;
const MAX_UNAVAILABLE_REASON_BYTES = 400;
const MAX_SINGLE_DIAGNOSTIC_BYTES = 240;

// -------------------------------------------------------------------------------------------------
// State management
// -------------------------------------------------------------------------------------------------

/**
 * Create a new empty session state object.
 */
export function createState(): SfLspState {
  return {
    lastStatusByFile: new Map<string, SfLspFileStatus>(),
    reportedUnavailableByLanguage: new Set<SupportedLanguage>(),
  };
}

/**
 * Clear all remembered state.
 */
export function resetState(state: SfLspState): void {
  state.lastStatusByFile.clear();
  state.reportedUnavailableByLanguage.clear();
}

// -------------------------------------------------------------------------------------------------
// Red/green decision logic
// -------------------------------------------------------------------------------------------------

/**
 * Convert an LSP result into a tool result update (or undefined to skip).
 *
 * Rules:
 * - Unavailable note: once per language per session
 * - Error diagnostics: always append
 * - Clean result: only append when the file previously had an error
 */
export function buildToolResultUpdate(
  options: BuildToolResultUpdateOptions,
): ToolResultUpdate | undefined {
  const { existingContent, existingDetails, filePath, language, lspResult, state } = options;

  if (lspResult.unavailable) {
    if (state.reportedUnavailableByLanguage.has(language)) {
      return undefined;
    }

    state.reportedUnavailableByLanguage.add(language);
    const renderedText = renderUnavailableFeedback(language, lspResult.unavailable.detail);
    return appendTextPart(
      existingContent,
      renderedText,
      buildSfLspMetadata({
        filePath,
        language,
        status: "unavailable",
        renderedText,
        diagnostics: [],
        unavailableReason: lspResult.unavailable.detail,
      }),
      existingDetails,
    );
  }

  const errorDiagnostics = getErrorDiagnostics(lspResult.diagnostics);

  if (errorDiagnostics.length > 0) {
    state.lastStatusByFile.set(filePath, "error");
    const renderedText = renderErrorFeedback(filePath, errorDiagnostics);
    return appendTextPart(
      existingContent,
      renderedText,
      buildSfLspMetadata({
        filePath,
        language,
        status: "error",
        renderedText,
        diagnostics: errorDiagnostics,
      }),
      existingDetails,
    );
  }

  const previousFileStatus = state.lastStatusByFile.get(filePath);
  state.lastStatusByFile.set(filePath, "clean");

  if (previousFileStatus !== "error") {
    return undefined;
  }

  const renderedText = renderSuccessFeedback(filePath);
  return appendTextPart(
    existingContent,
    renderedText,
    buildSfLspMetadata({
      filePath,
      language,
      status: "clean",
      renderedText,
      diagnostics: [],
    }),
    existingDetails,
  );
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

/**
 * Add one text item to the existing tool result content array.
 */
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

function normalizeDiagnosticCode(code: string | number | undefined): string | undefined {
  return code === undefined ? undefined : String(code);
}

function toSfPiDiagnosticItem(diagnostic: LspDiagnostic): SfPiDiagnosticMetadataItem {
  return {
    severity: severityFromLsp(diagnostic.severity ?? 1),
    message: normalizeWhitespace(diagnostic.message),
    line: diagnostic.range.start.line + 1,
    character: diagnostic.range.start.character,
    code: normalizeDiagnosticCode(diagnostic.code),
    source: diagnostic.source,
    range: diagnostic.range,
  };
}

function buildSfLspMetadata(options: {
  filePath: string;
  language: SupportedLanguage;
  status: SfPiDiagnosticsMetadata["status"];
  renderedText: string;
  diagnostics: LspDiagnostic[];
  unavailableReason?: string;
}): SfPiDiagnosticsMetadata {
  const fileName = diagnosticFileName(options.filePath);
  const diagnostics = options.diagnostics.map(toSfPiDiagnosticItem);
  return {
    source: "sf-lsp",
    status: options.status,
    filePath: options.filePath,
    fileName,
    language: options.language,
    generatedAt: new Date().toISOString(),
    summary: buildDiagnosticsSummary({
      status: options.status,
      fileName,
      diagnostics,
      unavailableReason: options.unavailableReason,
    }),
    renderedText: options.renderedText,
    diagnostics,
    unavailableReason: options.unavailableReason,
  };
}

/**
 * Keep only severity-1 (Error) diagnostics.
 */
function getErrorDiagnostics(diagnostics: LspDiagnostic[]): LspDiagnostic[] {
  return diagnostics.filter((diagnostic) => (diagnostic.severity ?? 1) === 1);
}

// -------------------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------------------

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }

  let truncated = "";
  for (const character of value) {
    const nextValue = `${truncated}${character}`;
    if (Buffer.byteLength(nextValue, "utf8") > maxBytes - 3) {
      break;
    }
    truncated = nextValue;
  }
  return `${truncated}...`;
}

function getLanguageLabel(language: SupportedLanguage): string {
  switch (language) {
    case "agentscript":
      return "Agent Script";
    case "apex":
      return "Apex";
    case "lwc":
      return "LWC";
  }
}

function sortDiagnosticsByLocation(left: LspDiagnostic, right: LspDiagnostic): number {
  if (left.range.start.line !== right.range.start.line) {
    return left.range.start.line - right.range.start.line;
  }
  return left.range.start.character - right.range.start.character;
}

function renderSingleDiagnostic(diagnostic: LspDiagnostic): string {
  const lineNumber = diagnostic.range.start.line + 1;
  const cleanMessage = normalizeWhitespace(diagnostic.message);
  const shortMessage = truncateByBytes(cleanMessage, MAX_SINGLE_DIAGNOSTIC_BYTES);
  return `- L${lineNumber}: ${shortMessage}`;
}

/**
 * Tiny success note used only when a previously failing file becomes clean.
 */
export function renderSuccessFeedback(filePath: string): string {
  return `LSP now clean: ${path.basename(filePath)}`;
}

/**
 * Render a readable error block for a file.
 */
export function renderErrorFeedback(filePath: string, diagnostics: LspDiagnostic[]): string {
  const sortedDiagnostics = [...diagnostics].sort(sortDiagnosticsByLocation);
  const header = `LSP feedback: ${path.basename(filePath)}`;
  const lines = [header];

  let bytesUsed = Buffer.byteLength(header, "utf8");
  let renderedCount = 0;

  for (const diagnostic of sortedDiagnostics) {
    const line = renderSingleDiagnostic(diagnostic);
    const bytesForLine = Buffer.byteLength(`\n${line}`, "utf8");

    if (bytesUsed + bytesForLine > MAX_RENDERED_FEEDBACK_BYTES) {
      break;
    }

    lines.push(line);
    bytesUsed += bytesForLine;
    renderedCount += 1;
  }

  const omittedCount = sortedDiagnostics.length - renderedCount;
  if (omittedCount > 0) {
    lines.push(`(+${omittedCount} more)`);
  }

  return lines.join("\n");
}

/**
 * Render the one-time setup note when an LSP is unavailable.
 */
export function renderUnavailableFeedback(language: SupportedLanguage, detail: string): string {
  const languageLabel = getLanguageLabel(language);
  const cleanDetail = normalizeWhitespace(detail);
  const shortDetail = truncateByBytes(cleanDetail, MAX_UNAVAILABLE_REASON_BYTES);
  return `LSP setup note: ${languageLabel} LSP is unavailable. Reason: ${shortDetail} I can help install or configure it if needed.`;
}

/**
 * Render the `/sf-lsp doctor` report.
 */
export function renderDoctorReport(statuses: LspDoctorStatus[]): string {
  const lines = ["Salesforce LSP doctor", ""];

  for (const status of statuses) {
    const marker = status.available ? "✅" : "❌";
    const sourceSuffix = status.source ? ` (${status.source})` : "";
    lines.push(`${marker} ${getLanguageLabel(status.language)}${sourceSuffix}: ${status.detail}`);

    if (status.command) {
      lines.push(`    command: ${status.command}`);
    }
  }

  return lines.join("\n");
}
