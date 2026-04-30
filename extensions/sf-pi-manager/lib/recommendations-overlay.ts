/* SPDX-License-Identifier: Apache-2.0 */
/**
 * TUI overlay for `/sf-pi recommended`.
 *
 * Single-level checklist:
 *   - ↑↓ navigate
 *   - Space toggle install/decline
 *   - A toggle all
 *   - Enter apply (install selected, decline unselected, persist state)
 *   - Esc cancel without writing state
 *
 * Each row shows the item's current decision ("installed", "declined", "new")
 * so the user can revisit and flip their mind without losing context. An item
 * the user installed previously is pre-checked on re-open.
 */
import { type Focusable, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { RecommendedItem } from "../../../catalog/types.ts";
import type { RecommendationDecision } from "./recommendations-state.ts";

export interface RecommendationRow {
  item: RecommendedItem;
  selected: boolean;
  previousDecision: RecommendationDecision | undefined;
}

export type RecommendationsOverlayResult =
  | { kind: "cancel" }
  | { kind: "apply"; rows: RecommendationRow[] };

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

export class RecommendationsOverlayComponent implements Focusable {
  focused = false;

  private selectedIndex = 0;

  constructor(
    private readonly theme: Theme,
    private readonly packageVersion: string,
    private readonly manifestRevision: string,
    private rows: RecommendationRow[],
    private readonly done: (result: RecommendationsOverlayResult | undefined) => void,
  ) {
    if (this.rows.length === 0) {
      // Defer to next tick so pi has a chance to mount before we close.
      queueMicrotask(() => this.done({ kind: "apply", rows: [] }));
    }
  }

  handleInput(data: string): void {
    if (this.rows.length === 0) return;

    if (matchesKey(data, "escape")) {
      this.done({ kind: "cancel" });
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.done({ kind: "apply", rows: this.rows });
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.selectedIndex = Math.min(this.rows.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, "space")) {
      const row = this.rows[this.selectedIndex];
      if (row) row.selected = !row.selected;
      return;
    }
    if (data === "a" || data === "A") {
      const allSelected = this.rows.every((r) => r.selected);
      for (const row of this.rows) row.selected = !allSelected;
      return;
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(50, width - 2);
    const theme = this.theme;

    const row = (content: string = "") => {
      const padded = padAnsi(truncateToWidth(content, innerWidth, ""), innerWidth);
      return `${theme.fg("border", "│")}${padded}${theme.fg("border", "│")}`;
    };

    const lines: string[] = [];
    lines.push(theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));

    const title = theme.fg("accent", theme.bold("sf-pi Recommended Extensions"));
    const version = theme.fg("dim", `v${this.packageVersion}`);
    const titleLeft = ` ${title}`;
    const titlePad = Math.max(1, innerWidth - visibleWidth(titleLeft) - visibleWidth(version) - 1);
    lines.push(row(`${titleLeft}${" ".repeat(titlePad)}${version}`));

    const revision = this.manifestRevision
      ? theme.fg("dim", `revision ${this.manifestRevision}`)
      : theme.fg("dim", "no revision");
    lines.push(
      row(
        ` ${revision} ${theme.fg("dim", "· ↑↓ move · Space toggle · A all · Enter apply · Esc cancel")}`,
      ),
    );
    lines.push(row(""));

    if (this.rows.length === 0) {
      lines.push(row(theme.fg("dim", "  No recommendations available right now.")));
    }

    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const isSelected = i === this.selectedIndex;

      const cursor = isSelected ? theme.fg("accent", "▸") : " ";
      const checkbox = r.selected ? theme.fg("accent", "[x]") : theme.fg("muted", "[ ]");
      const name = isSelected ? theme.bold(r.item.name) : r.item.name;
      const licenseTag = theme.fg("muted", `[${r.item.license}]`);
      const prevBadge = this.renderPreviousDecisionBadge(r.previousDecision);

      const rightParts = [prevBadge, licenseTag].filter(Boolean).join(" ");
      const leftPart = ` ${cursor} ${checkbox} ${name}`;
      const gap = Math.max(2, innerWidth - visibleWidth(leftPart) - visibleWidth(rightParts) - 1);
      lines.push(row(`${leftPart}${" ".repeat(gap)}${rightParts}`));
      lines.push(row(`       ${theme.fg("dim", r.item.description)}`));
      lines.push(row(`       ${theme.fg("muted", `source: ${r.item.source}`)}`));
      lines.push(row(`       ${theme.fg("muted", `why: ${r.item.rationale}`)}`));
      if (i < this.rows.length - 1) lines.push(row(""));
    }

    lines.push(row(""));
    const selectedCount = this.rows.filter((r) => r.selected).length;
    lines.push(
      row(` ${theme.fg("muted", `Selected to install: ${selectedCount}/${this.rows.length}`)}`),
    );
    lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));

    return lines;
  }

  invalidate(): void {}

  private renderPreviousDecisionBadge(decision: RecommendationDecision | undefined): string {
    if (decision === "installed") return this.theme.fg("success", "installed");
    if (decision === "declined") return this.theme.fg("warning", "declined");
    return this.theme.fg("accent", "new");
  }
}
