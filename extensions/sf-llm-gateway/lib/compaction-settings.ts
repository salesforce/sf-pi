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
  contextWindow?: number;
  maxTokens?: number;
}

export interface EffectiveCompactionSettings {
  model: GatewayCompactionModel;
  source: CompactionSettingsSource;
  enabled: boolean;
  enabledSource: CompactionSettingsSource;
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
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
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
  projectTrusted: boolean = true,
): EffectiveCompactionSettings {
  const globalRoot = readJsonFile(globalSettingsFile);
  const projectRoot = projectTrusted ? readJsonFile(projectSettingsPath(cwd)) : {};
  const globalModel = compactionModelFromRoot(globalRoot);
  const projectModel = compactionModelFromRoot(projectRoot);
  const globalEnabled = compactionEnabledFromRoot(globalRoot);
  const projectEnabled = compactionEnabledFromRoot(projectRoot);
  const enabled = projectEnabled ?? globalEnabled ?? true;
  const enabledSource: CompactionSettingsSource =
    projectEnabled !== undefined ? "project" : globalEnabled !== undefined ? "global" : "default";

  if (projectModel) {
    return {
      model: projectModel,
      source: "project",
      enabled,
      enabledSource,
      globalModel,
      projectModel,
    };
  }
  if (globalModel) {
    return {
      model: globalModel,
      source: "global",
      enabled,
      enabledSource,
      globalModel,
      projectModel,
    };
  }
  return {
    model: ACTIVE_COMPACTION_MODEL,
    source: "default",
    enabled,
    enabledSource,
    globalModel,
    projectModel,
  };
}

export function readScopedCompactionModel(
  cwd: string,
  scope: CompactionSettingsScope,
  globalSettingsFile: string = globalSettingsPath(),
): GatewayCompactionModel | undefined {
  const root = readJsonFile(settingsPathForScope(cwd, scope, globalSettingsFile));
  return compactionModelFromRoot(root);
}

export function writeScopedCompactionModel(
  cwd: string,
  scope: CompactionSettingsScope,
  model: GatewayCompactionModel | undefined,
  globalSettingsFile: string = globalSettingsPath(),
): void {
  writeScopedCompactionPreference(cwd, scope, model, false, globalSettingsFile);
}

export function writeScopedCompactionSetup(
  cwd: string,
  scope: CompactionSettingsScope,
  model: Exclude<GatewayCompactionModel, typeof ACTIVE_COMPACTION_MODEL>,
  globalSettingsFile: string = globalSettingsPath(),
): void {
  writeScopedCompactionPreference(cwd, scope, model, true, globalSettingsFile);
}

function writeScopedCompactionPreference(
  cwd: string,
  scope: CompactionSettingsScope,
  model: GatewayCompactionModel | undefined,
  enableNativeCompaction: boolean,
  globalSettingsFile: string,
): void {
  const filePath = settingsPathForScope(cwd, scope, globalSettingsFile);
  const root = readJsonFile(filePath);
  const nextRoot = { ...root };
  const sfPi = { ...nestedRecord(nextRoot, "sfPi") };
  const sfPiCompaction = { ...nestedRecord(sfPi, "compaction") };

  if (model) sfPiCompaction.model = model;
  else delete sfPiCompaction.model;

  if (Object.keys(sfPiCompaction).length > 0) sfPi.compaction = sfPiCompaction;
  else delete sfPi.compaction;

  if (Object.keys(sfPi).length > 0) nextRoot.sfPi = sfPi;
  else delete nextRoot.sfPi;

  if (enableNativeCompaction) {
    nextRoot.compaction = {
      ...nestedRecord(nextRoot, "compaction"),
      enabled: true,
    };
  }

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

function compactionModelFromRoot(
  root: Record<string, unknown>,
): GatewayCompactionModel | undefined {
  const sfPi = nestedRecord(root, "sfPi");
  return normalizeCompactionModel(nestedRecord(sfPi, "compaction").model);
}

function compactionEnabledFromRoot(root: Record<string, unknown>): boolean | undefined {
  const enabled = nestedRecord(root, "compaction").enabled;
  return typeof enabled === "boolean" ? enabled : undefined;
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
