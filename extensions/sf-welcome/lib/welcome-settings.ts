/* SPDX-License-Identifier: Apache-2.0 */
/** Pi settings-backed preferences for SF Welcome. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";

export type WelcomeSettingsScope = "global" | "project";
export type WelcomeStartupMode = "header" | "off";

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
  const sfPi = readObject(root.sfPi);
  const welcome = readObject(sfPi.welcome);
  root.sfPi = {
    ...sfPi,
    welcome: { ...welcome, mode: settings.startupMode },
  };
  writeJsonFile(filePath, root);
  return { startupMode: settings.startupMode, source: scope, path: filePath };
}

function readWelcomeSettingsFile(filePath: string): { settings: WelcomeSettings; exists: boolean } {
  const root = readJsonFile(filePath);
  const welcome = readObject(readObject(root.sfPi).welcome);
  const mode = welcome.mode;
  if (mode === "header" || mode === "off") {
    return { settings: { startupMode: mode }, exists: true };
  }
  if (mode === "overlay" || mode === "auto") {
    return { settings: { startupMode: "header" }, exists: true };
  }

  // A pre-Pi-1.0 panel stored its choice in quietStartup. Automatic overlays
  // are no longer supported, so every legacy value migrates to the safe header.
  if (typeof root.quietStartup === "boolean" || root.quietStartup === "header") {
    return { settings: { startupMode: "header" }, exists: true };
  }
  return { settings: { ...DEFAULT_WELCOME_SETTINGS }, exists: false };
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
