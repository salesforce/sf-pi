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
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SF_PI_REGISTRY } from "../../catalog/registry.ts";
import { globalSettingsPath, projectSettingsPath } from "./pi-paths.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

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
    return getDisabledExtensions(projectSettings, projectEntry.index);
  }

  const globalPath = globalSettingsPath();
  const globalSettings = readJsonFile(globalPath);
  const globalEntry = findSfPiPackageEntry(globalSettings, path.dirname(globalPath));
  return globalEntry ? getDisabledExtensions(globalSettings, globalEntry.index) : new Set();
}

export function isSfPiExtensionEnabled(cwd: string, extensionId: SfPiExtensionId): boolean {
  const extension = SF_PI_REGISTRY.find((entry) => entry.id === extensionId);
  if (!extension) return false;
  if (extension.alwaysActive) return true;
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

function getDisabledExtensions(
  settings: Record<string, unknown>,
  packageIndex: number,
): Set<string> {
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  const pkg = packages[packageIndex];
  if (!pkg || typeof pkg !== "object") return new Set();

  const extensions = Array.isArray((pkg as Record<string, unknown>).extensions)
    ? ((pkg as Record<string, unknown>).extensions as unknown[])
    : [];

  const disabled = new Set<string>();
  for (const pattern of extensions) {
    if (typeof pattern === "string" && pattern.startsWith("!")) {
      disabled.add(pattern.slice(1));
    }
  }
  return disabled;
}

function findSfPiPackageEntry(
  settings: Record<string, unknown>,
  settingsDir: string,
): { index: number; source: string; isObject: boolean } | null {
  const packages = Array.isArray(settings.packages) ? settings.packages : [];

  for (let index = 0; index < packages.length; index++) {
    const entry = packages[index];
    let source: string;
    let isObject: boolean;

    if (typeof entry === "string") {
      source = entry;
      isObject = false;
    } else if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).source === "string"
    ) {
      source = (entry as Record<string, unknown>).source as string;
      isObject = true;
    } else {
      continue;
    }

    if (matchesPackageSource(source, settingsDir)) {
      return { index, source, isObject };
    }
  }

  return null;
}

function matchesPackageSource(source: string, settingsDir: string): boolean {
  const normalizedSource = source.toLowerCase();

  if (normalizedSource.includes("sf-pi")) return true;
  if (normalizedSource.includes("jag-pi-extensions")) return true;

  const looksLikeLocalPath =
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith("~");

  if (!looksLikeLocalPath) return false;

  const expandedSource = source.startsWith("~") ? path.join(homedir(), source.slice(1)) : source;
  const resolved = path.resolve(settingsDir, expandedSource);

  if (resolved === PACKAGE_ROOT) return true;

  try {
    return realpathSync(resolved) === realpathSync(PACKAGE_ROOT);
  } catch {
    return false;
  }
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
