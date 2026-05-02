/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Top-right passive overlay for the sf-lsp HUD.
 *
 * Shape (per row):
 *
 *   ╭──────────────────────────────────╮
 *   │ 🩻 SF LSP              ok · err · │
 *   │ ● Apex   Foo.cls   ok    312ms   │
 *   │ ✗ LWC    bar.js    2 err 480ms   │
 *   │ ○ AS     —         off           │
 *   ╰──────────────────────────────────╯
 *
 * Never captures input. Follows the exact pattern used by sf-skills-hud so
 * the HUD family stays consistent across sf-pi extensions.
 */
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
  LANGUAGE_ORDER,
  formatDuration,
  formatRelativeAge,
  languageLongLabel,
  statusBadgeLabel,
  statusColor,
  statusGlyph,
  type LspActivityEntry,
  type LspActivityStore,
} from "./activity.ts";

export class SfLspHudComponent {
  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private store: LspActivityStore,
  ) {}

  setStore(store: LspActivityStore): void {
    this.store = store;
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const innerWidth = Math.max(30, width - 2);
    const lines: string[] = [];
    const theme = this.theme;
    const row = (content = "") => makeRow(theme, content, innerWidth);

    lines.push(theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));

    const title = theme.fg("accent", theme.bold("🩻 SF LSP"));
    const summary = theme.fg("dim", summarize(this.store));
    const gap = Math.max(1, innerWidth - visibleWidth(title) - visibleWidth(summary));
    lines.push(row(`${title}${" ".repeat(gap)}${summary}`));
    lines.push(row(""));

    const now = Date.now();
    for (const language of LANGUAGE_ORDER) {
      const entry = this.store.byLanguage.get(language);
      lines.push(row(buildLanguageRow(language, entry, theme, now)));
    }

    lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}

function makeRow(theme: Theme, content: string, innerWidth: number): string {
  const truncated = truncateToWidth(content, innerWidth, "", true);
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
  return `${theme.fg("border", "│")}${truncated}${padding}${theme.fg("border", "│")}`;
}

function summarize(store: LspActivityStore): string {
  if (!store.hasActivity) return " idle · no runs yet ";

  let errors = 0;
  let clean = 0;
  for (const entry of store.byLanguage.values()) {
    if (entry.status === "error") errors += entry.diagnosticCount || 1;
    if (entry.status === "clean" || entry.status === "transition-clean") clean += 1;
  }
  return ` ${clean} ok · ${errors} err `;
}

function buildLanguageRow(
  language: (typeof LANGUAGE_ORDER)[number],
  entry: LspActivityEntry | undefined,
  theme: Theme,
  now: number,
): string {
  const status = entry?.status ?? "idle";
  const color = statusColor(status);
  const glyph = theme.fg(color, statusGlyph(status));
  const label = theme.fg("text", padRight(languageLongLabel(language), 12));
  const file = theme.fg("accent", padRight(entry?.fileName ?? "—", 18));
  const badge = theme.fg(color, padRight(statusBadgeLabel(status), 6));
  const timing = theme.fg("dim", timingCell(entry, now, status));

  return ` ${glyph} ${label}${file}${badge}${timing}`;
}

function padRight(value: string, width: number): string {
  const vis = visibleWidth(value);
  if (vis >= width) return value;
  return value + " ".repeat(width - vis);
}

function timingCell(entry: LspActivityEntry | undefined, now: number, status: string): string {
  if (!entry || !entry.updatedAt) return "";
  if (status === "error" && entry.diagnosticCount > 0) {
    return `${entry.diagnosticCount} err · ${formatDuration(entry.durationMs)} · ${formatRelativeAge(entry.updatedAt, now)}`;
  }
  if (status === "unavailable") {
    return entry.unavailableReason ? truncateReason(entry.unavailableReason) : "unavailable";
  }
  return `${formatDuration(entry.durationMs)} · ${formatRelativeAge(entry.updatedAt, now)}`;
}

function truncateReason(reason: string): string {
  const clean = reason.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 45)}...` : clean;
}
