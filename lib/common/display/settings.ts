/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persistent sf-pi display settings.
 *
 * Stored under the public `sfPi.display` key in Pi settings files:
 *
 * ```json
 * { "sfPi": { "display": { "profile": "balanced" } } }
 * ```
 *
 * Project settings override global settings. Missing or invalid values fall
 * back to the balanced profile so existing behavior stays stable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalSettingsPath, projectSettingsPath } from "../pi-paths.ts";
import {
  DEFAULT_SF_PI_DISPLAY_SETTINGS,
  normalizeSfPiDisplaySettings,
  type SfPiDisplaySettings,
} from "./types.ts";

export type SfPiSettingsScope = "global" | "project";

export interface ScopedSfPiDisplaySettings {
  scope: SfPiSettingsScope;
  path: string;
  settings: SfPiDisplaySettings;
  exists: boolean;
}

export interface EffectiveSfPiDisplaySettings extends SfPiDisplaySettings {
  source: SfPiSettingsScope | "default";
  path?: string;
}

function settingsPathForScope(cwd: string, scope: SfPiSettingsScope): string {
  return scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getNestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readDisplaySettingsFromRoot(root: Record<string, unknown>): SfPiDisplaySettings {
  const sfPi = getNestedRecord(root, "sfPi");
  const display = getNestedRecord(sfPi, "display");
  return normalizeSfPiDisplaySettings(display);
}

function hasOwnDisplayProfile(root: Record<string, unknown>): boolean {
  const sfPi = getNestedRecord(root, "sfPi");
  const display = getNestedRecord(sfPi, "display");
  return Object.prototype.hasOwnProperty.call(display, "profile");
}

function writeDisplaySettingsToRoot(
  root: Record<string, unknown>,
  settings: SfPiDisplaySettings,
): Record<string, unknown> {
  const nextRoot = { ...root };
  const sfPi = { ...getNestedRecord(nextRoot, "sfPi") };
  sfPi.display = normalizeSfPiDisplaySettings(settings);
  nextRoot.sfPi = sfPi;
  return nextRoot;
}

export function readScopedSfPiDisplaySettings(
  cwd: string,
  scope: SfPiSettingsScope,
): ScopedSfPiDisplaySettings {
  const filePath = settingsPathForScope(cwd, scope);
  const root = readJsonObject(filePath);
  return {
    scope,
    path: filePath,
    settings: readDisplaySettingsFromRoot(root),
    exists: hasOwnDisplayProfile(root),
  };
}

export function readEffectiveSfPiDisplaySettings(cwd: string): EffectiveSfPiDisplaySettings {
  const project = readScopedSfPiDisplaySettings(cwd, "project");
  if (project.exists) {
    return { ...project.settings, source: "project", path: project.path };
  }

  const global = readScopedSfPiDisplaySettings(cwd, "global");
  if (global.exists) {
    return { ...global.settings, source: "global", path: global.path };
  }

  return { ...DEFAULT_SF_PI_DISPLAY_SETTINGS, source: "default" };
}

export function writeScopedSfPiDisplaySettings(
  cwd: string,
  scope: SfPiSettingsScope,
  settings: SfPiDisplaySettings,
): ScopedSfPiDisplaySettings {
  const filePath = settingsPathForScope(cwd, scope);
  const root = readJsonObject(filePath);
  const normalized = normalizeSfPiDisplaySettings(settings);
  const nextRoot = writeDisplaySettingsToRoot(root, normalized);

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(nextRoot, null, 2)}\n`, "utf8");

  return {
    scope,
    path: filePath,
    settings: normalized,
    exists: true,
  };
}

export function describeDisplaySettingsSource(settings: EffectiveSfPiDisplaySettings): string {
  if (settings.source === "default") return "default";
  return `${settings.source} (${settings.path})`;
}
