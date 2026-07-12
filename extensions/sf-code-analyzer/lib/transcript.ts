/* SPDX-License-Identifier: Apache-2.0 */
/** User-visible transcript rows for automatic Code Analyzer work. */
import path from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  renderSfPiNoticeCardText,
  renderSfPiNoticePanel,
  renderSfPiResultCardText,
  type SfPiArtifact,
  type SfPiCardStatus,
  type SfPiChip,
  type SfPiFact,
  type SfPiNoticeCard,
  type SfPiResultCard,
} from "../../../lib/common/display/result-card.ts";

export const CODE_ANALYZER_TRANSCRIPT_TYPE = "sf-code-analyzer";

export interface CodeAnalyzerTranscriptDetails {
  status: "running" | "clean" | "findings" | "skipped" | "timeout" | "error" | "stopped";
  reportFile?: string;
  targetCount?: number;
  violationCount?: number;
  durationMs?: number;
  selectors?: string[];
  targetFiles?: string[];
}

export function registerCodeAnalyzerTranscriptRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<CodeAnalyzerTranscriptDetails>(
    CODE_ANALYZER_TRANSCRIPT_TYPE,
    (message, _options, theme) => {
      const content = typeof message.content === "string" ? message.content : "[sf-code-analyzer]";
      const notice = transcriptNotice(content, message.details);
      if (notice) return renderSfPiNoticePanel(notice, theme);
      return new Text(renderCodeAnalyzerTranscript(content, message.details, theme), 0, 0);
    },
  );
}

export function renderCodeAnalyzerTranscript(
  content: string,
  details: CodeAnalyzerTranscriptDetails | undefined,
  theme: Theme,
): string {
  const notice = transcriptNotice(content, details);
  if (notice) return renderSfPiNoticeCardText(notice, theme);

  const card = transcriptCard(content, details);
  if (card)
    return renderSfPiResultCardText(card, { expanded: details?.status !== "running" }, theme);

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

function transcriptNotice(
  content: string,
  details: CodeAnalyzerTranscriptDetails | undefined,
): SfPiNoticeCard | undefined {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  if (
    !firstLine.includes("Code Analyzer Auto-scan") &&
    !firstLine.includes("Code Analyzer auto-scan")
  ) {
    return undefined;
  }

  const labels = parseLabelRows(content);
  const status = cardStatus(details?.status);
  const targetLabel = labels.get("targets");
  const engineLabel = labels.get("engines");
  const targetCount = details?.targetCount ?? numberFromText(targetLabel);
  const violationCount = details?.violationCount ?? numberFromText(content);
  const reportFile = reportFromContent(content) ?? labels.get("report") ?? details?.reportFile;
  const duration = labels.get("duration") ?? formatMs(details?.durationMs);
  const selectors = details?.selectors ?? (engineLabel ? [engineLabel] : []);
  const targetFiles = details?.targetFiles ?? targetFilesFromContent(content);
  const groups: SfPiNoticeCard["groups"] = [
    {
      title: "Scope",
      rows: [
        { label: "Tool", value: labels.get("tool") ?? "Local Salesforce Code Analyzer CLI" },
        { label: "Engines", value: selectors.join(", ") || "Code Analyzer", tone: "info" },
        ...(targetLabel
          ? [{ label: "Targets", value: targetLabel }]
          : targetCount !== undefined
            ? [
                {
                  label: "Targets",
                  value: `${targetCount} changed file${targetCount === 1 ? "" : "s"}`,
                },
              ]
            : []),
        ...(duration ? [{ label: "Duration", value: duration }] : []),
      ],
    },
    {
      title: "Reasoning",
      rows: selectorReasonRows(selectors),
    },
    ...(targetFiles.length
      ? [
          {
            title: "Files",
            rows: targetFiles
              .slice(0, 5)
              .map((file) => ({ label: "•", value: shortFilePath(file) })),
          },
        ]
      : []),
    ...(targetFiles.length > 5
      ? [
          {
            title: "More files",
            rows: [
              {
                label: "hidden",
                value: `+${targetFiles.length - 5} more file${targetFiles.length - 5 === 1 ? "" : "s"}`,
              },
            ],
          },
        ]
      : []),
    ...(reportFile
      ? [
          {
            title: "Evidence",
            rows: [{ label: "Report", value: reportFile, multiline: true }],
          },
        ]
      : []),
  ];
  return {
    icon: "🧪",
    title: "Code Analyzer Auto-scan",
    status,
    statusText: noticeStatusText(details?.status, violationCount),
    duration,
    groups,
    footer: noticeFooter(details?.status, violationCount),
  };
}

function transcriptCard(
  content: string,
  details: CodeAnalyzerTranscriptDetails | undefined,
): SfPiResultCard | undefined {
  const labels = parseLabelRows(content);
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes("Code Analyzer auto-scan"))
    return localAutoScanCard(firstLine, labels, details);
  if (firstLine.includes("ApexGuru auto insight"))
    return apexGuruAutoInsightCard(firstLine, labels, details);
  return undefined;
}

function localAutoScanCard(
  firstLine: string,
  labels: Map<string, string>,
  details: CodeAnalyzerTranscriptDetails | undefined,
): SfPiResultCard {
  const status = cardStatus(details?.status);
  const targetCount = details?.targetCount ?? numberFromText(labels.get("targets"));
  const violationCount = details?.violationCount ?? numberFromText(firstLine);
  const reportFile = details?.reportFile ?? labels.get("report");
  const artifacts: SfPiArtifact[] = reportFile
    ? [{ label: "report", path: reportFile, kind: "json" }]
    : [];
  const engineLabel = labels.get("engines");
  const durationLabel = labels.get("duration");
  const targetLabel = labels.get("targets");
  const chips: SfPiChip[] = [
    ...(engineLabel ? [{ label: engineLabel, tone: "info" as const }] : []),
    ...(targetCount !== undefined
      ? [
          {
            label: `${targetCount} changed file${targetCount === 1 ? "" : "s"}`,
            tone: "muted" as const,
          },
        ]
      : []),
    ...(durationLabel ? [{ label: durationLabel, tone: "muted" as const }] : []),
  ];
  const scope: SfPiFact[] = [
    { label: "tool", value: labels.get("tool") ?? "Local Salesforce Code Analyzer CLI" },
    ...(engineLabel ? [{ label: "engines", value: engineLabel, tone: "info" as const }] : []),
    ...(targetLabel
      ? [
          {
            label: "targets",
            value: targetLabel,
            tone: status === "running" ? ("info" as const) : ("muted" as const),
          },
        ]
      : []),
    ...(durationLabel ? [{ label: "duration", value: durationLabel }] : []),
  ];
  return {
    tool: { id: "sf-code-analyzer", label: "Code Analyzer", icon: "🧪" },
    title: "Auto-scan",
    status,
    summary: localAutoScanSummary(details?.status, violationCount),
    chips,
    scope,
    sections:
      status === "running"
        ? [
            {
              title: "Human-in-loop signal",
              icon: "👁",
              rows: [
                { label: "state", value: "running after agent edits", tone: "info" },
                { label: "context", value: "full report will stay as an artifact" },
              ],
              collapsedLimit: 2,
            },
          ]
        : undefined,
    artifacts,
    next: localAutoScanNext(details?.status, violationCount),
    renderHints: { collapsedLines: details?.status === "running" ? 10 : 14, expandedMaxLines: 40 },
  };
}

function apexGuruAutoInsightCard(
  firstLine: string,
  labels: Map<string, string>,
  details: CodeAnalyzerTranscriptDetails | undefined,
): SfPiResultCard {
  const reportFile = details?.reportFile ?? labels.get("report");
  const targetLabel = labels.get("target");
  const durationLabel = labels.get("duration");
  const chips: SfPiChip[] = [
    ...(targetLabel ? [{ label: targetLabel, tone: "info" as const }] : []),
    ...(durationLabel ? [{ label: durationLabel, tone: "muted" as const }] : []),
  ];
  return {
    tool: { id: "sf-code-analyzer", label: "ApexGuru", icon: "✨" },
    title: "Auto insight",
    status: cardStatus(details?.status),
    summary: firstLine.replace(/^[^A-Za-z]*\s*/u, ""),
    chips,
    scope: [...labels.entries()]
      .filter(([label]) => label !== "report")
      .map(([label, value]) => ({ label, value })),
    artifacts: reportFile ? [{ label: "report", path: reportFile, kind: "json" }] : undefined,
    next: [details?.status === "findings" ? "review findings before changing Apex" : "continue"],
  };
}

function selectorReasonRows(selectors: string[]): SfPiFact[] {
  if (selectors.includes("eslint:Recommended")) {
    return [
      { label: "Selected", value: "JS/TS changed file → eslint:Recommended", tone: "info" },
      { label: "Others", value: "PMD/Flow/SFGE skipped; no Apex or Flow file in this scan group" },
    ];
  }
  if (selectors.includes("pmd:Recommended")) {
    return [
      { label: "Selected", value: "Apex changed file → pmd:Recommended", tone: "info" },
      { label: "Others", value: "ESLint/Flow skipped; no JS/TS or Flow file in this scan group" },
    ];
  }
  if (selectors.includes("flow:Recommended")) {
    return [
      { label: "Selected", value: "Flow metadata changed file → flow:Recommended", tone: "info" },
      { label: "Others", value: "ESLint/PMD skipped; no JS/TS or Apex file in this scan group" },
    ];
  }
  return selectors.length
    ? selectors.map((selector) => ({
        label: "Selected",
        value: `${selector} matched changed file type`,
      }))
    : [{ label: "Selected", value: "selector chosen from changed file type" }];
}

function targetFilesFromContent(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:│\s*)?•\s+(.*)$/u)?.[1]?.trim())
    .filter((file): file is string => Boolean(file && !file.startsWith("+")));
}

function shortFilePath(filePath: string): string {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep).filter(Boolean);
  if (parts.length <= 4) return normalized;
  return `…/${parts.slice(-4).join("/")}`;
}

function noticeStatusText(
  status: CodeAnalyzerTranscriptDetails["status"] | undefined,
  violationCount: number | undefined,
): string {
  if (status === "running") return "Running";
  if (status === "clean") return "Clean";
  if (status === "findings") return `Findings (${violationCount ?? 0})`;
  if (status === "error") return "Error";
  return "Status";
}

function noticeFooter(
  status: CodeAnalyzerTranscriptDetails["status"] | undefined,
  violationCount: number | undefined,
): string {
  if (status === "running") return "Report will appear when complete";
  if (status === "clean") return "No action needed";
  if (status === "findings" && (violationCount ?? 0) > 0) return "Review report before continuing";
  return "Inspect diagnostics and rerun if needed";
}

function reportFromContent(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const inline = line.match(/^\s*(?:[│├╰]\s*)?Report:\s*(.*)$/u)?.[1]?.trim();
    if (inline) return inline;
    if (/^\s*│?\s*Report\s*$/u.test(line)) {
      const next = lines[index + 1]?.replace(/^\s*│?\s*/u, "").trim();
      if (next) return next;
    }
  }
  return undefined;
}

function formatMs(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function parseLabelRows(content: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const groupedMatch = line.match(/^\s*(?:│\s*)?([A-Za-z][A-Za-z ]+?)\s{2,}(.*)$/u);
    if (groupedMatch?.[1] !== undefined && groupedMatch[2] !== undefined) {
      labels.set(groupedMatch[1].trim().toLowerCase(), groupedMatch[2].trim());
      continue;
    }

    const colonMatch = line.match(/^\s*(?:[│├╰]\s*)?([A-Za-z][A-Za-z ]+):\s*(.*)$/u);
    if (colonMatch?.[1] === undefined || colonMatch[2] === undefined) continue;
    labels.set(colonMatch[1].trim().toLowerCase(), colonMatch[2].trim());
  }
  return labels;
}

function cardStatus(status: CodeAnalyzerTranscriptDetails["status"] | undefined): SfPiCardStatus {
  if (status === "running") return "running";
  if (status === "clean") return "success";
  if (status === "findings" || status === "timeout") return "warning";
  if (status === "error") return "error";
  return "info";
}

function localAutoScanSummary(
  status: CodeAnalyzerTranscriptDetails["status"] | undefined,
  violationCount: number | undefined,
): string {
  if (status === "running") return "Readiness-gated local scan is running after agent edits.";
  if (status === "clean") return "Deferred scan completed cleanly; no action required.";
  if (status === "findings") {
    return `Deferred scan found ${violationCount ?? 0} finding${violationCount === 1 ? "" : "s"}; review before moving on.`;
  }
  return "Deferred scan needs attention.";
}

function localAutoScanNext(
  status: CodeAnalyzerTranscriptDetails["status"] | undefined,
  violationCount: number | undefined,
): string[] {
  if (status === "running") return ["wait for the clean/findings card before acting"];
  if (status === "clean") return ["continue"];
  if (status === "findings" && (violationCount ?? 0) > 0) {
    return ["inspect the report or ask the agent to summarize last_report"];
  }
  return ["inspect diagnostics and rerun if needed"];
}

function numberFromText(value: string | undefined): number | undefined {
  const raw = value?.match(/\d+/u)?.[0];
  return raw ? Number(raw) : undefined;
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
