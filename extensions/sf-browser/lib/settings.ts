/* SPDX-License-Identifier: Apache-2.0 */
/** Pi settings-backed preferences for SF Browser. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import type { EvidenceImageMode } from "./artifacts.ts";

export const EVIDENCE_IMAGE_MODES = ["artifact", "thumbnail", "full"] as const;
export type SfBrowserSettingsScope = "global" | "project";

export interface SfBrowserSettings {
  evidenceImageMode: EvidenceImageMode;
  dismissOverlays: boolean;
  includeSetupAuditTrail: boolean;
}

export interface EffectiveSfBrowserSettings extends SfBrowserSettings {
  source: SfBrowserSettingsScope | "default";
  path?: string;
}

export const DEFAULT_SF_BROWSER_SETTINGS: SfBrowserSettings = {
  evidenceImageMode: "thumbnail",
  dismissOverlays: true,
  includeSetupAuditTrail: false,
};

export function readEffectiveSfBrowserSettings(cwd: string): EffectiveSfBrowserSettings {
  const projectPath = projectSettingsPath(cwd);
  const project = readSettingsFile(projectPath);
  if (project.exists) return { ...project.settings, source: "project", path: projectPath };
  const globalPath = globalSettingsPath();
  const global = readSettingsFile(globalPath);
  if (global.exists) return { ...global.settings, source: "global", path: globalPath };
  return { ...DEFAULT_SF_BROWSER_SETTINGS, source: "default" };
}

export function writeScopedSfBrowserSettings(
  cwd: string,
  scope: SfBrowserSettingsScope,
  settings: SfBrowserSettings,
): EffectiveSfBrowserSettings {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const root = readJsonFile(filePath);
  const sfPi = { ...nestedRecord(root, "sfPi") };
  sfPi.browser = normalizeSfBrowserSettings(settings);
  root.sfPi = sfPi;
  writeJsonFile(filePath, root);
  return { ...normalizeSfBrowserSettings(settings), source: scope, path: filePath };
}

export function normalizeSfBrowserSettings(value: unknown): SfBrowserSettings {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    evidenceImageMode: EVIDENCE_IMAGE_MODES.includes(
      candidate.evidenceImageMode as EvidenceImageMode,
    )
      ? (candidate.evidenceImageMode as EvidenceImageMode)
      : DEFAULT_SF_BROWSER_SETTINGS.evidenceImageMode,
    dismissOverlays:
      typeof candidate.dismissOverlays === "boolean"
        ? candidate.dismissOverlays
        : DEFAULT_SF_BROWSER_SETTINGS.dismissOverlays,
    includeSetupAuditTrail:
      typeof candidate.includeSetupAuditTrail === "boolean"
        ? candidate.includeSetupAuditTrail
        : DEFAULT_SF_BROWSER_SETTINGS.includeSetupAuditTrail,
  };
}

function readSettingsFile(filePath: string): { settings: SfBrowserSettings; exists: boolean } {
  const root = readJsonFile(filePath);
  const browser = nestedRecord(nestedRecord(root, "sfPi"), "browser");
  return {
    settings: normalizeSfBrowserSettings(browser),
    exists:
      Object.prototype.hasOwnProperty.call(browser, "evidenceImageMode") ||
      Object.prototype.hasOwnProperty.call(browser, "dismissOverlays") ||
      Object.prototype.hasOwnProperty.call(browser, "includeSetupAuditTrail"),
  };
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
