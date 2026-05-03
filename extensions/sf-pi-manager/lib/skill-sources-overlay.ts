/* SPDX-License-Identifier: Apache-2.0 */
/**
 * TUI overlay for `/sf-pi skills`.
 *
 * Single-level checklist of detected external skill roots. Space to
 * toggle wired/not-wired; Enter applies (delta-write to
 * `~/.pi/agent/settings.json → skills[]`); Esc cancels.
 *
 * The structure intentionally mirrors `recommendations-overlay.ts` so
 * users only learn one keybinding map. See that file for the reference
 * implementation of the same pattern.
 */
import { type Focusable, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { SkillSourceCandidate } from "../../../lib/common/skill-sources/skill-sources.ts";

export interface SkillSourceRow {
  candidate: SkillSourceCandidate;
  /** Current checkbox state — reflects whether the user wants this root
   *  wired in settings after Enter. */
  selected: boolean;
  /** Snapshot of `candidate.wired` at open time so the dispatcher can
   *  compute a minimal add/remove diff regardless of toggles. */
  previouslyWired: boolean;
}

export type SkillSourcesOverlayResult =
  | { kind: "cancel" }
  | { kind: "apply"; rows: SkillSourceRow[]; staleWired: string[]; pruneStale: boolean };

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

export class SkillSourcesOverlayComponent implements Focusable {
  focused = false;

  private selectedIndex = 0;
  private pruneStale: boolean;

  constructor(
    private readonly theme: Theme,
    private readonly packageVersion: string,
    private readonly settingsPath: string,
    private rows: SkillSourceRow[],
    private readonly staleWired: string[],
    private readonly done: (result: SkillSourcesOverlayResult | undefined) => void,
  ) {
    // Default: prune stale wired paths when Enter is pressed. The user
    // can flip this with `p` before confirming — we don't want an
    // invisible side-effect.
    this.pruneStale = this.staleWired.length > 0;

    if (this.rows.length === 0 && this.staleWired.length === 0) {
      // Nothing to show — close immediately.
      queueMicrotask(() =>
        this.done({ kind: "apply", rows: [], staleWired: [], pruneStale: false }),
      );
    }
  }

  handleInput(data: string): void {
    if (this.rows.length === 0 && this.staleWired.length === 0) return;

    if (matchesKey(data, "escape")) {
      this.done({ kind: "cancel" });
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.done({
        kind: "apply",
        rows: this.rows,
        staleWired: this.staleWired,
        pruneStale: this.pruneStale,
      });
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.selectedIndex = Math.min(Math.max(0, this.rows.length - 1), this.selectedIndex + 1);
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
    if (data === "p" || data === "P") {
      if (this.staleWired.length > 0) this.pruneStale = !this.pruneStale;
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

    const title = theme.fg("accent", theme.bold("sf-pi External Skill Sources"));
    const version = theme.fg("dim", `v${this.packageVersion}`);
    const titleLeft = ` ${title}`;
    const titlePad = Math.max(1, innerWidth - visibleWidth(titleLeft) - visibleWidth(version) - 1);
    lines.push(row(`${titleLeft}${" ".repeat(titlePad)}${version}`));
    lines.push(
      row(
        ` ${theme.fg("dim", `writes to ${this.settingsPath}`)} ${theme.fg("dim", "· ↑↓ move · Space toggle · A all · Enter apply · Esc cancel")}`,
      ),
    );
    lines.push(row(""));

    if (this.rows.length === 0) {
      lines.push(
        row(
          theme.fg(
            "dim",
            "  No external skill directories detected under ~/.claude, ~/.codex, or ~/.cursor.",
          ),
        ),
      );
    }

    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const isSelected = i === this.selectedIndex;
      const cursor = isSelected ? theme.fg("accent", "▸") : " ";
      const checkbox = r.selected ? theme.fg("accent", "[x]") : theme.fg("muted", "[ ]");
      const label = isSelected ? theme.bold(r.candidate.label) : r.candidate.label;
      const skillBadge = theme.fg(
        "muted",
        `${r.candidate.skillCount} skill${r.candidate.skillCount === 1 ? "" : "s"}`,
      );
      const wiredBadge = r.previouslyWired
        ? theme.fg("success", "wired")
        : theme.fg("accent", "available");

      const rightParts = [wiredBadge, skillBadge].filter(Boolean).join(" ");
      const leftPart = ` ${cursor} ${checkbox} ${label}`;
      const gap = Math.max(2, innerWidth - visibleWidth(leftPart) - visibleWidth(rightParts) - 1);
      lines.push(row(`${leftPart}${" ".repeat(gap)}${rightParts}`));
      lines.push(row(`       ${theme.fg("muted", `path: ${r.candidate.displayPath}`)}`));
      if (i < this.rows.length - 1) lines.push(row(""));
    }

    if (this.staleWired.length > 0) {
      lines.push(row(""));
      const label = theme.bold(theme.fg("warning", "Stale entries in settings.skills[]:"));
      lines.push(row(` ${label}`));
      for (const raw of this.staleWired) {
        lines.push(row(`   ${theme.fg("muted", raw)}`));
      }
      const toggle = this.pruneStale ? theme.fg("accent", "[x]") : theme.fg("muted", "[ ]");
      lines.push(row(` ${toggle} ${theme.fg("dim", "press P to toggle pruning these on Enter")}`));
    }

    lines.push(row(""));
    const selectedCount = this.rows.filter((r) => r.selected).length;
    lines.push(row(` ${theme.fg("muted", `Selected: ${selectedCount}/${this.rows.length}`)}`));
    lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));

    return lines;
  }

  invalidate(): void {}
}
