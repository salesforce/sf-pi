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
 *   7.  Optional Pi session name (lowest-priority left segment)
 *
 * Pure function: takes state, returns themed string array (one line).
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import { normalizeAnsiForTerminal } from "../../../lib/common/color-policy.ts";
import { formatGitChanges, type GitChanges } from "./git-changes.ts";
import { DEFAULT_DEVBAR_COLORS, type DevbarColors } from "./colors.ts";
import { resolveGlyphMode, type GlyphMode } from "../../../lib/common/glyph-policy.ts";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

/** Minimal theme interface compatible with Pi's ctx.ui.theme. */
export type BarTheme = {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
};

export type TopBarState = {
  /** Model display name, e.g. "Example Gateway Model". */
  modelName?: string;
  /** Model provider id, e.g. "sf-llm-gateway" or "anthropic". */
  modelProvider?: string;
  /** Context window size in tokens, e.g. 1000000. */
  contextWindow?: number;
  /** Current thinking level. */
  thinkingLevel?: string;
  /** Base name of the working directory. */
  folderName: string;
  /** Public Pi session display name, when the user assigned one. */
  sessionName?: string;
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
  /** Resolved DevBar-owned true-color accents. Defaults preserve classic colors. */
  colors?: DevbarColors;
};

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

/** The canonical gateway provider receives the rainbow badge. */
const SF_GATEWAY_PROVIDERS = new Set<string>(["sf-llm-gateway"]);

function isGatewayProvider(provider: string | undefined): boolean {
  return provider !== undefined && SF_GATEWAY_PROVIDERS.has(provider);
}

/** Powerline thin-right separator between segments (matches pi-powerline-footer). */
const SEP_CHAR = "\ue0b1";
const SESSION_SEGMENT_MAX_WIDTH = 32;

// -------------------------------------------------------------------------------------------------
// Renderer
// -------------------------------------------------------------------------------------------------

/** Render the DevBar as one themed line without cross-extension health status. */
export function renderTopBar(state: TopBarState, theme: BarTheme): string[] {
  return [renderTopBarContent(state, theme)];
}

/** Bound the single DevBar line to the current terminal width. */
export function renderTopBarLine(state: TopBarState, theme: BarTheme, width: number): string[] {
  return [truncateToWidth(renderTopBarContent(state, theme), width, "…")];
}

function renderTopBarContent(state: TopBarState, theme: BarTheme): string {
  const sep = ` ${theme.fg("dim", SEP_CHAR)} `;
  const mode = state.glyphMode ?? resolveGlyphMode();
  const colors = state.colors ?? DEFAULT_DEVBAR_COLORS;
  const segments: string[] = [];

  // 1. SF Pi brand icon + powerline separator + model segment (no gap)
  const brandIcon = theme.bold(theme.fg("accent", mode === "ascii" ? "sf-pi" : "\ue22c"));
  const modelSeg = formatModelSegment(state, theme, mode, colors);
  segments.push(brandIcon + sep + modelSeg);

  // 2. Thinking level (rainbow gradient, hidden when "off")
  const thinkSeg = formatThinkingSegment(state.thinkingLevel, theme, colors);
  if (thinkSeg) segments.push(thinkSeg);

  // 3. Working folder — teal color matching pi-powerline-footer
  segments.push(formatFolderSegment(state.folderName, mode, colors));

  // 4. Git branch + changes
  const gitSeg = formatGitSegment(state, theme, mode);
  if (gitSeg) segments.push(gitSeg);

  // 5. Context window progress bar
  const ctxSeg = formatContextSegment(state.contextPercent, theme, colors);
  if (ctxSeg) segments.push(ctxSeg);

  // 6. Optional inline-image-width pill — only when the user has nudged the
  //    setting away from Pi's default, so the bar stays uncluttered for
  //    everyone else.
  if (state.imageWidthPill) {
    segments.push(theme.fg("muted", state.imageWidthPill));
  }

  // 7. Thinking indicator (subtle pulse when agent is working)
  if (state.isThinking) {
    segments.push(theme.fg("accent", "⟳"));
  }

  // 8. Optional public Pi session name. Keep it last so model, project,
  // context, and active-work facts win when the terminal is narrow.
  const sessionSeg = formatSessionSegment(state.sessionName, theme);
  if (sessionSeg) segments.push(sessionSeg);

  return normalizeAnsiForTerminal(segments.join(sep));
}

// -------------------------------------------------------------------------------------------------
// Segment formatters
// -------------------------------------------------------------------------------------------------

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
  const [fr, fg, fb] = hexToRgb(fgHex);
  const [br, bg, bb] = hexToRgb(bgHex);
  return `\x1b[38;2;${fr};${fg};${fb};48;2;${br};${bg};${bb}m${text}\x1b[0m`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Render text as a smooth rainbow gradient (similar to think:xhigh).
 *
 * Each visible character gets an interpolated color from a pastel rainbow
 * palette. Spaces and punctuation pass through without advancing the color.
 */
function rainbowGradient(text: string, hexPalette: readonly string[]): string {
  const palette = (hexPalette.length > 0 ? hexPalette : DEFAULT_DEVBAR_COLORS.gatewayRainbow).map(
    hexToRgb,
  );

  // A single-color palette is a valid solid-color badge config. Duplicate it
  // locally so the interpolation math can keep using [current, next] stops.
  if (palette.length === 1) {
    const solidColor = palette[0];
    if (solidColor) palette.push(solidColor);
  }

  // Spaces separate words but should not consume gradient steps. Brackets are
  // visual badge edges, so color them as part of the badge.
  const skipChars = new Set([" "]);
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
 * The sf-llm-gateway extension bakes "[SF LLM Gateway]" and
 * context window labels like "[1M]" directly into model names
 * (e.g. "[SF LLM Gateway] Example Gateway Model [1M] Global").
 * We render our own gateway badge and context size, so strip duplicates.
 */
function cleanModelName(raw: string): string {
  return raw
    .replace(/^\[SF LLM Gateway\]\s*/i, "")
    .replace(/\s*\[\d+[KMkm]\]\s*/g, " ")
    .trim();
}

function formatModelSegment(
  state: TopBarState,
  theme: BarTheme,
  mode: GlyphMode,
  colors: DevbarColors,
): string {
  const parts: string[] = [];

  // Robot/chip icon. Nerd Font glyphs look great in Ghostty/iTerm but
  // render as tofu in Terminal.app; ASCII mode keeps the top bar readable.
  parts.push(theme.fg("accent", mode === "ascii" ? "AI" : "\uec19"));

  // SF LLM Gateway badge (rainbow gradient) — shown once for either
  // provider registration (OpenAI-compat or Anthropic-native).
  const isGateway = isGatewayProvider(state.modelProvider);
  if (isGateway) {
    parts.push(theme.bold(rainbowGradient("[SF LLM Gateway]", colors.gatewayRainbow)));
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
  parts.push(isGateway ? hexFg(colors.modelName, modelLabel) : theme.fg("muted", modelLabel));

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
function formatThinkingSegment(
  level: string | undefined,
  theme: BarTheme,
  colors: DevbarColors,
): string | null {
  if (!level || level === "off") return null;

  const label = `think:${level}`;

  // Only use rainbow for high/xhigh (matching pi-powerline-footer behavior)
  if (level === "high" || level === "xhigh") {
    let rainbow = "";
    let colorIndex = 0;
    for (const char of label) {
      // Skip spaces and colons from color cycling (matching pi-powerline-footer)
      if (char === " " || char === ":") {
        rainbow += char;
      } else {
        const color =
          colors.thinkingRainbow[colorIndex % colors.thinkingRainbow.length] ??
          DEFAULT_DEVBAR_COLORS.thinkingRainbow[0] ??
          DEFAULT_DEVBAR_COLORS.modelName;
        rainbow += hexFg(color, char).replace("\x1b[0m", ""); // Strip individual resets, add one at end
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
function formatFolderSegment(folderName: string, mode: GlyphMode, colors: DevbarColors): string {
  const icon = mode === "ascii" ? "dir" : "📂";
  return hexFg(colors.folderPath, `${icon} ${folderName}`);
}

function formatSessionSegment(sessionName: string | undefined, theme: BarTheme): string | null {
  const name = sessionName?.trim();
  if (!name) return null;
  return theme.fg("muted", truncateToWidth(`session:${name}`, SESSION_SEGMENT_MAX_WIDTH, "…"));
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
function formatContextSegment(
  percent: number | null | undefined,
  theme: BarTheme,
  colors: DevbarColors,
): string | null {
  if (percent === undefined) return null;
  if (percent === null) {
    return `${theme.fg("dim", "Context Window")} ${theme.fg("muted", "unknown")}`;
  }

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
  const emptyStr =
    emptyCells > 0
      ? hexFgBg(colors.contextEmptyFg, colors.contextEmptyBg, "░".repeat(emptyCells))
      : "";
  const labelText = `${clamped.toFixed(1)}%`;
  const label = clamped > 80 ? theme.bold(theme.fg(color, labelText)) : theme.fg(color, labelText);

  return `${theme.fg("dim", "Context Window")} ${filledStr}${emptyStr} ${label}`;
}
