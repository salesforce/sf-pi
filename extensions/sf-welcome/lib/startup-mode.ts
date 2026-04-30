/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Startup-mode resolution for sf-welcome.
 *
 * Pi applies project settings on top of global settings. The built-in
 * `--verbose` flag overrides quiet startup, so the splash should honor the
 * resolved quietStartup setting unless the user explicitly forces verbose mode.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  globalSettingsPath as resolveGlobalSettingsPath,
  projectSettingsPath as resolveProjectSettingsPath,
} from "../../../lib/common/pi-paths.ts";

export function globalSettingsPath(): string {
  return resolveGlobalSettingsPath();
}

export function projectSettingsPath(cwd: string): string {
  return resolveProjectSettingsPath(cwd);
}

function readSettings(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Exported for unit tests.
export function resolveQuietStartup(
  verboseFlag: unknown,
  globalSettings: Record<string, unknown>,
  projectSettings: Record<string, unknown>,
): boolean {
  if (verboseFlag === true) {
    return false;
  }

  const merged = {
    ...globalSettings,
    ...projectSettings,
  };

  return merged.quietStartup === true;
}

export function isVerboseStartupRequested(argv: readonly string[] = process.argv): boolean {
  // Pi parses --verbose as a built-in flag, so extension getFlag() cannot see
  // it. Checking argv preserves the documented quietStartup override until Pi
  // exposes built-in CLI flags through the extension context.
  return argv.includes("--verbose");
}

export function isQuietStartupEnabled(cwd: string, verboseFlag: unknown): boolean {
  return resolveQuietStartup(
    verboseFlag,
    readSettings(globalSettingsPath()),
    readSettings(projectSettingsPath(cwd)),
  );
}
