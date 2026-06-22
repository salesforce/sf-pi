/* SPDX-License-Identifier: Apache-2.0 */
/** Pi settings-backed preferences for SF Data 360. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import type { D360OutputMode } from "./truncation.ts";

export const DATA360_OUTPUT_MODES = ["summary", "inline", "file_only"] as const;
export type Data360OutputModeSetting = (typeof DATA360_OUTPUT_MODES)[number];
export type Data360SettingsScope = "global" | "project";

export interface Data360Settings {
  defaultOutputMode: Data360OutputModeSetting;
}

export interface ScopedData360Settings {
  scope: Data360SettingsScope;
  path: string;
  settings: Data360Settings;
  exists: boolean;
}

export interface EffectiveData360Settings extends Data360Settings {
  source: Data360SettingsScope | "default";
  path?: string;
}

export const DEFAULT_DATA360_SETTINGS: Data360Settings = { defaultOutputMode: "summary" };

export function readScopedData360Settings(
  cwd: string,
  scope: Data360SettingsScope,
): ScopedData360Settings {
  const filePath = settingsPathForScope(cwd, scope);
  const root = readJsonFile(filePath);
  const data360 = data360SettingsFromRoot(root);
  return {
    scope,
    path: filePath,
    settings: normalizeData360Settings(data360),
    exists: Object.prototype.hasOwnProperty.call(data360, "defaultOutputMode"),
  };
}

export function readEffectiveData360Settings(cwd: string): EffectiveData360Settings {
  const project = readScopedData360Settings(cwd, "project");
  if (project.exists) return { ...project.settings, source: "project", path: project.path };

  const global = readScopedData360Settings(cwd, "global");
  if (global.exists) return { ...global.settings, source: "global", path: global.path };

  return { ...DEFAULT_DATA360_SETTINGS, source: "default" };
}

export function writeScopedData360Settings(
  cwd: string,
  scope: Data360SettingsScope,
  settings: Data360Settings,
): ScopedData360Settings {
  const filePath = settingsPathForScope(cwd, scope);
  const root = readJsonFile(filePath);
  const normalized = normalizeData360Settings(settings);
  writeJsonFile(filePath, writeData360SettingsToRoot(root, normalized));
  return { scope, path: filePath, settings: normalized, exists: true };
}

export function describeData360SettingsSource(settings: EffectiveData360Settings): string {
  if (settings.source === "default") return "default";
  return `${settings.source} (${settings.path})`;
}

export function normalizeData360OutputMode(value: unknown): D360OutputMode | undefined {
  return DATA360_OUTPUT_MODES.includes(value as Data360OutputModeSetting)
    ? (value as D360OutputMode)
    : undefined;
}

export function normalizeData360Settings(value: unknown): Data360Settings {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    defaultOutputMode:
      normalizeData360OutputMode(candidate.defaultOutputMode) ??
      DEFAULT_DATA360_SETTINGS.defaultOutputMode,
  };
}

function settingsPathForScope(cwd: string, scope: Data360SettingsScope): string {
  return scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
}

function data360SettingsFromRoot(root: Record<string, unknown>): Record<string, unknown> {
  return nestedRecord(nestedRecord(root, "sfPi"), "data360");
}

function writeData360SettingsToRoot(
  root: Record<string, unknown>,
  settings: Data360Settings,
): Record<string, unknown> {
  const nextRoot = { ...root };
  const sfPi = { ...nestedRecord(nextRoot, "sfPi") };
  sfPi.data360 = normalizeData360Settings(settings);
  nextRoot.sfPi = sfPi;
  return nextRoot;
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
