/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Welcome — Splash screen TUI component.
 *
 * Layout modes (driven by terminal width):
 *   - Two-column (default, termWidth ≥ SINGLE_COL_THRESHOLD):
 *       Left:  Gradient Pi logo, model info, monthly cost, extension health,
 *              Slack/Gateway/SF CLI status
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
// Pi + Salesforce brand mark (omarchy-style stacked wordmark)
//
// The header renders as a vertical stack:
//   1. Pi glyph           (centered; pastel-rainbow palette)
//   2. SALESFORCE         (big 5-row block letters; Salesforce blue palette)
//   3. Caption            (pastel-rainbow palette)
//
// Two palettes, two roles:
//   - BLUE_PALETTE: locks SALESFORCE in the Salesforce blue/purple family
//     even as the per-character color cycle animates.
//   - RAINBOW_PALETTE: byte-for-byte copy of sf-ohana-spinner's
//     RAINBOW_COLORS (7 soft pastels). Applied to Pi and the caption so
//     they shimmer like the [SF LLM Gateway] spinner.
//
// Animation: buildLeftColumn() takes a headerOffset integer that the
// owner (SfWelcomeOverlay/SfWelcomeHeader via setHeaderOffset) ticks up every 400 ms
// for the first few seconds of the splash. Each tick advances the
// per-character color index by 1, so colors travel left→right through
// every section. After the animation window ends, the offset stays
// pinned on the final frame — no ongoing repaint cost.
//
// If either palette changes upstream, mirror the update here:
//   - this file's BLUE_PALETTE matches the previous GRADIENT_COLORS
//   - sf-ohana-spinner/lib/rainbow.ts RAINBOW_COLORS ↔ RAINBOW_PALETTE
// ═══════════════════════════════════════════════════════════════════════════

const PI_LOGO = [
  "▀████████████▀",
  "  ███    ███  ",
  "  ███    ███  ",
  "  ███    ███  ",
  " ▄███▄  ▄███▄ ",
];

// 5-row block letters used to build the big SALESFORCE wordmark. Each
// glyph is 5 cols wide; letters are separated by a 1-col gap, so
// SALESFORCE renders at 10 * 5 + 9 = 59 cols.
const LETTERS: Record<string, string[]> = {
  S: ["▄████", "█    ", "▀███▄", "    █", "████▀"],
  A: ["▄███▄", "█   █", "█████", "█   █", "█   █"],
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  F: ["█████", "█    ", "████ ", "█    ", "█    "],
  O: ["▄███▄", "█   █", "█   █", "█   █", "▀███▀"],
  R: ["████▄", "█   █", "████▀", "█  █ ", "█   █"],
  C: ["▄████", "█    ", "█    ", "█    ", "▀████"],
};

const WORD = "SALESFORCE";
// 10 letters × 5 cols + 9 gaps = 59.
const WORD_WIDTH = WORD.length * 5 + (WORD.length - 1);

// Caption under the mark. Pastel-rainbow painted so it pairs visually
// with Pi above.
const HEADER_CAPTION = "[ Headless 360 · Pro-code Access ]";

// Salesforce blue/purple family: SF Blue, mid blue, Astro cyan, light
// blue, lavender, SF Purple. Every stop has blue ≥ 210 so the wordmark
// stays firmly in the brand family even mid-animation.
const BLUE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 112, 210],
  [1, 160, 230],
  [1, 195, 226],
  [80, 160, 240],
  [120, 120, 250],
  [144, 97, 249],
];

// Ohana-spinner pastel rainbow: dusty rose, soft peach, muted gold, sage
// green, soft sky blue, lavender, soft mauve. Used for Pi and the caption
// so they match the [SF LLM Gateway] spinner shimmer.
const RAINBOW_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [200, 120, 130],
  [210, 150, 120],
  [200, 185, 120],
  [130, 190, 140],
  [120, 170, 200],
  [150, 130, 190],
  [185, 130, 180],
];

/**
 * Paint a single row with a palette, advancing color per visible
 * (non-space) character. `state.charIndex` is mutated so the color
 * cycle is continuous across the rows of a single section (Pi, word,
 * caption). Callers pass a fresh state per section so each section
 * starts from color 0.
 *
 * `offset` shifts the starting color so the animation loop can cycle
 * all colors to the right in lock-step across every section. Uses the
 * file-local fgRgb(r, g, b, text) defined above.
 */
function paintRow(
  row: string,
  state: { charIndex: number },
  offset: number,
  palette: ReadonlyArray<readonly [number, number, number]>,
): string {
  let result = "";
  for (const ch of row) {
    if (ch === " ") {
      result += ch;
      continue;
    }
    const [r, g, b] = palette[(state.charIndex + offset) % palette.length];
    result += fgRgb(r, g, b, ch);
    state.charIndex++;
  }
  return result;
}

/**
 * Build the 5-row SALESFORCE block. Returned rows are un-styled ASCII
 * so the caller can paint them with whichever palette + offset.
 */
function buildWordmarkRows(): string[] {
  const rows: string[] = ["", "", "", "", ""];
  for (let li = 0; li < WORD.length; li++) {
    const glyph = LETTERS[WORD[li]];
    for (let r = 0; r < 5; r++) {
      rows[r] += glyph[r];
      if (li < WORD.length - 1) rows[r] += " ";
    }
  }
  return rows;
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

function padVisible(str: string, width: number): string {
  return str + " ".repeat(Math.max(0, width - visibleWidth(str)));
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

const ICON_COL_WIDTH = 2;
const LABEL_COL_WIDTH = "sf-pi Extensions".length;

type SplashGlyphKey = Parameters<typeof glyph>[0];

function formatInfoRow(
  icon: string,
  label: string,
  value: string,
  iconColor: (text: string) => string = ACCENT,
): string {
  const iconCell = padVisible(iconColor(icon), ICON_COL_WIDTH);
  const labelCell = padVisible(`${BOLD}${ACCENT(label)}${RESET}`, LABEL_COL_WIDTH);
  return ` ${iconCell} ${labelCell}  ${value}`;
}

function formatGlyphInfoRow(
  iconKey: SplashGlyphKey,
  mode: GlyphMode,
  label: string,
  value: string,
  iconColor?: (text: string) => string,
): string {
  return formatInfoRow(glyph(iconKey, mode), label, value, iconColor);
}

function formatSfCliStatusValue(data: SplashData, mode: GlyphMode): string {
  const cli = data.sfCli;

  if (!cli || cli.loading || cli.freshness === "checking") {
    return MUTED(`${glyph("hourglass", mode)} Checking`);
  }

  if (!cli.installed) {
    return `${SF_RED("✗")} ${SF_RED("Not installed")}`;
  }

  const version = cli.installedVersion ? `v${cli.installedVersion}` : undefined;
  if (cli.freshness === "latest") {
    const suffix = version ? ` ${MUTED(`(${version})`)}` : "";
    return `${SF_GREEN("✓")} ${SF_GREEN("Installed")} ${MUTED("· latest")}${suffix}`;
  }

  if (cli.freshness === "update-available") {
    const fromVersion = version ?? "installed";
    const toVersion = cli.latestVersion ? `v${cli.latestVersion}` : "latest";
    return `${SF_ORANGE("!")} ${SF_ORANGE("Update available")} ${MUTED(`${fromVersion} → ${toVersion}`)}`;
  }

  const suffix = version ? ` ${MUTED(`(${version})`)}` : "";
  return `${SF_GREEN("✓")} ${SF_GREEN("Installed")}${suffix}`;
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

function buildLeftColumn(
  data: SplashData,
  colWidth: number,
  mode: GlyphMode,
  headerOffset: number = 0,
): string[] {
  const lines: string[] = [];

  // Welcome message
  lines.push("");
  lines.push(centerText(`${BOLD}Welcome back!${RESET}`, colWidth));
  lines.push("");

  // Pi + SALESFORCE stacked mark. Three sections, painted per-character
  // with an advancing color index. Each section has its own charIndex
  // state so the cycle restarts from color 0 at the top of each section,
  // but the shared `headerOffset` means all sections animate in
  // lock-step when the overlay ticks the offset forward.
  const piPad = Math.max(0, Math.floor((colWidth - PI_LOGO[0].length) / 2));
  const piState = { charIndex: 0 };
  for (const row of PI_LOGO) {
    lines.push(" ".repeat(piPad) + paintRow(row, piState, headerOffset, RAINBOW_PALETTE));
  }
  lines.push("");

  const wordRows = buildWordmarkRows();
  const wordPad = Math.max(0, Math.floor((colWidth - WORD_WIDTH) / 2));
  const wordState = { charIndex: 0 };
  for (const row of wordRows) {
    lines.push(" ".repeat(wordPad) + paintRow(row, wordState, headerOffset, BLUE_PALETTE));
  }
  lines.push("");

  const captionState = { charIndex: 0 };
  const captionPad = Math.max(0, Math.floor((colWidth - HEADER_CAPTION.length) / 2));
  lines.push(
    " ".repeat(captionPad) + paintRow(HEADER_CAPTION, captionState, headerOffset, RAINBOW_PALETTE),
  );
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
    formatGlyphInfoRow(
      "monthly",
      mode,
      "Monthly Usage",
      `${costColor(formatCost(data.monthlyCost))} ${MUTED("/")} ${MUTED(formatBudget(budget))}${sourceHint}`,
    ),
  );
  // Lifetime usage — prefers the gateway's per-key counter, falls back to a
  // local session-file estimate for bring-your-own-keys users. Always
  // rendered so BYO-keys users still see cumulative context.
  const lifetimeHint =
    data.lifetimeUsageSource === "sessions" ? ` ${MUTED("(local estimate)")}` : "";
  lines.push(
    formatGlyphInfoRow(
      "lifetime",
      mode,
      "Lifetime Usage",
      `${SF_CYAN(formatCost(data.lifetimeCost))}${lifetimeHint}`,
      SF_CYAN,
    ),
  );
  lines.push("");

  // Extension health (heading only — individual items removed)
  lines.push(horizontalRule(colWidth));
  const extCount = data.extensionHealth.filter(
    (e) => e.status === "active" || e.status === "locked",
  ).length;
  const extTotal = data.extensionHealth.length;
  const extensionValue = data.extensionHealthLoading
    ? MUTED(`${glyph("hourglass", mode)} Loading`)
    : `${SF_GREEN(`${extCount}`)}${MUTED(`/${extTotal} active`)}`;
  lines.push(formatGlyphInfoRow("extensions", mode, "sf-pi Extensions", extensionValue));

  // Slack status
  const slackValue = data.slackLoading
    ? MUTED(`${glyph("hourglass", mode)} Checking`)
    : data.slackConnected
      ? `${SF_GREEN("✓")} ${SF_GREEN("Connected")}`
      : `${SF_RED("✗")} ${SF_RED("Not connected")}`;
  lines.push(formatGlyphInfoRow("slack", mode, "Slack", slackValue));

  // LLM Gateway status (detect from provider name)
  const isGateway =
    data.providerName.toLowerCase().includes("gateway") ||
    data.modelName.toLowerCase().includes("gateway");
  if (isGateway) {
    lines.push(
      formatGlyphInfoRow(
        "gateway",
        mode,
        "LLM Gateway",
        `${SF_GREEN("✓")} ${SF_GREEN("Connected")}`,
      ),
    );
  }

  // SF CLI status only. Org/API/config context belongs in sf-devbar, not in
  // the welcome splash. Keep this directly under the gateway row so both
  // environment statuses read as one aligned block.
  lines.push(formatGlyphInfoRow("cli", mode, "SF CLI", formatSfCliStatusValue(data, mode)));
  lines.push("");

  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Right column builder
// ═══════════════════════════════════════════════════════════════════════════

function buildRightColumn(data: SplashData, colWidth: number, mode: GlyphMode): string[] {
  const lines: string[] = [];

  // --- Doctor nudge (startup/setup self-heal) ---
  // Render first so setup issues get a clear, actionable next step instead
  // of being buried behind general announcements or recommendations.
  if (data.doctor && data.doctor.issueCount > 0) {
    lines.push(` ${BOLD}${SF_ORANGE(`${glyph("warn", mode)} Setup check`)}${RESET}`);
    const detail = truncateToWidth(data.doctor.message, Math.max(10, colWidth - 4), "…");
    lines.push(` ${SF_ORANGE("!")} ${MUTED(detail)}`);
    lines.push(` ${MUTED("→")} ${SF_CYAN(data.doctor.command)} ${MUTED("to repair")}`);
    lines.push(horizontalRule(colWidth));
  }

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
  if (data.loadedCountsLoading) {
    lines.push(` ${MUTED("─")} ${MUTED(`${glyph("hourglass", mode)} Loading`)}`);
  } else {
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
  }
  lines.push(horizontalRule(colWidth));

  // --- Recent sessions ---
  lines.push(` ${BOLD}${GOLD(`${glyph("recent", mode)} Recent Sessions`)}${RESET}`);
  if (data.recentSessionsLoading) {
    lines.push(` ${MUTED("─")} ${MUTED(`${glyph("hourglass", mode)} Loading`)}`);
  } else if (data.recentSessions.length === 0) {
    lines.push(` ${MUTED("No recent sessions")}`);
  } else {
    for (const session of data.recentSessions) {
      lines.push(` ${MUTED("•")} ${SF_CYAN(session.name)} ${MUTED(`(${session.timeAgo})`)}`);
    }
  }
  lines.push(horizontalRule(colWidth));

  // --- Recommended extensions ---
  // Replaces the legacy Salesforce AI block. Shows the install counter plus
  // only the top four pending items so the splash stays scannable. Full
  // detail, installed items, and declined decisions live in
  // `/sf-pi recommended`.
  const recs = data.recommendations;
  if (recs && recs.total > 0) {
    lines.push(
      ` ${BOLD}${SF_BLUE(`${glyph("extensions", mode)} Recommended`)}${RESET}  ${SF_GREEN(`${recs.installedCount}`)}${MUTED(`/${recs.total} installed`)}`,
    );
    const pending = recs.items.filter((i) => i.status === "pending").slice(0, 4);
    for (const item of pending) {
      const truncated = truncateToWidth(item.name, Math.max(8, colWidth - 4), "…");
      lines.push(` ${MUTED("○")} ${MUTED(truncated)}`);
    }
    if (recs.pendingCount > 0) {
      const more =
        recs.pendingCount > pending.length
          ? ` ${MUTED(`(+${recs.pendingCount - pending.length} more)`)}`
          : "";
      lines.push(
        ` ${MUTED("→")} ${MUTED(`Top ${pending.length} not installed`)} ${SF_CYAN("/sf-pi recommended")}${more}`,
      );
    } else if (recs.installedCount === recs.total) {
      lines.push(` ${SF_GREEN("✓")} ${MUTED("All recommendations installed")}`);
    } else {
      lines.push(` ${SF_GREEN("✓")} ${MUTED("No pending recommendations")}`);
    }
    lines.push(horizontalRule(colWidth));
  }

  // --- Tips ---
  lines.push(` ${BOLD}${SF_BLUE(`${glyph("whatsNew", mode)} Tips`)}${RESET}`);
  lines.push(` ${MUTED("•")} ${SF_CYAN("/sf-pi")} ${MUTED("manage extensions")}`);
  lines.push(` ${MUTED("•")} ${SF_CYAN("/sf-pi recommended")} ${MUTED("install extras")}`);
  lines.push(` ${MUTED("•")} ${SF_CYAN("/sf-pi announcements")} ${MUTED("read updates")}`);
  lines.push(` ${MUTED("•")} ${SF_CYAN("/sf-pi help")} ${MUTED("show all commands")}`);
  lines.push(horizontalRule(colWidth));

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
// The SALESFORCE wordmark is 59 cols wide. Cap the left column at 72
// and raise the floor a bit so the mark always has 2-3 cols of breathing
// room on each side. Below 59 cols of available left column, the caller
// naturally drops to single-column layout (SINGLE_COL_THRESHOLD) where
// the full inner width is used instead.
const MIN_LEFT_COL = 56;
const MAX_LEFT_COL = 72;

function getBoxWidth(termWidth: number): number {
  // Reserve two columns so the rounded corners do not sit against the
  // terminal edge — matches the bleed behavior Pi's editor expects.
  const usable = Math.max(ABSOLUTE_MIN_TERM_WIDTH, termWidth - 2);
  return Math.max(MIN_BOX_WIDTH, Math.min(usable, MAX_BOX_WIDTH));
}

function getColumnWidths(boxWidth: number): { leftCol: number; rightCol: number } {
  // Aim for ~40 % of the box for the left column so the 59-col wordmark
  // fits with a small margin on either side.
  const leftCol = Math.min(MAX_LEFT_COL, Math.max(MIN_LEFT_COL, Math.floor(boxWidth * 0.4)));
  return {
    leftCol,
    rightCol: Math.max(1, boxWidth - leftCol - 3),
  };
}

/** True when the terminal cannot comfortably host two splash columns. */
function shouldUseSingleColumn(termWidth: number): boolean {
  return termWidth < SINGLE_COL_THRESHOLD;
}

function renderSplashBox(
  data: SplashData,
  termWidth: number,
  bottomLine: string,
  headerOffset: number = 0,
): string[] {
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
      ...buildLeftColumn(data, innerWidth, mode, headerOffset),
      horizontalRule(innerWidth),
      ...buildRightColumn(data, innerWidth, mode),
    ];
    for (const line of stackedLines) {
      lines.push(v + fitToWidth(line, innerWidth) + v);
    }
  } else {
    // Two-column layout.
    const { leftCol, rightCol } = getColumnWidths(boxWidth);
    const leftLines = buildLeftColumn(data, leftCol, mode, headerOffset);
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
  // Per-character color offset driven by the extension's animation
  // interval. Incremented each tick for a few seconds, then frozen.
  private headerOffset: number = 0;

  constructor(data: SplashData) {
    this.data = data;
  }

  setCountdown(seconds: number): void {
    this.countdown = seconds;
  }

  setHeaderOffset(offset: number): void {
    this.headerOffset = offset;
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

    return renderSplashBox(this.data, termWidth, bottomLine, this.headerOffset);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Splash header component (persistent, optional countdown)
// ═══════════════════════════════════════════════════════════════════════════

export class SfWelcomeHeader implements Component {
  private data: SplashData;
  // Mirrors SfWelcomeOverlay.headerOffset so non-overlay renders (e.g.
  // the persistent header shown in session lists) can show the same
  // animated frame if the caller chooses to drive it.
  private headerOffset: number = 0;
  private countdown: number | undefined;

  constructor(data: SplashData) {
    this.data = data;
  }

  setHeaderOffset(offset: number): void {
    this.headerOffset = offset;
  }

  setCountdown(seconds: number | undefined): void {
    this.countdown = seconds;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    if (termWidth < ABSOLUTE_MIN_TERM_WIDTH) return [];

    const boxWidth = getBoxWidth(termWidth);
    const hChar = "─";
    let bottomLine: string;
    if (this.countdown !== undefined) {
      const countdownText = ` Press Esc to dismiss · auto-dismiss in ${this.countdown}s `;
      const countdownStyled = MUTED(countdownText);
      const bottomContentWidth = boxWidth - 2;
      const countdownVisLen = visibleWidth(countdownText);
      const leftPad = Math.floor((bottomContentWidth - countdownVisLen) / 2);
      const rightPad = bottomContentWidth - countdownVisLen - leftPad;
      bottomLine =
        MUTED(hChar.repeat(Math.max(0, leftPad))) +
        countdownStyled +
        MUTED(hChar.repeat(Math.max(0, rightPad)));
    } else if (shouldUseSingleColumn(termWidth)) {
      // No column split to hint at in single-column mode.
      bottomLine = MUTED(hChar.repeat(Math.max(0, boxWidth - 2)));
    } else {
      const { leftCol, rightCol } = getColumnWidths(boxWidth);
      bottomLine = MUTED(hChar.repeat(leftCol)) + MUTED("┴") + MUTED(hChar.repeat(rightCol));
    }

    const lines = renderSplashBox(this.data, termWidth, bottomLine, this.headerOffset);
    if (lines.length > 0) {
      lines.push(""); // spacing below header
    }
    return lines;
  }
}
