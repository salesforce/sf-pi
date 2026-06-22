/* SPDX-License-Identifier: Apache-2.0 */
/** Pi settings-backed preferences for SF Data Explorer. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import type { ExplorerMode } from "./types.ts";

export const EXPLORER_MODES = ["soql", "sosl", "sql"] as const;
export type DataExplorerSettingsScope = "global" | "project";

export interface DataExplorerSettings {
  defaultMode: ExplorerMode;
  defaultOrg: string;
}

export interface EffectiveDataExplorerSettings extends DataExplorerSettings {
  source: DataExplorerSettingsScope | "default";
  path?: string;
}

export const DEFAULT_DATA_EXPLORER_SETTINGS: DataExplorerSettings = {
  defaultMode: "soql",
  defaultOrg: "default",
};

export function readEffectiveDataExplorerSettings(cwd: string): EffectiveDataExplorerSettings {
  const projectPath = projectSettingsPath(cwd);
  const project = readSettingsFile(projectPath);
  if (project.exists) return { ...project.settings, source: "project", path: projectPath };

  const globalPath = globalSettingsPath();
  const global = readSettingsFile(globalPath);
  if (global.exists) return { ...global.settings, source: "global", path: globalPath };

  return { ...DEFAULT_DATA_EXPLORER_SETTINGS, source: "default" };
}

export function writeScopedDataExplorerSettings(
  cwd: string,
  scope: DataExplorerSettingsScope,
  settings: DataExplorerSettings,
): EffectiveDataExplorerSettings {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const root = readJsonFile(filePath);
  const sfPi = { ...nestedRecord(root, "sfPi") };
  sfPi.dataExplorer = normalizeDataExplorerSettings(settings);
  root.sfPi = sfPi;
  writeJsonFile(filePath, root);
  return { ...normalizeDataExplorerSettings(settings), source: scope, path: filePath };
}

export function normalizeDataExplorerSettings(value: unknown): DataExplorerSettings {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    defaultMode: EXPLORER_MODES.includes(candidate.defaultMode as ExplorerMode)
      ? (candidate.defaultMode as ExplorerMode)
      : DEFAULT_DATA_EXPLORER_SETTINGS.defaultMode,
    defaultOrg:
      typeof candidate.defaultOrg === "string" && candidate.defaultOrg.trim()
        ? candidate.defaultOrg.trim()
        : DEFAULT_DATA_EXPLORER_SETTINGS.defaultOrg,
  };
}

function readSettingsFile(filePath: string): { settings: DataExplorerSettings; exists: boolean } {
  const root = readJsonFile(filePath);
  const dataExplorer = nestedRecord(nestedRecord(root, "sfPi"), "dataExplorer");
  return {
    settings: normalizeDataExplorerSettings(dataExplorer),
    exists:
      Object.prototype.hasOwnProperty.call(dataExplorer, "defaultMode") ||
      Object.prototype.hasOwnProperty.call(dataExplorer, "defaultOrg"),
  };
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
