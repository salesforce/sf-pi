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

const DEFAULTS: CodeAnalyzerSettings = {
  autoScan: true,
  apexGuruAuto: true,
};

export function readEffectiveCodeAnalyzerSettings(cwd: string): CodeAnalyzerSettings {
  return {
    ...DEFAULTS,
    ...readScopedSettings(globalSettingsPath()),
    ...readScopedSettings(projectSettingsPath(cwd)),
  };
}

export function writeCodeAnalyzerSetting(
  cwd: string,
  scope: "global" | "project",
  key: keyof CodeAnalyzerSettings,
  value: boolean,
): CodeAnalyzerSettings {
  const file = scope === "global" ? globalSettingsPath() : projectSettingsPath(cwd);
  const settings = readJsonFile(file);
  const sfPi = objectValue(settings.sfPi);
  const codeAnalyzer = objectValue(sfPi.codeAnalyzer);
  codeAnalyzer[key] = value;
  sfPi.codeAnalyzer = codeAnalyzer;
  settings.sfPi = sfPi;
  writeJsonFile(file, settings);
  return readEffectiveCodeAnalyzerSettings(cwd);
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
