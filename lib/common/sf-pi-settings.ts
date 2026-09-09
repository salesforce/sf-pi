/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pi settings.json read/write helpers shared across sf-pi extensions.
 *
 * Keep this module intentionally small and boring:
 * - path resolution (delegated to pi-paths.ts)
 * - tolerant JSON reads
 * - stable JSON writes
 *
 * sf-pi package discovery + filter state lives in sf-pi-package-state.ts,
 * not here. This file only knows how to read and write a settings file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  globalSettingsPath as resolveGlobalSettingsPath,
  projectSettingsPath as resolveProjectSettingsPath,
} from "./pi-paths.ts";

/** Global Pi settings file, e.g. ~/.pi/agent/settings.json for the normal Pi CLI. */
export function globalSettingsPath(): string {
  return resolveGlobalSettingsPath();
}

/** Project-local Pi settings file, e.g. <cwd>/.pi/settings.json for the normal Pi CLI. */
export function projectSettingsPath(cwd: string): string {
  return resolveProjectSettingsPath(cwd);
}

/**
 * Read a JSON object from disk.
 *
 * Returns {} for missing files, invalid JSON, or non-object roots.
 * That keeps command handlers simple and avoids surfacing parse noise to users.
 */
export function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Write a JSON object to disk, creating parent directories as needed. */
export function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  // Writes Pi settings.json (globalAgentDir or <cwd>/.pi), not an OS temp file.
  // CodeQL taints getAgentDir() because tests override the agent dir under os.tmpdir().
  // codeql[js/insecure-temporary-file]
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
