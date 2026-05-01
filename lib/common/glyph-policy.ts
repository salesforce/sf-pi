/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Glyph policy — decides whether to render emoji/box glyphs or ASCII
 * fallbacks in sf-pi UI surfaces (splash screen, bottom bar, status pills).
 *
 * Why this exists:
 *   macOS Terminal.app and some oh-my-zsh/Powerlevel10k font setups do not
 *   fall back to Apple Color Emoji for characters the primary font does not
 *   cover. Users see tofu (`?`) boxes for `⚡`, `💰`, `🧩`, `📦`, `🔗`, etc.
 *   iTerm2 / Ghostty / VS Code terminals handle this gracefully, which is
 *   why it works locally but breaks for users on plain Terminal.
 *
 * Resolution precedence (highest → lowest):
 *   1. Env var `SF_PI_ASCII_ICONS=1` or `=0` — immediate override, no
 *      settings lookup. Useful for CI, smoke tests, and "one shot" debug.
 *   2. Settings `sfPi.asciiIcons: true | false` (project > global).
 *   3. Auto-detect: return `"ascii"` on terminals known to lack emoji
 *      fallback (Apple_Terminal, dumb/linux TERM). Return `"emoji"` on
 *      everything else (iTerm, Ghostty, WezTerm, VS Code, Warp, etc.).
 *
 * The detector is intentionally conservative: default to `"emoji"` when we
 * cannot tell, so modern terminals are not punished. Users on broken
 * setups have two clearly-documented opt-in paths.
 *
 * This module has no dependencies on Pi's extension API — it is a pure
 * utility so the splash, bottom bar, and status pills can all share it.
 */
import { existsSync, readFileSync } from "node:fs";
import { globalSettingsPath, projectSettingsPath } from "./pi-paths.ts";

/** Icon mode selected by {@link resolveGlyphMode}. */
export type GlyphMode = "emoji" | "ascii";

/** Env var that forces a mode regardless of settings and auto-detect. */
export const GLYPH_MODE_ENV_VAR = "SF_PI_ASCII_ICONS";

/** Settings key (nested) — `sfPi.asciiIcons: true | false`. */
export const GLYPH_MODE_SETTING_KEY = "sfPi.asciiIcons";

// -------------------------------------------------------------------------------------------------
// Environment detection
// -------------------------------------------------------------------------------------------------

/**
 * Detect whether the current terminal is known to render emoji poorly.
 *
 * Auto-ascii is intentionally conservative — we only flip the default on
 * terminals where the bug has actually been reported and where we have
 * high confidence the user does not have an emoji-capable font chain.
 *
 * Currently that is only macOS Terminal.app (`TERM_PROGRAM=Apple_Terminal`).
 * For everything else (including `TERM=dumb` which can show up in CI runs
 * and subprocess contexts) users opt in explicitly via `SF_PI_ASCII_ICONS=1`
 * or `sfPi.asciiIcons: true` in settings. This keeps CI snapshots stable and
 * avoids punishing users who happened to set `TERM` unusually.
 *
 * iTerm2, Ghostty, WezTerm, Warp, VS Code integrated terminal, Hyper,
 * Alacritty, and Kitty all either fall back to a system emoji font or
 * support them natively, so we default to emoji mode on all of them.
 */
export function isAsciiPreferredTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERM_PROGRAM === "Apple_Terminal";
}

// -------------------------------------------------------------------------------------------------
// Settings lookup
// -------------------------------------------------------------------------------------------------

function readJsonSafe(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Corrupted settings should not break the splash / bottom bar.
    return {};
  }
}

/**
 * Read `sfPi.asciiIcons` from project then global settings.
 *
 * Returns `undefined` when neither file declares the flag — the caller
 * should then fall back to env var + auto-detect.
 */
function readSettingsOverride(cwd: string): boolean | undefined {
  // Project overrides global — matches Pi's own precedence so power users
  // can pin a project to ASCII mode without changing their global default.
  const scopes = [readJsonSafe(projectSettingsPath(cwd)), readJsonSafe(globalSettingsPath())];
  for (const settings of scopes) {
    const sfPi = settings.sfPi;
    if (sfPi && typeof sfPi === "object") {
      const flag = (sfPi as Record<string, unknown>).asciiIcons;
      if (typeof flag === "boolean") return flag;
    }
  }
  return undefined;
}

// -------------------------------------------------------------------------------------------------
// Public resolver
// -------------------------------------------------------------------------------------------------

export interface ResolveGlyphModeOptions {
  /** Current working directory — used to look up project settings. */
  cwd?: string;
  /** Override the process env (tests). */
  env?: NodeJS.ProcessEnv;
  /** Override the settings lookup (tests). */
  settingsOverride?: boolean;
}

/**
 * Resolve the glyph mode using env var → settings → auto-detect.
 *
 * Pure function — no I/O side effects beyond reading settings.json. Safe
 * to call from any render path; callers typically cache the result for
 * the lifetime of a render cycle.
 */
export function resolveGlyphMode(options: ResolveGlyphModeOptions = {}): GlyphMode {
  const env = options.env ?? process.env;

  // 1. Env var wins.
  const envFlag = env[GLYPH_MODE_ENV_VAR];
  if (envFlag === "1" || envFlag === "true") return "ascii";
  if (envFlag === "0" || envFlag === "false") return "emoji";

  // 2. Settings override (test hook or real file lookup).
  const settingsFlag =
    options.settingsOverride !== undefined
      ? options.settingsOverride
      : readSettingsOverride(options.cwd ?? process.cwd());
  if (settingsFlag === true) return "ascii";
  if (settingsFlag === false) return "emoji";

  // 3. Auto-detect.
  return isAsciiPreferredTerminal(env) ? "ascii" : "emoji";
}

// -------------------------------------------------------------------------------------------------
// Glyph table
// -------------------------------------------------------------------------------------------------

/**
 * Stable set of glyphs used across sf-pi UI. Each entry pairs the rich
 * emoji/box variant with an ASCII fallback that preserves the semantic
 * meaning without relying on fonts outside the default Terminal.app
 * coverage (BMP Latin + shapes + arrows).
 *
 * Keep keys short and action-oriented — they are used at render sites.
 */
export const GLYPH_TABLE = {
  // Section markers
  monthly: { emoji: "💰", ascii: "$" },
  lifetime: { emoji: "Σ", ascii: "Σ" }, // Greek capital sigma — BMP, renders on every terminal
  extensions: { emoji: "🧩", ascii: "+" },
  slack: { emoji: "💬", ascii: ">" },
  gateway: { emoji: "🔗", ascii: "~" },
  cloud: { emoji: "☁", ascii: "*" }, // Salesforce Environment / Salesforce AI
  loaded: { emoji: "📦", ascii: "[]" },
  recent: { emoji: "🕐", ascii: "o" },
  whatsNew: { emoji: "✨", ascii: "*" },
  announce: { emoji: "🔔", ascii: "!" },
  hourglass: { emoji: "⏳", ascii: "..." },
  bug: { emoji: "🐛", ascii: "!" },
  pr: { emoji: "🔀", ascii: "><" },
  warn: { emoji: "⚠️", ascii: "!" }, // note: VS16 variation selector
  // Inline bullets that already render fine in Terminal.app but we want a
  // single switchable source of truth for custom renderers.
  node: { emoji: "⬢", ascii: "*" },
  hex: { emoji: "⬡", ascii: "-" },
  diamondSolid: { emoji: "◆", ascii: "*" },
  diamondOpen: { emoji: "◇", ascii: "." },
} as const;

export type GlyphKey = keyof typeof GLYPH_TABLE;

/**
 * Return the concrete glyph for a semantic key + mode.
 *
 * Use at render sites like `glyph("monthly", mode) + " Monthly"` so the single
 * call site makes it obvious which icon is involved.
 */
export function glyph(key: GlyphKey, mode: GlyphMode): string {
  const entry = GLYPH_TABLE[key];
  return mode === "ascii" ? entry.ascii : entry.emoji;
}
