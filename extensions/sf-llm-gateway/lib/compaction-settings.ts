/* SPDX-License-Identifier: Apache-2.0 */
/** Scoped SF Pi preference for choosing a dedicated Gateway compaction model. */
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import { PROVIDER_NAME } from "./config.ts";

export const ACTIVE_COMPACTION_MODEL = "active" as const;
export type GatewayCompactionModel =
  typeof ACTIVE_COMPACTION_MODEL | `${typeof PROVIDER_NAME}/${string}`;
export type CompactionSettingsScope = "global" | "project";
export type CompactionSettingsSource = CompactionSettingsScope | "default";

export interface GatewayCompactionModelOption {
  value: GatewayCompactionModel;
  label: string;
  description: string;
}

export interface EffectiveCompactionSettings {
  model: GatewayCompactionModel;
  source: CompactionSettingsSource;
  globalModel?: GatewayCompactionModel;
  projectModel?: GatewayCompactionModel;
}

export function buildGatewayCompactionModelOptions(
  models: readonly Pick<Model<Api>, "provider" | "id" | "name" | "contextWindow" | "maxTokens">[],
): GatewayCompactionModelOption[] {
  return models
    .filter((model) => model.provider === PROVIDER_NAME)
    .map((model) => ({
      value: `${PROVIDER_NAME}/${model.id}` as GatewayCompactionModel,
      label: model.name.replace(/^\[SF LLM Gateway\]\s*/u, "") || model.id,
      description: `${formatTokenCapacity(model.contextWindow)} context · ${formatTokenCapacity(model.maxTokens)} output`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function normalizeCompactionModel(value: unknown): GatewayCompactionModel | undefined {
  if (value === ACTIVE_COMPACTION_MODEL) return ACTIVE_COMPACTION_MODEL;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  const prefix = `${PROVIDER_NAME}/`;
  return normalized.startsWith(prefix) && normalized.length > prefix.length
    ? (normalized as GatewayCompactionModel)
    : undefined;
}

export function readEffectiveCompactionSettings(
  cwd: string,
  globalSettingsFile: string = globalSettingsPath(),
): EffectiveCompactionSettings {
  const globalModel = readScopedCompactionModel(cwd, "global", globalSettingsFile);
  const projectModel = readScopedCompactionModel(cwd, "project", globalSettingsFile);
  if (projectModel) return { model: projectModel, source: "project", globalModel, projectModel };
  if (globalModel) return { model: globalModel, source: "global", globalModel, projectModel };
  return { model: ACTIVE_COMPACTION_MODEL, source: "default", globalModel, projectModel };
}

export function readScopedCompactionModel(
  cwd: string,
  scope: CompactionSettingsScope,
  globalSettingsFile: string = globalSettingsPath(),
): GatewayCompactionModel | undefined {
  const root = readJsonFile(settingsPathForScope(cwd, scope, globalSettingsFile));
  const sfPi = nestedRecord(root, "sfPi");
  const compaction = nestedRecord(sfPi, "compaction");
  return normalizeCompactionModel(compaction.model);
}

export function writeScopedCompactionModel(
  cwd: string,
  scope: CompactionSettingsScope,
  model: GatewayCompactionModel | undefined,
  globalSettingsFile: string = globalSettingsPath(),
): void {
  const filePath = settingsPathForScope(cwd, scope, globalSettingsFile);
  const root = readJsonFile(filePath);
  const nextRoot = { ...root };
  const sfPi = { ...nestedRecord(nextRoot, "sfPi") };
  const compaction = { ...nestedRecord(sfPi, "compaction") };

  if (model) compaction.model = model;
  else delete compaction.model;

  if (Object.keys(compaction).length > 0) sfPi.compaction = compaction;
  else delete sfPi.compaction;

  if (Object.keys(sfPi).length > 0) nextRoot.sfPi = sfPi;
  else delete nextRoot.sfPi;

  writeJsonFile(filePath, nextRoot);
}

export function settingsPathForScope(
  cwd: string,
  scope: CompactionSettingsScope,
  globalSettingsFile: string = globalSettingsPath(),
): string {
  return scope === "project" ? projectSettingsPath(cwd) : globalSettingsFile;
}

function formatTokenCapacity(tokens: number): string {
  if (tokens >= 1_000_000) return `${formatCapacityNumber(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${formatCapacityNumber(tokens / 1_000)}K`;
  return String(tokens);
}

function formatCapacityNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "");
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
