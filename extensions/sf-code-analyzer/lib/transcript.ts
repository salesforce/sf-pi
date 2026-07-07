/* SPDX-License-Identifier: Apache-2.0 */
/** User-visible transcript rows for automatic Code Analyzer work. */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export const CODE_ANALYZER_TRANSCRIPT_TYPE = "sf-code-analyzer";

export interface CodeAnalyzerTranscriptDetails {
  status: "running" | "clean" | "findings" | "skipped" | "timeout" | "error" | "stopped";
  reportFile?: string;
  targetCount?: number;
  violationCount?: number;
  durationMs?: number;
}

export function registerCodeAnalyzerTranscriptRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<CodeAnalyzerTranscriptDetails>(
    CODE_ANALYZER_TRANSCRIPT_TYPE,
    (message, _options, theme) =>
      new Text(
        renderCodeAnalyzerTranscript(
          typeof message.content === "string" ? message.content : "[sf-code-analyzer]",
          message.details,
          theme,
        ),
        0,
        0,
      ),
  );
}

export function renderCodeAnalyzerTranscript(
  content: string,
  details: CodeAnalyzerTranscriptDetails | undefined,
  theme: Theme,
): string {
  const lines = content.split("\n");
  return lines.map((line, index) => styleTranscriptLine(line, index, details, theme)).join("\n");
}

export function emitCodeAnalyzerTranscript(
  pi: ExtensionAPI,
  content: string,
  details: CodeAnalyzerTranscriptDetails,
): void {
  pi.sendMessage({
    customType: CODE_ANALYZER_TRANSCRIPT_TYPE,
    content,
    display: true,
    details,
  });
}

function styleTranscriptLine(
  line: string,
  index: number,
  details: CodeAnalyzerTranscriptDetails | undefined,
  theme: Theme,
): string {
  if (index === 0) return styleTitleLine(line, details, theme);

  const match = line.match(/^(\s*)([A-Za-z][A-Za-z ]+):(\s*)(.*)$/u);
  if (!match) return theme.fg("dim", line);
  const [, indent = "", label = "", separator = "", value = ""] = match;
  return [
    theme.fg("border", indent),
    theme.fg("muted", `${label}:`),
    separator,
    styleValue(label, value, details, theme),
  ].join("");
}

function styleValue(
  label: string,
  value: string,
  details: CodeAnalyzerTranscriptDetails | undefined,
  theme: Theme,
): string {
  switch (label.toLowerCase()) {
    case "engines":
    case "target":
      return theme.fg("accent", theme.bold(value));
    case "report":
      return theme.fg("dim", value);
    case "error":
      return theme.fg("error", value);
    case "duration":
      return theme.fg("muted", value);
    case "targets":
      return details?.status === "running" ? theme.fg("accent", theme.bold(value)) : value;
    case "reason":
      return theme.fg("warning", value);
    default:
      return value;
  }
}

function styleTitleLine(
  line: string,
  details: CodeAnalyzerTranscriptDetails | undefined,
  theme: Theme,
): string {
  const statusColor = titleStatusColor(details?.status);
  if (line.includes("Code Analyzer")) {
    const [prefix = "", rest = ""] = line.split("Code Analyzer", 2);
    return [
      theme.fg(statusColor, prefix),
      theme.fg("toolTitle", theme.bold("Code Analyzer")),
      theme.fg(statusColor, rest),
    ].join("");
  }
  if (line.includes("ApexGuru")) {
    const [prefix = "", rest = ""] = line.split("ApexGuru", 2);
    return [
      theme.fg(statusColor, prefix),
      theme.fg("toolTitle", theme.bold("ApexGuru")),
      theme.fg(statusColor, rest),
    ].join("");
  }
  return theme.fg(statusColor, line);
}

function titleStatusColor(
  status: CodeAnalyzerTranscriptDetails["status"] | undefined,
): "success" | "warning" | "error" | "muted" {
  if (status === "clean") return "success";
  if (status === "findings" || status === "running" || status === "timeout") return "warning";
  if (status === "error") return "error";
  return "muted";
}
