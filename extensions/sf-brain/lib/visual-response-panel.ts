/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only SF Pi Manager panel for the aggregate visual-response audit. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";
import type { VisualResponseAuditReport } from "./visual-response-audit.ts";

export function renderVisualResponseAuditReport(
  report: VisualResponseAuditReport,
  width = 100,
): string[] {
  const safeWidth = Number.isFinite(width) ? Math.max(20, Math.floor(width)) : 100;
  const { scope, summary, diagramKinds } = report;
  const lines = [
    "Visual Response Audit",
    "Aggregate-only facts; transcript content and identifiers are never displayed.",
    "",
    "Scope",
    `  Sessions audited       ${summary.sessionsAudited} / ${scope.sessionsSelected} selected`,
    `  Terminal width         ${scope.terminalWidth}`,
    `  Bound/scope skips      ${summary.sessionsSkippedForBounds} / ${summary.sessionsSkippedForScope}`,
    "",
    "Responses",
    `  Final responses        ${summary.finalResponses}`,
    `  With Mermaid          ${summary.responsesWithMermaid}`,
    `  With visual icons     ${summary.responsesWithVisualIcons}`,
    "",
    "Mermaid",
    `  Total / renderable    ${summary.diagrams} / ${summary.wouldRenderAtWidth}`,
    `  Unsupported/malformed ${summary.unsupported} / ${summary.malformed}`,
    `  Parser warnings       ${summary.withWarnings}`,
    `  Top-level fences      ${summary.topLevel}`,
    "",
    "Families",
    `  Flow ${diagramKinds.flowchart} · Sequence ${diagramKinds.sequence} · State ${diagramKinds.state}`,
    `  ER ${diagramKinds.er} · Class ${diagramKinds.class} · Unsupported ${diagramKinds.unsupported}`,
    "",
    "Width",
    `  Min ${value(report.width.min)} · Median ${value(report.width.median)} · P90 ${value(report.width.p90)} · Max ${value(report.width.max)}`,
  ];
  return lines.map((line) => truncateToWidth(line, safeWidth, "…"));
}

export class VisualResponseAuditPanel implements Focusable {
  focused = false;

  constructor(
    private readonly theme: Theme,
    private readonly report: VisualResponseAuditReport,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {}

  handleInput(data: string): void {
    if (
      matchesKey(data, "escape") ||
      matchesKey(data, "enter") ||
      matchesKey(data, "return") ||
      data === "q"
    ) {
      this.done(undefined);
    }
  }

  renderContent(width = 100): string[] {
    const lines = renderVisualResponseAuditReport(this.report, width);
    if (lines.length > 0) lines[0] = this.theme.fg("accent", this.theme.bold(lines[0] ?? ""));
    return [...lines, "", this.theme.fg("dim", "Enter/Esc back")];
  }

  render(width = 100): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}
}

function value(input: number | undefined): string {
  return input === undefined ? "n/a" : String(input);
}
