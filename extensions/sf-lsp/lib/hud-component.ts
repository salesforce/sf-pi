/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Ultra-compact top-right HUD for sf-lsp.
 *
 * Renders a SINGLE line, no borders, flush right:
 *
 *   ⌁ LSP  ◐ Apex  ✓ LWC  ◌ AS  1e
 *
 * Visibility is driven by `isLspHudActive(store)` in the overlay's
 * `visible` predicate — the HUD appears while a check is running or within
 * `HUD_IDLE_HIDE_MS` of the last update, then auto-hides.
 *
 * Glyph legend:
 *   ◐  checking  (accent)
 *   ✓  clean / ok  (success)
 *   ✗  error  (error)
 *   ◌  unavailable / not probed  (warning)
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

/** How long after the last update to keep the HUD on-screen before hiding. */
export const HUD_IDLE_HIDE_MS = 8_000;

/**
 * Fixed width for the overlay box. Content is tight; keeping the width
 * constant + small ensures the top-right anchor sits flush against the
 * terminal's right edge instead of floating at `min(80, available)` (Pi's
 * default when `width` is unspecified).
 */
export const HUD_OVERLAY_WIDTH = 38;

export type HudIcon = {
  /** Rendered glyph or short text (e.g. "⌁", "◆", "[LSP]"). */
  glyph: string;
  /** Theme color key for the glyph. */
  color: "accent" | "success" | "warning" | "error" | "muted";
  /** Short label (e.g. "LSP", "SF LSP"). */
  label: string;
};

/**
 * Curated icon catalogue. Keys are stable so they can be saved in
 * settings. Glyphs stay within widely-supported ranges so fallback
 * terminals don't render them as tofu.
 */
export const HUD_ICON_CATALOGUE: Record<string, HudIcon> = {
  bolt: { glyph: "⌁", color: "accent", label: "LSP" },
  diamond: { glyph: "◆", color: "accent", label: "LSP" },
  dot: { glyph: "●", color: "accent", label: "LSP" },
  spark: { glyph: "✦", color: "accent", label: "LSP" },
  brackets: { glyph: "[LSP]", color: "accent", label: "" },
  gear: { glyph: "⚙", color: "accent", label: "LSP" },
  ring: { glyph: "◎", color: "accent", label: "LSP" },
  nib: { glyph: "✎", color: "accent", label: "LSP" },
};

export const DEFAULT_HUD_ICON: HudIcon = HUD_ICON_CATALOGUE.bolt!;

/**
 * Resolve a stored icon key (or literal glyph) to a HudIcon. Unknown
 * keys fall through as a custom glyph so users can drop any emoji or
 * short string.
 */
export function resolveHudIcon(key: string | undefined): HudIcon {
  if (!key) return DEFAULT_HUD_ICON;
  const catalogued = HUD_ICON_CATALOGUE[key];
  if (catalogued) return catalogued;
  return { glyph: key, color: "accent", label: DEFAULT_HUD_ICON.label };
}

export class SfLspHudComponent {
  private icon: HudIcon;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private store: LspActivityStore,
    icon: HudIcon = DEFAULT_HUD_ICON,
  ) {
    this.icon = icon;
  }

  setStore(store: LspActivityStore): void {
    this.store = store;
    this.tui.requestRender();
  }

  setIcon(icon: HudIcon): void {
    this.icon = icon;
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const content = this.buildContent();
    // Right-align inside the overlay cell. Pi pads the overlay to exactly
    // `width`; we manually left-pad so the content visually hugs the right
    // edge, then truncate defensively.
    const visible = visibleWidth(content);
    const pad = Math.max(0, width - visible);
    const line = `${" ".repeat(pad)}${content}`;
    return [truncateToWidth(line, width, "", true)];
  }

  private buildContent(): string {
    const theme = this.theme;
    const segments: string[] = [];

    // Brand prefix: one glyph + tight label
    const iconGlyph = theme.fg(this.icon.color, this.icon.glyph);
    const iconLabel = theme.fg("muted", this.icon.label);
    segments.push(`${iconGlyph} ${iconLabel}`);

    // Per-language status
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

    return segments.join(theme.fg("muted", "  "));
  }

  invalidate(): void {}
  dispose(): void {}
}

/**
 * Is the HUD worth showing right now? True while any language is currently
 * checking, or when the most recent update across all languages is within
 * `HUD_IDLE_HIDE_MS`.
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
