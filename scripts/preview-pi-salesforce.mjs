#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Preview-only: "Pi + Salesforce" brand mark with a two-palette design
 * painted in the ohana-spinner animation style.
 *
 * Palettes:
 *   - BLUE_PALETTE:    Salesforce blue family. Applied to the big
 *     SALESFORCE wordmark so it reads as "solidly the brand."
 *   - RAINBOW_PALETTE: Ohana-spinner pastel rainbow. Applied to the Pi
 *     glyph and the "[ Headless 360 · procode access ]" caption so they
 *     pair with the [SF LLM Gateway] spinner visually.
 *
 * Animation:
 *   - 150 ms/frame (sf-ohana-spinner's FRAME_INTERVAL_MS)
 *   - Per-character color advance (spaces pass through)
 *   - Offset ticks by 1 each frame, both palettes cycle in lock-step
 *   - 3-second preview duration, then freezes on the last frame
 *
 * Nothing in the splash is modified by running this.
 *
 * Usage:
 *   node scripts/preview-pi-salesforce.mjs
 *   node scripts/preview-pi-salesforce.mjs --animate
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// ═══════════════════════════════════════════════════════════════════════════
// Two palettes, two roles:
//
//   BLUE_PALETTE    - Big SALESFORCE word. Same 6 stops as the existing
//                     Pi logo in splash-component.ts (SF Blue -> cyan ->
//                     purple). Blue channel >= 210 on every stop, so the
//                     word stays solidly in the Salesforce family even
//                     mid-animation.
//
//   RAINBOW_PALETTE - Pi glyph and caption. Byte-for-byte copy of
//                     sf-ohana-spinner's RAINBOW_COLORS (7 soft pastels).
//                     Gives Pi + caption the same shimmer as the
//                     [SF LLM Gateway] spinner.
//
// Both palettes share the same offset + cadence so the whole mark
// animates in lock-step even though the color families differ.
//
// If either upstream palette changes, mirror the update here:
//   - splash-component.ts  GRADIENT_COLORS   (BLUE_PALETTE)
//   - sf-ohana-spinner/lib/rainbow.ts RAINBOW_COLORS (RAINBOW_PALETTE)
// ═══════════════════════════════════════════════════════════════════════════
const BLUE_PALETTE = [
  [0, 112, 210], //    SF Blue
  [1, 160, 230], //    Mid blue
  [1, 195, 226], //    Astro cyan
  [80, 160, 240], //   Light blue
  [120, 120, 250], //  Lavender
  [144, 97, 249], //   SF Purple
];

const RAINBOW_PALETTE = [
  [200, 120, 130], // dusty rose
  [210, 150, 120], // soft peach
  [200, 185, 120], // muted gold
  [130, 190, 140], // sage green
  [120, 170, 200], // soft sky blue
  [150, 130, 190], // lavender
  [185, 130, 180], // soft mauve
];

// 300 ms/frame — exactly half the speed of sf-ohana-spinner's
// FRAME_INTERVAL_MS (150). The spinner lives inline with text and
// benefits from quicker motion; the splash mark is a standalone
// "boot-up" moment and reads better when slower. The viewer has time
// to track a single color walking across the width.
//
// Override at the CLI: --fast (150) or --slow (450).
let FRAME_INTERVAL_MS = 300;
if (process.argv.includes("--fast")) FRAME_INTERVAL_MS = 150;
if (process.argv.includes("--slow")) FRAME_INTERVAL_MS = 450;

function fgRgb(rgb, text) {
  const [r, g, b] = rgb;
  return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mark shape — big Pi over SALESFORCE (layout A)
// ═══════════════════════════════════════════════════════════════════════════

const PI_LOGO = [
  "▀████████████▀",
  "  ███    ███  ",
  "  ███    ███  ",
  "  ███    ███  ",
  " ▄███▄  ▄███▄ ",
];

const LETTERS = {
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
const WORD_WIDTH = WORD.length * 5 + (WORD.length - 1);

// ═══════════════════════════════════════════════════════════════════════════
// Per-character painting with a caller-supplied palette.
//
// state.charIndex is kept separate per section (Pi vs word vs caption)
// so each section's cycle starts fresh at index 0. This mirrors the
// sf-ohana-spinner: one message, one run of chars, spaces passed
// through unchanged.
// ═══════════════════════════════════════════════════════════════════════════

function paintRow(row, state, offset, palette) {
  let result = "";
  for (const ch of row) {
    if (ch === " ") {
      result += ch;
      continue;
    }
    const colorIdx = (state.charIndex + offset) % palette.length;
    result += fgRgb(palette[colorIdx], ch);
    state.charIndex++;
  }
  return result;
}

function renderMark(offset) {
  const lines = [];

  // Pi — pastel rainbow. Fresh charIndex so Pi's color cycle is
  // independent of the wordmark below it.
  const piState = { charIndex: 0 };
  const piPad = Math.max(0, Math.floor((WORD_WIDTH - PI_LOGO[0].length) / 2));
  for (const row of PI_LOGO) {
    lines.push(" ".repeat(piPad) + paintRow(row, piState, offset, RAINBOW_PALETTE));
  }
  lines.push("");

  // SALESFORCE — Salesforce blue family. Fresh charIndex so the word's
  // color distribution starts from blue regardless of Pi above.
  const wordState = { charIndex: 0 };
  for (let r = 0; r < 5; r++) {
    let rawRow = "";
    for (let li = 0; li < WORD.length; li++) {
      rawRow += LETTERS[WORD[li]][r];
      if (li < WORD.length - 1) rawRow += " ";
    }
    lines.push(paintRow(rawRow, wordState, offset, BLUE_PALETTE));
  }
  lines.push("");

  // Caption — pastel rainbow, pairing it visually with Pi above.
  const capState = { charIndex: 0 };
  const caption = "[ Headless 360 \u00b7 procode access ]";
  const capPad = Math.max(0, Math.floor((WORD_WIDTH - caption.length) / 2));
  lines.push(" ".repeat(capPad) + paintRow(caption, capState, offset, RAINBOW_PALETTE));

  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Driver
// ═══════════════════════════════════════════════════════════════════════════

function printStatic() {
  console.log(`${BOLD}Pi + Salesforce \u2014 rainbow Pi/caption + blue SALESFORCE${RESET}`);
  console.log(
    `${DIM}Run with --animate (6 s, 300 ms/frame). Use --fast or --slow to tune.${RESET}`,
  );
  console.log("");
  for (const line of renderMark(0)) console.log("  " + line);
  console.log("");
}

async function printAnimated() {
  // Longer default preview so the slower cadence still gets enough
  // frames to read as a full color walk-through.
  const TOTAL_MS = 6000;
  const FRAMES = Math.round(TOTAL_MS / FRAME_INTERVAL_MS);

  console.log(
    `${BOLD}Animated preview \u2014 two-palette cycle at ${FRAME_INTERVAL_MS} ms/frame${RESET}`,
  );
  console.log(`${DIM}(${FRAMES} frames over ${TOTAL_MS / 1000} s, then freezes.)${RESET}`);
  console.log("");

  const first = renderMark(0);
  const rowCount = first.length;
  for (const line of first) process.stdout.write("  " + line + "\n");

  for (let f = 1; f < FRAMES; f++) {
    await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
    process.stdout.write(`\x1b[${rowCount}A`);
    process.stdout.write("\x1b[0J");
    for (const line of renderMark(f)) process.stdout.write("  " + line + "\n");
  }

  console.log("");
  console.log(`${DIM}Cycle complete. Mark freezes on frame ${FRAMES - 1}.${RESET}`);
}

async function main() {
  console.log("");
  if (process.argv.includes("--animate")) {
    await printAnimated();
  } else {
    printStatic();
  }
}

main();
