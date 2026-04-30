/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Slack shortcode → terminal glyph.
 *
 * Slack reactions arrive as shortcodes (`:eyes:`, `:raised_hands:`,
 * `:ack_:`, `:approved-4:`, …). The renderer wants a visually dense
 * reactions row that still degrades gracefully when the terminal is
 * narrow or the emoji is workspace-custom.
 *
 * We resolve shortcodes in three stages, in order:
 *
 *   1. `node-emoji.get()` — authoritative lookup for every standard
 *      Slack alias that maps 1:1 to a Unicode codepoint
 *      (`:eyes:` → `👀`, `:heart:` → `❤️`, `:raised_hands:` → `🙌`, …).
 *
 *   2. Semantic fallback — a small set of regex hints for common
 *      custom-emoji families. Slack workspaces routinely ship
 *      `:approved-4:`, `:lgtm-2:`, `:merge:`, `:ack_:`, `:thankyou_:`,
 *      which have no Unicode equivalent but do have an obvious visual
 *      intent. Mapping those to `✅`, `✔`, `🙏`, etc. keeps the
 *      reactions row readable instead of dumping raw shortcodes.
 *
 *   3. Literal fallback — if neither stage matches, we return the
 *      original `:shortcode:` so the user can still see what was
 *      reacted. The renderer wraps this in `theme.fg("dim", …)` to
 *      visually de-emphasize it relative to real glyphs.
 *
 * All three stages are pure / deterministic — no network, no I/O, no
 * Slack API calls. Custom-emoji image fetch is intentionally out of
 * scope (see proposals/ for the inline-image discussion).
 */

import { get as nodeEmojiGet } from "node-emoji";

// ─── Semantic fallbacks for custom workspace emoji ────────────────────────────
//
// Ordered most-specific → most-generic. First match wins. The patterns
// are case-insensitive and deliberately narrow — we'd rather return
// `:custom-emoji:` than risk a wrong glyph.

const CUSTOM_GLYPH_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  // Approvals, merges, code review
  [/^(approved|lgtm|merge|merged|shipit|ship-it|landed)/i, "✅"],
  [/^(ack|acknowledged|seen|noted)/i, "✔"],

  // Gratitude
  [/^(thank(s|you)?|ty|gratitude)/i, "🙏"],

  // Celebrations
  [/^(party|tada|celebrate|huzzah)/i, "🎉"],

  // Energy / urgency
  [/^(fire|hot|blazing)/i, "🔥"],
  [/^(rocket|ship|launch|liftoff)/i, "🚀"],

  // Warnings / incidents
  [/^(warning|caution|siren|rotating_light|alert)/i, "⚠"],
  [/^(bug|broken|crash|error)/i, "🐛"],

  // Completion / status
  [/^(done|complete|checkmark|check_mark|check)/i, "☑"],
  [/^(wip|in_progress|working)/i, "⏳"],

  // Eyes / attention
  [/^(eyes|looking|watching)/i, "👀"],

  // Generic affirmation
  [/^(thup|thumbsup|plusone|plus1|upvote)/i, "👍"],
  [/^(thdown|thumbsdown|minusone|minus1|downvote)/i, "👎"],
];

/** Return a semantic glyph for a workspace-custom shortcode, or `null`
 *  if no hint matches. Exported for tests. */
export function fallbackGlyph(name: string): string | null {
  if (!name) return null;
  for (const [pattern, glyph] of CUSTOM_GLYPH_HINTS) {
    if (pattern.test(name)) return glyph;
  }
  return null;
}

/**
 * Resolve a Slack reaction shortcode to a renderable glyph.
 *
 *   `shortcodeToGlyph("eyes")`         → `"👀"`   (node-emoji)
 *   `shortcodeToGlyph("raised_hands")` → `"🙌"`   (node-emoji)
 *   `shortcodeToGlyph("ack_")`         → `"✔"`    (semantic fallback)
 *   `shortcodeToGlyph("approved-4")`   → `"✅"`   (semantic fallback)
 *   `shortcodeToGlyph("company-logo")`  → `null`   (caller should render `:name:`)
 *
 * Slack sometimes returns shortcodes with skin-tone modifiers
 * (`"+1::skin-tone-3"`) — strip those before lookup so the base glyph
 * still resolves. We don't try to re-apply the tone; reactions are a
 * roll-up, not a faithful render.
 *
 * Returns `null` when the caller should fall back to the literal
 * `:shortcode:` rendering.
 */
export function shortcodeToGlyph(name: string | undefined): string | null {
  if (!name) return null;
  // Slack tone-modifier suffix, e.g. "+1::skin-tone-3"
  const base = name.split("::")[0];
  if (!base) return null;
  const unicode = nodeEmojiGet(base);
  if (unicode) return unicode;
  return fallbackGlyph(base);
}
