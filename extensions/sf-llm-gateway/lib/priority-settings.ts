/* SPDX-License-Identifier: Apache-2.0 */
/** Scoped user preference for exact-model Gateway priority requests. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";

export type PriorityScope = "global" | "project";
export interface EffectivePrioritySettings {
  enabled: boolean;
  source: PriorityScope | "default";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readScopedPriority(
  cwd: string,
  scope: PriorityScope,
  globalFile = globalSettingsPath(),
): boolean | undefined {
  const root = readJsonFile(scope === "project" ? projectSettingsPath(cwd) : globalFile);
  const value = record(record(root.sfPi).llmGateway).priority;
  return typeof value === "boolean" ? value : undefined;
}

export function readEffectivePrioritySettings(
  cwd: string,
  globalFile = globalSettingsPath(),
  projectTrusted = false,
): EffectivePrioritySettings {
  const project = projectTrusted ? readScopedPriority(cwd, "project", globalFile) : undefined;
  if (project !== undefined) return { enabled: project, source: "project" };
  const global = readScopedPriority(cwd, "global", globalFile);
  return global !== undefined
    ? { enabled: global, source: "global" }
    : { enabled: true, source: "default" };
}

export function writeScopedPriority(
  cwd: string,
  scope: PriorityScope,
  value: boolean | undefined,
  globalFile = globalSettingsPath(),
): void {
  const file = scope === "project" ? projectSettingsPath(cwd) : globalFile;
  const root = readJsonFile(file);
  const sfPi = { ...record(root.sfPi) };
  const gateway = { ...record(sfPi.llmGateway) };
  if (value === undefined) delete gateway.priority;
  else gateway.priority = value;
  if (Object.keys(gateway).length) sfPi.llmGateway = gateway;
  else delete sfPi.llmGateway;
  if (Object.keys(sfPi).length) root.sfPi = sfPi;
  else delete root.sfPi;
  writeJsonFile(file, root);
}
