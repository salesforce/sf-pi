/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "../../../lib/common/pi-sdk-compat.ts";
import type { SfPiToolResultEnvelope } from "../../../lib/common/display/types.ts";

export type D360OutputMode = "inline" | "summary" | "file_only";

export interface D360TruncatedOutput {
  text: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
  outputMode?: D360OutputMode;
}

export const D360_OUTPUT_SUFFIX =
  ` Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} ` +
  `(whichever is hit first). If truncated, the full output is saved to a temp file. ` +
  `Use output_mode:'summary' or output_mode:'file_only' for broad responses.`;

export async function formatD360Output(
  text: string,
  outputMode: D360OutputMode = "inline",
): Promise<D360TruncatedOutput> {
  if (outputMode === "summary") return summarizeD360Output(text);
  if (outputMode === "file_only") return fileOnlyD360Output(text);
  return truncateD360Output(text);
}

export async function truncateD360Output(text: string): Promise<D360TruncatedOutput> {
  const truncation = truncateHead(text);
  if (!truncation.truncated) return { text: truncation.content, outputMode: "inline" };

  const fullOutputPath = await writeFullD360Output(text);

  return {
    text: `${truncation.content}\n\n${buildTruncationNote(truncation, fullOutputPath)}`,
    truncation,
    fullOutputPath,
    outputMode: "inline",
  };
}

export async function writeFullD360Output(text: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-d360-"));
  const fullOutputPath = join(tempDir, "output.json");

  await withFileMutationQueue(fullOutputPath, async () => {
    await writeFile(fullOutputPath, text, "utf8");
  });

  return fullOutputPath;
}

async function summarizeD360Output(text: string): Promise<D360TruncatedOutput> {
  const fullOutputPath = await writeFullD360Output(text);
  return {
    text: buildSummaryText(text, fullOutputPath),
    fullOutputPath,
    outputMode: "summary",
  };
}

async function fileOnlyD360Output(text: string): Promise<D360TruncatedOutput> {
  const fullOutputPath = await writeFullD360Output(text);
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    text: `Data 360 response saved to ${fullOutputPath} (${formatSize(bytes)}).`,
    fullOutputPath,
    outputMode: "file_only",
  };
}

export function buildSummaryText(text: string, fullOutputPath: string): string {
  const bytes = Buffer.byteLength(text, "utf8");
  const lines = [
    `Data 360 response summary (${formatSize(bytes)}).`,
    `Full output: ${fullOutputPath}`,
  ];
  const parsed = parseJson(text);

  if (Array.isArray(parsed)) {
    lines.push(`Shape: JSON array (${parsed.length} items).`);
    appendSampleRows(lines, parsed);
    return lines.join("\n");
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj);
    lines.push(`Top-level keys: ${keys.length ? keys.join(", ") : "(none)"}.`);
    for (const key of keys) {
      appendKeySummary(lines, key, obj[key]);
    }
    return lines.join("\n");
  }

  const preview = text.trim().split(/\r?\n/).slice(0, 10).join("\n");
  lines.push("Shape: non-JSON response.");
  if (preview) lines.push("Preview:", preview);
  return lines.join("\n");
}

function appendKeySummary(lines: string[], key: string, value: unknown): void {
  if (Array.isArray(value)) {
    lines.push(`- ${key}: array (${value.length} items)`);
    appendSampleRows(lines, value, `  `);
    return;
  }
  if (value && typeof value === "object") {
    const nested = value as Record<string, unknown>;
    const hints = ["totalSize", "total", "count", "done"]
      .filter((hint) => nested[hint] !== undefined)
      .map((hint) => `${hint}=${String(nested[hint])}`);
    const nestedKeys = Object.keys(nested);
    lines.push(
      `- ${key}: object (${hints.length ? hints.join(", ") : `${nestedKeys.length} keys`})`,
    );
    return;
  }
  lines.push(`- ${key}: ${value === null ? "null" : typeof value}`);
}

function appendSampleRows(lines: string[], rows: unknown[], indent = ""): void {
  const samples = rows.slice(0, 5).map(describeSampleRow).filter(Boolean);
  if (samples.length > 0) lines.push(`${indent}Sample: ${samples.join("; ")}`);
}

function describeSampleRow(row: unknown): string {
  if (!row || typeof row !== "object") return String(row);
  const obj = row as Record<string, unknown>;
  const errorCode = firstString(obj, ["errorCode", "code"]);
  const message = firstString(obj, ["message", "errorMessage"]);
  if (errorCode && message) return `${errorCode}: ${truncateOneLine(message, 180)}`;

  const label = firstString(obj, ["displayName", "label", "name", "id"]);
  const apiName = firstString(obj, ["name"]);
  if (label && apiName && label !== apiName) return `${label} (${apiName})`;
  return label ?? truncateOneLine(JSON.stringify(obj), 180);
}

function truncateOneLine(value: string, maxChars: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > maxChars ? `${oneLine.slice(0, maxChars - 1)}…` : oneLine;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key]) return obj[key] as string;
  }
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function buildTruncationNote(truncation: TruncationResult, fullOutputPath: string): string {
  return (
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `Full output saved to: ${fullOutputPath}]`
  );
}

/**
 * Build the shared `details.sfPi` envelope (see
 * `lib/common/display/types.ts > SfPiToolResultEnvelope`) for a Data 360
 * tool result. Centralizing this here keeps the three d360 tools
 * (api/metadata/probe) shipping the same shape so renderers and
 * downstream tooling can read `details.sfPi.summary`, `truncation`, and
 * `data` without per-tool branches.
 */
export function buildD360Envelope(
  action: string,
  ok: boolean,
  text: string,
  details: Record<string, unknown>,
  output?: D360TruncatedOutput,
): SfPiToolResultEnvelope {
  const summary = pickSummary(details, text);
  const envelope: SfPiToolResultEnvelope = {
    ok,
    action,
    summary,
  };

  if (output?.truncation) {
    envelope.truncation = {
      truncated: output.truncation.truncated,
      outputLines: output.truncation.outputLines,
      totalLines: output.truncation.totalLines,
      outputBytes: output.truncation.outputBytes,
      totalBytes: output.truncation.totalBytes,
      ...(output.fullOutputPath ? { fullOutputPath: output.fullOutputPath } : {}),
    };
  } else if (output?.fullOutputPath) {
    envelope.truncation = {
      truncated: false,
      fullOutputPath: output.fullOutputPath,
    };
  }

  return envelope;
}

function pickSummary(details: Record<string, unknown>, fallback: string): string | undefined {
  if (typeof details.summary === "string" && details.summary.trim()) {
    return details.summary.trim();
  }
  const firstLine = fallback
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;
  return firstLine.length > 240 ? `${firstLine.slice(0, 237)}\u2026` : firstLine;
}
