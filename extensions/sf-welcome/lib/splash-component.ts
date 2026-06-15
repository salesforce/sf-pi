/* SPDX-License-Identifier: Apache-2.0 */
/**
 * SF Welcome — Splash screen TUI component.
 *
 * Layout modes (driven by terminal width):
 *   - Two-column (default, termWidth ≥ SINGLE_COL_THRESHOLD):
 *       Left:  Gradient Pi logo, model info, monthly cost, optional integrations,
 *              environment checks, and release freshness rows
 *       Right: Announcements, loaded counts, recent sessions,
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
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
const WORDMARK_SHADOW = (text: string) => fg256(238, text); // Subtle depth on dark terminals

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
// for the first 8 seconds of the splash. Each tick advances the
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
// glyph is 5 cols wide. The 2-col inter-letter gap gives the one-cell
// drop shadow room to breathe instead of crowding the next letter.
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
const WORD_LETTER_GAP = 2;
const WORD_SHADOW_OFFSET = 1;
// 10 letters × 5 cols + 9 two-col gaps = 68.
const WORD_WIDTH = WORD.length * 5 + (WORD.length - 1) * WORD_LETTER_GAP;
const WORD_WIDTH_WITH_SHADOW = WORD_WIDTH + WORD_SHADOW_OFFSET;

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
      if (li < WORD.length - 1) rows[r] += " ".repeat(WORD_LETTER_GAP);
    }
  }
  return rows;
}

/**
 * Paint the SALESFORCE block with a one-cell down/right shadow. The shadow
 * is intentionally static while the foreground keeps the existing shimmer;
 * the sixth returned row reuses the old spacer below the wordmark so the
 * splash height does not change.
 */
function paintWordmarkRowsWithShadow(rows: string[], offset: number): string[] {
  const paintedRows: string[] = [];
  const foregroundState = { charIndex: 0 };
  for (let rowIndex = 0; rowIndex < rows.length + 1; rowIndex++) {
    let painted = "";
    const foregroundRow = rows[rowIndex] ?? "";
    const shadowSourceRow = rowIndex > 0 ? (rows[rowIndex - 1] ?? "") : "";

    for (let col = 0; col < WORD_WIDTH_WITH_SHADOW; col++) {
      const foregroundChar = foregroundRow[col] ?? " ";
      if (foregroundChar !== " ") {
        const [r, g, b] = BLUE_PALETTE[(foregroundState.charIndex + offset) % BLUE_PALETTE.length];
        painted += fgRgb(r, g, b, foregroundChar);
        foregroundState.charIndex++;
        continue;
      }

      const shadowChar = shadowSourceRow[col - 1] ?? " ";
      painted += shadowChar !== " " ? WORDMARK_SHADOW(shadowChar) : " ";
    }

    paintedRows.push(painted.trimEnd());
  }

  return paintedRows;
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
const LABEL_COL_WIDTH = "Monthly Usage".length;

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

function formatSlackStatusValue(data: SplashData, mode: GlyphMode): string {
  const status = data.slackStatus;
  if (data.slackLoading || !status || status.kind === "loading") {
    return MUTED(`${glyph("hourglass", mode)} Checking`);
  }

  switch (status.kind) {
    case "ready":
    case "partial-grant":
      return `${SF_GREEN("✓")} ${SF_GREEN("Connected")}`;
    case "scopes-unknown":
      return `${SF_ORANGE("?")} ${SF_ORANGE("Scopes unknown")}`;
    case "auth-error":
      return `${SF_RED("✗")} ${SF_RED("Auth error")}`;
    case "not-configured":
      return `${SF_ORANGE("○")} ${SF_ORANGE("Not configured")}`;
    case "hidden":
      return data.slackConnected
        ? `${SF_ORANGE("?")} ${SF_ORANGE("Scopes unknown")}`
        : `${SF_ORANGE("○")} ${SF_ORANGE("Not configured")}`;
    default:
      return `${SF_ORANGE("?")} ${SF_ORANGE("Unknown")}`;
  }
}

function formatGatewayStatusValue(data: SplashData, mode: GlyphMode): string {
  const status = data.gatewayStatus;
  if (data.gatewayLoading || !status || status.kind === "checking") {
    return MUTED(`${glyph("hourglass", mode)} Checking`);
  }

  switch (status.kind) {
    case "connected":
      return `${SF_GREEN("✓")} ${SF_GREEN("Connected")}`;
    case "not-configured":
      return `${SF_ORANGE("!")} ${SF_ORANGE("Configure")}`;
    case "auth-failed":
      return `${SF_RED("✗")} ${SF_RED("Auth failed")}`;
    case "url-invalid":
      return `${SF_ORANGE("!")} ${SF_ORANGE("URL issue")}`;
    case "unreachable":
      // Phase 1.3: distinguish a real unreachable network from a slow probe
      // that timed out. The gateway is probably fine — the cold-start link
      // is just sluggish. Suffix the retry indicator when the one-shot retry
      // also failed (matches `connectionStatus.retried`) so the user knows
      // we already gave the gateway a second chance.
      if (status.timedOut) {
        return `${SF_ORANGE("!")} ${SF_ORANGE(`Slow${status.retried ? " (retried)" : ""}`)}`;
      }
      return `${SF_ORANGE("!")} ${SF_ORANGE(`Unreachable${status.retried ? " (retried)" : ""}`)}`;
    case "degraded":
      return `${SF_ORANGE("!")} ${SF_ORANGE("Degraded")}`;
    case "unknown":
    default:
      return `${SF_ORANGE("!")} ${SF_ORANGE("Unknown")}`;
  }
}

function formatSfSkillsStatusValue(data: SplashData, mode: GlyphMode): string {
  const skills = data.sfSkills;

  if (!skills || skills.loading || skills.freshness === "checking") {
    return MUTED(`${glyph("hourglass", mode)} Checking`);
  }

  // Strong opinionated nudge when the official library isn't installed:
  // bright orange ↑ + bold action verb. The matching "/sf-skills defaults
  // install" command is rendered on a muted sub-line below the row (see
  // buildLeftColumn) so the row text itself stays inside the 72-col
  // left-column cap that the SALESFORCE wordmark drives.
  if (skills.installKind === "not-installed") {
    return `${SF_ORANGE("↑")} ${SF_ORANGE("Install official skills")} ${MUTED("· afv-library · this project")}`;
  }

  const skillCountSuffix =
    typeof skills.skillCount === "number" && skills.skillCount > 0
      ? ` ${MUTED(`(${skills.skillCount} skill${skills.skillCount === 1 ? "" : "s"})`)}`
      : "";

  if (skills.installKind === "linked") {
    // User-owned checkout: green ✓, never nag for updates.
    return `${SF_GREEN("✓")} ${SF_GREEN("afv-library linked")}${skillCountSuffix}`;
  }

  // installKind === "managed"
  if (skills.freshness === "update-available") {
    const behind =
      typeof skills.commitsBehind === "number" && skills.commitsBehind > 0
        ? `${skills.commitsBehind} commit${skills.commitsBehind === 1 ? "" : "s"} behind`
        : "update available";
    return `${SF_ORANGE("↑")} ${SF_ORANGE("afv-library")} ${MUTED(`· ${behind}`)}`;
  }

  const managedLabel = skills.wired === false ? "afv-library available" : "afv-library installed";

  if (skills.freshness === "latest") {
    return `${SF_GREEN("✓")} ${SF_GREEN(managedLabel)} ${MUTED("· latest")}${skillCountSuffix}`;
  }

  // freshness === "unknown" — we know the managed source is available; the
  // network probe either hasn't run yet or failed. Render green to avoid a
  // false install alarm when the current project deliberately hasn't wired it.
  return `${SF_GREEN("✓")} ${SF_GREEN(managedLabel)}${skillCountSuffix}`;
}

/** Suggested follow-up command for the current sf-skills state, or null when
 *  the row is informational only. Rendered as a muted sub-line so it never
 *  pushes the main row past the column cap.
 *
 *  Gated on `loading` so the hint never appears under the "⏳ Checking"
 *  state — we don't actually know the install state yet, and showing
 *  "/sf-skills defaults install" before detection completes would be a
 *  false claim. */
function sfSkillsActionHint(skills: SplashData["sfSkills"]): string | null {
  if (!skills) return null;
  if (skills.loading || skills.freshness === "checking") return null;
  if (skills.installKind === "not-installed") return "/sf-skills defaults install";
  if (skills.installKind === "managed" && skills.freshness === "update-available") {
    return "/sf-skills defaults update";
  }
  if (skills.installKind === "managed" && skills.wired === false) {
    return "/sf-skills defaults install";
  }
  return null;
}

function formatCodeAnalyzerStatusValue(data: SplashData): string {
  const status = data.codeAnalyzer;
  if (!status || status.status === "unknown") {
    return `${SF_ORANGE("○")} ${SF_ORANGE("Install recommended")}`;
  }
  if (status.status === "ready") {
    const suffix = status.pluginVersion ? ` ${MUTED(`(${status.pluginVersion})`)}` : "";
    return `${SF_GREEN("✓")} ${SF_GREEN("Ready")}${suffix}`;
  }
  if (status.status === "partial") {
    return `${SF_ORANGE("!")} ${SF_ORANGE("Partial setup")} ${MUTED("· /sf-code-analyzer doctor")}`;
  }
  return `${SF_ORANGE("↑")} ${SF_ORANGE("Install recommended")}`;
}

function codeAnalyzerActionHint(data: SplashData): string | null {
  if (!data.codeAnalyzer) return null;
  if (data.codeAnalyzer.status === "ready") return null;
  return "/sf-code-analyzer doctor";
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

function formatVersion(version: string | undefined): string {
  return version ? `v${version}` : "version unknown";
}

function formatReleaseStatusValue(
  status: SplashData["sfPiRelease"] | SplashData["piRelease"],
  mode: GlyphMode,
  suffix: string = "",
): string {
  if (!status) {
    return MUTED(`${glyph("hourglass", mode)} checking latest${suffix}`);
  }

  const installed = formatVersion(status.installedVersion);
  if (status.loading || status.freshness === "checking") {
    return `${MUTED(`${glyph("hourglass", mode)} checking latest`)} ${MUTED(`· ${installed}`)}${suffix}`;
  }

  if (status.freshness === "update-available") {
    const latest = status.latestVersion ? `v${status.latestVersion}` : "latest";
    return `${SF_ORANGE("↑")} ${SF_ORANGE("update available")} ${MUTED(`· ${installed} → ${latest}`)}${suffix}`;
  }

  if (status.freshness === "latest") {
    const label = status.cooldownActive ? "latest allowed [cooldown active]" : "latest";
    return `${SF_GREEN("✓")} ${SF_GREEN(label)} ${MUTED(`· ${installed}`)}${suffix}`;
  }

  const reason = status.checkSkipped ? "latest check skipped" : "latest unknown";
  return `${SF_GREEN("✓")} ${SF_GREEN("installed")} ${MUTED(`· ${installed} (${reason})`)}${suffix}`;
}

function releaseActionHint(
  status: SplashData["sfPiRelease"] | SplashData["piRelease"],
): string | null {
  if (!status || status.loading || status.freshness !== "update-available") return null;
  return status.updateCommand ?? null;
}

function formatSfPiExtensionSuffix(data: SplashData, mode: GlyphMode): string {
  if (data.extensionHealthLoading)
    return ` ${MUTED(`(${glyph("hourglass", mode)} extensions loading)`)}`;
  const extCount = data.extensionHealth.filter(
    (e) => e.status === "active" || e.status === "locked",
  ).length;
  const extTotal = data.extensionHealth.length;
  if (extTotal === 0) return "";
  return ` ${MUTED(`(${extCount}/${extTotal} extensions active)`)}`;
}

function nodeCertSourceLabel(source: NonNullable<SplashData["nodeCert"]>["source"]): string {
  switch (source) {
    case "env":
    case "probe":
      return "NODE_EXTRA_CA_CERTS";
    case "launch-agent":
      return "LaunchAgent";
    case "shell":
      return "shell";
    case "fixer":
      return "saved fix";
    case "candidate":
      return "candidate";
    default:
      return "custom CA";
  }
}

function formatNodeCertStatusValue(data: SplashData, mode: GlyphMode): string {
  const cert = data.nodeCert;

  if (!cert || cert.loading || cert.kind === "checking") {
    return MUTED(`${glyph("hourglass", mode)} Checking`);
  }

  switch (cert.kind) {
    case "verified":
      return `${SF_GREEN("✓")} ${SF_GREEN("Verified")} ${MUTED("· NODE_EXTRA_CA_CERTS")}`;
    case "installed":
      return `${SF_GREEN("✓")} ${SF_GREEN("Installed")} ${MUTED(`· ${nodeCertSourceLabel(cert.source)}`)}`;
    case "found":
      return `${SF_ORANGE("!")} ${SF_ORANGE("Found candidate")}`;
    case "not-configured":
      return `${MUTED("○")} ${MUTED("Not configured")}`;
    case "invalid":
      return `${SF_RED("✗")} ${SF_RED("Invalid path")}`;
    case "unknown":
    default:
      return `${SF_ORANGE("?")} ${SF_ORANGE("Unknown")}`;
  }
}

function nodeCertActionHint(cert: SplashData["nodeCert"]): string | null {
  if (!cert || cert.loading || cert.kind === "checking") return null;
  if (cert.kind === "found") return "/sf-llm-gateway fix-ca-bundle";
  if (
    cert.kind === "installed" &&
    cert.source &&
    cert.source !== "env" &&
    cert.source !== "probe"
  ) {
    return "relaunch pi to inherit NODE_EXTRA_CA_CERTS";
  }
  if (cert.kind === "invalid") return "check NODE_EXTRA_CA_CERTS path";
  return null;
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
  const wordPad = Math.max(0, Math.floor((colWidth - WORD_WIDTH_WITH_SHADOW) / 2));
  for (const row of paintWordmarkRowsWithShadow(wordRows, headerOffset)) {
    lines.push(" ".repeat(wordPad) + row);
  }

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
  lines.push("");

  // Optional integration and environment statuses.
  lines.push(horizontalRule(colWidth));

  // Slack status is optional: hide it unless sf-slack is enabled and configured
  // or has published a live status. This keeps public/external installs quiet.
  if (data.slackVisible) {
    lines.push(formatGlyphInfoRow("slack", mode, "Slack", formatSlackStatusValue(data, mode)));
  }

  // LLM Gateway status is optional and only appears when the bundled gateway
  // extension is enabled. The value comes from the shared auth-gated probe state.
  if (data.gatewayVisible) {
    lines.push(
      formatGlyphInfoRow("gateway", mode, "LLM Gateway", formatGatewayStatusValue(data, mode)),
    );
    // Phase 1.6: passive key-conflict nudge directly under the gateway row.
    // Truncated to the column width so it never wraps. The gateway extension
    // also notifies once per session via ctx.ui.notify() — this row is the
    // visual reminder that persists for the splash's lifetime.
    if (data.gatewayKeyConflict) {
      const hint = `Two API keys configured (env: ${data.gatewayKeyConflict.envKeyHash}…, saved: ${data.gatewayKeyConflict.savedKeyHash}…, saved active)`;
      const truncated = truncateToWidth(hint, Math.max(10, colWidth - 4), "…");
      lines.push(`   ${SF_ORANGE("⚠")} ${MUTED(truncated)}`);
    }
    // Corporate CA nudge sub-line. Only renders when the most recent
    // doctor run flagged a TLS-class failure on macOS, the gateway
    // extension is enabled, and no fix has been applied. All three
    // gates evaluated synchronously in collectCaBundleNudge so this
    // row never adds boot-time work.
    if (data.caBundleNudge) {
      const hint = `${data.caBundleNudge.command} \u2014 ${data.caBundleNudge.message}`;
      const truncated = truncateToWidth(hint, Math.max(10, colWidth - 4), "…");
      lines.push(`   ${SF_ORANGE("⚠")} ${MUTED(truncated)}`);
    }
  }

  // SF CLI status only. Org/API/config context belongs in sf-devbar, not in
  // the welcome splash. Keep this directly under the gateway row so both
  // environment statuses read as one aligned block.
  lines.push(formatGlyphInfoRow("cli", mode, "SF CLI", formatSfCliStatusValue(data, mode)));

  if (data.codeAnalyzer) {
    lines.push(
      formatGlyphInfoRow(
        "codeAnalyzer",
        mode,
        "Code Analyzer",
        formatCodeAnalyzerStatusValue(data),
      ),
    );
    const codeAnalyzerHint = codeAnalyzerActionHint(data);
    if (codeAnalyzerHint) {
      const truncated = truncateToWidth(codeAnalyzerHint, Math.max(10, colWidth - 4), "…");
      lines.push(`   ${MUTED(`→ ${truncated}`)}`);
    }
  }

  // Node custom-CA posture. Cache-first like SF CLI / SF Skills: the row can
  // say "Checking" on first paint, then update once the deferred local-only
  // detector classifies NODE_EXTRA_CA_CERTS / LaunchAgent / shell state.
  lines.push(
    formatGlyphInfoRow("nodeCert", mode, "Node CA Certs", formatNodeCertStatusValue(data, mode)),
  );
  const nodeCertHint = nodeCertActionHint(data.nodeCert);
  if (nodeCertHint) {
    const truncated = truncateToWidth(nodeCertHint, Math.max(10, colWidth - 4), "…");
    lines.push(`   ${MUTED(`→ ${truncated}`)}`);
  }

  // Privacy / telemetry posture. sf-pi opts users out of pi's anonymous
  // install/update ping by default. The row is always rendered so the
  // posture is auditable at a glance — colored green for off, dim gray
  // for on (informational, not a warning).
  if (data.privacy) {
    lines.push(
      formatGlyphInfoRow("privacy", mode, "Privacy", formatPrivacyStatusValue(data.privacy)),
    );
  }

  // SF Skills (forcedotcom/afv-library) install + freshness. Always
  // rendered — the not-installed state is the loud orange nudge that
  // pushes users toward the official skills library. Cache-first paint
  // (see sf-skills-status.ts) keeps this row free at startup.
  lines.push(
    formatGlyphInfoRow("sfSkills", mode, "SF Skills", formatSfSkillsStatusValue(data, mode)),
  );
  // Action hint as a muted sub-line, same convention the gateway row uses
  // for its key-conflict warning. Only fires when there's something the
  // user can actionably run from the row's current state.
  const sfSkillsHint = sfSkillsActionHint(data.sfSkills);
  if (sfSkillsHint) {
    const truncated = truncateToWidth(sfSkillsHint, Math.max(10, colWidth - 4), "…");
    lines.push(`   ${MUTED(`→ ${truncated}`)}`);
  }

  // Release freshness rows sit under SF Skills so package/runtime update
  // state is grouped together. The sf-pi row carries the extension
  // active/total count, replacing the older top-level "sf-pi Extensions"
  // row without losing the enablement signal.
  lines.push(
    formatGlyphInfoRow(
      "extensions",
      mode,
      "sf-pi",
      formatReleaseStatusValue(data.sfPiRelease, mode, formatSfPiExtensionSuffix(data, mode)),
    ),
  );
  const sfPiHint = releaseActionHint(data.sfPiRelease);
  if (sfPiHint) {
    const truncated = truncateToWidth(sfPiHint, Math.max(10, colWidth - 4), "…");
    lines.push(`   ${MUTED(`→ ${truncated}`)}`);
  }

  lines.push(formatGlyphInfoRow("pi", mode, "Pi", formatReleaseStatusValue(data.piRelease, mode)));
  const piHint = releaseActionHint(data.piRelease);
  if (piHint) {
    const truncated = truncateToWidth(piHint, Math.max(10, colWidth - 4), "…");
    lines.push(`   ${MUTED(`→ ${truncated}`)}`);
  }
  lines.push("");

  return lines;
}

function formatPrivacyStatusValue(privacy: NonNullable<SplashData["privacy"]>): string {
  const sourceLabel =
    privacy.source === "sf-pi-default"
      ? "sf-pi default"
      : privacy.source === "user-override"
        ? "user override"
        : "unset";
  // Lead with a ✓ glyph so this row aligns visually with the Slack /
  // LLM Gateway / SF CLI rows above it. Color carries the semantics:
  // green when telemetry is off (privacy-preserving), muted when on
  // (informational, not a warning — see comment at call site).
  if (privacy.telemetryEnabled) {
    return `${MUTED("✓")} ${MUTED("telemetry on")} ${MUTED(`(${sourceLabel})`)}`;
  }
  return `${SF_GREEN("✓")} ${SF_GREEN("telemetry off")} ${MUTED(`(${sourceLabel})`)}`;
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
 *     layout so no content gets ellipsised. The wider shadowed wordmark
 *     needs more left-column space before two columns are comfortable.
 */
const ABSOLUTE_MIN_TERM_WIDTH = 60;
const MIN_BOX_WIDTH = 80;
const MAX_BOX_WIDTH = 220;
const SINGLE_COL_THRESHOLD = 120;
// The shadowed SALESFORCE wordmark is 69 cols wide. Keep the left column
// wide enough to preserve the extra inter-letter breathing room in two-column
// mode; narrower terminals drop to single-column layout instead.
const MIN_LEFT_COL = WORD_WIDTH_WITH_SHADOW + 2;
const MAX_LEFT_COL = 76;

function getBoxWidth(termWidth: number): number {
  // Reserve two columns so the rounded corners do not sit against the
  // terminal edge — matches the bleed behavior Pi's editor expects.
  const usable = Math.max(ABSOLUTE_MIN_TERM_WIDTH, termWidth - 2);
  return Math.max(MIN_BOX_WIDTH, Math.min(usable, MAX_BOX_WIDTH));
}

function getColumnWidths(boxWidth: number): { leftCol: number; rightCol: number } {
  // Aim for ~40 % of the box, but never squeeze the shadowed wordmark.
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
// Splash overlay component
// ═══════════════════════════════════════════════════════════════════════════

export class SfWelcomeOverlay implements Component {
  private data: SplashData;
  // Per-character color offset driven by the extension's animation
  // interval. Incremented each tick for the startup animation window,
  // then frozen.
  private headerOffset: number = 0;

  constructor(data: SplashData) {
    this.data = data;
  }

  setHeaderOffset(offset: number): void {
    this.headerOffset = offset;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    if (termWidth < ABSOLUTE_MIN_TERM_WIDTH) return [];

    const boxWidth = getBoxWidth(termWidth);

    const footerText = " Press any key to continue ";
    const footerStyled = MUTED(footerText);
    const bottomContentWidth = boxWidth - 2;
    const footerVisLen = visibleWidth(footerText);
    const leftPad = Math.floor((bottomContentWidth - footerVisLen) / 2);
    const rightPad = bottomContentWidth - footerVisLen - leftPad;
    const hChar = "─";
    const bottomLine =
      MUTED(hChar.repeat(Math.max(0, leftPad))) +
      footerStyled +
      MUTED(hChar.repeat(Math.max(0, rightPad)));

    return renderSplashBox(this.data, termWidth, bottomLine, this.headerOffset);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Splash header component (persistent)
// ═══════════════════════════════════════════════════════════════════════════

export class SfWelcomeHeader implements Component {
  private data: SplashData;
  // Mirrors SfWelcomeOverlay.headerOffset so non-overlay renders (e.g.
  // the persistent header shown in session lists) can show the same
  // animated frame if the caller chooses to drive it.
  private headerOffset: number = 0;

  constructor(data: SplashData) {
    this.data = data;
  }

  setHeaderOffset(offset: number): void {
    this.headerOffset = offset;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    if (termWidth < ABSOLUTE_MIN_TERM_WIDTH) return [];

    const boxWidth = getBoxWidth(termWidth);
    const hChar = "─";
    const footerText = " Press Esc to dismiss ";
    const footerStyled = MUTED(footerText);
    const bottomContentWidth = boxWidth - 2;
    const footerVisLen = visibleWidth(footerText);
    const leftPad = Math.floor((bottomContentWidth - footerVisLen) / 2);
    const rightPad = bottomContentWidth - footerVisLen - leftPad;
    const bottomLine =
      MUTED(hChar.repeat(Math.max(0, leftPad))) +
      footerStyled +
      MUTED(hChar.repeat(Math.max(0, rightPad)));

    const lines = renderSplashBox(this.data, termWidth, bottomLine, this.headerOffset);
    if (lines.length > 0) {
      lines.push(""); // spacing below header
    }
    return lines;
  }
}
