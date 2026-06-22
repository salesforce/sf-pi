/* SPDX-License-Identifier: Apache-2.0 */
/** Pi settings-backed preferences for SF Skills. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import type { SkillSourceScope } from "../../../lib/common/skill-sources/skill-sources.ts";

export const SKILLS_HUD_VISIBILITY = ["auto", "hidden"] as const;
export type SkillsHudVisibility = (typeof SKILLS_HUD_VISIBILITY)[number];
export type SkillsSettingsScope = "global" | "project";

export interface SfSkillsSettings {
  hudVisibility: SkillsHudVisibility;
  defaultInstallScope: SkillSourceScope;
}

export interface EffectiveSfSkillsSettings extends SfSkillsSettings {
  source: SkillsSettingsScope | "default";
  path?: string;
}

export const DEFAULT_SF_SKILLS_SETTINGS: SfSkillsSettings = {
  hudVisibility: "auto",
  defaultInstallScope: "project",
};

export function readEffectiveSfSkillsSettings(cwd: string): EffectiveSfSkillsSettings {
  const projectPath = projectSettingsPath(cwd);
  const project = readSettingsFile(projectPath);
  if (project.exists) return { ...project.settings, source: "project", path: projectPath };

  const globalPath = globalSettingsPath();
  const global = readSettingsFile(globalPath);
  if (global.exists) return { ...global.settings, source: "global", path: globalPath };

  return { ...DEFAULT_SF_SKILLS_SETTINGS, source: "default" };
}

export function writeScopedSfSkillsSettings(
  cwd: string,
  scope: SkillsSettingsScope,
  settings: SfSkillsSettings,
): EffectiveSfSkillsSettings {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const root = readJsonFile(filePath);
  const sfPi = { ...nestedRecord(root, "sfPi") };
  sfPi.skills = normalizeSfSkillsSettings(settings);
  root.sfPi = sfPi;
  writeJsonFile(filePath, root);
  return { ...normalizeSfSkillsSettings(settings), source: scope, path: filePath };
}

export function normalizeSfSkillsSettings(value: unknown): SfSkillsSettings {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    hudVisibility:
      candidate.hudVisibility === "hidden" ? "hidden" : DEFAULT_SF_SKILLS_SETTINGS.hudVisibility,
    defaultInstallScope:
      candidate.defaultInstallScope === "global"
        ? "global"
        : DEFAULT_SF_SKILLS_SETTINGS.defaultInstallScope,
  };
}

function readSettingsFile(filePath: string): { settings: SfSkillsSettings; exists: boolean } {
  const root = readJsonFile(filePath);
  const skills = nestedRecord(nestedRecord(root, "sfPi"), "skills");
  return {
    settings: normalizeSfSkillsSettings(skills),
    exists:
      Object.prototype.hasOwnProperty.call(skills, "hudVisibility") ||
      Object.prototype.hasOwnProperty.call(skills, "defaultInstallScope"),
  };
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
