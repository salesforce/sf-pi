/* SPDX-License-Identifier: Apache-2.0 */
/** Scoped Pi settings for SF DevBar preferences. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import {
  DEFAULT_DEVBAR_COLORS,
  DEVBAR_COLOR_DESCRIPTORS,
  normalizeDevbarColorOverrides,
  resolveDevbarColors,
  type DevbarColorKey,
  type DevbarColorOverrides,
  type DevbarColors,
} from "./colors.ts";

export type DevbarSettingsScope = "global" | "project";
export type DevbarColorSource = DevbarSettingsScope | "default";

export interface ScopedDevbarSettings {
  scope: DevbarSettingsScope;
  path: string;
  colors: DevbarColorOverrides;
  exists: boolean;
}

export interface EffectiveDevbarSettings {
  colors: DevbarColors;
  sources: Record<DevbarColorKey, DevbarColorSource>;
  global: ScopedDevbarSettings;
  project: ScopedDevbarSettings;
}

export function readScopedDevbarSettings(
  cwd: string,
  scope: DevbarSettingsScope,
  globalSettingsFile: string = globalSettingsPath(),
): ScopedDevbarSettings {
  const filePath = settingsPathForScope(cwd, scope, globalSettingsFile);
  const root = readJsonFile(filePath);
  const colors = readDevbarColorOverridesFromRoot(root);
  return {
    scope,
    path: filePath,
    colors,
    exists: Object.keys(colors).length > 0,
  };
}

export function readEffectiveDevbarSettings(
  cwd: string,
  globalSettingsFile: string = globalSettingsPath(),
): EffectiveDevbarSettings {
  const global = readScopedDevbarSettings(cwd, "global", globalSettingsFile);
  const project = readScopedDevbarSettings(cwd, "project", globalSettingsFile);
  const colors = resolveDevbarColors(global.colors, project.colors);
  const sources = buildColorSources(global.colors, project.colors);
  return { colors, sources, global, project };
}

export function writeScopedDevbarColorOverrides(
  cwd: string,
  scope: DevbarSettingsScope,
  colors: DevbarColorOverrides,
  globalSettingsFile: string = globalSettingsPath(),
): ScopedDevbarSettings {
  const filePath = settingsPathForScope(cwd, scope, globalSettingsFile);
  const root = readJsonFile(filePath);
  const normalized = normalizeDevbarColorOverrides(colors);
  writeJsonFile(filePath, writeDevbarColorOverridesToRoot(root, normalized));
  return {
    scope,
    path: filePath,
    colors: normalized,
    exists: Object.keys(normalized).length > 0,
  };
}

export function clearScopedDevbarColorOverride(
  cwd: string,
  scope: DevbarSettingsScope,
  key: DevbarColorKey,
  globalSettingsFile: string = globalSettingsPath(),
): ScopedDevbarSettings {
  const current = readScopedDevbarSettings(cwd, scope, globalSettingsFile).colors;
  const next: DevbarColorOverrides = { ...current };
  delete next[key];
  return writeScopedDevbarColorOverrides(cwd, scope, next, globalSettingsFile);
}

export function resetScopedDevbarColors(
  cwd: string,
  scope: DevbarSettingsScope,
  globalSettingsFile: string = globalSettingsPath(),
): ScopedDevbarSettings {
  return writeScopedDevbarColorOverrides(cwd, scope, {}, globalSettingsFile);
}

export function settingsPathForScope(
  cwd: string,
  scope: DevbarSettingsScope,
  globalSettingsFile: string = globalSettingsPath(),
): string {
  return scope === "project" ? projectSettingsPath(cwd) : globalSettingsFile;
}

export function describeDevbarSettingsSource(settings: EffectiveDevbarSettings): string {
  const hasProject = settings.project.exists;
  const hasGlobal = settings.global.exists;
  if (hasProject && hasGlobal) return "project + global";
  if (hasProject) return `project (${settings.project.path})`;
  if (hasGlobal) return `global (${settings.global.path})`;
  return "default";
}

function readDevbarColorOverridesFromRoot(root: Record<string, unknown>): DevbarColorOverrides {
  const sfPi = nestedRecord(root, "sfPi");
  const devbar = nestedRecord(sfPi, "devbar");
  return normalizeDevbarColorOverrides(devbar.colors);
}

function writeDevbarColorOverridesToRoot(
  root: Record<string, unknown>,
  colors: DevbarColorOverrides,
): Record<string, unknown> {
  const nextRoot = { ...root };
  const sfPi = { ...nestedRecord(nextRoot, "sfPi") };
  const devbar = { ...nestedRecord(sfPi, "devbar") };

  if (Object.keys(colors).length > 0) {
    devbar.colors = colors;
  } else {
    delete devbar.colors;
  }

  if (Object.keys(devbar).length > 0) {
    sfPi.devbar = devbar;
  } else {
    delete sfPi.devbar;
  }

  if (Object.keys(sfPi).length > 0) {
    nextRoot.sfPi = sfPi;
  } else {
    delete nextRoot.sfPi;
  }

  return nextRoot;
}

function buildColorSources(
  globalColors: DevbarColorOverrides,
  projectColors: DevbarColorOverrides,
): Record<DevbarColorKey, DevbarColorSource> {
  const sources = {} as Record<DevbarColorKey, DevbarColorSource>;
  for (const descriptor of DEVBAR_COLOR_DESCRIPTORS) {
    const key = descriptor.key;
    if (projectColors[key] !== undefined) {
      sources[key] = "project";
    } else if (globalColors[key] !== undefined) {
      sources[key] = "global";
    } else {
      sources[key] = "default";
    }
  }
  return sources;
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Re-export the default for callers that only need settings.ts.
export { DEFAULT_DEVBAR_COLORS };
