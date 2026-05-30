/* SPDX-License-Identifier: Apache-2.0 */
/** SF Pi-owned preferences for Code Analyzer. */
import {
  readJsonFile,
  writeJsonFile,
  globalSettingsPath,
  projectSettingsPath,
} from "../../../lib/common/sf-pi-settings.ts";

export interface CodeAnalyzerSettings {
  autoScan: boolean;
  apexGuruAuto: boolean;
}

export type CodeAnalyzerSettingKey = keyof CodeAnalyzerSettings;
export type CodeAnalyzerSettingSource = "project" | "global" | "default";

export interface EffectiveCodeAnalyzerSettings extends CodeAnalyzerSettings {
  sources: Record<CodeAnalyzerSettingKey, CodeAnalyzerSettingSource>;
}

const DEFAULTS: CodeAnalyzerSettings = {
  autoScan: true,
  apexGuruAuto: true,
};

export function readEffectiveCodeAnalyzerSettings(cwd: string): EffectiveCodeAnalyzerSettings {
  const global = readScopedSettings(globalSettingsPath());
  const project = readScopedSettings(projectSettingsPath(cwd));
  return {
    autoScan: project.autoScan ?? global.autoScan ?? DEFAULTS.autoScan,
    apexGuruAuto: project.apexGuruAuto ?? global.apexGuruAuto ?? DEFAULTS.apexGuruAuto,
    sources: {
      autoScan: sourceFor("autoScan", project, global),
      apexGuruAuto: sourceFor("apexGuruAuto", project, global),
    },
  };
}

export function writeCodeAnalyzerSetting(
  cwd: string,
  scope: "global" | "project",
  key: CodeAnalyzerSettingKey,
  value: boolean,
): EffectiveCodeAnalyzerSettings {
  mutateScopedSettings(cwd, scope, (codeAnalyzer) => {
    codeAnalyzer[key] = value;
  });
  return readEffectiveCodeAnalyzerSettings(cwd);
}

export function resetProjectCodeAnalyzerSetting(
  cwd: string,
  key: CodeAnalyzerSettingKey,
): EffectiveCodeAnalyzerSettings {
  mutateScopedSettings(cwd, "project", (codeAnalyzer) => {
    delete codeAnalyzer[key];
  });
  return readEffectiveCodeAnalyzerSettings(cwd);
}

export function describeSetting(
  settings: EffectiveCodeAnalyzerSettings,
  key: CodeAnalyzerSettingKey,
): string {
  return `${settings[key] ? "on" : "off"} (${settings.sources[key]})`;
}

function mutateScopedSettings(
  cwd: string,
  scope: "global" | "project",
  mutate: (codeAnalyzer: Record<string, unknown>) => void,
): void {
  const file = scope === "global" ? globalSettingsPath() : projectSettingsPath(cwd);
  const settings = readJsonFile(file);
  const sfPi = objectValue(settings.sfPi);
  const codeAnalyzer = objectValue(sfPi.codeAnalyzer);
  mutate(codeAnalyzer);
  sfPi.codeAnalyzer = codeAnalyzer;
  settings.sfPi = sfPi;
  writeJsonFile(file, settings);
}

function readScopedSettings(file: string): Partial<CodeAnalyzerSettings> {
  const settings = readJsonFile(file);
  const sfPi = objectValue(settings.sfPi);
  const codeAnalyzer = objectValue(sfPi.codeAnalyzer);
  const result: Partial<CodeAnalyzerSettings> = {};
  if (typeof codeAnalyzer.autoScan === "boolean") result.autoScan = codeAnalyzer.autoScan;
  if (typeof codeAnalyzer.apexGuruAuto === "boolean")
    result.apexGuruAuto = codeAnalyzer.apexGuruAuto;
  return result;
}

function sourceFor(
  key: CodeAnalyzerSettingKey,
  project: Partial<CodeAnalyzerSettings>,
  global: Partial<CodeAnalyzerSettings>,
): CodeAnalyzerSettingSource {
  if (project[key] !== undefined) return "project";
  if (global[key] !== undefined) return "global";
  return "default";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
