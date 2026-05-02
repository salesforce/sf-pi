/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bottom bar renderer — custom footer displayed below the text editor.
 *
 * Segments in order (left-aligned):
 *   1.  Salesforce cloud symbol
 *   2.  Default org name + type badge (sandbox/prod/scratch/dev)
 *   3.  Connection status
 *   4.  SF CLI version + freshness indicator
 *
 * Right-aligned:
 *   5.  Extension statuses from sf-pi extensions (monthly budget, package
 *       count, Slack connection pill)
 *
 * Token usage and session cost are intentionally omitted — the top bar
 * context window progress and model segment provide sufficient session context.
 * Pi core package statuses (e.g. "13 pkgs • ↻ daily") are filtered out to
 * keep the bar focused on Salesforce-relevant information.
 *
 * Pure function: takes state, returns themed string (one line).
 */

import type { OrgType } from "../../../lib/common/sf-environment/types.ts";
import { glyph, resolveGlyphMode, type GlyphMode } from "../../../lib/common/glyph-policy.ts";
import type { CliFreshness } from "./cli-freshness.ts";

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
const ALLOWED_STATUS_KEYS = new Set([
  "sf-pi",
  "sf-llm-gateway-internal",
  "sf-slack-status",
  "sf-lsp",
]);

export type BottomBarState = {
  /** Org alias or username. */
  orgName?: string;
  /** Org type for badge rendering. */
  orgType?: OrgType;
  /** Connection status string, e.g. "Connected". */
  connectedStatus?: string;
  /** Whether the org was detected at all. */
  orgDetected?: boolean;
  /** SF CLI installed version. */
  cliVersion?: string;
  /** CLI freshness check result. */
  cliFreshness: CliFreshness;
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

  // 1. Salesforce org icon (using server/database icon for better visibility)
  const isProd = state.orgType === "production";
  const orgIconColor = isProd ? "error" : "accent";
  leftSegments.push(theme.bold(theme.fg(orgIconColor, glyph("node", mode))));

  // 2. Org name + type badge (bracketed format: "OrgName [⬡ type]")
  if (state.orgDetected && state.orgName) {
    const badge = formatOrgTypeBadge(state.orgType, theme, mode);
    const orgLabel = badge ? `${state.orgName} [${badge}]` : state.orgName;
    leftSegments.push(theme.bold(theme.fg(isProd ? "error" : "accent", orgLabel)));
  } else if (state.orgName) {
    leftSegments.push(hexFg("#cc8866", `${glyph("warn", mode)} ${state.orgName} — disconnected`));
  } else {
    leftSegments.push(hexFg("#cc8866", `${glyph("warn", mode)} No org configured`));
  }

  // 3. Connection status
  if (state.orgDetected) {
    const status = state.connectedStatus ?? "unknown";
    const isConnected = status.toLowerCase() === "connected";
    leftSegments.push(
      isConnected
        ? theme.fg("success", "✓ Connected")
        : hexFg("#cc8866", `${glyph("warn", mode)} ${status}`),
    );
  }

  // 4. SF CLI version + freshness ("SF CLI Version: x.y.z")
  if (state.cliVersion) {
    let cliSeg = theme.fg("dim", `SF CLI Version: ${state.cliVersion}`);
    cliSeg += " " + formatCliFreshnessBadge(state.cliFreshness, theme);
    leftSegments.push(cliSeg);
  }

  // --- Right side ---
  const rightSegments: string[] = [];

  // 5. Extension statuses from sf-pi extensions (filtered to allowed keys)
  if (state.extensionStatuses?.size) {
    for (const [key, value] of state.extensionStatuses) {
      if (value && ALLOWED_STATUS_KEYS.has(key)) rightSegments.push(value);
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

/**
 * CLI freshness badge: "✓ latest", "↑ update", or nothing while checking.
 */
function formatCliFreshnessBadge(status: CliFreshness, theme: BarTheme): string {
  switch (status) {
    case "latest":
      return theme.fg("success", "✓ latest");
    case "update-available":
      return hexFg("#cc8866", "↑ update");
    case "checking":
      return theme.fg("dim", "…");
    case "unknown":
      return "";
  }
}
