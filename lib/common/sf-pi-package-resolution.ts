/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared sf-pi package-entry interpretation.
 *
 * Pi stores bundled extension enablement as filters on the sf-pi package entry
 * in settings.json. Both read-side status surfaces and write-side manager
 * toggles must interpret those filters the same way. This module owns the
 * common package-source matching, default-disabled extension list, and
 * enabled/disabled filter parsing so the two sides cannot drift.
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SF_PI_REGISTRY } from "../../catalog/registry.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// lib/common/sf-pi-package-resolution.ts → ../../ is the package root.
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

export interface SfPiPackageEntry {
  index: number;
  source: string;
  isObject: boolean;
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
): SfPiPackageEntry | null {
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

  if (!looksLikeLocalPath) return false;

  const expandedSource = source.startsWith("~") ? path.join(homedir(), source.slice(1)) : source;
  const resolved = path.resolve(settingsDir, expandedSource);

  if (resolved === PACKAGE_ROOT) return true;

  try {
    return realpathSync(resolved) === realpathSync(PACKAGE_ROOT);
  } catch {
    return false;
  }
}

export function getDefaultDisabledExtensionFiles(): string[] {
  return SF_PI_REGISTRY.filter((entry) => !entry.defaultEnabled && !entry.alwaysActive).map(
    (entry) => entry.file,
  );
}

export function getExplicitlyEnabledExtensionFiles(
  settings: Record<string, unknown>,
  packageIndex: number,
): Set<string> {
  const pkg = packageObject(settings, packageIndex);
  if (!pkg) return new Set();
  return getExplicitlyEnabledExtensions(pkg);
}

export function getExplicitlyEnabledExtensions(pkg: Record<string, unknown>): Set<string> {
  const enabledExtensions = Array.isArray(pkg.enabledExtensions) ? pkg.enabledExtensions : [];
  return new Set(enabledExtensions.filter((entry): entry is string => typeof entry === "string"));
}

export function getDisabledExtensionFiles(
  settings: Record<string, unknown>,
  packageIndex: number,
): Set<string> {
  const pkg = packageObject(settings, packageIndex);
  if (!pkg) return new Set(getDefaultDisabledExtensionFiles());

  const extensions = Array.isArray(pkg.extensions) ? pkg.extensions : [];
  const explicitlyEnabled = getExplicitlyEnabledExtensions(pkg);

  const disabled = new Set<string>();
  for (const file of getDefaultDisabledExtensionFiles()) {
    if (!explicitlyEnabled.has(file)) disabled.add(file);
  }
  for (const pattern of extensions) {
    if (typeof pattern === "string" && pattern.startsWith("!")) {
      disabled.add(pattern.slice(1));
    }
  }
  return disabled;
}

function packageObject(
  settings: Record<string, unknown>,
  packageIndex: number,
): Record<string, unknown> | null {
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  const pkg = packages[packageIndex];
  return pkg && typeof pkg === "object" ? (pkg as Record<string, unknown>) : null;
}
