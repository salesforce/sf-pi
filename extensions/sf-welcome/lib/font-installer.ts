/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Font installer for sf-welcome.
 *
 * Copies the four bundled MesloLGM Nerd Font Mono TTFs from
 * `extensions/sf-welcome/assets/fonts/` into the user's per-user font
 * directory, verifies each file by SHA-256 so we never silently
 * overwrite a known-good install, and refreshes the OS font cache on
 * a best-effort basis.
 *
 * Design tenets:
 *
 * - **Opt-in writes only.** Nothing installs on startup. The user must
 *   run `/sf-setup-fonts`.
 * - **Idempotent.** A second run with the same TTFs already in place is
 *   a no-op and reports "already installed" per file.
 * - **No sudo, no system-wide install.** We only touch the per-user
 *   fonts directory (`~/Library/Fonts` on macOS,
 *   `~/.local/share/fonts` on Linux). Windows is "print instructions
 *   and exit" because `C:\Windows\Fonts` needs admin.
 * - **Tolerant of missing cache tools.** `atsutil` / `fc-cache` failures
 *   never fail the install — the fonts are already on disk and a
 *   terminal restart picks them up.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";

// -------------------------------------------------------------------------------------------------
// Bundled font manifest
// -------------------------------------------------------------------------------------------------

/**
 * One entry per bundled TTF. `sha256` pins the exact bytes we ship so a
 * later `cp` that silently corrupts a file is caught before we declare
 * "already installed".
 */
export interface BundledFont {
  /** Basename as it appears both in the repo and on the target filesystem. */
  fileName: string;
  /** Hex SHA-256 of the bundled TTF. */
  sha256: string;
}

export const BUNDLED_FONTS: ReadonlyArray<BundledFont> = [
  {
    fileName: "MesloLGMNerdFontMono-Regular.ttf",
    sha256: "a440f036bcb21a13b9c0b6852d2e53a5df4752d5be4de318046fab4c52d7ce55",
  },
  {
    fileName: "MesloLGMNerdFontMono-Bold.ttf",
    sha256: "c76da4d9fca24be442437f4f7cbae99acad21971f81543588c7f9da14e8ce8ec",
  },
  {
    fileName: "MesloLGMNerdFontMono-Italic.ttf",
    sha256: "9791f8376801ec8806df7b5ae8af07fea7c567a9a4bb0a33d35e3b415cffe13e",
  },
  {
    fileName: "MesloLGMNerdFontMono-BoldItalic.ttf",
    sha256: "7580e0e585b39ed1b2e4856e59d180a764e8e86cad26e7a60f288445c4590752",
  },
];

export const FONT_FAMILY_NAME = "MesloLGM Nerd Font Mono";

// -------------------------------------------------------------------------------------------------
// Paths
// -------------------------------------------------------------------------------------------------

/** Resolve the bundled-fonts directory shipped inside this extension. */
export function bundledFontsDir(): string {
  // lib/font-installer.ts → ../assets/fonts
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "assets", "fonts");
}

/**
 * Return the per-user font install directory for the current platform, or
 * `null` if the platform is not auto-installable (Windows).
 */
export function userFontDir(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string | null {
  if (platform === "darwin") return path.join(home, "Library", "Fonts");
  if (platform === "linux") return path.join(home, ".local", "share", "fonts");
  return null;
}

// -------------------------------------------------------------------------------------------------
// Hashing
// -------------------------------------------------------------------------------------------------

export function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

// -------------------------------------------------------------------------------------------------
// Installer
// -------------------------------------------------------------------------------------------------

export type FontInstallStatus =
  | "installed" // newly copied
  | "already-installed" // target file existed with matching sha256
  | "replaced" // target file existed but content differed — we overwrote it
  | "skipped-missing-source" // the bundled TTF wasn't found on disk (bad packaging)
  | "skipped-unsupported"; // platform without a known user fonts dir (Windows)

export interface FontInstallResult {
  fileName: string;
  status: FontInstallStatus;
  sourcePath: string;
  targetPath: string | null;
  /** Populated only when status is one of the error-ish variants. */
  error?: string;
}

export interface InstallFontsOptions {
  /** Override target dir (tests). */
  targetDir?: string;
  /** Override bundled source dir (tests). */
  sourceDir?: string;
  /** Override platform (tests). */
  platform?: NodeJS.Platform;
}

/**
 * Install the bundled fonts. Pure disk I/O — no cache refresh here
 * (callers do that separately so we can test install logic without
 * shelling out).
 */
export function installFonts(options: InstallFontsOptions = {}): FontInstallResult[] {
  const platform = options.platform ?? process.platform;
  const sourceDir = options.sourceDir ?? bundledFontsDir();

  // Windows is not auto-installable (system fonts dir needs admin) and
  // any other unknown platform should also skip. Honor the platform
  // decision even when the caller passes an explicit `targetDir` so the
  // "unsupported" contract doesn't accidentally depend on a test-only
  // override.
  const resolvedTarget = userFontDir(platform);
  if (!resolvedTarget) {
    return BUNDLED_FONTS.map((font) => ({
      fileName: font.fileName,
      status: "skipped-unsupported" as const,
      sourcePath: path.join(sourceDir, font.fileName),
      targetPath: null,
    }));
  }

  const targetDir = options.targetDir ?? resolvedTarget;

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const results: FontInstallResult[] = [];

  for (const font of BUNDLED_FONTS) {
    const sourcePath = path.join(sourceDir, font.fileName);
    const targetPath = path.join(targetDir, font.fileName);

    if (!existsSync(sourcePath)) {
      results.push({
        fileName: font.fileName,
        status: "skipped-missing-source",
        sourcePath,
        targetPath,
        error: "bundled font file missing on disk",
      });
      continue;
    }

    // Verify our own source matches the pinned sha so we never propagate
    // a corrupted TTF from the extension package.
    const sourceHash = sha256File(sourcePath);
    if (sourceHash !== font.sha256) {
      results.push({
        fileName: font.fileName,
        status: "skipped-missing-source",
        sourcePath,
        targetPath,
        error: `source sha256 mismatch (expected ${font.sha256}, got ${sourceHash})`,
      });
      continue;
    }

    if (existsSync(targetPath)) {
      const targetHash = sha256File(targetPath);
      if (targetHash === font.sha256) {
        results.push({
          fileName: font.fileName,
          status: "already-installed",
          sourcePath,
          targetPath,
        });
        continue;
      }
      // Content differs — user has a different version of the same
      // filename. Overwrite with our pinned bytes so the splash glyph
      // grid stays consistent across contributors.
      copyFileSync(sourcePath, targetPath);
      results.push({
        fileName: font.fileName,
        status: "replaced",
        sourcePath,
        targetPath,
      });
      continue;
    }

    copyFileSync(sourcePath, targetPath);
    results.push({
      fileName: font.fileName,
      status: "installed",
      sourcePath,
      targetPath,
    });
  }

  return results;
}

// -------------------------------------------------------------------------------------------------
// Cache refresh (best-effort)
// -------------------------------------------------------------------------------------------------

export interface RefreshCacheResult {
  tool: "atsutil" | "fc-cache" | "none";
  ok: boolean;
  message: string;
}

/**
 * Refresh the OS font cache so newly installed fonts are picked up by
 * already-running apps. Best-effort: failures are reported but never
 * thrown, because the fonts are already on disk and a terminal restart
 * is a perfectly acceptable fallback.
 */
export async function refreshFontCache(
  exec: ExecFn,
  platform: NodeJS.Platform = process.platform,
): Promise<RefreshCacheResult> {
  if (platform === "darwin") {
    try {
      const result = await exec("atsutil", ["databases", "-remove"], { timeout: 10_000 });
      if (result.code === 0) {
        return { tool: "atsutil", ok: true, message: "font cache refreshed" };
      }
      return {
        tool: "atsutil",
        ok: false,
        message: result.stderr?.trim() || `atsutil exited ${result.code}`,
      };
    } catch (err) {
      return {
        tool: "atsutil",
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (platform === "linux") {
    try {
      const result = await exec("fc-cache", ["-f"], { timeout: 20_000 });
      if (result.code === 0) {
        return { tool: "fc-cache", ok: true, message: "font cache refreshed" };
      }
      return {
        tool: "fc-cache",
        ok: false,
        message: result.stderr?.trim() || `fc-cache exited ${result.code}`,
      };
    } catch (err) {
      return {
        tool: "fc-cache",
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { tool: "none", ok: false, message: "no cache-refresh tool for this platform" };
}

// -------------------------------------------------------------------------------------------------
// Detection — does the user already have this font family installed?
// -------------------------------------------------------------------------------------------------

/**
 * Execute the full install-and-report flow used by both
 * `/sf-setup-fonts` and the one-time splash prompt. Returns a rendered
 * multi-line summary ready for `ctx.ui.notify()`.
 *
 * Extracted into a shared helper so the two call sites can't drift in
 * their user-facing output. Pure relative to the filesystem: side
 * effects are limited to the install target dir and (optionally) the
 * font cache tool.
 */
export interface RunInstallResult {
  /** Multi-line user-facing summary. */
  summary: string;
  /** One of `info` / `warning` — caller picks the notify severity. */
  severity: "info" | "warning";
  /** Did at least one file change on disk? Callers use this to decide
   *  whether to bother with a cache-refresh or a "restart terminal" note. */
  changed: boolean;
}

export async function runFontInstall(
  exec: ExecFn,
  platform: NodeJS.Platform = process.platform,
): Promise<RunInstallResult> {
  if (platform !== "darwin" && platform !== "linux") {
    return {
      severity: "info",
      changed: false,
      summary: [
        "sf-pi: Nerd Font install (manual)",
        "",
        `Automatic install supports macOS and Linux only. For ${platform},`,
        "download Meslo Nerd Font from https://www.nerdfonts.com and install via",
        "your system's font manager, then set your terminal font to:",
        "",
        `  ${FONT_FAMILY_NAME}`,
      ].join("\n"),
    };
  }

  const results = installFonts({ platform });
  const targetDir = userFontDir(platform) ?? "(unknown)";

  const installed = results.filter((r) => r.status === "installed").length;
  const replaced = results.filter((r) => r.status === "replaced").length;
  const already = results.filter((r) => r.status === "already-installed").length;
  const skipped = results.filter(
    (r) => r.status === "skipped-missing-source" || r.status === "skipped-unsupported",
  );
  const changed = installed + replaced > 0;

  let cacheNote = "";
  if (changed) {
    const cache = await refreshFontCache(exec, platform);
    cacheNote = cache.ok
      ? `Font cache refreshed via ${cache.tool}.`
      : `Font cache refresh skipped (${cache.tool}: ${cache.message}). Restart your terminal if glyphs don't appear.`;
  }

  const perFileLines = results.map((r) => {
    const tag =
      r.status === "installed"
        ? "installed"
        : r.status === "replaced"
          ? "replaced"
          : r.status === "already-installed"
            ? "already installed"
            : r.status === "skipped-missing-source"
              ? `skipped (${r.error ?? "missing source"})`
              : "skipped (unsupported platform)";
    return `  - ${r.fileName}: ${tag}`;
  });

  const lines = [
    `sf-pi: ${FONT_FAMILY_NAME}`,
    "",
    `Target: ${targetDir}`,
    `Installed: ${installed}   Replaced: ${replaced}   Already present: ${already}   Skipped: ${skipped.length}`,
    "",
    ...perFileLines,
  ];

  if (cacheNote) lines.push("", cacheNote);

  lines.push(
    "",
    "Next steps:",
    `  1. Set your terminal font to "${FONT_FAMILY_NAME}".`,
    "     Ghostty example:",
    `       font-family = ${FONT_FAMILY_NAME}`,
    "  2. Close and reopen the terminal so the new font is picked up.",
  );

  const hasFailures = results.some((r) => r.status === "skipped-missing-source");

  return {
    summary: lines.join("\n"),
    severity: hasFailures ? "warning" : "info",
    changed,
  };
}

/**
 * Return true if at least the Regular variant of the bundled family is
 * already present in the per-user font directory. Used by the splash
 * "Tips" nudge so we only prompt the user when it would actually help.
 */
export function isFontFamilyInstalled(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): boolean {
  const targetDir = userFontDir(platform, home);
  if (!targetDir || !existsSync(targetDir)) return false;

  const regularPath = path.join(targetDir, "MesloLGMNerdFontMono-Regular.ttf");
  if (!existsSync(regularPath)) {
    // Fall back to a lenient family-name scan so users who installed via
    // Homebrew/nerd-fonts or a different weight mix still count as
    // "already has it" and don't get the nudge.
    try {
      const entries = readdirSync(targetDir);
      return entries.some((name) => /MesloLG.*NerdFont/i.test(name));
    } catch {
      return false;
    }
  }

  // Sanity-check: file exists and is non-empty.
  try {
    const stat = statSync(regularPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}
