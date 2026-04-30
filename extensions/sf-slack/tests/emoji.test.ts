/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for the shortcode → glyph resolver used by the Slack
 * reactions roll-up.
 *
 * Covers the three stages in order:
 *   1. Standard Slack alias → Unicode via node-emoji.
 *   2. Workspace-custom shortcode → semantic fallback glyph.
 *   3. Unknown shortcode → null, so the renderer emits `:name:`.
 *
 * The standard-alias assertions stay deliberately narrow — we pin
 * exactly the shortcodes that show up in day-to-day Slack reactions
 * (from the reactions roll-up renderer), not the full emojilib set.
 * If node-emoji ever stops shipping one of these, the build should
 * fail and we re-evaluate.
 */
import { describe, it, expect } from "vitest";
import { shortcodeToGlyph, fallbackGlyph } from "../lib/emoji.ts";

describe("shortcodeToGlyph — standard Slack aliases", () => {
  // Each of these is a reaction we observed in live Slack traffic
  // while building this feature. Keeping them pinned here is the
  // fastest way to notice a regression if node-emoji ever drops one.
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ["eyes", "👀"],
    ["heart", "❤️"],
    ["raised_hands", "🙌"],
    ["+1", "👍"],
    ["-1", "👎"],
    ["tada", "🎉"],
    ["fire", "🔥"],
    ["rocket", "🚀"],
    ["pray", "🙏"],
    ["white_check_mark", "✅"],
    ["warning", "⚠️"],
    ["rotating_light", "🚨"],
  ];

  for (const [name, glyph] of CASES) {
    it(`:${name}: → ${glyph}`, () => {
      expect(shortcodeToGlyph(name)).toBe(glyph);
    });
  }

  it("strips skin-tone suffix before lookup", () => {
    // Slack returns "+1::skin-tone-3"; we don't try to re-apply the
    // tone, we just want the base glyph.
    expect(shortcodeToGlyph("+1::skin-tone-3")).toBe("👍");
    expect(shortcodeToGlyph("raised_hands::skin-tone-5")).toBe("🙌");
  });
});

describe("shortcodeToGlyph — semantic fallback for custom emoji", () => {
  // These are all workspace-custom shortcodes with no Unicode
  // equivalent but an obvious visual intent. Mapping them keeps the
  // reactions row readable in a terminal.
  const CASES: ReadonlyArray<readonly [string, string]> = [
    // approvals / reviews
    ["approved", "✅"],
    ["approved-4", "✅"],
    ["lgtm", "✅"],
    ["merge", "✅"],
    ["merged", "✅"],
    ["shipit", "✅"],

    // acknowledgement
    ["ack", "✔"],
    ["ack_", "✔"],
    ["acknowledged", "✔"],

    // gratitude
    ["thankyou", "🙏"],
    ["thankyou_", "🙏"],
    ["thanks", "🙏"],
    ["ty", "🙏"],

    // affirmation
    ["thup", "👍"],
    ["thumbsup", "👍"],
    ["plus1", "👍"],

    // attention
    ["eyes_", "👀"],
    ["looking", "👀"],
  ];

  for (const [name, glyph] of CASES) {
    it(`:${name}: → ${glyph}`, () => {
      expect(shortcodeToGlyph(name)).toBe(glyph);
    });
  }

  it("fallbackGlyph is pure — returns null for unmatched input", () => {
    expect(fallbackGlyph("company-logo")).toBeNull();
    expect(fallbackGlyph("internal-project-codename")).toBeNull();
    expect(fallbackGlyph("")).toBeNull();
  });
});

describe("shortcodeToGlyph — no match", () => {
  it("returns null for workspace-custom emoji with no semantic hint", () => {
    // Truly org-specific shortcodes should fall through so the caller
    // can render `:org-custom:` literally. We never want to guess.
    expect(shortcodeToGlyph("company-logo")).toBeNull();
    expect(shortcodeToGlyph("team-mascot")).toBeNull();
    expect(shortcodeToGlyph("internal-project-codename")).toBeNull();
  });

  it("handles empty and undefined input defensively", () => {
    expect(shortcodeToGlyph(undefined)).toBeNull();
    expect(shortcodeToGlyph("")).toBeNull();
  });
});
