/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Compact top-right HUD for sf-lsp.
 *
 * One line, status-only, no filenames or durations:
 *
 *   ╭─────────────────────────────────────╮
 *   │ 🩻 SF LSP  ◐ Apex  ✓ LWC  ◌ AS  1e │
 *   ╰─────────────────────────────────────╯
 *
 * Visibility is driven by the caller (`isLspHudActive`) — the HUD only
 * appears when a check is in flight or recently finished. Once everything
 * has been idle for `HUD_IDLE_HIDE_MS`, the overlay's `visible` predicate
 * returns false and Pi composites it out.
 *
 * Glyph legend (symbols the user asked for):
 *   ◐  checking  (accent)
 *   ✓  clean / ok  (success)
 *   ✗  error  (error)
 *   ◌  unavailable / not probed  (warning / dim)
 *   ●  idle but probed  (muted)
 */
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
  LANGUAGE_ORDER,
  languageLabel,
  type LspActivityEntry,
  type LspActivityStore,
  type LspActivityStatus,
} from "./activity.ts";
import type { SupportedLanguage } from "./types.ts";

/**
 * How long after the last update to keep the HUD on-screen before the
 * `visible` predicate hides it. Kept short so the HUD stays "active
 * signal" only, per user feedback.
 */
export const HUD_IDLE_HIDE_MS = 8_000;

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
    const theme = this.theme;
    // Compact single-line panel — target width is derived from content, not
    // from the overlay cell because we want it tight.
    const segments = [theme.fg("accent", theme.bold("🩻 SF LSP"))];

    let errorTotal = 0;
    let checking = false;
    for (const language of LANGUAGE_ORDER) {
      const entry = this.store.byLanguage.get(language);
      segments.push(renderLanguageSegment(language, entry, theme));
      if (entry?.status === "error") errorTotal += entry.diagnosticCount || 1;
      if (entry?.status === "checking") checking = true;
    }

    if (errorTotal > 0) {
      segments.push(theme.fg("error", theme.bold(`${errorTotal}e`)));
    } else if (checking) {
      segments.push(theme.fg("accent", "…"));
    }

    const separator = theme.fg("muted", "  ");
    const content = segments.join(separator);
    const innerWidth = Math.min(Math.max(visibleWidth(content), 32), Math.max(20, width - 2));

    const top = theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
    const bottom = theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);

    const truncated = truncateToWidth(` ${content} `, innerWidth, "", true);
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
    const body = `${theme.fg("border", "│")}${truncated}${padding}${theme.fg("border", "│")}`;

    return [top, body, bottom];
  }

  invalidate(): void {}
  dispose(): void {}
}

/**
 * Is the HUD worth showing right now? True while any language is
 * currently checking, or when the most recent update across all
 * languages is within `HUD_IDLE_HIDE_MS`.
 */
export function isLspHudActive(store: LspActivityStore, now: number = Date.now()): boolean {
  if (!store.hasActivity) return false;
  for (const entry of store.byLanguage.values()) {
    if (entry.status === "checking") return true;
    if (entry.updatedAt && now - entry.updatedAt <= HUD_IDLE_HIDE_MS) return true;
  }
  return false;
}

function renderLanguageSegment(
  language: SupportedLanguage,
  entry: LspActivityEntry | undefined,
  theme: Theme,
): string {
  const status = entry?.status ?? "idle";
  const { glyph, color } = compactGlyph(status);
  const coloredGlyph = theme.fg(color, glyph);
  const label = theme.fg(status === "idle" ? "dim" : "text", languageLabel(language));
  return `${coloredGlyph} ${label}`;
}

type CompactGlyph = {
  glyph: string;
  color: "success" | "error" | "warning" | "accent" | "muted" | "dim";
};

function compactGlyph(status: LspActivityStatus): CompactGlyph {
  switch (status) {
    case "checking":
      return { glyph: "◐", color: "accent" };
    case "clean":
    case "transition-clean":
      return { glyph: "✓", color: "success" };
    case "error":
      return { glyph: "✗", color: "error" };
    case "unavailable":
      return { glyph: "◌", color: "warning" };
    case "idle":
    default:
      return { glyph: "●", color: "muted" };
  }
}
