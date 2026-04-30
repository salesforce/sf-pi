/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-pi package discovery + extension filter state.
 *
 * Responsibility split:
 * - settings.ts handles generic JSON file I/O
 * - this file understands Pi package entries and sf-pi exclusion patterns
 *
 * Keeping the rules here makes index.ts easier to read during command work.
 */
import { homedir } from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "./settings.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");

export interface PackageEntryMatch {
  index: number;
  source: string;
  isObject: boolean;
  settingsPath: string;
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

/**
 * Search a settings object's packages array for the sf-pi package entry.
 *
 * Pi allows package entries in two shapes:
 * - string: "git:github.com/..."
 * - object: { source, extensions, skills, ... }
 */
export function findSfPiPackageEntry(
  settings: Record<string, unknown>,
  settingsDir: string,
): { index: number; source: string; isObject: boolean } | null {
  const packages = Array.isArray(settings.packages) ? settings.packages : [];

  for (let index = 0; index < packages.length; index++) {
    const entry = packages[index];
    let source: string;
    let isObject: boolean;

    if (typeof entry === "string") {
      source = entry;
      isObject = false;
    } else if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).source === "string"
    ) {
      source = (entry as Record<string, unknown>).source as string;
      isObject = true;
    } else {
      continue;
    }

    if (matchesPackageSource(source, settingsDir)) {
      return { index, source, isObject };
    }
  }

  return null;
}

/**
 * Check whether a package source string points at sf-pi.
 *
 * We support three installation styles:
 * - npm names
 * - git URLs
 * - local paths (including symlinks from `pi install .`)
 */
export function matchesPackageSource(source: string, settingsDir: string): boolean {
  const normalizedSource = source.toLowerCase();

  if (normalizedSource.includes("sf-pi")) return true;
  // Legacy name: the package was published as `jag-pi-extensions` before being
  // renamed to `sf-pi`. Keep this match so users who still have the old URL
  // in their pi settings.json continue to be detected as having the package.
  if (normalizedSource.includes("jag-pi-extensions")) return true;

  const looksLikeLocalPath =
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith("~");

  if (!looksLikeLocalPath) {
    return false;
  }

  const expandedSource = source.startsWith("~") ? path.join(homedir(), source.slice(1)) : source;
  const resolved = path.resolve(settingsDir, expandedSource);

  if (resolved === PACKAGE_ROOT) {
    return true;
  }

  try {
    return realpathSync(resolved) === realpathSync(PACKAGE_ROOT);
  } catch {
    return false;
  }
}

// Read the disabled extension file paths from Pi's package filter entry.
// Example filter list:
//   ["extensions/*/index.ts", "!extensions/sf-ohana-spinner/index.ts"]
export function getDisabledExtensions(settingsPath: string): Set<string> {
  const settings = readJsonFile(settingsPath);
  const entry = findSfPiPackageEntry(settings, path.dirname(settingsPath));
  if (!entry || !entry.isObject) return new Set();

  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  const pkg = packages[entry.index] as Record<string, unknown>;
  const extensions = Array.isArray(pkg.extensions) ? pkg.extensions : [];

  const disabled = new Set<string>();
  for (const pattern of extensions) {
    if (typeof pattern === "string" && pattern.startsWith("!")) {
      disabled.add(pattern.slice(1));
    }
  }

  return disabled;
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

  if (disabledFiles.size === 0) {
    packages[match.index] = match.source;
  } else {
    const existingObject =
      typeof packages[match.index] === "object" && packages[match.index] !== null
        ? { ...(packages[match.index] as Record<string, unknown>) }
        : {};

    packages[match.index] = {
      ...existingObject,
      source: match.source,
      extensions: [
        "extensions/*/index.ts",
        ...Array.from(disabledFiles)
          .sort()
          .map((file) => `!${file}`),
      ],
    };
  }

  settings.packages = packages;
  writeJsonFile(match.settingsPath, settings);
}
