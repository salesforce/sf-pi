/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Rainbow ANSI colorizer for the ohana spinner.
 *
 * Pure functions: text + offset in, ANSI-colored string out.
 * Extracted from index.ts so the rainbow rendering logic is independently testable.
 */

// Soft pastel rainbow — muted tones that work on dark backgrounds
export const RAINBOW_COLORS = [
  [200, 120, 130], // Dusty rose
  [210, 150, 120], // Soft peach
  [200, 185, 120], // Muted gold
  [130, 190, 140], // Sage green
  [120, 170, 200], // Soft sky blue
  [150, 130, 190], // Lavender
  [185, 130, 180], // Soft mauve
] as const;

/**
 * Braille dot spinner frames prepended to the rainbow message. Matches Pi's
 * default loader animation so the spinner reads as "something is working"
 * even before the user notices the rainbow color shift.
 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/**
 * Apply a flowing rainbow effect to text using 24-bit ANSI colors.
 * The offset shifts the starting color to create animation.
 */
export function rainbow(text: string, offset: number): string {
  let result = "";
  let charIndex = 0;
  for (const char of text) {
    if (char === " ") {
      result += char;
    } else {
      const colorIdx = (charIndex + offset) % RAINBOW_COLORS.length;
      const [r, g, b] = RAINBOW_COLORS[colorIdx];
      result += `\x1b[38;2;${r};${g};${b}m${char}`;
      charIndex++;
    }
  }
  result += "\x1b[0m";
  return result;
}

/**
 * Pre-compute one animation cycle of frames for a given message. Each frame
 * is `<braille-spinner> <rainbow-text>`, both colored with the current
 * lead color so the indicator feels unified.
 *
 * Frame count = max(RAINBOW_COLORS.length, SPINNER_FRAMES.length). Pi's
 * loader advances one frame per `intervalMs` tick; the spinner and rainbow
 * cycles are indexed modulo their own lengths so both keep looping cleanly.
 */
export function buildRainbowFrames(text: string): string[] {
  const cycleLen = Math.max(RAINBOW_COLORS.length, SPINNER_FRAMES.length);
  return Array.from({ length: cycleLen }, (_, offset) => {
    const spinnerChar = SPINNER_FRAMES[offset % SPINNER_FRAMES.length];
    const [r, g, b] = RAINBOW_COLORS[offset % RAINBOW_COLORS.length];
    const spinner = `\x1b[38;2;${r};${g};${b}m${spinnerChar}\x1b[0m`;
    return `${spinner} ${rainbow(text, offset)}`;
  });
}
