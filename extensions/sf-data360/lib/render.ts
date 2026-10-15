/* SPDX-License-Identifier: Apache-2.0 */
/** Rich Data 360 Run Card rendering for the single sf_data360 tool. */
import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Data360Namespace, SfData360Input } from "./actions/action-types.ts";
import { buildData360Digest, namespacePresentation } from "./digest.ts";
import {
  normalizeSfPiDisplayProfile,
  type SfPiDisplayProfile,
} from "../../../lib/common/display/types.ts";
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
  return new Text(
    styleCard(
      renderData360DigestMarkdown(digest, {
        ...options,
        profile: normalizeSfPiDisplayProfile(
          (result.details?.sfPi as { renderHints?: { profile?: unknown } } | undefined)?.renderHints
            ?.profile,
        ),
      }),
      digest,
      theme,
    ),
    0,
    0,
  );
}

export function renderData360DigestMarkdown(
  digest: Data360RunDigest,
  options: { expanded?: boolean; profile?: SfPiDisplayProfile } = {},
): string {
  const expanded = options.expanded === true;
  const profile = options.profile ?? "balanced";
  const previewRows = profile === "compact" ? 3 : profile === "verbose" ? 10 : 5;
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
  if (expanded && digest.api_calls?.length) appendApiRail(lines, digest);

  const humanSections = digest.sections.filter(
    (section) => section.title !== "Evidence" && section.title !== "Next Step",
  );
  const visibleSections = humanSections.filter((section) => {
    if (expanded) return true;
    if (section.compact) return true;
    if (["Warnings", "Failure"].includes(section.title)) return true;
    return digest.card_kind === "api" && ["Request", "Response"].includes(section.title);
  });
  for (const section of visibleSections) {
    appendSection(lines, section, expanded, previewRows);
  }
  if (expanded && digest.artifacts?.length) {
    lines.push("", `  📁 Full result: ${digest.artifacts[0].path}`);
  }

  if (!expanded) {
    const hidden = humanSections.filter((section) => !visibleSections.includes(section)).length;
    if (hidden > 0)
      lines.push(
        "",
        `  … Expand for SQL, tables, and ${hidden} more module section${hidden === 1 ? "" : "s"}`,
      );
  }
  return lines.join("\n");
}

function appendApiRail(lines: string[], digest: Data360RunDigest): void {
  if (!digest.api_calls?.length) return;
  lines.push("   API");
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

function appendSection(
  lines: string[],
  section: Data360RunSection,
  expanded: boolean,
  previewRows: number,
): void {
  const sourceRows = section.rows ?? [];
  const rows =
    expanded || ["Warnings", "Failure"].includes(section.title)
      ? sourceRows
      : section.title === "Request"
        ? sourceRows.filter((row) => ["Method", "URL", "Safety", "Request"].includes(row.label))
        : sourceRows.slice(0, section.title === "Outcome" ? previewRows + 2 : previewRows);
  const tableRows = (section.table?.rows ?? []).slice(0, expanded ? 50 : previewRows);
  // Request/response JSON and canonical raw payloads belong in the artifact, not the card.
  const codeLines =
    expanded && section.code?.language !== "json" ? (section.code?.lines ?? []).slice(0, 50) : [];
  if (!rows.length && !tableRows.length && !codeLines.length) return;
  lines.push("", `—— ${section.icon} ${section.title} ——`);
  for (const row of rows) {
    const value =
      !expanded && section.title === "Request" && row.label === "URL"
        ? endpointPath(row.value)
        : row.value;
    lines.push(`  ${row.icon} ${pad(row.label, 14)} ${value}`);
  }
  if (section.table && tableRows.length) {
    const hiddenTableRows =
      Math.max(0, section.table.rows.length - tableRows.length) + (section.table.omittedRows ?? 0);
    appendTable(lines, section.table.columns, tableRows, hiddenTableRows);
    if (hiddenTableRows) {
      lines.push(
        expanded
          ? "  … Inline table limited to 50 rows · full result in artifact"
          : "  … Expand to see more table rows",
      );
    }
  }
  for (const line of codeLines) lines.push(`  ${line}`);
  if (section.code && codeLines.length) {
    const omitted = section.code.lines.length - codeLines.length + (section.code.omittedLines ?? 0);
    if (omitted) lines.push(`  … ${omitted} more line(s) · full result in artifact`);
  }
}

function endpointPath(value: string): string {
  try {
    const url = new URL(value);
    return url.pathname + url.search;
  } catch {
    return value;
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
