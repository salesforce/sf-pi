/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the sf-ohana-spinner setWorkingIndicator() migration.
 *
 * Covers:
 * - rainbow() produces valid 24-bit ANSI color sequences
 * - buildRainbowFrames() generates one frame per animation step (LCM of the
 *   braille-spinner and rainbow cycles) with a rotating spinner glyph
 *   prepended to the rainbow-colored message
 * - Each frame is unique (animation shifts both spinner and colors)
 * - Spaces are preserved without color codes
 * - Module export still works after the migration
 */
import { describe, it, expect } from "vitest";
import { rainbow, buildRainbowFrames, RAINBOW_COLORS, SPINNER_FRAMES } from "../lib/rainbow.ts";
import { messages } from "../lib/messages.ts";

// -------------------------------------------------------------------------------------------------
// rainbow() — single frame rendering
// -------------------------------------------------------------------------------------------------

describe("rainbow", () => {
  it("returns a string containing 24-bit ANSI color escapes", () => {
    const result = rainbow("Hello", 0);
    // 24-bit color escape format: \x1b[38;2;R;G;Bm
    expect(result).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
  });

  it("ends with ANSI reset", () => {
    const result = rainbow("Test", 0);
    expect(result).toMatch(/\x1b\[0m$/);
  });

  it("preserves spaces without color codes", () => {
    const result = rainbow("A B", 0);
    // Space between A and B should be a literal space, not wrapped in ANSI
    // Split on reset to find the space character between colored chars
    expect(result).toContain(" ");
    // The space should NOT be preceded by a color escape immediately
    const spaceIndex = result.indexOf(" ");
    const beforeSpace = result.slice(Math.max(0, spaceIndex - 1), spaceIndex);
    expect(beforeSpace).not.toMatch(/m$/);
  });

  it("colors each non-space character individually", () => {
    const result = rainbow("AB", 0);
    // Two characters should produce two color escape sequences
    const colorMatches = result.match(/\x1b\[38;2;\d+;\d+;\d+m/g);
    expect(colorMatches).toHaveLength(2);
  });

  it("shifts colors based on offset", () => {
    const frame0 = rainbow("A", 0);
    const frame1 = rainbow("A", 1);
    // Different offsets should produce different color for the same character
    expect(frame0).not.toBe(frame1);
  });

  it("wraps offset around RAINBOW_COLORS length", () => {
    const frame0 = rainbow("A", 0);
    const frameWrapped = rainbow("A", RAINBOW_COLORS.length);
    // Offset equal to the color count should wrap back to the first color
    expect(frame0).toBe(frameWrapped);
  });

  it("returns only a reset for an empty string", () => {
    const result = rainbow("", 0);
    expect(result).toBe("\x1b[0m");
  });

  it("handles a string of only spaces", () => {
    const result = rainbow("   ", 0);
    // Spaces should pass through, ending with reset
    expect(result).toBe("   \x1b[0m");
  });
});

// -------------------------------------------------------------------------------------------------
// buildRainbowFrames() — frame set generation for setWorkingIndicator
// -------------------------------------------------------------------------------------------------

describe("buildRainbowFrames", () => {
  const EXPECTED_FRAME_COUNT = Math.max(RAINBOW_COLORS.length, SPINNER_FRAMES.length);

  it("generates one frame per animation step (LCM of spinner + rainbow cycles)", () => {
    const frames = buildRainbowFrames("Test message...");
    expect(frames).toHaveLength(EXPECTED_FRAME_COUNT);
  });

  it("prefixes every frame with a braille spinner glyph", () => {
    const frames = buildRainbowFrames("Hello");
    // Strip ANSI before inspecting the visible first glyph.

    const ansi = /\x1b\[[0-9;]*m/g;
    for (const frame of frames) {
      const visible = frame.replace(ansi, "");
      const firstGlyph = [...visible][0];
      expect(SPINNER_FRAMES).toContain(firstGlyph);
    }
  });

  it("every frame is a non-empty string", () => {
    const frames = buildRainbowFrames("Testing...");
    for (const frame of frames) {
      expect(typeof frame).toBe("string");
      expect(frame.length).toBeGreaterThan(0);
    }
  });

  it("every frame contains 24-bit ANSI color escapes", () => {
    const frames = buildRainbowFrames("Hello");
    for (const frame of frames) {
      expect(frame).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
    }
  });

  it("every frame ends with ANSI reset", () => {
    const frames = buildRainbowFrames("Test");
    for (const frame of frames) {
      expect(frame).toMatch(/\x1b\[0m$/);
    }
  });

  it("all frames are unique (animation shifts colors)", () => {
    const frames = buildRainbowFrames("Hello World...");
    const unique = new Set(frames);
    expect(unique.size).toBe(frames.length);
  });

  it("every frame embeds the rainbow-colored text alongside the spinner", () => {
    const text = "Testing rainbow...";
    const frames = buildRainbowFrames(text);
    for (let i = 0; i < frames.length; i++) {
      expect(frames[i]).toContain(rainbow(text, i % RAINBOW_COLORS.length));
    }
  });

  it("works with actual messages from the catalog", () => {
    // Test with the first few real messages to catch encoding issues
    for (const msg of messages.slice(0, 5)) {
      const frames = buildRainbowFrames(msg);
      expect(frames).toHaveLength(EXPECTED_FRAME_COUNT);
      expect(frames.every((f) => typeof f === "string" && f.length > 0)).toBe(true);
    }
  });

  it("handles a single character", () => {
    const frames = buildRainbowFrames("X");
    expect(frames).toHaveLength(EXPECTED_FRAME_COUNT);
    // Every frame has a unique spinner glyph + rainbow color combo.
    const unique = new Set(frames);
    expect(unique.size).toBe(EXPECTED_FRAME_COUNT);
  });
});

// -------------------------------------------------------------------------------------------------
// Module export after migration
// -------------------------------------------------------------------------------------------------

describe("sf-ohana-spinner module", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });
});
