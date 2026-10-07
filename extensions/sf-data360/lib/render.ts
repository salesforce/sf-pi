/* SPDX-License-Identifier: Apache-2.0 */
/** Rich Data 360 Run Card rendering for the single sf_data360 tool. */
import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Data360Namespace, SfData360Input } from "./actions/action-types.ts";
import { buildData360Digest, namespacePresentation } from "./digest.ts";
import type { Data360RunDigest, Data360RunSection } from "./types.ts";

interface ToolResult {
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, unknown> & { digest?: Data360RunDigest };
}

export function namespaceIcon(namespace: Data360Namespace): string {
  return namespacePresentation(namespace).icon;
}

export function renderSfData360Call(input: SfData360Input, theme: Theme): Text {
  const namespace = namespaceForAction(input.action);
  const presentation = namespacePresentation(namespace);
  const scope = subject(input.params) ?? input.target_org;
  const mode = input.dry_run ? " · dry-run" : input.output_mode ? ` · ${input.output_mode}` : "";
  return new Text(
    theme.fg("toolTitle", theme.bold(`${presentation.icon} SF Data 360 `)) +
      theme.fg("muted", input.action) +
      (scope ? theme.fg("dim", ` · ${scope}`) : "") +
      (mode ? theme.fg(input.dry_run ? "warning" : "dim", mode) : ""),
    0,
    0,
  );
}

export function renderSfData360Result(
  result: ToolResult,
  options: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  if (options.isPartial) return new Text(theme.fg("warning", "☁️ SF Data 360 running…"), 0, 0);
  const digest = result.details?.digest ?? digestFromLegacyDetails(result.details);
  if (!digest) {
    const text =
      result.content?.find((item) => item.type === "text")?.text ?? "SF Data 360 completed";
    return new Text(text, 0, 0);
  }
  return new Text(styleCard(renderData360DigestMarkdown(digest, options), digest, theme), 0, 0);
}

export function renderData360DigestMarkdown(
  digest: Data360RunDigest,
  options: { expanded?: boolean } = {},
): string {
  const expanded = options.expanded === true;
  const target = [
    digest.target?.alias,
    digest.target?.dataspace ? `space=${digest.target.dataspace}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = [
    `${statusIcon(digest.status)} ${digest.icon} ${digest.title} · ${digest.action}${target ? ` · ${target}` : ""}`,
  ];
  if (digest.pagination) lines.push(`   📚 ${digest.pagination.label}`);
  appendApiRail(lines, digest);

  const humanSections = digest.sections.filter(
    (section) => section.title !== "Evidence" && section.title !== "Next Step",
  );
  const visibleSections = humanSections.filter((section) => {
    if (expanded) return true;
    return ["Outcome", "Results", "Warnings", "Failure", "Request", "Response"].includes(
      section.title,
    );
  });
  for (const section of visibleSections) appendSection(lines, section, expanded);

  if (!expanded) {
    const hidden = humanSections.filter((section) => !visibleSections.includes(section)).length;
    if (hidden > 0)
      lines.push(
        "",
        `  … expand for SQL, tables, and ${hidden} more module section${hidden === 1 ? "" : "s"}`,
      );
  }
  return lines.join("\n");
}

function appendApiRail(lines: string[], digest: Data360RunDigest): void {
  lines.push("   API");
  if (!digest.api_calls?.length) {
    lines.push("   │ ℹ️ No API request recorded");
    return;
  }
  for (const call of digest.api_calls.slice(0, 8)) {
    const state =
      call.outcome === "failed"
        ? "❌"
        : call.outcome === "warning"
          ? "⚠️"
          : call.outcome === "planned"
            ? "🟡"
            : "✅";
    const status = call.status === undefined ? "" : ` ${call.status}`;
    const duration = call.durationMs === undefined ? "" : ` · ${formatDuration(call.durationMs)}`;
    lines.push(
      `   │ ${state} ${pad(call.transport, 9)} ${pad(call.method, 7)} ${call.url}${status}${duration}`,
    );
    if (call.detail) lines.push(`   │   ↳ ${clip(call.detail, 220)}`);
    if (call.pagination) {
      const facts = [
        call.pagination.label,
        call.pagination.offset === undefined ? undefined : `offset=${call.pagination.offset}`,
        call.pagination.limit === undefined ? undefined : `limit=${call.pagination.limit}`,
        call.pagination.returned === undefined ? undefined : `returned=${call.pagination.returned}`,
      ].filter(Boolean);
      lines.push(`   │   📚 ${facts.join(" · ")}`);
    }
  }
}

function appendSection(lines: string[], section: Data360RunSection, expanded: boolean): void {
  const rows =
    expanded || section.title === "Request" || section.title === "Response"
      ? (section.rows ?? [])
      : (section.rows ?? []).slice(0, section.title === "Outcome" ? 7 : 4);
  const tableRows = expanded
    ? (section.table?.rows ?? [])
    : (section.table?.rows ?? []).slice(0, 3);
  const codeLines =
    section.title === "Response"
      ? (section.code?.lines ?? []).slice(0, 8)
      : section.title === "Request"
        ? expanded
          ? (section.code?.lines ?? [])
          : (section.code?.lines ?? []).slice(0, 8)
        : expanded
          ? (section.code?.lines ?? [])
          : [];
  if (!rows.length && !tableRows.length && !codeLines.length) return;
  lines.push("", `—— ${section.icon} ${section.title} ——`);
  for (const row of rows) lines.push(`  ${row.icon} ${pad(row.label, 14)} ${row.value}`);
  if (section.table && tableRows.length)
    appendTable(lines, section.table.columns, tableRows, section.table.omittedRows);
  if (section.code && codeLines.length) {
    for (const line of codeLines) lines.push(`  ${line}`);
    const hiddenCodeLines = Math.max(
      section.code.omittedLines ?? 0,
      section.code.lines.length + (section.code.omittedLines ?? 0) - codeLines.length,
    );
    if (hiddenCodeLines) {
      lines.push(
        section.title === "Response"
          ? `  … response preview capped at 8 lines · ${hiddenCodeLines} more line(s) returned`
          : `  … ${hiddenCodeLines} more request line(s) omitted`,
      );
    }
  }
}

function appendTable(
  lines: string[],
  columns: string[],
  rows: string[][],
  omittedRows?: number,
): void {
  const widths = columns.map((column, index) =>
    Math.min(36, Math.max(column.length, ...rows.map((row) => String(row[index] ?? "").length))),
  );
  lines.push(
    `  ${columns
      .map((column, index) => {
        const width = widths[index] ?? 1;
        return pad(clip(column, width), width);
      })
      .join(" │ ")}`,
  );
  lines.push(`  ${widths.map((width) => "─".repeat(width)).join("─┼─")}`);
  for (const row of rows) {
    lines.push(
      `  ${columns
        .map((_column, index) => {
          const width = widths[index] ?? 1;
          return pad(clip(String(row[index] ?? ""), width), width);
        })
        .join(" │ ")}`,
    );
  }
  if (omittedRows) lines.push(`  … ${omittedRows} more row(s) returned`);
}

function styleCard(text: string, digest: Data360RunDigest, theme: Theme): string {
  const lines = text.split("\n");
  return lines
    .map((line, index) => {
      if (index === 0) return theme.fg(statusTheme(digest.status), theme.bold(line));
      if (line.startsWith("—— ")) return theme.fg("toolTitle", theme.bold(line));
      if (line === "   API") return theme.fg("muted", line);
      if (line.includes("📚")) return theme.fg("accent", line);
      if (line.startsWith("   │")) return theme.fg("dim", line);
      if (line.trimStart().startsWith("…")) return theme.fg("muted", line);
      return line;
    })
    .join("\n");
}

function digestFromLegacyDetails(details: ToolResult["details"]): Data360RunDigest | undefined {
  if (!details || typeof details.action !== "string") return undefined;
  return buildData360Digest({
    input: { action: details.action },
    result: details,
    artifactPath:
      typeof details.artifactPath === "string"
        ? details.artifactPath
        : typeof details.fullOutputPath === "string"
          ? details.fullOutputPath
          : undefined,
    outputMode: "summary",
  });
}

function namespaceForAction(action: string): Data360Namespace {
  const namespace = action.split(".")[0] as Data360Namespace;
  return [
    "discover",
    "connect",
    "prepare",
    "harmonize",
    "segment",
    "activate",
    "query",
    "semantic",
    "observe",
    "orchestrate",
    "api",
  ].includes(namespace)
    ? namespace
    : "api";
}
function subject(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  for (const key of [
    "dloName",
    "dmoName",
    "segmentId",
    "session_id",
    "trace_id",
    "queryId",
    "name",
  ]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
function statusIcon(status: Data360RunDigest["status"]): string {
  return status === "pass"
    ? "✅"
    : status === "warning"
      ? "⚠️"
      : status === "fail"
        ? "❌"
        : status === "planned"
          ? "🟡"
          : "ℹ️";
}
function statusTheme(
  status: Data360RunDigest["status"],
): "success" | "warning" | "error" | "accent" {
  return status === "pass"
    ? "success"
    : status === "warning" || status === "planned"
      ? "warning"
      : status === "fail"
        ? "error"
        : "accent";
}
function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
function clip(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, Math.max(1, max - 1))}…` : oneLine;
}
function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
