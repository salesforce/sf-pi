/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pi settings.json helpers for the gateway extension.
 *
 * This is intentionally separate from config.ts:
 * - config.ts owns gateway-specific saved config files
 * - this file owns generic Pi settings mutations (default model/provider)
 *
 * ⚠ Race risk: These functions read/write settings.json directly. Pi's own
 * settings writes (e.g. from setters like setLastChangelogVersion) could race
 * with ours. Pi v0.50.2 added external-edit preservation, but concurrent
 * writes from within the same process are still at risk. Callers should
 * use `ctx.reload()` after batch writes to let Pi re-read the file.
 *
 * Ideally Pi would expose a settings write API (pi.setSetting(key, value)).
 * Until then, this is the accepted pattern for provider extensions that
 * need to persist defaultProvider/defaultModel.
 */
import {
  globalSettingsPath as resolveGlobalSettingsPath,
  projectSettingsPath as resolveProjectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import {
  ENABLED_MODEL_PATTERN,
  LEGACY_ENABLED_MODEL_PATTERN_ANTHROPIC,
  asOptionalString,
} from "./config.ts";

const LEGACY_ENABLED_MODEL_PREFIX_ANTHROPIC = LEGACY_ENABLED_MODEL_PATTERN_ANTHROPIC.slice(0, -1);

/**
 * Since R1·Unify the gateway registers a single provider. All models live
 * under `sf-llm-gateway-internal/*`. The legacy `-anthropic/*` pattern is
 * still recognized only for the one-shot migration in
 * `normalizeLegacyGatewayEnabledModels()`.
 */
function isGatewayScopePattern(pattern: string): boolean {
  return pattern === ENABLED_MODEL_PATTERN;
}

export interface EffectiveDefaultModelSetting {
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

export function globalSettingsPath(): string {
  return resolveGlobalSettingsPath();
}

export function projectSettingsPath(cwd: string): string {
  return resolveProjectSettingsPath(cwd);
}

/**
 * Read Pi settings as a tolerant object.
 * Missing files and malformed JSON both collapse to {} so command handlers can
 * stay linear and user-friendly.
 */
export function readSettings(filePath: string): Record<string, unknown> {
  return readJsonFile(filePath);
}

export function writeSettings(filePath: string, settings: Record<string, unknown>): void {
  writeJsonFile(filePath, settings);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function isExclusiveEnabledModelPattern(value: unknown): boolean {
  const patterns = toStringArray(value);
  if (patterns.length === 0) return false;
  return patterns.every((pattern) => isGatewayScopePattern(pattern));
}

function isLegacyGatewayModelPattern(pattern: string): boolean {
  if (isGatewayScopePattern(pattern)) return false;
  return pattern.startsWith(LEGACY_ENABLED_MODEL_PREFIX_ANTHROPIC);
}

/**
 * Collapse entries from the retired Anthropic-only sub-provider to the current
 * provider wildcard.
 *
 * Current-provider model ids such as `sf-llm-gateway-internal/gpt-5.5` are
 * valid explicit allow-list entries. Preserve them so users who intentionally
 * scope Pi to a fixed set of gateway models keep that scope across restarts.
 */
export function normalizeLegacyGatewayEnabledModels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const patterns = toStringArray(value);
  let hasGatewayScope = false;
  const otherPatterns: string[] = [];

  for (const pattern of patterns) {
    if (isGatewayScopePattern(pattern) || isLegacyGatewayModelPattern(pattern)) {
      hasGatewayScope = true;
      continue;
    }

    if (!otherPatterns.includes(pattern)) {
      otherPatterns.push(pattern);
    }
  }

  if (!hasGatewayScope) {
    return patterns;
  }

  return [ENABLED_MODEL_PATTERN, ...otherPatterns];
}

export function snapshotEnabledModelsForExclusiveScope(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return removeEnabledModelPattern(value);
}

/**
 * Keep the gateway provider pattern present and at the front of enabledModels.
 */
export function ensureEnabledModelPattern(value: unknown): string[] {
  const existing = toStringArray(value).filter((item) => !isGatewayScopePattern(item));
  return [ENABLED_MODEL_PATTERN, ...existing];
}

/** Replace enabledModels with gateway-only scope. */
export function setExclusiveEnabledModelPattern(): string[] {
  return [ENABLED_MODEL_PATTERN];
}

/** Remove the gateway provider pattern from enabledModels. */
export function removeEnabledModelPattern(value: unknown): string[] {
  return toStringArray(value).filter((item) => !isGatewayScopePattern(item));
}

export function restoreEnabledModelsSnapshot(
  snapshot: string[] | null | undefined,
): string[] | undefined {
  if (snapshot === undefined || snapshot === null) {
    return undefined;
  }
  return [...snapshot];
}

export function applyGatewayModelScope(value: unknown, exclusiveScope: boolean): string[] {
  return exclusiveScope ? setExclusiveEnabledModelPattern() : ensureEnabledModelPattern(value);
}

export function shouldCaptureExclusiveScopeSnapshot(
  value: unknown,
  existingSnapshot: string[] | null | undefined,
): boolean {
  return existingSnapshot === undefined || !isExclusiveEnabledModelPattern(value);
}

/**
 * Project settings override global settings, matching Pi's normal precedence.
 * We only read the default-provider related keys here.
 */
export function getEffectiveDefaultModelSetting(cwd: string): EffectiveDefaultModelSetting {
  const merged = {
    ...readSettings(globalSettingsPath()),
    ...readSettings(projectSettingsPath(cwd)),
  };

  return {
    provider: asOptionalString(merged.defaultProvider),
    modelId: asOptionalString(merged.defaultModel),
    thinkingLevel: asOptionalString(merged.defaultThinkingLevel),
  };
}
