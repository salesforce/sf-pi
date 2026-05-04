/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateTail,
  type TruncationResult,
  withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import type { SfPiToolResultEnvelope } from "../../../lib/common/display/types.ts";

export type SlackTruncationStrategy = "head" | "tail";

export interface SlackTruncatedText {
  text: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export type SlackTruncatedDetails<TDetails extends Record<string, unknown>> = TDetails & {
  sfPi: SfPiToolResultEnvelope;
  truncation?: TruncationResult;
  fullOutputPath?: string;
};

export const SLACK_OUTPUT_DESCRIPTION_SUFFIX =
  ` Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} ` +
  `(whichever is hit first). If truncated, the full output is saved to a temp file.`;

export async function truncateSlackText(
  text: string,
  options: { strategy?: SlackTruncationStrategy; prefix?: string } = {},
): Promise<SlackTruncatedText> {
  const strategy = options.strategy ?? "head";
  const prefix = options.prefix ?? "pi-slack";
  const truncation = strategy === "tail" ? truncateTail(text) : truncateHead(text);

  if (!truncation.truncated) {
    return { text: truncation.content };
  }

  const tempDir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const fullOutputPath = join(tempDir, "output.txt");

  await withFileMutationQueue(fullOutputPath, async () => {
    // Intentional local spillover for truncated tool output. The path is a
    // fresh mkdtemp directory and is only shown to the authenticated local user.
    // codeql[js/http-to-file-access]
    await writeFile(fullOutputPath, text, "utf8");
  });

  const note = buildTruncationNote(truncation, fullOutputPath);
  const separator = truncation.content ? "\n\n" : "";

  return {
    text: `${truncation.content}${separator}${note}`,
    truncation,
    fullOutputPath,
  };
}

export async function buildSlackTextResult<TDetails extends Record<string, unknown>>(
  text: string,
  details: TDetails,
  options: { strategy?: SlackTruncationStrategy; prefix?: string } = {},
): Promise<{
  content: [{ type: "text"; text: string }];
  details: SlackTruncatedDetails<TDetails>;
}> {
  const truncated = await truncateSlackText(text, options);

  return {
    content: [{ type: "text", text: truncated.text }],
    details: {
      ...details,
      sfPi: buildSfPiEnvelope(text, details, truncated),
      ...(truncated.truncation ? { truncation: truncated.truncation } : {}),
      ...(truncated.fullOutputPath ? { fullOutputPath: truncated.fullOutputPath } : {}),
    } as SlackTruncatedDetails<TDetails>,
  };
}

function buildSfPiEnvelope<TDetails extends Record<string, unknown>>(
  sourceText: string,
  details: TDetails,
  truncated: SlackTruncatedText,
): SfPiToolResultEnvelope {
  const action = typeof details.action === "string" ? details.action : undefined;
  const summary =
    typeof details.summary === "string"
      ? details.summary
      : sourceText
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0)
          ?.slice(0, 240);

  return {
    ok: details.ok !== false,
    action,
    summary,
    truncation: truncated.truncation
      ? {
          truncated: true,
          outputLines: truncated.truncation.outputLines,
          totalLines: truncated.truncation.totalLines,
          outputBytes: truncated.truncation.outputBytes,
          totalBytes: truncated.truncation.totalBytes,
          fullOutputPath: truncated.fullOutputPath,
        }
      : undefined,
  };
}

function buildTruncationNote(truncation: TruncationResult, fullOutputPath: string): string {
  if (truncation.firstLineExceedsLimit) {
    return `[Output truncated: first line exceeds ${formatSize(truncation.maxBytes)}. Full output saved to: ${fullOutputPath}]`;
  }

  const omittedLines = Math.max(0, truncation.totalLines - truncation.outputLines);
  const omittedBytes = Math.max(0, truncation.totalBytes - truncation.outputBytes);
  const partialNote = truncation.lastLinePartial
    ? " Output ends mid-line due to the byte limit."
    : "";

  return (
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `${omittedLines} lines (${formatSize(omittedBytes)}) omitted.${partialNote} ` +
    `Full output saved to: ${fullOutputPath}]`
  );
}
