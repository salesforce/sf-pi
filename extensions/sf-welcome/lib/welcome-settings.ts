/* SPDX-License-Identifier: Apache-2.0 */
/** Pi settings-backed preferences for SF Welcome. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";

export type WelcomeSettingsScope = "global" | "project";
export type WelcomeStartupMode = "header" | "overlay";

export interface WelcomeSettings {
  startupMode: WelcomeStartupMode;
}

export interface EffectiveWelcomeSettings extends WelcomeSettings {
  source: WelcomeSettingsScope | "default";
  path?: string;
}

export const DEFAULT_WELCOME_SETTINGS: WelcomeSettings = { startupMode: "header" };

export function readEffectiveWelcomeSettings(cwd: string): EffectiveWelcomeSettings {
  const projectPath = projectSettingsPath(cwd);
  const project = readWelcomeSettingsFile(projectPath);
  if (project.exists) return { ...project.settings, source: "project", path: projectPath };

  const globalPath = globalSettingsPath();
  const global = readWelcomeSettingsFile(globalPath);
  if (global.exists) return { ...global.settings, source: "global", path: globalPath };

  return { ...DEFAULT_WELCOME_SETTINGS, source: "default" };
}

export function writeScopedWelcomeSettings(
  cwd: string,
  scope: WelcomeSettingsScope,
  settings: WelcomeSettings,
): EffectiveWelcomeSettings {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const root = readJsonFile(filePath);
  // Existing startup implementation reads top-level quietStartup. Preserve that
  // contract instead of introducing a second source of truth.
  root.quietStartup = settings.startupMode === "header";
  writeJsonFile(filePath, root);
  return { startupMode: settings.startupMode, source: scope, path: filePath };
}

function readWelcomeSettingsFile(filePath: string): { settings: WelcomeSettings; exists: boolean } {
  const root = readJsonFile(filePath);
  const quiet = root.quietStartup;
  return {
    settings: { startupMode: quiet === false ? "overlay" : "header" },
    exists: typeof quiet === "boolean",
  };
}
