/* SPDX-License-Identifier: Apache-2.0 */
/** Pi settings-backed preferences for SF Brain. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";

export type SfBrainSettingsScope = "global" | "project";
export type HerdrGuidanceMode = "auto" | "off";

export interface SfBrainSettings {
  herdrGuidance: HerdrGuidanceMode;
}

export interface EffectiveSfBrainSettings extends SfBrainSettings {
  source: SfBrainSettingsScope | "default";
  path?: string;
}

export const DEFAULT_SF_BRAIN_SETTINGS: SfBrainSettings = { herdrGuidance: "auto" };

export function readEffectiveSfBrainSettings(cwd: string): EffectiveSfBrainSettings {
  const projectPath = projectSettingsPath(cwd);
  const project = readSettingsFile(projectPath);
  if (project.exists) return { ...project.settings, source: "project", path: projectPath };
  const globalPath = globalSettingsPath();
  const global = readSettingsFile(globalPath);
  if (global.exists) return { ...global.settings, source: "global", path: globalPath };
  return { ...DEFAULT_SF_BRAIN_SETTINGS, source: "default" };
}

export function writeScopedSfBrainSettings(
  cwd: string,
  scope: SfBrainSettingsScope,
  settings: SfBrainSettings,
): EffectiveSfBrainSettings {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const root = readJsonFile(filePath);
  const sfPi = { ...nestedRecord(root, "sfPi") };
  sfPi.brain = normalizeSfBrainSettings(settings);
  root.sfPi = sfPi;
  writeJsonFile(filePath, root);
  return { ...normalizeSfBrainSettings(settings), source: scope, path: filePath };
}

export function normalizeSfBrainSettings(value: unknown): SfBrainSettings {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { herdrGuidance: candidate.herdrGuidance === "off" ? "off" : "auto" };
}

function readSettingsFile(filePath: string): { settings: SfBrainSettings; exists: boolean } {
  const root = readJsonFile(filePath);
  const brain = nestedRecord(nestedRecord(root, "sfPi"), "brain");
  return {
    settings: normalizeSfBrainSettings(brain),
    exists: Object.prototype.hasOwnProperty.call(brain, "herdrGuidance"),
  };
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
