/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One-shot settings migration from former Opus product defaults to GPT-5.6 Sol.
 *
 * Former default models remain selectable. The per-file sentinel is therefore
 * essential: after this migration runs once, a user can deliberately choose an
 * Opus model again without startup rewriting that choice.
 */
import { existsSync } from "node:fs";
import { DEFAULT_MODEL_ID, PROVIDER_NAME, asOptionalString } from "./config.ts";
import {
  globalSettingsPath,
  projectSettingsPath,
  readSettings,
  writeSettings,
} from "./pi-settings.ts";

export const GPT56_DEFAULT_MIGRATION_SENTINEL_KEY = "sfPi";
export const GPT56_DEFAULT_MIGRATION_SENTINEL_FIELD = "gatewayGpt56DefaultMigrated";

export const OBSOLETE_GATEWAY_DEFAULT_MODEL_IDS = new Set([
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-7-v1",
  "claude-opus-4-7-20250416",
  "us.anthropic.claude-opus-4-7-v1",
]);

export interface Gpt56DefaultMigrationResult {
  changed: boolean;
  alreadyMigrated: boolean;
  changes: string[];
}

export function migrateGpt56DefaultSettingsFile(filePath: string): Gpt56DefaultMigrationResult {
  if (!existsSync(filePath)) {
    return { changed: false, alreadyMigrated: false, changes: [] };
  }

  const settings = readSettings(filePath);
  const sfPi = toRecord(settings[GPT56_DEFAULT_MIGRATION_SENTINEL_KEY]);
  if (sfPi[GPT56_DEFAULT_MIGRATION_SENTINEL_FIELD] === true) {
    return { changed: false, alreadyMigrated: true, changes: [] };
  }

  const changes: string[] = [];
  const shouldMigrate =
    settings.defaultProvider === PROVIDER_NAME &&
    isObsoleteGatewayDefaultModelId(asOptionalString(settings.defaultModel));

  if (shouldMigrate) {
    changes.push(`defaultModel: ${String(settings.defaultModel)} → ${DEFAULT_MODEL_ID}`);
    settings.defaultModel = DEFAULT_MODEL_ID;
  }

  markGpt56DefaultMigration(settings);
  writeSettings(filePath, settings);

  return { changed: shouldMigrate, alreadyMigrated: false, changes };
}

export function migrateGpt56DefaultSettings(
  cwd: string | undefined,
): Gpt56DefaultMigrationResult[] {
  const results = [migrateGpt56DefaultSettingsFile(globalSettingsPath())];
  if (cwd) {
    results.push(migrateGpt56DefaultSettingsFile(projectSettingsPath(cwd)));
  }
  return results;
}

export function isObsoleteGatewayDefaultModelId(modelId: string | undefined): boolean {
  const unprefixed = stripGatewayProviderPrefix(modelId);
  return Boolean(unprefixed && OBSOLETE_GATEWAY_DEFAULT_MODEL_IDS.has(unprefixed));
}

export function markGpt56DefaultMigration(settings: Record<string, unknown>): void {
  const sfPi = toRecord(settings[GPT56_DEFAULT_MIGRATION_SENTINEL_KEY]);
  settings[GPT56_DEFAULT_MIGRATION_SENTINEL_KEY] = {
    ...sfPi,
    [GPT56_DEFAULT_MIGRATION_SENTINEL_FIELD]: true,
  };
}

function stripGatewayProviderPrefix(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  const prefix = `${PROVIDER_NAME}/`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
