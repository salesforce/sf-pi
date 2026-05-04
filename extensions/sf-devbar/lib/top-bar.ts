/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Top bar renderer — widget displayed above the text editor.
 *
 * Segments in order:
 *   1.  SF Pi brand icons
 *   2.  Model name (with SF LLM Gateway rainbow badge if applicable)
 *   3.  Thinking level (rainbow gradient when active)
 *   4.  Working folder
 *   5.  Git branch + change counts
 *   6.  Context Window progress bar (grey background for available space)
 *
 * Pure function: takes state, returns themed string array (one line).
 */

import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { formatGitChanges, type GitChanges } from "./git-changes.ts";
import { resolveGlyphMode, type GlyphMode } from "../../../lib/common/glyph-policy.ts";
import type {
  SfLspActivity,
  SfLspAvailability,
  SfLspHealthSnapshot,
  SfLspLanguageEntry,
  SupportedLspLanguage,
} from "../../../lib/common/sf-lsp-health/index.ts";
import { languageFullName } from "../../../lib/common/sf-lsp-health/types.ts";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

/** Minimal theme interface compatible with Pi's ctx.ui.theme. */
export type BarTheme = {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
};

export type TopBarState = {
  /** Model display name, e.g. "Claude Opus 4.7". */
  modelName?: string;
  /** Per-language Salesforce LSP health snapshot. */
  lspHealth?: SfLspHealthSnapshot;
  /** Model provider id, e.g. "sf-llm-gateway-internal" or "anthropic". */
  modelProvider?: string;
  /** Context window size in tokens, e.g. 1000000. */
  contextWindow?: number;
  /** Current thinking level. */
  thinkingLevel?: string;
  /** Base name of the working directory. */
  folderName: string;
  /** Current git branch name. */
  gitBranch?: string | null;
  /** Git change counts from `git status`. */
  gitChanges?: GitChanges | null;
  /** Context usage percentage 0-100. */
  contextPercent?: number | null;
  /** Whether the agent is currently processing a turn. */
  isThinking?: boolean;
  /** Inline image width pill text, e.g. "img:120c". Empty when the user
   * left Pi's default (`terminal.imageWidthCells = 60`). */
  imageWidthPill?: string;
  /** Optional glyph mode override (test hook). Production auto-detects. */
  glyphMode?: GlyphMode;
};

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

/**
 * The unified sf-llm-gateway-internal provider. Since R1·Unify every model
 * (OpenAI-compat + Claude) is registered under this single id and gets the
 * same rainbow [SF LLM Gateway] badge. The retired
 * `sf-llm-gateway-internal-anthropic` id is still recognized so any
 * in-flight session that was opened against older sf-pi code keeps rendering
 * correctly until the one-shot settings migration runs.
 */
const SF_GATEWAY_PROVIDERS = new Set<string>([
  "sf-llm-gateway-internal",
  "sf-llm-gateway-internal-anthropic",
]);

function isGatewayProvider(provider: string | undefined): boolean {
  return provider !== undefined && SF_GATEWAY_PROVIDERS.has(provider);
}

/** Powerline thin-right separator between segments (matches pi-powerline-footer). */
const SEP_CHAR = "\ue0b1";

// -------------------------------------------------------------------------------------------------
// Renderer
// -------------------------------------------------------------------------------------------------

/**
 * Render the top bar as a single themed line.
 *
 * Back-compat thin wrapper over `renderTopBarParts`. The permanent LSP
 * health segment lives on the right side; the widget factory in
 * `index.ts` handles right-alignment at the current terminal width.
 */
export function renderTopBar(state: TopBarState, theme: BarTheme): string[] {
  const { left, right } = renderTopBarParts(state, theme);
  return right ? [`${left}  ${right}`] : [left];
}

/**
 * Terminal-width-aware single-line renderer. Left side is flush-left,
 * right side (permanent LSP health segment) is flush-right at the
 * current terminal width. If the combined content doesn't fit, the
 * right side wins and the left side is truncated with an ellipsis —
 * availability is the permanent signal users asked for.
 */
export function renderTopBarLine(state: TopBarState, theme: BarTheme, width: number): string[] {
  const { left, right } = renderTopBarParts(state, theme);
  if (!right) return [truncateToWidth(left, width)];
  const leftW = visibleWidth(left);
  const rightW = visibleWidth(right);
  const minGap = 2;

  if (leftW + minGap + rightW <= width) {
    const pad = " ".repeat(width - leftW - rightW);
    return [`${left}${pad}${right}`];
  }

  // Not enough room — truncate the left side to make room for the right.
  const budget = Math.max(0, width - rightW - minGap);
  const truncatedLeft = truncateToWidth(left, budget, "…");
  const actual = visibleWidth(truncatedLeft);
  const gap = Math.max(minGap, width - actual - rightW);
  return [`${truncatedLeft}${" ".repeat(gap)}${right}`];
}

/**
 * Render the top bar as left / right joined segments. Used by the widget
 * factory in `extensions/sf-devbar/index.ts` to right-align the LSP
 * health segment against the terminal's right edge.
 */
export function renderTopBarParts(
  state: TopBarState,
  theme: BarTheme,
): { left: string; right: string } {
  const sep = ` ${theme.fg("dim", SEP_CHAR)} `;
  const mode = state.glyphMode ?? resolveGlyphMode();
  const leftSegments: string[] = [];

  // 1. SF Pi brand icon + powerline separator + model segment (no gap)
  const brandIcon = theme.bold(theme.fg("accent", mode === "ascii" ? "sf-pi" : "\ue22c"));
  const modelSeg = formatModelSegment(state, theme, mode);
  leftSegments.push(brandIcon + sep + modelSeg);

  // 2. Thinking level (rainbow gradient, hidden when "off")
  const thinkSeg = formatThinkingSegment(state.thinkingLevel, theme);
  if (thinkSeg) leftSegments.push(thinkSeg);

  // 3. Working folder — teal color matching pi-powerline-footer
  leftSegments.push(formatFolderSegment(state.folderName, mode));

  // 4. Git branch + changes
  const gitSeg = formatGitSegment(state, theme, mode);
  if (gitSeg) leftSegments.push(gitSeg);

  // 5. Context window progress bar
  const ctxSeg = formatContextSegment(state.contextPercent, theme);
  if (ctxSeg) leftSegments.push(ctxSeg);

  // 6. Optional inline-image-width pill — only when the user has nudged the
  //    setting away from Pi's default, so the bar stays uncluttered for
  //    everyone else.
  if (state.imageWidthPill) {
    leftSegments.push(theme.fg("muted", state.imageWidthPill));
  }

  // 7. Thinking indicator (subtle pulse when agent is working)
  if (state.isThinking) {
    leftSegments.push(theme.fg("accent", "⟳"));
  }

  const rightSegments: string[] = [];

  // LSP health segment — permanent, full names, colored by availability.
  const lspSeg = formatLspHealthSegment(state.lspHealth, theme);
  if (lspSeg) rightSegments.push(lspSeg);

  return {
    left: leftSegments.join(sep),
    right: rightSegments.join(sep),
  };
}

/**
 * Render the permanent LSP health segment:
 *
 *   LSP[Apex: ● | LWC: ✓ | AgentScript: ◐]
 *
 * The `LSP[…]` wrapper labels the segment so new users don't mistake the
 * three colored dots for "feature enabled" indicators — they report the
 * health of the Apex / LWC / Agent Script Language Server Protocol
 * backends that power sf-lsp diagnostics.
 *
 * The glyph blends *availability* (can we run diagnostics for this
 * language at all?) with the *most recent activity* (is a check running
 * right now? did the last one pass?). This gives the user a single
 * at-a-glance read:
 *
 *   ◌  dim        — unknown (not probed yet / session just started)
 *   ○  warning    — unavailable (LSP jar / server / binary missing)
 *   ●  success    — available, no activity yet (ready / healthy)
 *   ◐  accent     — check in flight right now
 *   ✓  success    — last check was clean
 *   ✗  error      — last check reported errors
 *
 * On color fallback terminals the glyph shape alone still disambiguates.
 */
export function formatLspHealthSegment(
  snapshot: SfLspHealthSnapshot | undefined,
  theme: BarTheme,
): string | null {
  if (!snapshot) return null;
  const languages: SupportedLspLanguage[] = ["apex", "lwc", "agentscript"];
  const bar = theme.fg("dim", " | ");
  const body = languages
    .map((language) => {
      const entry = snapshot.byLanguage[language];
      const { glyph, color, bold } = resolveLspStatus(entry);
      const label = theme.fg("muted", `${languageFullName(language)}:`);
      const coloredGlyph = bold ? theme.fg(color, theme.bold(glyph)) : theme.fg(color, glyph);
      return `${label} ${coloredGlyph}`;
    })
    .join(bar);
  const open = theme.fg("muted", "LSP[");
  const close = theme.fg("muted", "]");
  return `${open}${body}${close}`;
}

export type LspStatusRender = {
  glyph: string;
  color: "success" | "error" | "warning" | "accent" | "muted" | "dim";
  bold: boolean;
};

/**
 * Pure glyph/color resolver. Exported so tests can assert on the raw
 * render without having to parse ANSI escape sequences.
 *
 * Activity dominates when the language is available: 'error' is stickiest
 * because unresolved errors matter more than "last clean check". When
 * availability is unknown or unavailable, activity is ignored.
 */
export function resolveLspStatus(entry: SfLspLanguageEntry): LspStatusRender {
  switch (entry.availability) {
    case "unknown":
      return { glyph: "◌", color: "dim", bold: false };
    case "unavailable":
      return { glyph: "○", color: "warning", bold: true };
    case "available":
      return renderActivityGlyph(entry.activity);
    default:
      return { glyph: "◌", color: "dim", bold: false };
  }
}

function renderActivityGlyph(activity: SfLspActivity): LspStatusRender {
  switch (activity) {
    case "checking":
      return { glyph: "◐", color: "accent", bold: true };
    case "clean":
      return { glyph: "✓", color: "success", bold: true };
    case "error":
      return { glyph: "✗", color: "error", bold: true };
    case "idle":
    default:
      return { glyph: "●", color: "success", bold: false };
  }
}

// Keep types importable for other callers.
export type { SfLspAvailability, SfLspActivity };

// -------------------------------------------------------------------------------------------------
// Segment formatters
// -------------------------------------------------------------------------------------------------

/**
 * Teal color for folder path, matching pi-powerline-footer's "path" color (#00afaf).
 */
const TEAL_HEX = "#00afaf";

/**
 * Light pink/mauve for model name, matching pi-powerline-footer's "model" color (#d787af).
 */
const MODEL_PINK_HEX = "#d787af";

/** Apply a hex color to text using raw ANSI true-color escapes. */
function hexFg(hex: string, text: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

/** Apply foreground + background using raw ANSI true-color escapes. */
function hexFgBg(fgHex: string, bgHex: string, text: string): string {
  const fh = fgHex.replace("#", "");
  const bh = bgHex.replace("#", "");
  const fr = parseInt(fh.slice(0, 2), 16),
    fg = parseInt(fh.slice(2, 4), 16),
    fb = parseInt(fh.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16),
    bg = parseInt(bh.slice(2, 4), 16),
    bb = parseInt(bh.slice(4, 6), 16);
  return `\x1b[38;2;${fr};${fg};${fb};48;2;${br};${bg};${bb}m${text}\x1b[0m`;
}

/**
 * Render text as a smooth rainbow gradient (similar to think:xhigh).
 *
 * Each visible character gets an interpolated color from a pastel rainbow
 * palette. Spaces and punctuation pass through without advancing the color.
 */
function rainbowGradient(text: string): string {
  const palette: [number, number, number][] = [
    [178, 129, 214], // lavender
    [215, 135, 175], // pink
    [254, 188, 56], // gold
    [137, 210, 129], // green
    [0, 175, 175], // teal
    [23, 143, 185], // blue
    [178, 129, 214], // lavender (wrap)
  ];

  // Count color-cycling characters (skip brackets, spaces)
  const skipChars = new Set([" ", "[", "]"]);
  const colorChars = [...text].filter((c) => !skipChars.has(c)).length;
  if (colorChars === 0) return text;

  let result = "";
  let colorIdx = 0;
  for (const ch of text) {
    if (skipChars.has(ch)) {
      result += ch;
      continue;
    }
    const t = colorIdx / Math.max(colorChars - 1, 1);
    const pos = t * (palette.length - 1);
    const i = Math.min(Math.floor(pos), palette.length - 2);
    const frac = pos - i;
    const r = Math.round(palette[i][0] + (palette[i + 1][0] - palette[i][0]) * frac);
    const g = Math.round(palette[i][1] + (palette[i + 1][1] - palette[i][1]) * frac);
    const b = Math.round(palette[i][2] + (palette[i + 1][2] - palette[i][2]) * frac);
    result += `\x1b[38;2;${r};${g};${b}m${ch}`;
    colorIdx++;
  }
  result += "\x1b[0m";
  return result;
}

/**
 * Strip gateway prefix and context window labels from a model name.
 *
 * The sf-llm-gateway-internal extension bakes "[SF LLM Gateway]" and
 * context window labels like "[1M]" directly into model names
 * (e.g. "[SF LLM Gateway] Claude Opus 4.7 [1M] Global").
 * We render our own gateway badge and context size, so strip duplicates.
 */
function cleanModelName(raw: string): string {
  return raw
    .replace(/^\[SF LLM Gateway\]\s*/i, "")
    .replace(/\s*\[\d+[KMkm]\]\s*/g, " ")
    .trim();
}

function formatModelSegment(state: TopBarState, theme: BarTheme, mode: GlyphMode): string {
  const parts: string[] = [];

  // Robot/chip icon. Nerd Font glyphs look great in Ghostty/iTerm but
  // render as tofu in Terminal.app; ASCII mode keeps the top bar readable.
  parts.push(theme.fg("accent", mode === "ascii" ? "AI" : "\uec19"));

  // SF LLM Gateway badge (rainbow gradient) — shown once for either
  // provider registration (OpenAI-compat or Anthropic-native).
  const isGateway = isGatewayProvider(state.modelProvider);
  if (isGateway) {
    parts.push(theme.bold(rainbowGradient("[SF LLM Gateway]")));
  }

  // Model name — strip embedded gateway/size labels to avoid duplication
  const rawName = state.modelName ?? "no model";
  const name = cleanModelName(rawName);

  // Context window label appended to cleaned model name (single source of truth)
  let modelLabel = name;
  if (state.contextWindow) {
    const sizeLabel = formatContextWindowSize(state.contextWindow);
    modelLabel += ` [${sizeLabel}]`;
  }

  // Apply consistent pink color when using gateway, otherwise muted.
  parts.push(isGateway ? hexFg(MODEL_PINK_HEX, modelLabel) : theme.fg("muted", modelLabel));

  return parts.join(" ");
}

/** Format context window: 1000000 → "1M", 200000 → "200K". */
function formatContextWindowSize(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m === Math.floor(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return k === Math.floor(k) ? `${k}K` : `${k.toFixed(0)}K`;
  }
  return `${tokens}`;
}

/**
 * Render the thinking level as a rainbow gradient string.
 *
 * Uses the same softer pastel rainbow palette as pi-powerline-footer for
 * high/xhigh levels, and a muted theme color for lower levels.
 * Returns null when thinking is "off" or undefined.
 */
function formatThinkingSegment(level: string | undefined, theme: BarTheme): string | null {
  if (!level || level === "off") return null;

  const label = `think:${level}`;

  // Only use rainbow for high/xhigh (matching pi-powerline-footer behavior)
  if (level === "high" || level === "xhigh") {
    // Softer pastel rainbow matching pi-powerline-footer's RAINBOW_COLORS
    const rainbowHexColors = [
      "#b281d6",
      "#d787af",
      "#febc38",
      "#e4c00f",
      "#89d281",
      "#00afaf",
      "#178fb9",
      "#b281d6",
    ];

    let rainbow = "";
    let colorIndex = 0;
    for (const char of label) {
      // Skip spaces and colons from color cycling (matching pi-powerline-footer)
      if (char === " " || char === ":") {
        rainbow += char;
      } else {
        rainbow += hexFg(rainbowHexColors[colorIndex % rainbowHexColors.length], char).replace(
          "\x1b[0m",
          "",
        ); // Strip individual resets, add one at end
        colorIndex++;
      }
    }
    rainbow += "\x1b[0m";
    return rainbow;
  }

  // Lower thinking levels: use muted theme color
  return theme.fg("muted", label);
}

/**
 * Render the working folder in teal, matching pi-powerline-footer's "path" color.
 */
function formatFolderSegment(folderName: string, mode: GlyphMode): string {
  const icon = mode === "ascii" ? "dir" : "📂";
  return hexFg(TEAL_HEX, `${icon} ${folderName}`);
}

function formatGitSegment(state: TopBarState, theme: BarTheme, mode: GlyphMode): string | null {
  if (!state.gitBranch) return null;

  const icon = mode === "ascii" ? "git" : "\uf126";
  let seg = theme.fg("success", `${icon} ${state.gitBranch}`);

  if (state.gitChanges) {
    const changes = formatGitChanges(state.gitChanges);
    if (changes) {
      seg += " " + theme.fg("muted", changes);
    }
  }

  return seg;
}

/**
 * Render the context window progress bar.
 *
 * Visual: "Context Window [████▌░░░░░] 32.4%"
 *
 * Granularity: the bar uses 1/8-block partials (▏▎▍▌▋▊▉█) on top of a
 * 10-cell track, giving 80 distinct fill positions (~1.25% per step). The
 * percent label is shown with one decimal place so small shifts remain
 * visible numerically even when the bar cell doesn't change.
 *
 * Uses a light grey background for the empty portion to show available space.
 * Colors: teal <60%, amber 60-80%, red >80%.
 */
function formatContextSegment(percent: number | null | undefined, theme: BarTheme): string | null {
  if (percent == null) return null;

  const clamped = Math.max(0, Math.min(100, percent));
  const barWidth = 10;
  // 1/8 block characters, ordered from empty -> full. Index 0 is unused.
  const partials = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
  const eighths = Math.round((clamped / 100) * barWidth * 8);
  const fullCells = Math.floor(eighths / 8);
  const remainder = eighths % 8;
  const hasPartial = remainder > 0 && fullCells < barWidth;
  const emptyCells = barWidth - fullCells - (hasPartial ? 1 : 0);

  // Color based on usage level — thresholds use the raw float so the
  // color flip happens at the true boundary, not an integer-rounded one.
  const color = clamped > 80 ? "error" : clamped > 60 ? "warning" : "success";

  const filledStr = theme.fg(
    color,
    "█".repeat(fullCells) + (hasPartial ? partials[remainder] : ""),
  );
  // Grey background on empty portion to show available space clearly
  const emptyStr = emptyCells > 0 ? hexFgBg("#3c3c4a", "#28282e", "░".repeat(emptyCells)) : "";
  const labelText = `${clamped.toFixed(1)}%`;
  const label = clamped > 80 ? theme.bold(theme.fg(color, labelText)) : theme.fg(color, labelText);

  return `${theme.fg("dim", "Context Window")} ${filledStr}${emptyStr} ${label}`;
}
