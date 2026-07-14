/* SPDX-License-Identifier: Apache-2.0 */
/** Lightweight font-status helpers used on the startup path. */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolveGlyphMode, type GlyphMode } from "../../../lib/common/glyph-policy.ts";
import type { FontRuntimeStatusInfo } from "./types.ts";

export const FONT_FAMILY_NAME = "MesloLGM Nerd Font Mono";

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

/**
 * Return true if at least the Regular variant of the bundled family is already
 * present in the per-user font directory.
 */
export function isFontFamilyInstalled(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): boolean {
  const targetDir = userFontDir(platform, home);
  if (!targetDir || !existsSync(targetDir)) return false;

  const regularPath = path.join(targetDir, "MesloLGMNerdFontMono-Regular.ttf");
  if (!existsSync(regularPath)) {
    try {
      const entries = readdirSync(targetDir);
      return entries.some((name) => /MesloLG.*NerdFont/i.test(name));
    } catch {
      return false;
    }
  }

  try {
    const stat = statSync(regularPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function detectFontRuntimeStatus(
  options: {
    cwd?: string;
    platform?: NodeJS.Platform;
    home?: string;
    glyphMode?: GlyphMode;
  } = {},
): FontRuntimeStatusInfo {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const supportedPlatform = platform === "darwin" || platform === "linux";
  const glyphMode = options.glyphMode ?? resolveGlyphMode({ cwd: options.cwd });
  const installed = isFontFamilyInstalled(platform, home);

  return {
    kind: installed ? "installed" : supportedPlatform ? "missing" : "unsupported",
    fontFamily: FONT_FAMILY_NAME,
    glyphMode,
    supportedPlatform,
    installed,
    loading: false,
    checkedAt: new Date().toISOString(),
  };
}
