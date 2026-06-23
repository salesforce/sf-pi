/* SPDX-License-Identifier: Apache-2.0 */
/** Non-secret, scoped SF Docs preferences stored in Pi settings. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import type { DocsScope, EffectiveSfDocsPreferences, SfDocsPreferences } from "./types.ts";

export const DEFAULT_DOCS_PREFERENCES: SfDocsPreferences = {
  defaultCollection: "developer",
  defaultVersion: "current",
  defaultLocale: "en-us",
  defaultFetchFormat: "markdown",
  defaultPageSize: 5,
  includeCitations: true,
  displayDensity: "balanced",
  cacheCatalog: true,
};

export type SfDocsPreferenceKey = keyof SfDocsPreferences;

const PREFERENCE_KEYS = Object.keys(DEFAULT_DOCS_PREFERENCES) as SfDocsPreferenceKey[];

export function readScopedDocsPreferences(
  cwd: string,
  scope: DocsScope,
): Partial<SfDocsPreferences> {
  const settings = readJsonFile(
    scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath(),
  );
  return sanitizePreferences(readNested(settings));
}

export function readEffectiveDocsPreferences(cwd: string): EffectiveSfDocsPreferences {
  const global = readScopedDocsPreferences(cwd, "global");
  const project = readScopedDocsPreferences(cwd, "project");
  const result = { ...DEFAULT_DOCS_PREFERENCES } as EffectiveSfDocsPreferences;
  result.sources = {} as EffectiveSfDocsPreferences["sources"];

  for (const key of PREFERENCE_KEYS) {
    const projectValue = project[key];
    const globalValue = global[key];
    if (projectValue !== undefined) {
      setPreferenceValue(result, key, projectValue);
      result.sources[key] = { scope: "project", path: projectSettingsPath(cwd) };
    } else if (globalValue !== undefined) {
      setPreferenceValue(result, key, globalValue);
      result.sources[key] = { scope: "global", path: globalSettingsPath() };
    } else {
      result.sources[key] = { scope: "default" };
    }
  }
  return result;
}

export function writeDocsPreference(
  cwd: string,
  scope: DocsScope,
  key: SfDocsPreferenceKey,
  value: SfDocsPreferences[SfDocsPreferenceKey],
): EffectiveSfDocsPreferences {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const settings = readJsonFile(filePath);
  const sfPi = ensureObject(settings.sfPi);
  const docs = ensureObject(sfPi.docs);
  docs[key] = value;
  sfPi.docs = docs;
  settings.sfPi = sfPi;
  writeJsonFile(filePath, settings);
  return readEffectiveDocsPreferences(cwd);
}

export function describePreferenceSource(
  effective: EffectiveSfDocsPreferences,
  key: SfDocsPreferenceKey,
): string {
  const source = effective.sources[key];
  if (source.scope === "default") return "default";
  return `${source.scope} (${source.path})`;
}

function readNested(settings: Record<string, unknown>): unknown {
  const sfPi = ensureObject(settings.sfPi);
  return sfPi.docs;
}

function sanitizePreferences(value: unknown): Partial<SfDocsPreferences> {
  const input = ensureObject(value);
  const out: Partial<SfDocsPreferences> = {};
  if (typeof input.defaultCollection === "string" && input.defaultCollection.trim()) {
    out.defaultCollection = input.defaultCollection.trim();
  }
  if (typeof input.defaultVersion === "string" && input.defaultVersion.trim()) {
    out.defaultVersion = input.defaultVersion.trim();
  }
  if (typeof input.defaultLocale === "string" && input.defaultLocale.trim()) {
    out.defaultLocale = input.defaultLocale.trim().toLowerCase();
  }
  if (
    input.defaultFetchFormat === "text" ||
    input.defaultFetchFormat === "markdown" ||
    input.defaultFetchFormat === "html"
  ) {
    out.defaultFetchFormat = input.defaultFetchFormat;
  }
  if (typeof input.defaultPageSize === "number" && Number.isFinite(input.defaultPageSize)) {
    out.defaultPageSize = Math.min(60, Math.max(1, Math.round(input.defaultPageSize)));
  }
  if (typeof input.includeCitations === "boolean") out.includeCitations = input.includeCitations;
  if (
    input.displayDensity === "compact" ||
    input.displayDensity === "balanced" ||
    input.displayDensity === "verbose"
  ) {
    out.displayDensity = input.displayDensity;
  }
  if (typeof input.cacheCatalog === "boolean") out.cacheCatalog = input.cacheCatalog;
  return out;
}

function setPreferenceValue(
  target: SfDocsPreferences,
  key: SfDocsPreferenceKey,
  value: SfDocsPreferences[SfDocsPreferenceKey],
): void {
  (target as unknown as Record<string, unknown>)[key] = value;
}

function ensureObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
