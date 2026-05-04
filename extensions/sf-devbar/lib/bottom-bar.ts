/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bottom bar renderer — custom footer displayed below the text editor.
 *
 * Segments in order (left-aligned):
 *   1.  LLM gateway monthly cost
 *   2.  SF Pi package count
 *   3.  SFDX project → authenticated org + type badge, only inside a
 *       Salesforce DX project
 *
 * Right-aligned:
 *   4.  Slack connection pill
 *
 * Token usage, connection status, and SF CLI version/freshness are
 * intentionally omitted — the top bar context window and SF Welcome already
 * cover broader session and environment details.
 * Pi core package statuses (e.g. "13 pkgs • ↻ daily") are filtered out to
 * keep the bar focused on Salesforce-relevant information.
 *
 * Pure function: takes state, returns themed string (one line).
 */

import type { OrgType } from "../../../lib/common/sf-environment/types.ts";
import { glyph, resolveGlyphMode, type GlyphMode } from "../../../lib/common/glyph-policy.ts";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

/** Minimal theme interface compatible with Pi's ctx.ui.theme. */
export type BarTheme = {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
};

/** Status keys from sf-pi extensions that should appear on the bottom bar.
 *
 * Only curated extensions are surfaced so the bar stays focused. Keep this
 * list small — every added key costs horizontal space on narrow terminals. */
const LEFT_STATUS_ORDER = ["sf-llm-gateway-internal", "sf-pi"];
const RIGHT_STATUS_KEYS = new Set(["sf-slack-status"]);

export type BottomBarState = {
  /** Org alias or username. */
  orgName?: string;
  /** Org type for badge rendering. */
  orgType?: OrgType;
  /** Whether the current folder is a Salesforce DX project. */
  projectDetected?: boolean;
  /** Whether the org was detected at all. */
  orgDetected?: boolean;
  /** Extension statuses from other extensions (from footerData). */
  extensionStatuses?: ReadonlyMap<string, string>;
  /** Optional glyph mode override (test hook). Production leaves this
   * undefined and lets `resolveGlyphMode()` auto-detect. */
  glyphMode?: GlyphMode;
};

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

/** Powerline thin-right separator between segments (matches pi-powerline-footer). */
const SEP_CHAR = "\ue0b1";

// -------------------------------------------------------------------------------------------------
// Renderer
// -------------------------------------------------------------------------------------------------

/** Apply a hex color to text using raw ANSI true-color escapes. */
function hexFg(hex: string, text: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

/**
 * Render the bottom bar as a left + right aligned string.
 *
 * The caller (index.ts) handles the width-aware padding between left and right
 * using visibleWidth from pi-tui. This function returns the two halves.
 */
export function renderBottomBarParts(
  state: BottomBarState,
  theme: BarTheme,
): { left: string; right: string } {
  const sep = ` ${theme.fg("dim", SEP_CHAR)} `;
  // Resolve glyph mode once per render so every segment stays consistent.
  // Terminal.app lacks fonts for `⬢`/`⬡` (Miscellaneous Symbols), so on
  // that terminal we swap in ASCII fallbacks to avoid tofu boxes around
  // the org badge.
  const mode: GlyphMode = state.glyphMode ?? resolveGlyphMode();

  // --- Left side ---
  const leftSegments: string[] = [];

  // 1–2. Extension statuses use a fixed order so cost stays leftmost and
  // package health stays next, regardless of footerData map insertion order.
  if (state.extensionStatuses?.size) {
    for (const key of LEFT_STATUS_ORDER) {
      const value = state.extensionStatuses.get(key);
      if (value) leftSegments.push(value);
    }
  }

  // 3. SFDX project → org + type badge. Keep org context project-scoped so a
  // global default org does not appear while the user is outside a Salesforce
  // folder. The "SFDX Project" prefix is the explicit environment indicator.
  if (state.projectDetected) {
    leftSegments.push(formatProjectOrgSegment(state, theme, mode));
  }

  // --- Right side ---
  const rightSegments: string[] = [];

  if (state.extensionStatuses?.size) {
    for (const [key, value] of state.extensionStatuses) {
      if (value && RIGHT_STATUS_KEYS.has(key)) rightSegments.push(value);
    }
  }

  return {
    left: leftSegments.join(sep),
    right: rightSegments.join(sep),
  };
}

// -------------------------------------------------------------------------------------------------
// Segment formatters
// -------------------------------------------------------------------------------------------------

function formatProjectOrgSegment(state: BottomBarState, theme: BarTheme, mode: GlyphMode): string {
  const prefix = theme.fg("dim", "SFDX Project →");
  const isProd = state.orgType === "production";

  if (state.orgDetected && state.orgName) {
    const badge = formatOrgTypeBadge(state.orgType, theme, mode);
    const orgLabel = badge ? `${state.orgName} [${badge}]` : state.orgName;
    return `${prefix} ${theme.bold(theme.fg(isProd ? "error" : "accent", orgLabel))}`;
  }

  if (state.orgName) {
    return `${prefix} ${hexFg("#cc8866", `${glyph("warn", mode)} ${state.orgName}`)}`;
  }

  return `${prefix} ${hexFg("#cc8866", `${glyph("warn", mode)} No org configured`)}`;
}

/**
 * Org type badge — returns the raw badge text without brackets.
 * The caller wraps it in brackets: "OrgName [⬡ sandbox]".
 *
 * Production gets a bold red warning. Others get calm colored badges.
 */
function formatOrgTypeBadge(
  orgType: OrgType | undefined,
  theme: BarTheme,
  mode: GlyphMode,
): string | null {
  switch (orgType) {
    case "sandbox":
      return hexFg("#82aacc", `${glyph("hex", mode)} sandbox`);
    case "scratch":
      return theme.fg("accent", `${glyph("diamondOpen", mode)} scratch`);
    case "developer":
      return theme.fg("accent", `${glyph("diamondSolid", mode)} dev`);
    case "production":
      return theme.bold(theme.fg("error", `${glyph("warn", mode)} PRODUCTION`));
    case "trial":
      return hexFg("#82aacc", `${glyph("hex", mode)} trial`);
    case "unknown":
    default:
      return null;
  }
}
