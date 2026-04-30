/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Font installer tests.
 *
 * Critical behavior contracts:
 * - idempotent (re-run copies nothing when sha matches)
 * - detects and overwrites mismatched target content
 * - reports platform dispatch correctly (macOS/Linux dir, Windows skip)
 * - cache refresh failures never throw
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUNDLED_FONTS,
  bundledFontsDir,
  installFonts,
  isFontFamilyInstalled,
  refreshFontCache,
  runFontInstall,
  sha256File,
  userFontDir,
} from "../lib/font-installer.ts";

describe("userFontDir", () => {
  it("returns ~/Library/Fonts on macOS", () => {
    expect(userFontDir("darwin", "/Users/alex")).toBe("/Users/alex/Library/Fonts");
  });

  it("returns ~/.local/share/fonts on Linux", () => {
    expect(userFontDir("linux", "/home/alex")).toBe("/home/alex/.local/share/fonts");
  });

  it("returns null for Windows (manual install)", () => {
    expect(userFontDir("win32", "C:/Users/alex")).toBeNull();
  });
});

describe("bundled fonts on disk", () => {
  it("every manifest entry has a matching TTF with the pinned sha256", () => {
    const sourceDir = bundledFontsDir();
    for (const font of BUNDLED_FONTS) {
      const full = path.join(sourceDir, font.fileName);
      expect(existsSync(full), `${font.fileName} missing on disk`).toBe(true);
      expect(sha256File(full)).toBe(font.sha256);
    }
  });
});

describe("installFonts", () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = mkdtempSync(path.join(tmpdir(), "sf-welcome-fonts-"));
  });

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("installs every bundled font into an empty target dir", () => {
    const results = installFonts({ targetDir, platform: "darwin" });
    expect(results.every((r) => r.status === "installed")).toBe(true);
    for (const font of BUNDLED_FONTS) {
      const target = path.join(targetDir, font.fileName);
      expect(existsSync(target)).toBe(true);
      expect(sha256File(target)).toBe(font.sha256);
    }
  });

  it("is idempotent on re-run", () => {
    installFonts({ targetDir, platform: "darwin" });
    const second = installFonts({ targetDir, platform: "darwin" });
    expect(second.every((r) => r.status === "already-installed")).toBe(true);
  });

  it("replaces a mismatched target file with the pinned bytes", () => {
    const firstFont = BUNDLED_FONTS[0];
    const target = path.join(targetDir, firstFont.fileName);
    writeFileSync(target, "not a real ttf");
    expect(sha256File(target)).not.toBe(firstFont.sha256);

    const results = installFonts({ targetDir, platform: "darwin" });
    const firstResult = results.find((r) => r.fileName === firstFont.fileName);
    expect(firstResult?.status).toBe("replaced");
    expect(sha256File(target)).toBe(firstFont.sha256);
  });

  it("creates the target dir if it doesn't exist", () => {
    const nested = path.join(targetDir, "nested", "fonts");
    expect(existsSync(nested)).toBe(false);
    installFonts({ targetDir: nested, platform: "darwin" });
    expect(existsSync(nested)).toBe(true);
    for (const font of BUNDLED_FONTS) {
      expect(existsSync(path.join(nested, font.fileName))).toBe(true);
    }
  });

  it("reports skipped-unsupported on Windows", () => {
    const results = installFonts({ targetDir, platform: "win32" });
    expect(results.every((r) => r.status === "skipped-unsupported")).toBe(true);
    for (const font of BUNDLED_FONTS) {
      expect(existsSync(path.join(targetDir, font.fileName))).toBe(false);
    }
  });

  it("reports skipped-missing-source when a bundled TTF is missing", () => {
    const fakeSourceDir = mkdtempSync(path.join(tmpdir(), "sf-welcome-fakesrc-"));
    try {
      const results = installFonts({
        targetDir,
        sourceDir: fakeSourceDir,
        platform: "darwin",
      });
      expect(results.every((r) => r.status === "skipped-missing-source")).toBe(true);
      expect(results.every((r) => typeof r.error === "string" && r.error.length > 0)).toBe(true);
    } finally {
      rmSync(fakeSourceDir, { recursive: true, force: true });
    }
  });

  it("reports a sha mismatch when the source TTF is corrupted", () => {
    const fakeSourceDir = mkdtempSync(path.join(tmpdir(), "sf-welcome-fakesrc-"));
    try {
      // Seed the fake source with junk files that share the bundled names.
      mkdirSync(fakeSourceDir, { recursive: true });
      for (const font of BUNDLED_FONTS) {
        writeFileSync(path.join(fakeSourceDir, font.fileName), "corrupted bytes");
      }
      const results = installFonts({
        targetDir,
        sourceDir: fakeSourceDir,
        platform: "darwin",
      });
      expect(results.every((r) => r.status === "skipped-missing-source")).toBe(true);
      for (const r of results) {
        expect(r.error).toMatch(/sha256 mismatch/);
      }
    } finally {
      rmSync(fakeSourceDir, { recursive: true, force: true });
    }
  });
});

describe("isFontFamilyInstalled", () => {
  it("returns false when the target dir doesn't exist", () => {
    // Point at a guaranteed-missing path by using a fresh tmp dir we
    // immediately delete.
    const missing = mkdtempSync(path.join(tmpdir(), "sf-welcome-missing-"));
    rmSync(missing, { recursive: true, force: true });
    // We can't stub userFontDir from here without a full mock, so just
    // verify the path existence check works by passing a synthetic home
    // on a known platform.
    expect(isFontFamilyInstalled("linux", missing)).toBe(false);
  });

  it("returns true when the Regular TTF is present", () => {
    const home = mkdtempSync(path.join(tmpdir(), "sf-welcome-home-"));
    try {
      const fontDir = path.join(home, ".local", "share", "fonts");
      mkdirSync(fontDir, { recursive: true });
      writeFileSync(path.join(fontDir, "MesloLGMNerdFontMono-Regular.ttf"), "dummy");
      expect(isFontFamilyInstalled("linux", home)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("returns true when a sibling Nerd Font weight is present (homebrew install)", () => {
    const home = mkdtempSync(path.join(tmpdir(), "sf-welcome-home-"));
    try {
      const fontDir = path.join(home, ".local", "share", "fonts");
      mkdirSync(fontDir, { recursive: true });
      writeFileSync(path.join(fontDir, "MesloLGSNerdFont-Regular.ttf"), "dummy");
      expect(isFontFamilyInstalled("linux", home)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("runFontInstall", () => {
  it("returns manual instructions on Windows without running the installer", async () => {
    const fakeExec = async () => ({ stdout: "", stderr: "", code: 0 });
    const result = await runFontInstall(fakeExec, "win32");
    expect(result.severity).toBe("info");
    expect(result.changed).toBe(false);
    expect(result.summary).toContain("manual");
    expect(result.summary).toContain("MesloLGM Nerd Font Mono");
  });

  it("produces the canonical Next-steps block with the Ghostty snippet", async () => {
    // Exercising the darwin path uses the caller's real ~/Library/Fonts
    // by design — but runFontInstall is idempotent, so running it in
    // tests is safe on a machine where the font is already installed.
    // We still assert only the shared output format so the test is
    // stable regardless of which status each file actually reports.
    const fakeExec = async () => ({ stdout: "", stderr: "", code: 0 });
    const result = await runFontInstall(fakeExec);
    expect(result.summary).toContain("Next steps:");
    expect(result.summary).toContain("font-family = MesloLGM Nerd Font Mono");
  });
});

describe("refreshFontCache", () => {
  it("returns { ok: true } when the tool exits 0 on macOS", async () => {
    const fakeExec = async () => ({ stdout: "", stderr: "", code: 0 });
    const result = await refreshFontCache(fakeExec, "darwin");
    expect(result.tool).toBe("atsutil");
    expect(result.ok).toBe(true);
  });

  it("returns { ok: false } when the tool exits non-zero on Linux", async () => {
    const fakeExec = async () => ({ stdout: "", stderr: "boom", code: 1 });
    const result = await refreshFontCache(fakeExec, "linux");
    expect(result.tool).toBe("fc-cache");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("boom");
  });

  it("never throws when exec itself rejects", async () => {
    const fakeExec = async () => {
      throw new Error("command not found");
    };
    const result = await refreshFontCache(fakeExec, "darwin");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("command not found");
  });

  it("returns tool: 'none' on unsupported platforms", async () => {
    const fakeExec = async () => ({ stdout: "", stderr: "", code: 0 });
    const result = await refreshFontCache(fakeExec, "win32");
    expect(result.tool).toBe("none");
    expect(result.ok).toBe(false);
  });
});
