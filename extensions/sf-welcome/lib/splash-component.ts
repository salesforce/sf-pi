/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Welcome — Splash screen TUI component.
 *
 * Layout modes (driven by terminal width):
 *   - Two-column (default, termWidth ≥ SINGLE_COL_THRESHOLD):
 *       Left:  Gradient Pi logo, model info, monthly cost, extension health,
 *              Slack/Gateway status, SF environment
 *       Right: Announcements, What's New, loaded counts, recent sessions,
 *              recommended extensions, attribution
 *   - Single-column (narrow terminals): left block stacked above right block
 *     so no content gets squeezed or truncated with an ellipsis. See issue #17
 *     (macOS Terminal.app at ~92 cols was rendering the splash with a hard
 *     cutoff on the right edge).
 *
 * Glyph policy:
 *   Every emoji/box icon is resolved through `lib/common/glyph-policy` so
 *   terminals that lack emoji font fallback (notably Terminal.app without
 *   an emoji-capable Nerd Font) get ASCII equivalents instead of tofu.
 */
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { glyph, resolveGlyphMode, type GlyphMode } from "../../../lib/common/glyph-policy.ts";
import type { SplashData } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// ANSI helpers
// ═══════════════════════════════════════════════════════════════════════════

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";

function fg256(code: number, text: string): string {
  return `\x1b[38;5;${code}m${text}${RESET}`;
}

function fgRgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
}

// Salesforce brand colors used in this component.
const SF_BLUE = (text: string) => fgRgb(0, 112, 210, text); // #0070D2
const SF_GREEN = (text: string) => fgRgb(75, 202, 129, text); // Success green
const SF_RED = (text: string) => fgRgb(234, 69, 80, text); // Error red
const SF_ORANGE = (text: string) => fgRgb(255, 183, 93, text); // Warning
const SF_CYAN = (text: string) => fgRgb(1, 195, 226, text); // Astro cyan
const MUTED = (text: string) => fg256(245, text); // Gray muted
const ACCENT = (text: string) => fg256(75, text); // Blue accent
const GOLD = (text: string) => fgRgb(255, 183, 77, text); // Gold/amber

// ═══════════════════════════════════════════════════════════════════════════
// Pi + SF header with Salesforce gradient
//
// The splash header reads as a single Pi ╋ SF brand mark: both glyphs are
// 5 rows tall, drawn from block chars (▀ █ ▄), and painted with the same
// gradient as the existing Pi logo. A dim "+" sits between them on the
// middle row to frame the pairing as additive — sf-pi = Pi (the agent
// harness) + Salesforce (the platform it targets). The HEADER_CAPTION
// below the mark names the platform surface sf-pi exposes: Salesforce's
// Headless 360 API / MCP / CLI layer.
//
// Both arrays must stay the same row count; buildLeftColumn() zips them
// by index. Widths are intentionally unequal (Pi=14, SF=17) so each
// letterform reads cleanly.
// ═══════════════════════════════════════════════════════════════════════════

const PI_LOGO = [
  "▀████████████▀",
  "  ███    ███  ",
  "  ███    ███  ",
  "  ███    ███  ",
  " ▄███▄  ▄███▄ ",
];

// SF monogram — 17 cols, 5 rows. The S uses diagonal half-block hooks
// (▄…▄ top shoulder, ▀…▀ bottom shoulder) so the curves read smoothly at
// this resolution without needing more rows.
const SF_LOGO = [
  " ▄█████▄  ███████",
  "██        ██     ",
  " ▀█████▄  █████▀ ",
  "      ██  ██     ",
  " █████▀   ██     ",
];

// Gradient caption under the logo block. Anchors the mark to sf-pi's
// positioning: procode access to Salesforce Headless 360.
const HEADER_CAPTION = "[ Salesforce Headless 360 ]";

// 5-col gutter between Pi and SF. The middle row swaps the gutter for a
// dim "+" marker so the pairing reads as additive.
const HEADER_GUTTER = "     ";
const HEADER_PLUS_ROW = 2;

// Salesforce-inspired gradient: blue → cyan → purple
const GRADIENT_COLORS = [
  "\x1b[38;2;0;112;210m", // SF Blue
  "\x1b[38;2;1;160;230m", // Mid blue
  "\x1b[38;2;1;195;226m", // Astro cyan
  "\x1b[38;2;80;160;240m", // Light blue
  "\x1b[38;2;120;120;250m", // Lavender
  "\x1b[38;2;144;97;249m", // SF Purple
];

function gradientLine(line: string): string {
  let result = "";
  let colorIdx = 0;
  const step = Math.max(1, Math.floor(line.length / GRADIENT_COLORS.length));

  for (let i = 0; i < line.length; i++) {
    if (i > 0 && i % step === 0 && colorIdx < GRADIENT_COLORS.length - 1) colorIdx++;
    if (line[i] !== " ") {
      result += GRADIENT_COLORS[colorIdx] + line[i] + RESET;
    } else {
      result += " ";
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Layout helpers
// ═══════════════════════════════════════════════════════════════════════════

function centerText(text: string, width: number): string {
  const visLen = visibleWidth(text);
  if (visLen >= width) return truncateToWidth(text, width, "…");
  const leftPad = Math.floor((width - visLen) / 2);
  const rightPad = width - visLen - leftPad;
  return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

/**
 * Wrap a plain (non-styled) string into lines whose visible length fits
 * `width`. Splits on whitespace, never in the middle of a word. The splash
 * only calls this with plain text (trademark notice), so we don't need a
 * full ANSI-aware wrapper.
 */
function wrapPlainText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function fitToWidth(str: string, width: number): string {
  const visLen = visibleWidth(str);
  if (visLen > width) return truncateToWidth(str, width, "…");
  return str + " ".repeat(width - visLen);
}

function horizontalRule(width: number): string {
  return ` ${MUTED("─".repeat(Math.max(0, width - 2)))}`;
}

function formatCost(cost: number): string {
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(0)}`;
}

/** Render the budget side of the usage line.
 * `null` means unlimited — show the infinity symbol to match the bottom bar
 * gateway status (`$N/∞`).
 */
function formatBudget(budget: number | null): string {
  if (budget === null) return "∞";
  return formatCost(budget);
}

function formatRelativeAge(timestamp: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - timestamp);
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 10) return "updated just now";
  if (diffSeconds < 60) return `updated ${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `updated ${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `updated ${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `updated ${diffDays}d ago`;
}

function formatEnvironmentFreshness(env: SplashData["sfEnvironment"]): string | null {
  if (!env) return null;

  const parts: string[] = [];
  if (typeof env.detectedAt === "number") {
    parts.push(formatRelativeAge(env.detectedAt));
  }
  if (env.source === "cached") {
    parts.push("cached");
  }
  if (env.refreshing) {
    parts.push("refreshing…");
  }

  return parts.length > 0 ? parts.join(" • ") : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Left column builder
// ═══════════════════════════════════════════════════════════════════════════

/** Single-glyph marker per announcement kind. Matches the severity color
 * picked by the caller. Kept ASCII-safe so it renders without a Nerd Font. */
function announcementMarker(kind: "note" | "update" | "breaking" | "deprecation"): string {
  switch (kind) {
    case "update":
      return "↑";
    case "breaking":
      return "!";
    case "deprecation":
      return "×";
    case "note":
    default:
      return "•";
  }
}

function buildLeftColumn(data: SplashData, colWidth: number, mode: GlyphMode): string[] {
  const lines: string[] = [];

  // Welcome message
  lines.push("");
  lines.push(centerText(`${BOLD}Welcome back!${RESET}`, colWidth));
  lines.push("");

  // Gradient Pi + SF header with Headless 360 caption.
  // Each row stitches [Pi-row][gutter|+][SF-row] so the pair renders as one
  // visual block; centerText() can't help here because the gutter contains
  // ANSI (the dim "+"), so we center by the un-styled visible width and
  // then prepend that padding to the styled row.
  for (let i = 0; i < PI_LOGO.length; i++) {
    const piRow = PI_LOGO[i] ?? "";
    const sfRow = SF_LOGO[i] ?? "";
    const gutter = i === HEADER_PLUS_ROW ? `  ${DIM}+${RESET}  ` : HEADER_GUTTER;
    const visibleRow = piRow + HEADER_GUTTER + sfRow;
    const styledRow = gradientLine(piRow) + gutter + gradientLine(sfRow);
    const leftPad = Math.max(0, Math.floor((colWidth - visibleWidth(visibleRow)) / 2));
    lines.push(" ".repeat(leftPad) + styledRow);
  }
  // One blank line between the logo block and the caption, then the
  // gradient-painted subtitle centered on the column.
  lines.push("");
  lines.push(centerText(gradientLine(HEADER_CAPTION), colWidth));
  lines.push("");

  // Model info
  const modelTruncated = truncateToWidth(data.modelName, colWidth - 4, "…");
  lines.push(centerText(SF_BLUE(modelTruncated), colWidth));
  lines.push(centerText(MUTED(data.providerName), colWidth));
  // Trademark caption — anchored under the provider name and wrapped to fit
  // narrow columns instead of truncating so the full notice remains visible.
  lines.push("");
  const trademark = "Salesforce®, Agentforce™ and logos are trademarks of Salesforce, Inc.";
  for (const wrapped of wrapPlainText(trademark, Math.max(1, colWidth - 2))) {
    lines.push(centerText(`${DIM}${MUTED(wrapped)}${RESET}`, colWidth));
  }
  lines.push("");

  // Monthly cost (single line, no bar)
  // When the gateway supplies a real budget we color by utilization; with
  // an infinite budget (null) we keep the value accent-colored because
  // there is no threshold to exceed.
  lines.push(horizontalRule(colWidth));
  const budget = data.monthlyBudget;
  const ratio = typeof budget === "number" && budget > 0 ? data.monthlyCost / budget : 0;
  const costColor =
    budget === null ? SF_CYAN : ratio < 0.5 ? SF_GREEN : ratio < 0.8 ? SF_ORANGE : SF_RED;
  const sourceHint = data.monthlyUsageSource === "sessions" ? ` ${MUTED("(local estimate)")}` : "";
  lines.push(
    ` ${BOLD}${ACCENT(`${glyph("monthly", mode)} Monthly Usage`)}${RESET}  ${costColor(formatCost(data.monthlyCost))} ${MUTED("/")} ${MUTED(formatBudget(budget))}${sourceHint}`,
  );
  // Lifetime usage — prefers the gateway's per-key counter, falls back to a
  // local session-file estimate for bring-your-own-keys users. Always
  // rendered so BYO-keys users still see cumulative context.
  const lifetimeHint =
    data.lifetimeUsageSource === "sessions" ? ` ${MUTED("(local estimate)")}` : "";
  lines.push(
    ` ${BOLD}${ACCENT(`${glyph("lifetime", mode)} Lifetime Usage`)}${RESET} ${SF_CYAN(formatCost(data.lifetimeCost))}${lifetimeHint}`,
  );
  lines.push("");

  // Extension health (heading only — individual items removed)
  lines.push(horizontalRule(colWidth));
  const extCount = data.extensionHealth.filter(
    (e) => e.status === "active" || e.status === "locked",
  ).length;
  const extTotal = data.extensionHealth.length;
  lines.push(
    ` ${BOLD}${ACCENT(`${glyph("extensions", mode)} sf-pi Extensions`)}${RESET}  ${SF_GREEN(`${extCount}`)}${MUTED(`/${extTotal} active`)}`,
  );

  // Slack status
  const slackIcon = data.slackConnected ? SF_GREEN("✓") : SF_RED("✗");
  const slackLabel = data.slackConnected ? "Connected" : "Not connected";
  const slackStatus = data.slackConnected ? SF_GREEN(slackLabel) : SF_RED(slackLabel);
  lines.push(
    ` ${BOLD}${ACCENT(`${glyph("slack", mode)} Slack`)}${RESET}  ${slackIcon} ${slackStatus}`,
  );

  // LLM Gateway status (detect from provider name)
  const isGateway =
    data.providerName.toLowerCase().includes("gateway") ||
    data.modelName.toLowerCase().includes("gateway");
  if (isGateway) {
    lines.push(
      ` ${BOLD}${ACCENT(`${glyph("gateway", mode)} LLM Gateway`)}${RESET}  ${SF_GREEN("✓")} ${SF_GREEN("Connected")}`,
    );
  }
  lines.push("");

  // Salesforce Environment (async — may still be loading)
  lines.push(horizontalRule(colWidth));
  lines.push(` ${BOLD}${ACCENT(`${glyph("cloud", mode)} Salesforce Environment`)}${RESET}`);
  const env = data.sfEnvironment;
  if (!env || env.loading) {
    lines.push(` ${MUTED(`${glyph("hourglass", mode)} Detecting...`)}`);
  } else if (!env.cliInstalled) {
    lines.push(` ${MUTED("SF CLI:")} ${SF_RED("Not installed")}`);
  } else {
    lines.push(` ${MUTED("SF CLI:")} ${SF_GREEN(`v${env.cliVersion ?? "?"}`)} ${SF_GREEN("✓")}`);
    if (env.defaultOrg) {
      // Keep org label, type badge, and connection status on a single line
      // so the environment block reads at a glance. The instance URL is
      // intentionally omitted — the org name + type is enough on the splash
      // and the bottom bar already exposes the URL on demand.
      const connIcon = env.connected ? SF_GREEN("✓ Connected") : SF_RED("✗ Disconnected");
      const orgTypeBadge = env.orgType ? ` ${MUTED(`(${env.orgType})`)}` : "";
      // Reserve trailing space for the connection suffix so long org names
      // don't push past the column. 14 covers "✓ Connected" + padding.
      const reservedForConn = 14;
      const orgLabel = truncateToWidth(
        env.defaultOrg,
        Math.max(10, colWidth - 16 - reservedForConn),
        "…",
      );
      lines.push(` ${MUTED("Org:")} ${orgLabel}${orgTypeBadge} — ${connIcon}`);
      const parts: string[] = [];
      if (env.apiVersion) parts.push(`API ${env.apiVersion}`);
      if (env.configScope) parts.push(`${env.configScope}`);
      if (parts.length) {
        lines.push(` ${MUTED(parts.join(" • "))}`);
      }

      const freshness = formatEnvironmentFreshness(env);
      if (freshness) {
        lines.push(` ${MUTED(freshness)}`);
      }
    } else {
      lines.push(` ${MUTED("No default org configured")}`);
    }
  }

  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Right column builder
// ═══════════════════════════════════════════════════════════════════════════

function buildRightColumn(data: SplashData, colWidth: number, mode: GlyphMode): string[] {
  const lines: string[] = [];

  // --- Announcements (maintainer notes + sf-pi update nudge) ---
  // Rendered at the very top of the right column so maintainer messaging
  // and update nudges get first-glance real estate. Panel caps at 3 items
  // and each title truncates to one line — longer bodies live in
  // `/sf-pi announcements`.
  if (data.announcements && data.announcements.visible.length > 0) {
    const more =
      data.announcements.totalActive > data.announcements.visible.length
        ? ` ${MUTED(`(+${data.announcements.totalActive - data.announcements.visible.length} more)`)}`
        : "";
    lines.push(` ${BOLD}${GOLD(`${glyph("announce", mode)} Announcements`)}${RESET}${more}`);
    for (const item of data.announcements.visible) {
      const markerColor =
        item.severity === "critical" ? SF_RED : item.severity === "warn" ? SF_ORANGE : SF_CYAN;
      const marker = markerColor(announcementMarker(item.kind));
      const truncated = truncateToWidth(item.title, Math.max(10, colWidth - 4), "…");
      lines.push(` ${marker} ${MUTED(truncated)}`);
    }
    lines.push(horizontalRule(colWidth));
  }

  // --- What's New (only when a pi version bump is unacknowledged) ---
  // Rendered at the top of the right column so the user sees new
  // capabilities before the regular tips list. Stays compact (max 8
  // bullets) so the panel never dominates the splash. See lib/whats-new.ts
  // for the selection rules.
  if (data.whatsNew && data.whatsNew.bullets.length > 0) {
    const versionRange = data.whatsNew.fromVersion
      ? `v${data.whatsNew.fromVersion} → v${data.whatsNew.toVersion}`
      : `v${data.whatsNew.toVersion}`;
    lines.push(
      ` ${BOLD}${GOLD(`${glyph("whatsNew", mode)} What's New`)}${RESET} ${MUTED(`(${versionRange})`)}`,
    );
    for (const bullet of data.whatsNew.bullets) {
      const marker = bullet.section === "feature" ? SF_GREEN("+") : SF_CYAN("※");
      // Reserve room for the marker + spacing so long bullets truncate with
      // an ellipsis instead of wrapping into the next column cell.
      const truncated = truncateToWidth(bullet.text, Math.max(10, colWidth - 4), "…");
      lines.push(` ${marker} ${MUTED(truncated)}`);
    }
    lines.push(horizontalRule(colWidth));
  }

  // --- Loaded counts ---
  lines.push(` ${BOLD}${GOLD(`${glyph("loaded", mode)} Loaded`)}${RESET}`);
  const { extensions, skills, promptTemplates } = data.loadedCounts;
  if (extensions > 0) {
    lines.push(
      ` ${MUTED("─")} ${SF_GREEN(`${extensions}`)} extension${extensions !== 1 ? "s" : ""}`,
    );
  }
  if (skills > 0) {
    lines.push(` ${MUTED("─")} ${SF_GREEN(`${skills}`)} skill${skills !== 1 ? "s" : ""}`);
  }
  if (promptTemplates > 0) {
    lines.push(
      ` ${MUTED("─")} ${SF_GREEN(`${promptTemplates}`)} prompt template${promptTemplates !== 1 ? "s" : ""}`,
    );
  }
  if (extensions === 0 && skills === 0 && promptTemplates === 0) {
    lines.push(` ${MUTED("No extensions loaded")}`);
  }
  lines.push(horizontalRule(colWidth));

  // --- Recent sessions ---
  lines.push(` ${BOLD}${GOLD(`${glyph("recent", mode)} Recent Sessions`)}${RESET}`);
  if (data.recentSessions.length === 0) {
    lines.push(` ${MUTED("No recent sessions")}`);
  } else {
    for (const session of data.recentSessions) {
      lines.push(` ${MUTED("•")} ${SF_CYAN(session.name)} ${MUTED(`(${session.timeAgo})`)}`);
    }
  }
  lines.push(horizontalRule(colWidth));

  // --- Recommended extensions ---
  // Replaces the legacy Salesforce AI block. Shows a header counter and
  // lists every recommended item with a status glyph so users can see at
  // a glance which external pi packages they have, haven't, or declined.
  //   ● green  = installed (reality — settings.json scan)
  //   ○ muted  = pending / never acted on
  //   · muted  = declined (past /sf-pi recommended overlay decision)
  // Install status is authoritative from settings.json; the state file
  // contributes only the 'declined' marker. See lib/recommendations-status.ts.
  const recs = data.recommendations;
  if (recs && recs.total > 0) {
    lines.push(
      ` ${BOLD}${SF_BLUE(`${glyph("extensions", mode)} Recommended`)}${RESET}  ${SF_GREEN(`${recs.installedCount}`)}${MUTED(`/${recs.total} installed`)}`,
    );
    for (const item of recs.items) {
      const marker =
        item.status === "installed"
          ? SF_GREEN("●")
          : item.status === "declined"
            ? MUTED("·")
            : MUTED("○");
      const nameColor = item.status === "installed" ? SF_CYAN : MUTED;
      const truncated = truncateToWidth(item.name, Math.max(8, colWidth - 4), "…");
      lines.push(` ${marker} ${nameColor(truncated)}`);
    }
    if (recs.pendingCount > 0) {
      lines.push(` ${MUTED("→")} ${SF_CYAN("/sf-pi recommended")}`);
    } else {
      lines.push(` ${SF_GREEN("✓")} ${MUTED("All recommendations installed")}`);
    }
    lines.push(horizontalRule(colWidth));
  }

  // --- External skill sources (Claude Code / Codex / Cursor interop) ---
  //
  // Surfaces a single-line nudge when pi's skill-discovery would pick up
  // more skills with one settings edit. Keeps the block compact on
  // purpose: users who want to manage the list open `/sf-pi skills`.
  const skillSources = data.skillSources;
  if (skillSources && skillSources.availableCount > 0) {
    const rootLabel = `${skillSources.availableCount} external skill root${
      skillSources.availableCount === 1 ? "" : "s"
    }`;
    const skillCount = skillSources.totalSkillCount;
    const detail =
      skillCount > 0
        ? ` ${MUTED(`(${skillCount} skill${skillCount === 1 ? "" : "s"} detected)`)}`
        : "";
    lines.push(
      ` ${BOLD}${SF_BLUE(`${glyph("extensions", mode)} Interop`)}${RESET}  ${SF_CYAN(rootLabel)}${detail}`,
    );
    lines.push(` ${MUTED("→")} ${SF_CYAN("/sf-pi skills")}`);
    lines.push(horizontalRule(colWidth));
  }

  // --- Attribution ---
  lines.push(` ${ITALIC}${MUTED("Maintained by")}${RESET}`);
  lines.push(
    ` ${GOLD("Jag Valaiyapathy")} ${MUTED("• Senior Forward Deployed Engineer, Salesforce")}`,
  );
  lines.push(` ${SF_CYAN("github.com/salesforce/sf-pi")}`);
  lines.push("");
  lines.push(` ${SF_CYAN(glyph("slack", mode))} ${MUTED("We'd love to hear your feedback!")}`);
  lines.push(
    ` ${MUTED(`${glyph("bug", mode)} Open an issue  •  ${glyph("pr", mode)} Submit a PR`)}`,
  );
  lines.push("");

  // The trademark caption lives in the left column under the provider name.
  // The right column intentionally stops at the feedback links.

  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Box renderer
// ═══════════════════════════════════════════════════════════════════════════

/** Layout constants.
 *
 * Sizing rules for the splash box:
 *   - Minimum of 80 (down from 100) so narrow Terminal.app windows still
 *     fit comfortably without forcing a horizontal overflow that bleeds
 *     through Pi's startup output.
 *   - Maximum raised to 220 so wide terminals actually fill instead of
 *     leaving a truncated-looking island with background text showing
 *     around it.
 *   - Below SINGLE_COL_THRESHOLD we switch to a single-column stacked
 *     layout so no content gets ellipsised. Two columns need ~100 cols
 *     of usable space to render the right column's tips + session list
 *     without truncation.
 */
const ABSOLUTE_MIN_TERM_WIDTH = 60;
const MIN_BOX_WIDTH = 80;
const MAX_BOX_WIDTH = 220;
const SINGLE_COL_THRESHOLD = 100;
const MIN_LEFT_COL = 48;
const MAX_LEFT_COL = 60;

function getBoxWidth(termWidth: number): number {
  // Reserve two columns so the rounded corners do not sit against the
  // terminal edge — matches the bleed behavior Pi's editor expects.
  const usable = Math.max(ABSOLUTE_MIN_TERM_WIDTH, termWidth - 2);
  return Math.max(MIN_BOX_WIDTH, Math.min(usable, MAX_BOX_WIDTH));
}

function getColumnWidths(boxWidth: number): { leftCol: number; rightCol: number } {
  const leftCol = Math.min(MAX_LEFT_COL, Math.max(MIN_LEFT_COL, Math.floor(boxWidth * 0.32)));
  return {
    leftCol,
    rightCol: Math.max(1, boxWidth - leftCol - 3),
  };
}

/** True when the terminal cannot comfortably host two splash columns. */
function shouldUseSingleColumn(termWidth: number): boolean {
  return termWidth < SINGLE_COL_THRESHOLD;
}

function renderSplashBox(data: SplashData, termWidth: number, bottomLine: string): string[] {
  if (termWidth < ABSOLUTE_MIN_TERM_WIDTH) return [];

  const mode = resolveGlyphMode();
  const boxWidth = getBoxWidth(termWidth);

  const hChar = "─";
  const v = MUTED("│");
  const tl = MUTED("╭");
  const tr = MUTED("╮");
  const bl = MUTED("╰");
  const br = MUTED("╯");

  const lines: string[] = [];

  // Top border with title
  const title = " sf-pi ";
  const titlePrefix = MUTED(hChar.repeat(3));
  const titleStyled = titlePrefix + SF_BLUE(`${BOLD}${title}${RESET}`);
  const titleVisLen = 3 + visibleWidth(title);
  const subtitle = " for Salesforce Development ";
  const subtitleStyled = MUTED(subtitle);
  const subtitleVisLen = visibleWidth(subtitle);
  const afterAll = boxWidth - 2 - titleVisLen - subtitleVisLen;
  const afterText = afterAll > 0 ? MUTED(hChar.repeat(afterAll)) : "";
  lines.push(tl + titleStyled + subtitleStyled + afterText + tr);

  if (shouldUseSingleColumn(termWidth)) {
    // Narrow terminal: stack the two columns so nothing truncates. We use
    // the full inner width (boxWidth - 2) for both blocks and insert a thin
    // separator rule between them so the split is still visually clear.
    const innerWidth = boxWidth - 2;
    const stackedLines = [
      ...buildLeftColumn(data, innerWidth, mode),
      horizontalRule(innerWidth),
      ...buildRightColumn(data, innerWidth, mode),
    ];
    for (const line of stackedLines) {
      lines.push(v + fitToWidth(line, innerWidth) + v);
    }
  } else {
    // Two-column layout.
    const { leftCol, rightCol } = getColumnWidths(boxWidth);
    const leftLines = buildLeftColumn(data, leftCol, mode);
    const rightLines = buildRightColumn(data, rightCol, mode);
    const maxRows = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxRows; i++) {
      const left = fitToWidth(leftLines[i] ?? "", leftCol);
      const right = fitToWidth(rightLines[i] ?? "", rightCol);
      lines.push(v + left + v + right + v);
    }
  }

  // Bottom border
  lines.push(bl + bottomLine + br);

  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Splash overlay component (with countdown)
// ═══════════════════════════════════════════════════════════════════════════

export class SfWelcomeOverlay implements Component {
  private data: SplashData;
  private countdown: number = 30;

  constructor(data: SplashData) {
    this.data = data;
  }

  setCountdown(seconds: number): void {
    this.countdown = seconds;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    if (termWidth < ABSOLUTE_MIN_TERM_WIDTH) return [];

    const boxWidth = getBoxWidth(termWidth);

    // Bottom line with countdown
    const countdownText = ` Press any key to continue (${this.countdown}s) `;
    const countdownStyled = MUTED(countdownText);
    const bottomContentWidth = boxWidth - 2;
    const countdownVisLen = visibleWidth(countdownText);
    const leftPad = Math.floor((bottomContentWidth - countdownVisLen) / 2);
    const rightPad = bottomContentWidth - countdownVisLen - leftPad;
    const hChar = "─";
    const bottomLine =
      MUTED(hChar.repeat(Math.max(0, leftPad))) +
      countdownStyled +
      MUTED(hChar.repeat(Math.max(0, rightPad)));

    return renderSplashBox(this.data, termWidth, bottomLine);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Splash header component (persistent, no countdown)
// ═══════════════════════════════════════════════════════════════════════════

export class SfWelcomeHeader implements Component {
  private data: SplashData;

  constructor(data: SplashData) {
    this.data = data;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    if (termWidth < ABSOLUTE_MIN_TERM_WIDTH) return [];

    const boxWidth = getBoxWidth(termWidth);
    const hChar = "─";
    let bottomLine: string;
    if (shouldUseSingleColumn(termWidth)) {
      // No column split to hint at in single-column mode.
      bottomLine = MUTED(hChar.repeat(Math.max(0, boxWidth - 2)));
    } else {
      const { leftCol, rightCol } = getColumnWidths(boxWidth);
      bottomLine = MUTED(hChar.repeat(leftCol)) + MUTED("┴") + MUTED(hChar.repeat(rightCol));
    }

    const lines = renderSplashBox(this.data, termWidth, bottomLine);
    if (lines.length > 0) {
      lines.push(""); // spacing below header
    }
    return lines;
  }
}
