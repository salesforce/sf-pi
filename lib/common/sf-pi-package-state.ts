/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-pi package discovery + extension filter state.
 *
 * This module owns the WRITE side of pi's package filter list (the
 * `!extensions/<id>/index.ts` exclusions in settings.json). The matching
 * READ-only check lives in `./sf-pi-extension-state.ts`.
 *
 * Lives in lib/common because the toggle action helper (extension-toggle.ts)
 * needs it, and that helper is consumed by every command-bearing extension.
 * Keeping the rules here means index.ts in each extension stays focused on
 * its own behavior.
 */
import path from "node:path";
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "./sf-pi-settings.ts";

import {
  findSfPiPackageEntry,
  getDefaultDisabledExtensionFiles,
  getDisabledExtensionFiles,
  matchesPackageSource,
} from "./sf-pi-package-resolution.ts";

export { findSfPiPackageEntry, matchesPackageSource };

export interface PackageEntryMatch {
  index: number;
  source: string;
  isObject: boolean;
  settingsPath: string;
}

/**
 * Resolve the effective scope for sf-pi commands when the user has not
 * explicitly passed `global` or `project`.
 *
 * Mirrors Pi's natural settings precedence (project overrides global) so
 * the manager defaults to the same scope the rest of the runtime is
 * already reading from for this cwd. Falls back to `global` only when no
 * installation is found anywhere — that way the "package not found"
 * warning still points at a real settings file.
 */
export function resolveEffectiveScope(cwd: string): "global" | "project" {
  if (findPackageInSettings(cwd, "project")) return "project";
  if (findPackageInSettings(cwd, "global")) return "global";
  return "global";
}

/**
 * Find the sf-pi package in the chosen settings scope.
 * Returns null when the package is not installed in that scope.
 */
export function findPackageInSettings(
  cwd: string,
  scope: "global" | "project",
): PackageEntryMatch | null {
  const settingsPath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const settings = readJsonFile(settingsPath);
  const entry = findSfPiPackageEntry(settings, path.dirname(settingsPath));

  return entry ? { ...entry, settingsPath } : null;
}

// Read the disabled extension file paths from Pi's package filter entry.
// Example filter list:
//   ["extensions/*/index.ts", "!extensions/sf-ohana-spinner/index.ts"]
export function getDisabledExtensions(settingsPath: string): Set<string> {
  const settings = readJsonFile(settingsPath);
  const entry = findSfPiPackageEntry(settings, path.dirname(settingsPath));
  if (!entry || !entry.isObject) return new Set(getDefaultDisabledExtensionFiles());
  return getDisabledExtensionFiles(settings, entry.index);
}

/**
 * Project settings override global settings, matching Pi's normal precedence.
 * We only need the disabled file set here, so this helper returns the first
 * applicable scope instead of trying to deeply merge two settings files.
 */
export function getDisabledExtensionsForCwd(cwd: string): Set<string> {
  const projectPath = projectSettingsPath(cwd);
  const projectMatch = findSfPiPackageEntry(readJsonFile(projectPath), path.dirname(projectPath));
  if (projectMatch) {
    return getDisabledExtensions(projectPath);
  }

  return getDisabledExtensions(globalSettingsPath());
}

/**
 * Persist the new disabled-file set back into settings.json.
 *
 * Pi package entries can be either:
 * - a simple string source when everything is enabled
 * - an object with an `extensions` filter array when any extension is disabled
 *
 * We intentionally collapse back to string form when nothing is disabled so the
 * user's settings stay clean and easy to read.
 */
export function applyExtensionState(match: PackageEntryMatch, disabledFiles: Set<string>): void {
  const settings = readJsonFile(match.settingsPath);
  const packages = [...(Array.isArray(settings.packages) ? settings.packages : [])];

  const enabledDefaultOff = getDefaultDisabledExtensionFiles().filter(
    (file) => !disabledFiles.has(file),
  );

  const existingObject =
    typeof packages[match.index] === "object" && packages[match.index] !== null
      ? { ...(packages[match.index] as Record<string, unknown>) }
      : {};
  delete existingObject.extensions;
  delete existingObject.enabledExtensions;

  if (disabledFiles.size === 0 && enabledDefaultOff.length === 0) {
    packages[match.index] = hasPackageConfigBeyondSource(existingObject)
      ? { ...existingObject, source: match.source }
      : match.source;
  } else {
    packages[match.index] = {
      ...existingObject,
      source: match.source,
      extensions: [
        "extensions/*/index.ts",
        ...Array.from(disabledFiles)
          .sort()
          .map((file) => `!${file}`),
      ],
      ...(enabledDefaultOff.length > 0 ? { enabledExtensions: enabledDefaultOff.sort() } : {}),
    };
  }

  settings.packages = packages;
  writeJsonFile(match.settingsPath, settings);
}

function hasPackageConfigBeyondSource(pkg: Record<string, unknown>): boolean {
  return Object.keys(pkg).some((key) => key !== "source");
}
