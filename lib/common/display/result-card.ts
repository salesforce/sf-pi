/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared SF Pi result-card renderer.
 *
 * This is intentionally small: a card is structured evidence, not a TUI
 * framework. Tool `content` stays model-facing; renderers map structured
 * `details` into this human-facing card for compact, Apple-like progressive
 * disclosure in the terminal.
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Box, Text, type Component } from "@earendil-works/pi-tui";

export type SfPiCardStatus = "success" | "warning" | "error" | "info" | "running";
export type SfPiTone = "success" | "warning" | "error" | "info" | "muted";
export type SfPiRailLabel = "API" | "CLI" | "Local" | "Browser" | "Data" | "Artifact";
export type SfPiArtifactKind = "json" | "markdown" | "csv" | "html" | "log" | "image" | "text";

export interface SfPiChip {
  label: string;
  tone?: SfPiTone;
}

export interface SfPiFact {
  label: string;
  value: string;
  icon?: string;
  tone?: SfPiTone;
}

export interface SfPiRail {
  label: SfPiRailLabel;
  items: Array<{
    verb?: string;
    target: string;
    detail?: string;
    tone?: SfPiTone;
  }>;
}

export interface SfPiSection {
  title: string;
  icon?: string;
  rows: SfPiFact[];
  collapsedLimit?: number;
}

export interface SfPiArtifact {
  label: string;
  path: string;
  kind?: SfPiArtifactKind;
}

export interface SfPiProgress {
  phase: string;
  current?: string;
  completed?: number;
  total?: number;
  percent?: number;
}

export interface SfPiNoticeRow {
  label: string;
  value: string;
  tone?: SfPiTone;
  multiline?: boolean;
}

export interface SfPiNoticeGroup {
  title: string;
  rows: SfPiNoticeRow[];
}

export interface SfPiNoticeCard {
  icon: string;
  title: string;
  status: SfPiCardStatus;
  statusText: string;
  duration?: string;
  groups: SfPiNoticeGroup[];
  footer: string;
}

export interface SfPiResultCard {
  tool: {
    id: string;
    label: string;
    icon: string;
  };
  title: string;
  status: SfPiCardStatus;
  summary: string;
  chips?: SfPiChip[];
  scope?: SfPiFact[];
  rails?: SfPiRail[];
  sections?: SfPiSection[];
  artifacts?: SfPiArtifact[];
  next?: string[];
  renderHints?: {
    collapsedLines?: number;
    expandedMaxLines?: number;
    profile?: "compact" | "balanced" | "verbose";
  };
}

export function renderSfPiToolCallLine(
  input: {
    icon: string;
    label: string;
    action?: string;
    subject?: string;
    scope?: string;
    mode?: string;
  },
  theme: Theme,
): string {
  const bits = [input.action, input.subject, input.scope, input.mode].filter((bit): bit is string =>
    Boolean(bit),
  );
  return `${theme.fg("toolTitle", theme.bold(`${input.icon} ${input.label} `))}${theme.fg("muted", bits.join(" · "))}`;
}

export function renderSfPiProgressText(progress: SfPiProgress, theme: Theme): string {
  const hasMeasuredProgress =
    typeof progress.percent === "number" ||
    (progress.completed !== undefined && progress.total !== undefined);
  const ratio = progressRatio(progress);
  const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  const bar = `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
  const count =
    progress.completed !== undefined && progress.total !== undefined
      ? `${progress.completed}/${progress.total}`
      : undefined;
  const bits = [progress.phase, count, progress.current].filter((bit): bit is string =>
    Boolean(bit),
  );
  const indicator = hasMeasuredProgress ? `[${bar}]` : "⏳";
  return `${theme.fg("accent", indicator)} ${theme.fg("muted", bits.join(" · "))}`;
}

export function renderSfPiNoticePanel(card: SfPiNoticeCard, theme: Theme): Component {
  const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
  box.addChild(new Text(buildNoticePanelLines(card, theme).join("\n"), 0, 0));
  return box;
}

export function renderSfPiNoticeCardText(card: SfPiNoticeCard, theme: Theme): string {
  const lines = [
    `${theme.fg("border", "╭─ ")}${theme.fg("toolTitle", theme.bold(`${card.icon} ${card.title}`))}`,
    theme.fg("border", "│"),
    noticeStatusLine(card, theme),
    theme.fg("border", "│"),
  ];

  card.groups.forEach((group, index) => {
    if (index > 0) lines.push(theme.fg("border", "│"));
    lines.push(`${theme.fg("border", "│  ")}${theme.fg("accent", theme.bold(group.title))}`);
    for (const row of group.rows) lines.push(...noticeRowLines(row, theme));
  });

  lines.push(`${theme.fg("border", "╰─ ")}${noticeFooter(card, theme)}`);
  return lines.join("\n");
}

export function renderSfPiResultCardPanel(
  card: SfPiResultCard,
  opts: { expanded?: boolean } = {},
  theme: Theme,
): Component {
  const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
  box.addChild(
    new Text(buildResultPanelLines(card, opts.expanded === true, theme).join("\n"), 0, 0),
  );
  return box;
}

export function renderSfPiResultCardText(
  card: SfPiResultCard,
  opts: { expanded?: boolean } = {},
  theme: Theme,
): string {
  const expanded = opts.expanded === true;
  const lines = buildCardLines(card, expanded, theme);
  if (expanded) {
    const max = card.renderHints?.expandedMaxLines ?? 120;
    return clampLines(lines, max, theme).join("\n");
  }
  return clampLines(lines, card.renderHints?.collapsedLines ?? 14, theme).join("\n");
}

function buildNoticePanelLines(card: SfPiNoticeCard, theme: Theme): string[] {
  const lines = [
    `  ${theme.fg("toolTitle", theme.bold(`${card.icon} ${card.title}`))}`,
    "",
    `  ${statusLabel(card.status, card.statusText, theme)}${card.duration ? `  ${theme.fg("dim", card.duration)}` : ""}`,
    "",
  ];

  card.groups.forEach((group, index) => {
    if (index > 0) lines.push("");
    lines.push(`  ${theme.fg("accent", theme.bold(group.title))}`);
    for (const row of group.rows) lines.push(...noticePanelRowLines(row, theme));
  });

  lines.push("", `  ${noticeFooter(card, theme)}`);
  return lines;
}

function noticePanelRowLines(row: SfPiNoticeRow, theme: Theme): string[] {
  if (row.multiline) {
    return [
      `    ${theme.fg("muted", row.label)}`,
      `      ${tone(row.tone ?? "muted", clipValue(row.value, 220), theme)}`,
    ];
  }
  return [
    `    ${labelText(row.label, theme, 9)}${tone(row.tone ?? "muted", clipValue(row.value, 160), theme)}`,
  ];
}

function noticeStatusLine(card: SfPiNoticeCard, theme: Theme): string {
  const status = statusLabel(card.status, card.statusText, theme);
  const duration = card.duration ? `  ${theme.fg("dim", card.duration)}` : "";
  return `${theme.fg("border", "│  ")}${status}${duration}`;
}

function statusLabel(status: SfPiCardStatus, text: string, theme: Theme): string {
  const color = statusColor(status);
  return `${theme.fg(color, statusIcon(status))} ${theme.fg(color, theme.bold(text))}`;
}

function noticeRowLines(row: SfPiNoticeRow, theme: Theme): string[] {
  if (row.multiline) {
    return [
      `${theme.fg("border", "│    ")}${theme.fg("muted", row.label)}`,
      `${theme.fg("border", "│      ")}${tone(row.tone ?? "muted", clipValue(row.value, 220), theme)}`,
    ];
  }
  return [
    `${theme.fg("border", "│    ")}${labelText(row.label, theme, 9)}${tone(row.tone ?? "muted", clipValue(row.value, 160), theme)}`,
  ];
}

function noticeFooter(card: SfPiNoticeCard, theme: Theme): string {
  return theme.fg(statusColor(card.status), card.footer);
}

function statusColor(status: SfPiCardStatus): ThemeColor {
  if (status === "success") return "success";
  if (status === "warning" || status === "running") return "warning";
  if (status === "error") return "error";
  return "accent";
}

function statusIcon(status: SfPiCardStatus): string {
  if (status === "success") return "✓";
  if (status === "warning") return "⚠";
  if (status === "error") return "✕";
  if (status === "running") return "⏳";
  return "ⓘ";
}

function buildResultPanelLines(card: SfPiResultCard, expanded: boolean, theme: Theme): string[] {
  const lines = [
    `  ${theme.fg("toolTitle", theme.bold(`${card.tool.icon} ${card.title}`))}`,
    "",
    `  ${statusLabel(card.status, statusText(card.status), theme)}${card.chips?.length ? `  ${card.chips.map((chip) => tone(chip.tone ?? "muted", chip.label, theme)).join(theme.fg("dim", " · "))}` : ""}`,
    "",
    `  ${theme.fg("accent", theme.bold("Summary"))}`,
    `    ${tone(card.status === "error" ? "error" : card.status === "warning" ? "warning" : "muted", clipValue(card.summary, 180), theme)}`,
  ];

  if (card.scope?.length) {
    lines.push("", `  ${theme.fg("accent", theme.bold("Scope"))}`);
    for (const row of expanded ? card.scope : card.scope.slice(0, 6)) {
      lines.push(
        `    ${labelText(titleCase(row.label), theme, 10)}${tone(row.tone ?? "muted", clipValue(row.value, 160), theme)}`,
      );
    }
  }

  if (card.rails?.length) {
    const rails = expanded ? card.rails : card.rails.slice(0, 1);
    lines.push("", `  ${theme.fg("accent", theme.bold("Execution"))}`);
    for (const rail of rails) {
      for (const item of expanded ? rail.items : rail.items.slice(0, 2)) {
        const prefix = [rail.label, item.verb].filter(Boolean).join(" · ");
        lines.push(
          `    ${labelText(prefix, theme, 10)}${tone(item.tone ?? "muted", clipValue(item.target, 160), theme)}`,
        );
        if (item.detail)
          lines.push(
            `    ${labelText("Detail", theme, 10)}${theme.fg("dim", clipValue(item.detail, 120))}`,
          );
      }
    }
  }

  const sections = expanded ? (card.sections ?? []) : (card.sections ?? []).slice(0, 3);
  for (const section of sections) {
    const rows = expanded ? section.rows : section.rows.slice(0, section.collapsedLimit ?? 3);
    if (!rows.length) continue;
    lines.push(
      "",
      `  ${theme.fg("accent", theme.bold(`${section.icon ? `${section.icon} ` : ""}${section.title}`))}`,
    );
    for (const row of rows) {
      lines.push(
        `    ${row.icon ? `${row.icon} ` : ""}${labelText(titleCase(row.label), theme, 10)}${tone(row.tone ?? "muted", clipValue(row.value, 160), theme)}`,
      );
    }
    if (!expanded && section.rows.length > rows.length) {
      lines.push(
        `    ${labelText("More", theme, 10)}${theme.fg("dim", `+${section.rows.length - rows.length} in expanded view`)}`,
      );
    }
  }

  if (card.artifacts?.length) {
    lines.push("", `  ${theme.fg("accent", theme.bold("Evidence"))}`);
    for (const artifact of expanded ? card.artifacts : card.artifacts.slice(0, 3)) {
      lines.push(
        `    ${labelText(titleCase(artifact.label), theme, 10)}${theme.fg("dim", shortEvidencePath(artifact.path))}`,
      );
    }
  }

  if (card.next?.length) {
    lines.push(
      "",
      `  ${tone(card.status === "error" ? "error" : card.status === "warning" ? "warning" : "success", card.next[0] ?? "continue", theme)}`,
    );
    if (expanded) {
      for (const next of card.next.slice(1)) lines.push(`  ${theme.fg("dim", `→ ${next}`)}`);
    }
  }
  return lines;
}

function statusText(status: SfPiCardStatus): string {
  if (status === "success") return "Success";
  if (status === "warning") return "Review";
  if (status === "error") return "Blocked";
  if (status === "running") return "Running";
  return "Info";
}

function titleCase(value: string): string {
  if (!value) return "";
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function shortEvidencePath(filePath: string): string {
  const parts = filePath.split(/[\\/]+/u).filter(Boolean);
  if (parts.length <= 2) return filePath;
  return `…/${parts.at(-1)}`;
}

function buildCardLines(card: SfPiResultCard, expanded: boolean, theme: Theme): string[] {
  const lines: string[] = [];
  const status = statusChip(card.status, theme);
  const chips = (card.chips ?? []).map((chip) => tone(chip.tone ?? "muted", chip.label, theme));
  const title = `${card.tool.icon} ${card.title}`;
  lines.push(
    `${theme.fg("border", "╭─ ")}${theme.fg("toolTitle", theme.bold(title))}  ${status}${chips.length ? `  ${chips.join(theme.fg("dim", " · "))}` : ""}`,
  );
  lines.push(factLine({ label: "summary", value: card.summary }, theme));

  for (const item of (expanded ? card.scope : (card.scope ?? []).slice(0, 4)) ?? []) {
    lines.push(factLine(item, theme));
  }

  if (card.rails?.length) {
    const rails = expanded ? card.rails : card.rails.slice(0, 1);
    for (const rail of rails) appendRail(lines, rail, expanded, theme);
  }

  const sections = expanded ? (card.sections ?? []) : (card.sections ?? []).slice(0, 2);
  for (const section of sections) appendSection(lines, section, expanded, theme);

  appendArtifacts(lines, card.artifacts ?? [], expanded, theme);
  appendNext(lines, card.next ?? [], expanded, theme);
  if (!card.next?.length) lines.push(theme.fg("border", "╰─"));
  return lines;
}

function appendRail(lines: string[], rail: SfPiRail, expanded: boolean, theme: Theme): void {
  const items = expanded ? rail.items : rail.items.slice(0, 2);
  if (!items.length) return;
  lines.push(sectionTitle(rail.label, "", theme));
  for (const item of items) {
    const verb = item.verb ? labelText(item.verb, theme, 8) : labelText("", theme, 8);
    const detail = item.detail ? `  ${theme.fg("dim", clipValue(item.detail, 80))}` : "";
    lines.push(
      `${theme.fg("border", "│  ")}${verb}${tone(item.tone ?? "muted", clipValue(item.target, 150), theme)}${detail}`,
    );
  }
  if (!expanded && rail.items.length > items.length) {
    lines.push(
      factLine(
        {
          label: "more",
          value: `+${rail.items.length - items.length} ${rail.label.toLowerCase()} entries`,
        },
        theme,
      ),
    );
  }
}

function appendSection(
  lines: string[],
  section: SfPiSection,
  expanded: boolean,
  theme: Theme,
): void {
  const rows = expanded ? section.rows : section.rows.slice(0, section.collapsedLimit ?? 3);
  if (!rows.length) return;
  lines.push(sectionTitle(section.title, section.icon, theme));
  for (const row of rows) lines.push(factLine(row, theme));
  if (!expanded && section.rows.length > rows.length) {
    lines.push(
      factLine(
        { label: "more", value: `+${section.rows.length - rows.length} in expanded view` },
        theme,
      ),
    );
  }
}

function appendArtifacts(
  lines: string[],
  artifacts: SfPiArtifact[],
  expanded: boolean,
  theme: Theme,
): void {
  const visible = expanded ? artifacts : artifacts.slice(0, 2);
  if (!visible.length) return;
  lines.push(sectionTitle("Artifacts", "📦", theme));
  for (const artifact of visible) {
    lines.push(
      factLine(
        {
          icon: artifactIcon(artifact.kind),
          label: artifact.label,
          value: artifact.path,
          tone: "muted",
        },
        theme,
      ),
    );
  }
  if (!expanded && artifacts.length > visible.length) {
    lines.push(
      factLine(
        { label: "more", value: `+${artifacts.length - visible.length} artifact(s)` },
        theme,
      ),
    );
  }
}

function appendNext(lines: string[], next: string[], expanded: boolean, theme: Theme): void {
  const visible = expanded ? next : next.slice(0, 1);
  if (!visible.length) return;
  lines.push(`${theme.fg("border", "╰─ ")}${theme.fg("accent", theme.bold("Next"))}`);
  for (const step of visible)
    lines.push(`${theme.fg("border", "   ")}${theme.fg("accent", "→")} ${step}`);
}

function sectionTitle(title: string, icon: string | undefined, theme: Theme): string {
  return `${theme.fg("border", "├─ ")}${theme.fg("accent", theme.bold(`${icon ? `${icon} ` : ""}${title}`))}`;
}

function factLine(fact: SfPiFact, theme: Theme): string {
  const icon = fact.icon ? `${fact.icon} ` : "";
  return `${theme.fg("border", "│  ")}${icon}${labelText(fact.label, theme)}${tone(fact.tone ?? "muted", clipValue(fact.value), theme)}`;
}

function labelText(label: string, theme: Theme, width = 13): string {
  const visible = label.length > width ? `${label.slice(0, Math.max(1, width - 1))}…` : label;
  return theme.fg("muted", `${visible.padEnd(width)}  `);
}

function clipValue(value: string, max = 180): string {
  const oneLine = value.replace(/\s+/gu, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, Math.max(0, max - 1))}…` : oneLine;
}

function statusChip(status: SfPiCardStatus, theme: Theme): string {
  switch (status) {
    case "success":
      return theme.fg("success", "✓ success");
    case "warning":
      return theme.fg("warning", "⚠ review");
    case "error":
      return theme.fg("error", "✗ blocked");
    case "running":
      return theme.fg("warning", "⏳ running");
    case "info":
    default:
      return theme.fg("accent", "ⓘ info");
  }
}

function tone(toneName: SfPiTone, value: string, theme: Theme): string {
  const color: ThemeColor = toneName === "info" ? "accent" : toneName;
  return theme.fg(color, value);
}

function artifactIcon(kind: SfPiArtifactKind | undefined): string {
  switch (kind) {
    case "csv":
      return "📊";
    case "html":
      return "🌐";
    case "image":
      return "🖼";
    case "log":
      return "🧾";
    case "markdown":
      return "📝";
    case "text":
      return "📄";
    case "json":
    default:
      return "📄";
  }
}

function progressRatio(progress: SfPiProgress): number {
  if (typeof progress.percent === "number" && Number.isFinite(progress.percent)) {
    return progress.percent > 1 ? progress.percent / 100 : progress.percent;
  }
  if (progress.completed !== undefined && progress.total && progress.total > 0) {
    return progress.completed / progress.total;
  }
  return 0;
}

function clampLines(lines: string[], maxLines: number, theme: Theme): string[] {
  if (maxLines <= 0 || lines.length <= maxLines) return lines;
  if (maxLines <= 3) return lines.slice(0, maxLines);
  const preservedStart = lines.findIndex(
    (line) => line.includes("Artifacts") || line.includes("Next"),
  );
  const preserved = preservedStart >= 0 ? lines.slice(preservedStart) : [];
  const headBudget = Math.max(2, maxLines - preserved.length - 1);
  const head = lines.slice(0, headBudget);
  const omitted = lines.length - head.length - preserved.length;
  const omittedLine =
    omitted > 0
      ? [factLine({ label: "more", value: `+${omitted} hidden · expand for evidence` }, theme)]
      : [];
  return [...head, ...omittedLine, ...preserved].slice(0, maxLines);
}
