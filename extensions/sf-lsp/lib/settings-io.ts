/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Persistent sf-lsp UI settings.
 *
 * Stored under `sfPi.sfLsp` in Pi settings (global or project):
 *
 * ```json
 * { "sfPi": { "sfLsp": { "verbose": false } } }
 * ```
 *
 * Project settings override global settings. Missing keys fall back to
 * defaults (`verbose: false`).
 *
 * The former `hud` and `icon` keys were removed when the HUD overlay was
 * replaced by sf-devbar's permanent top-bar LSP segment. Settings files
 * written by older builds are still readable; unknown keys are ignored.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalSettingsPath, projectSettingsPath } from "../../../lib/common/pi-paths.ts";

export type SfLspSettingsScope = "global" | "project";

export interface SfLspUiSettings {
  /** Emit a transcript row for every check (not just errors/transitions). Default: false. */
  verbose: boolean;
}

export interface EffectiveSfLspUiSettings extends SfLspUiSettings {
  source: SfLspSettingsScope | "default";
  path?: string;
}

export const DEFAULT_SF_LSP_UI_SETTINGS: SfLspUiSettings = {
  verbose: false,
};

function settingsPathForScope(cwd: string, scope: SfLspSettingsScope): string {
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

function normalize(raw: Record<string, unknown>): SfLspUiSettings {
  const verbose =
    typeof raw.verbose === "boolean" ? raw.verbose : DEFAULT_SF_LSP_UI_SETTINGS.verbose;
  return { verbose };
}

function hasOwnKey(root: Record<string, unknown>, key: "verbose"): boolean {
  const sfPi = getNestedRecord(root, "sfPi");
  const sfLsp = getNestedRecord(sfPi, "sfLsp");
  return Object.prototype.hasOwnProperty.call(sfLsp, key);
}

export function readScopedSfLspSettings(
  cwd: string,
  scope: SfLspSettingsScope,
): { scope: SfLspSettingsScope; path: string; settings: SfLspUiSettings; exists: boolean } {
  const filePath = settingsPathForScope(cwd, scope);
  const root = readJsonObject(filePath);
  const sfPi = getNestedRecord(root, "sfPi");
  const sfLsp = getNestedRecord(sfPi, "sfLsp");
  return {
    scope,
    path: filePath,
    settings: normalize(sfLsp),
    exists: hasOwnKey(root, "verbose"),
  };
}

export function readEffectiveSfLspSettings(cwd: string): EffectiveSfLspUiSettings {
  const project = readScopedSfLspSettings(cwd, "project");
  if (project.exists) {
    return { ...project.settings, source: "project", path: project.path };
  }
  const global = readScopedSfLspSettings(cwd, "global");
  if (global.exists) {
    return { ...global.settings, source: "global", path: global.path };
  }
  return { ...DEFAULT_SF_LSP_UI_SETTINGS, source: "default" };
}

export function writeScopedSfLspSettings(
  cwd: string,
  scope: SfLspSettingsScope,
  patch: Partial<SfLspUiSettings>,
): EffectiveSfLspUiSettings {
  const filePath = settingsPathForScope(cwd, scope);
  const root = readJsonObject(filePath);
  const sfPi = { ...getNestedRecord(root, "sfPi") };
  const sfLsp = { ...getNestedRecord(sfPi, "sfLsp"), ...patch };
  sfPi.sfLsp = sfLsp;
  const nextRoot = { ...root, sfPi };

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(nextRoot, null, 2)}\n`, "utf8");

  return {
    ...normalize(sfLsp),
    source: scope,
    path: filePath,
  };
}
