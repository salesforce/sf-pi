/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Inline transcript row for sf-lsp checks.
 *
 * Uses `pi.appendEntry("sf-lsp", data)` plus `registerEntryRenderer()` so
 * the row appears in the TUI chat stream while staying OUT of the LLM
 * context. Pi custom messages are model-visible; custom entries are the
 * human-only transcript path.
 *
 * Two responsibilities:
 *   1. Decide whether to emit a row for a given sample (balanced vs verbose)
 *   2. Render the row when Pi calls our message renderer back
 */
import type { EntryRenderer, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { languageLongLabel, statusColor, type LspActivityStatus } from "./activity.ts";
import type { SupportedLanguage } from "./types.ts";

export const LSP_TRANSCRIPT_CUSTOM_TYPE = "sf-lsp";

export interface LspTranscriptDetails {
  language: SupportedLanguage;
  fileName: string;
  status: LspActivityStatus;
  diagnosticCount: number;
  durationMs?: number;
  unavailableReason?: string;
  previewLines?: string[];
}

export interface LspTranscriptEntry {
  content: string;
  details: LspTranscriptDetails;
}

export type VerbosityMode = "balanced" | "verbose";

/**
 * Decide whether to send a transcript row for this sample under the
 * current verbosity setting.
 *
 * balanced: emit on error + transition-clean + unavailable (first time)
 * verbose : emit on every check
 */
export function shouldEmitTranscriptRow(
  status: LspActivityStatus,
  mode: VerbosityMode,
  previousUnavailableSeen: boolean,
): boolean {
  if (mode === "verbose") return true;
  if (status === "error") return true;
  if (status === "transition-clean") return true;
  if (status === "unavailable" && !previousUnavailableSeen) return true;
  return false;
}

export function emitTranscriptRow(pi: ExtensionAPI, details: LspTranscriptDetails): void {
  pi.appendEntry<LspTranscriptEntry>(LSP_TRANSCRIPT_CUSTOM_TYPE, {
    content: buildPlainContent(details),
    details,
  });
}

function buildPlainContent(details: LspTranscriptDetails): string {
  const language = languageLongLabel(details.language);
  switch (details.status) {
    case "error":
      return `${language} · ${details.fileName} · ${details.diagnosticCount} error${
        details.diagnosticCount === 1 ? "" : "s"
      }`;
    case "clean":
    case "transition-clean":
      return `${language} · ${details.fileName} · clean`;
    case "unavailable":
      return `${language} · LSP unavailable`;
    case "checking":
      return `${language} · checking ${details.fileName}`;
    case "idle":
    default:
      return `${language} · ${details.fileName}`;
  }
}

/**
 * Renderer callback. Must return a pi-tui Component. Stays pure — all theme
 * colors are reapplied via `theme.fg` at render time so theme changes pick
 * up correctly (see tui.md "Invalidation and Theme Changes").
 */
export function createTranscriptRenderer(): EntryRenderer<LspTranscriptEntry> {
  return (entry, options, theme) => {
    const details = entry.data?.details;
    const status = details?.status ?? "idle";
    const color = statusColor(status);
    const plainContent = entry.data?.content ?? "";

    const parts: string[] = [];
    parts.push(theme.fg(color, "[sf-lsp]"));
    parts.push(theme.fg("text", plainContent));

    if (details?.durationMs !== undefined) {
      parts.push(theme.fg("dim", `· ${formatDurationForRow(details.durationMs)}`));
    }

    let text = parts.join(" ");

    if (options.expanded) {
      text += renderExpandedBody(details, theme);
    } else if (details?.status === "error" && details.diagnosticCount > 0) {
      text += theme.fg("dim", "\n  ▸ ctrl+e to expand");
    }

    const box = new Box(1, 0, (s) => theme.bg("customMessageBg", s));
    box.addChild(new Text(text, 0, 0));
    return box;
  };
}

function formatDurationForRow(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderExpandedBody(details: LspTranscriptDetails | undefined, theme: Theme): string {
  if (!details) return "";
  const lines: string[] = [];

  if (details.status === "error" && details.previewLines?.length) {
    for (const line of details.previewLines) {
      lines.push(`\n${theme.fg("error", "  ")}${theme.fg("text", line)}`);
    }
  }

  if (details.status === "unavailable" && details.unavailableReason) {
    lines.push(`\n${theme.fg("warning", `  ${details.unavailableReason}`)}`);
  }

  return lines.join("");
}
