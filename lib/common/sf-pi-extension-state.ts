/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared sf-pi extension enablement state.
 *
 * sf-pi stores bundled-extension disables as Pi package filters in
 * settings.json, for example an include-all pattern plus an exclusion for
 * `extensions/sf-slack/index.ts`.
 * Multiple extensions need to answer the same question ("is optional extension X enabled?")
 * before surfacing status UI, so this module centralizes Pi's project-over-global
 * precedence and package-source matching rules.
 */
import path from "node:path";
import { SF_PI_REGISTRY } from "../../catalog/registry.ts";
import { globalSettingsPath, projectSettingsPath, readJsonFile } from "./sf-pi-settings.ts";
import {
  findSfPiPackageEntry,
  getDisabledExtensionFiles,
  getExplicitlyEnabledExtensionFiles,
} from "./sf-pi-package-resolution.ts";

export type SfPiExtensionId = (typeof SF_PI_REGISTRY)[number]["id"];

const STATUS_KEY_EXTENSION_ID: Record<string, SfPiExtensionId | "always"> = {
  "sf-slack-status": "sf-slack",
  "sf-llm-gateway-internal": "sf-llm-gateway-internal",
  "sf-pi": "always",
};

export function getDisabledExtensionFilesForCwd(cwd: string): Set<string> {
  const projectPath = projectSettingsPath(cwd);
  const projectSettings = readJsonFile(projectPath);
  const projectEntry = findSfPiPackageEntry(projectSettings, path.dirname(projectPath));
  if (projectEntry) {
    return getDisabledExtensionFiles(projectSettings, projectEntry.index);
  }

  const globalPath = globalSettingsPath();
  const globalSettings = readJsonFile(globalPath);
  const globalEntry = findSfPiPackageEntry(globalSettings, path.dirname(globalPath));
  return globalEntry ? getDisabledExtensionFiles(globalSettings, globalEntry.index) : new Set();
}

export function isSfPiExtensionEnabled(cwd: string, extensionId: SfPiExtensionId): boolean {
  const extension = SF_PI_REGISTRY.find((entry) => entry.id === extensionId);
  if (!extension) return false;
  if (extension.alwaysActive) return true;
  if (!extension.defaultEnabled) {
    return getEnabledExtensionFilesForCwd(cwd).has(extension.file);
  }
  return !getDisabledExtensionFilesForCwd(cwd).has(extension.file);
}

export function filterEnabledExtensionStatuses(
  cwd: string,
  statuses: ReadonlyMap<string, string>,
): Map<string, string> {
  const filtered = new Map<string, string>();
  for (const [key, value] of statuses) {
    const owner = STATUS_KEY_EXTENSION_ID[key];
    if (!owner) continue;
    if (owner === "always" || isSfPiExtensionEnabled(cwd, owner)) {
      filtered.set(key, value);
    }
  }
  return filtered;
}

function getEnabledExtensionFilesForCwd(cwd: string): Set<string> {
  const projectPath = projectSettingsPath(cwd);
  const projectSettings = readJsonFile(projectPath);
  const projectEntry = findSfPiPackageEntry(projectSettings, path.dirname(projectPath));
  if (projectEntry) {
    return getExplicitlyEnabledExtensionFiles(projectSettings, projectEntry.index);
  }

  const globalPath = globalSettingsPath();
  const globalSettings = readJsonFile(globalPath);
  const globalEntry = findSfPiPackageEntry(globalSettings, path.dirname(globalPath));
  return globalEntry
    ? getExplicitlyEnabledExtensionFiles(globalSettings, globalEntry.index)
    : new Set();
}
