/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Glyph policy — tests for the auto-detect, env-var, and settings
 * precedence rules that decide whether emoji or ASCII glyphs render.
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GLYPH_TABLE, glyph, isAsciiPreferredTerminal, resolveGlyphMode } from "../glyph-policy.ts";

// Track temp dirs so we clean up even if a test throws.
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "glyph-policy-"));
  tempDirs.push(dir);
  return dir;
}

function writeProjectSettings(cwd: string, contents: unknown): void {
  const dir = path.join(cwd, ".pi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify(contents), "utf8");
}

// ─── isAsciiPreferredTerminal ────────────────────────────────────────────────

describe("isAsciiPreferredTerminal", () => {
  it("returns true for Apple_Terminal regardless of TERM", () => {
    expect(isAsciiPreferredTerminal({ TERM_PROGRAM: "Apple_Terminal" })).toBe(true);
    expect(
      isAsciiPreferredTerminal({ TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" }),
    ).toBe(true);
  });

  it("returns false for modern emoji-capable terminals", () => {
    expect(isAsciiPreferredTerminal({ TERM_PROGRAM: "iTerm.app" })).toBe(false);
    expect(isAsciiPreferredTerminal({ TERM_PROGRAM: "ghostty" })).toBe(false);
    expect(isAsciiPreferredTerminal({ TERM_PROGRAM: "vscode" })).toBe(false);
    expect(isAsciiPreferredTerminal({ TERM_PROGRAM: "WezTerm" })).toBe(false);
  });

  it("defaults to false when TERM_PROGRAM is absent (CI, subprocesses)", () => {
    // CI runners and nested shells often strip TERM_PROGRAM. Defaulting to
    // emoji keeps snapshots stable; users on broken setups opt in via the
    // env var or settings.
    expect(isAsciiPreferredTerminal({})).toBe(false);
    expect(isAsciiPreferredTerminal({ TERM: "dumb" })).toBe(false);
    expect(isAsciiPreferredTerminal({ TERM: "linux" })).toBe(false);
  });
});

// ─── resolveGlyphMode precedence ─────────────────────────────────────────────

describe("resolveGlyphMode", () => {
  it("env var SF_PI_ASCII_ICONS=1 forces ascii", () => {
    const cwd = makeTempCwd();
    // Even with emoji-friendly terminal + settings saying emoji, env wins.
    writeProjectSettings(cwd, { sfPi: { asciiIcons: false } });
    expect(
      resolveGlyphMode({
        cwd,
        env: { SF_PI_ASCII_ICONS: "1", TERM_PROGRAM: "ghostty" },
      }),
    ).toBe("ascii");
  });

  it("env var SF_PI_ASCII_ICONS=0 forces emoji", () => {
    const cwd = makeTempCwd();
    // Even on Terminal.app with settings saying ascii, env wins.
    writeProjectSettings(cwd, { sfPi: { asciiIcons: true } });
    expect(
      resolveGlyphMode({
        cwd,
        env: { SF_PI_ASCII_ICONS: "0", TERM_PROGRAM: "Apple_Terminal" },
      }),
    ).toBe("emoji");
  });

  it("accepts true/false spellings for the env var", () => {
    expect(resolveGlyphMode({ env: { SF_PI_ASCII_ICONS: "true" }, settingsOverride: false })).toBe(
      "ascii",
    );
    expect(resolveGlyphMode({ env: { SF_PI_ASCII_ICONS: "false" }, settingsOverride: true })).toBe(
      "emoji",
    );
  });

  it("project settings override auto-detect", () => {
    const cwd = makeTempCwd();
    writeProjectSettings(cwd, { sfPi: { asciiIcons: true } });
    expect(resolveGlyphMode({ cwd, env: { TERM_PROGRAM: "ghostty" } })).toBe("ascii");
  });

  it("auto-detect returns ascii on Apple_Terminal by default", () => {
    const cwd = makeTempCwd(); // no settings
    expect(resolveGlyphMode({ cwd, env: { TERM_PROGRAM: "Apple_Terminal" } })).toBe("ascii");
  });

  it("auto-detect returns emoji on modern terminals by default", () => {
    const cwd = makeTempCwd();
    expect(resolveGlyphMode({ cwd, env: { TERM_PROGRAM: "ghostty" } })).toBe("emoji");
  });

  it("falls back to emoji when TERM_PROGRAM is absent (CI-safe)", () => {
    const cwd = makeTempCwd();
    expect(resolveGlyphMode({ cwd, env: {} })).toBe("emoji");
  });

  it("survives corrupted settings.json without throwing", () => {
    const cwd = makeTempCwd();
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(path.join(cwd, ".pi", "settings.json"), "{ not json", "utf8");
    // Corrupt file should behave like no file: fall back to auto-detect.
    expect(resolveGlyphMode({ cwd, env: { TERM_PROGRAM: "ghostty" } })).toBe("emoji");
    expect(resolveGlyphMode({ cwd, env: { TERM_PROGRAM: "Apple_Terminal" } })).toBe("ascii");
  });

  it("settingsOverride hook wins over auto-detect (test ergonomics)", () => {
    expect(resolveGlyphMode({ settingsOverride: true, env: { TERM_PROGRAM: "ghostty" } })).toBe(
      "ascii",
    );
    expect(
      resolveGlyphMode({ settingsOverride: false, env: { TERM_PROGRAM: "Apple_Terminal" } }),
    ).toBe("emoji");
  });
});

// ─── glyph() lookup ──────────────────────────────────────────────────────────

describe("glyph", () => {
  it("returns the emoji form in emoji mode", () => {
    expect(glyph("monthly", "emoji")).toBe("💰");
    expect(glyph("lifetime", "emoji")).toBe("🌐");
    expect(glyph("cli", "emoji")).toBe("🧰");
    expect(glyph("loaded", "emoji")).toBe("📦");
  });

  it("returns the ASCII form in ascii mode", () => {
    expect(glyph("monthly", "ascii")).toBe("$");
    expect(glyph("lifetime", "ascii")).toBe("@");
    expect(glyph("cli", "ascii")).toBe(">");
    expect(glyph("loaded", "ascii")).toBe("[]");
  });

  it("every glyph has both emoji and ascii variants", () => {
    for (const key of Object.keys(GLYPH_TABLE) as (keyof typeof GLYPH_TABLE)[]) {
      const entry = GLYPH_TABLE[key];
      expect(entry.emoji, `glyph ${key} emoji`).toBeTypeOf("string");
      expect(entry.emoji.length, `glyph ${key} emoji non-empty`).toBeGreaterThan(0);
      expect(entry.ascii, `glyph ${key} ascii`).toBeTypeOf("string");
      expect(entry.ascii.length, `glyph ${key} ascii non-empty`).toBeGreaterThan(0);
    }
  });

  it("ASCII variants contain only BMP Latin / punctuation", () => {
    // The whole point of the ASCII variant is to render on Terminal.app
    // without a Nerd/emoji font. Guard against future edits that sneak a
    // high-codepoint character back in.
    for (const key of Object.keys(GLYPH_TABLE) as (keyof typeof GLYPH_TABLE)[]) {
      const ascii = GLYPH_TABLE[key].ascii;
      for (const char of ascii) {
        const code = char.codePointAt(0) ?? 0;
        expect(code, `glyph ${key} ascii uses BMP-safe codepoint`).toBeLessThan(0x2500);
      }
    }
  });
});
