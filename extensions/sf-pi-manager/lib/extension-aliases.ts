/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Silent extension-rename migration.
 *
 * When sf-pi renames an extension, users who explicitly disabled the old
 * name will have a stale `!extensions/<old-id>/index.ts` entry in their
 * pi package filter list. After the rename that path no longer exists, so
 * pi silently ignores the entry — and the new extension turns on by
 * default, surprising anyone who deliberately turned the old one off.
 *
 * This module rewrites those stale entries on session_start so a
 * disable preference survives the rename. It is:
 *
 * - read-only when nothing matches (cheap)
 * - idempotent (running twice is the same as running once)
 * - scope-aware (walks both global and project settings)
 *
 * For users who never touched the old extension's enablement, no entry
 * is present and this module is a no-op.
 */
import path from "node:path";
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import { findSfPiPackageEntry } from "../../../lib/common/sf-pi-package-state.ts";

/**
 * Map of old extension id → new extension id.
 *
 * Add entries when renaming an extension. Old keys can stay forever
 * because the rewrite is idempotent.
 */
export const EXTENSION_ALIASES: Readonly<Record<string, string>> = {
  "sf-skills-hud": "sf-skills",
};

export interface MigrationResult {
  migrated: string[];
}

/**
 * Walk global + project settings and rewrite stale `!extensions/<old>/index.ts`
 * filter entries to point at the renamed extension.
 *
 * Returns the absolute paths of every settings file we mutated. An empty
 * array means there was nothing to do.
 */
export function migrateExtensionAliases(cwd: string): MigrationResult {
  const migrated: string[] = [];
  for (const file of [globalSettingsPath(), projectSettingsPath(cwd)]) {
    if (rewriteAliasesInFile(file)) migrated.push(file);
  }
  return { migrated };
}

function rewriteAliasesInFile(settingsPath: string): boolean {
  const settings = readJsonFile(settingsPath);
  const entry = findSfPiPackageEntry(settings, path.dirname(settingsPath));
  if (!entry || !entry.isObject) return false;

  const packages = Array.isArray(settings.packages) ? [...settings.packages] : [];
  const pkg = { ...(packages[entry.index] as Record<string, unknown>) };
  const extensions = Array.isArray(pkg.extensions) ? [...pkg.extensions] : null;
  if (!extensions) return false;

  let changed = false;
  for (let i = 0; i < extensions.length; i++) {
    const value = extensions[i];
    if (typeof value !== "string") continue;
    const replaced = applyAliases(value);
    if (replaced !== value) {
      extensions[i] = replaced;
      changed = true;
    }
  }

  // Same alias map is applied to enabledExtensions (the inverse list) so a
  // user who explicitly enabled a default-off old extension keeps that
  // preference under the new name.
  const enabledExtensions = Array.isArray(pkg.enabledExtensions)
    ? [...pkg.enabledExtensions]
    : null;
  if (enabledExtensions) {
    for (let i = 0; i < enabledExtensions.length; i++) {
      const value = enabledExtensions[i];
      if (typeof value !== "string") continue;
      const replaced = applyAliases(value);
      if (replaced !== value) {
        enabledExtensions[i] = replaced;
        changed = true;
      }
    }
  }

  if (!changed) return false;

  pkg.extensions = dedupePreserveOrder(extensions);
  if (enabledExtensions) pkg.enabledExtensions = dedupePreserveOrder(enabledExtensions);
  packages[entry.index] = pkg;
  settings.packages = packages;
  writeJsonFile(settingsPath, settings);
  return true;
}

function applyAliases(filterEntry: string): string {
  // Filter entries take the form `extensions/<id>/index.ts` or `!extensions/<id>/index.ts`.
  // We only care about the `<id>` segment; any other shape is left untouched.
  const match = filterEntry.match(/^(!?)extensions\/([^/]+)\/index\.ts$/);
  if (!match) return filterEntry;
  const [, bang, oldId] = match;
  const newId = EXTENSION_ALIASES[oldId];
  return newId ? `${bang}extensions/${newId}/index.ts` : filterEntry;
}

function dedupePreserveOrder<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
