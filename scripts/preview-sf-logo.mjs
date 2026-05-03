#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Preview-only: renders the proposed splash header — Pi + SF with a
 * "[ Salesforce Headless 360 ]" caption, all in the Pi brand gradient.
 *
 * This iteration: vertical spacing variants between the Pi+SF block and
 * the caption. Nothing in the splash is changed by running this.
 *
 * Usage:  node scripts/preview-sf-logo.mjs
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// --- Mirrors splash-component.ts ---
const GRADIENT_COLORS = [
  "\x1b[38;2;0;112;210m", // SF Blue
  "\x1b[38;2;1;160;230m", // Mid blue
  "\x1b[38;2;1;195;226m", // Astro cyan
  "\x1b[38;2;80;160;240m", // Light blue
  "\x1b[38;2;120;120;250m", // Lavender
  "\x1b[38;2;144;97;249m", // SF Purple
];

function gradientLine(line) {
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

const PI_LOGO = [
  "▀████████████▀",
  "  ███    ███  ",
  "  ███    ███  ",
  "  ███    ███  ",
  " ▄███▄  ▄███▄ ",
];

// M3 — the SF monogram you picked (smooth symmetric S, 16w)
const SF_LOGO = [
  " ▄█████▄  ███████",
  "██        ██     ",
  " ▀█████▄  █████▀ ",
  "      ██  ██     ",
  " █████▀   ██     ",
];

const CAPTION = "[ Salesforce Headless 360 ]";

// ═══════════════════════════════════════════════════════════════════════════
// Render helpers
// ═══════════════════════════════════════════════════════════════════════════

function renderPiAndSf() {
  const piWidth = PI_LOGO[0].length; // 14
  const sfWidth = SF_LOGO[0].length; // 17
  const separator = "     "; // 5 cols between, "+" centered vertically
  const plusRow = Math.floor(PI_LOGO.length / 2);
  const lines = [];
  for (let i = 0; i < PI_LOGO.length; i++) {
    const pi = gradientLine(PI_LOGO[i] ?? " ".repeat(piWidth));
    const sf = gradientLine(SF_LOGO[i] ?? " ".repeat(sfWidth));
    const mid = i === plusRow ? `  ${DIM}+${RESET}  ` : "     ";
    lines.push(pi + mid + sf);
  }
  return { lines, totalWidth: piWidth + separator.length + sfWidth };
}

function centerTo(str, visWidth, targetWidth) {
  if (visWidth >= targetWidth) return str;
  const leftPad = Math.floor((targetWidth - visWidth) / 2);
  return " ".repeat(leftPad) + str;
}

// ═══════════════════════════════════════════════════════════════════════════
// Spacing variants — how many blank lines between Pi+SF and the caption
// ═══════════════════════════════════════════════════════════════════════════

const SPACING_VARIANTS = [
  { id: "V0", label: "V0 — no gap (tight, original)", blankLines: 0 },
  { id: "V1", label: "V1 — 1 blank line", blankLines: 1 },
  { id: "V2", label: "V2 — 2 blank lines (airy)", blankLines: 2 },
  { id: "V3", label: "V3 — 1 blank + horizontal rule + 1 blank (separator)", blankLines: -1 },
];

const header = renderPiAndSf();
const captionGrad = gradientLine(CAPTION);
const captionCentered = centerTo(captionGrad, CAPTION.length, header.totalWidth);

console.log("");
console.log(`${BOLD}═══ Vertical spacing variants between Pi+SF and caption ═══${RESET}`);
console.log("");

for (const v of SPACING_VARIANTS) {
  console.log(`${BOLD}${v.label}${RESET}`);
  for (const line of header.lines) console.log("   " + line);
  if (v.blankLines === -1) {
    console.log("");
    // Dim horizontal rule, same visible width as the header block
    const rule = DIM + "─".repeat(header.totalWidth) + RESET;
    console.log("   " + rule);
    console.log("");
  } else {
    for (let i = 0; i < v.blankLines; i++) console.log("");
  }
  console.log("   " + captionCentered);
  console.log("");
  console.log("");
}

console.log(`${DIM}Tell me which spacing variant (V0 / V1 / V2 / V3) to use.${RESET}`);
console.log("");
