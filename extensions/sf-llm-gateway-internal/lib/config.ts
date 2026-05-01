/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway configuration layer — constants, types, and config I/O.
 *
 * This is the foundation module for the sf-llm-gateway-internal extension.
 * Both the extension entry point and the setup overlay import from here.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globalAgentPath, projectConfigPath } from "../../../lib/common/pi-paths.ts";

// -------------------------------------------------------------------------------------------------
// Public constants
// -------------------------------------------------------------------------------------------------

export const PROVIDER_NAME = "sf-llm-gateway-internal";
// Friendly display name surfaced in pi's `/login` listing. pi >= 0.71 shows
// this as the provider label; older pi releases ignore the field.
//
// The "Salesforce Internal" suffix matches the README's "Internal-only
// extension" wording and makes it unambiguous for end users browsing
// `/login`: this gateway requires a Salesforce-issued token. External users
// should pick a different provider row.
export const PROVIDER_DISPLAY_NAME = "SF LLM Gateway (Salesforce Internal)";
export const COMMAND_NAME = "sf-llm-gateway-internal";
export const STATUS_KEY = "sf-llm-gateway-internal";
export const ENABLED_MODEL_PATTERN = `${PROVIDER_NAME}/*`;

/**
 * The sf-pi 0.20.x line registered a second provider for Claude models:
 *   "sf-llm-gateway-internal-anthropic"
 * That provider no longer exists — every model now runs under
 * PROVIDER_NAME, and Claude models carry `api: "anthropic-messages"` on
 * their `ProviderModelConfig` so pi dispatches them to the Anthropic-native
 * transport. The legacy id is exported here only so the one-shot settings
 * migrator can detect and rewrite it.
 */
export const LEGACY_PROVIDER_NAME_ANTHROPIC = "sf-llm-gateway-internal-anthropic";
export const LEGACY_ENABLED_MODEL_PATTERN_ANTHROPIC = `${LEGACY_PROVIDER_NAME_ANTHROPIC}/*`;

export const BASE_URL_ENV = "SF_LLM_GATEWAY_INTERNAL_BASE_URL";
export const API_KEY_ENV = "SF_LLM_GATEWAY_INTERNAL_API_KEY";
// The gateway endpoint is a Salesforce-internal URL and is intentionally not
// hardcoded here. Users must configure it via the setup wizard or env var.
export const DEFAULT_BASE_URL = "";

export const DEFAULT_MODEL_ID = "claude-opus-4-7";
export const FALLBACK_MODEL_ID = "claude-sonnet-4-6";

/** Previous default kept as a named constant for backward compatibility in presets. */
export const PREVIOUS_DEFAULT_MODEL_ID = "claude-opus-4-6-v1";
export const DEFAULT_THINKING_LEVEL = "xhigh" as const;
// When the user turns the gateway off, switch them to a model that actually
// exists on the gateway. `openai-codex/gpt-5.5` used to be here but is not
// a published model id on the gateway; use the real GPT-5 on the openai
// provider bundled with pi instead.
export const OFF_DEFAULT_PROVIDER = "openai";
export const OFF_DEFAULT_MODEL_ID = "gpt-5";
export const OFF_DEFAULT_THINKING_LEVEL = "xhigh" as const;

export const BETAS_ENV = "SF_LLM_GATEWAY_INTERNAL_BETAS";
export const SAVED_CONFIG_FILE = `${PROVIDER_NAME}.json`;

/**
 * Settings file path surfaced in retry-guidance notifications. Displayed
 * verbatim so users can paste it into their shell — kept consistent with
 * pi-coding-agent's docs.
 */
export const RETRY_GUIDANCE_SETTINGS_PATH = "~/.pi/agent/settings.json";

/** Anthropic status URL surfaced in retry-guidance notifications. */
export const RETRY_GUIDANCE_STATUS_URL = "https://status.anthropic.com";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type ConfigSource = "env" | "saved" | "default" | "missing";

export type SavedGatewayConfig = {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  exclusiveScope?: boolean;
  previousEnabledModels?: string[] | null;
  previousDefaultProvider?: string;
  previousDefaultModel?: string;
  previousThinkingLevel?: string;
};

export type GatewayConfig = {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  exclusiveScope: boolean;
  baseUrlSource: ConfigSource;
  apiKeySource: ConfigSource;
  exclusiveScopeSource: Extract<ConfigSource, "saved" | "default">;
  previousDefaultProvider?: string;
  previousDefaultModel?: string;
  previousThinkingLevel?: string;
};

export type SavedExclusiveScopeMode = "inherit" | "exclusive" | "additive";

export type SavedExclusiveScopeStatus = {
  project: SavedExclusiveScopeMode;
  global: SavedExclusiveScopeMode;
  effective: Exclude<SavedExclusiveScopeMode, "inherit">;
  effectiveSource: "project" | "global" | "default";
};

// -------------------------------------------------------------------------------------------------
// Config resolution
// -------------------------------------------------------------------------------------------------

export function getGatewayConfig(cwd: string): GatewayConfig {
  const saved = getMergedSavedGatewayConfig(cwd);

  const envBaseUrl = normalizeBaseUrl(process.env[BASE_URL_ENV]);
  const savedBaseUrl = normalizeBaseUrl(saved.baseUrl);
  const envApiKey = process.env[API_KEY_ENV]?.trim() || undefined;
  const savedApiKey = saved.apiKey?.trim() || undefined;
  const savedExclusiveScope = asOptionalBoolean(saved.exclusiveScope);
  const baseUrl = envBaseUrl ?? savedBaseUrl ?? DEFAULT_BASE_URL;

  return {
    enabled: saved.enabled !== false,
    baseUrl,
    apiKey: envApiKey ?? savedApiKey,
    exclusiveScope: savedExclusiveScope ?? false,
    baseUrlSource: envBaseUrl ? "env" : savedBaseUrl ? "saved" : "default",
    apiKeySource: envApiKey ? "env" : savedApiKey ? "saved" : "missing",
    exclusiveScopeSource: savedExclusiveScope !== undefined ? "saved" : "default",
    previousDefaultProvider: saved.previousDefaultProvider,
    previousDefaultModel: saved.previousDefaultModel,
    previousThinkingLevel: saved.previousThinkingLevel,
  };
}

/**
 * Global-only config resolution for the factory phase before session_start.
 * Reads env vars and the global Pi agent saved config but not the project-level
 * config (which requires a session cwd).
 */
export function getGlobalOnlyGatewayConfig(): GatewayConfig {
  const saved = readGatewaySavedConfig(globalGatewayConfigPath());

  const envBaseUrl = normalizeBaseUrl(process.env[BASE_URL_ENV]);
  const savedBaseUrl = normalizeBaseUrl(saved.baseUrl);
  const envApiKey = process.env[API_KEY_ENV]?.trim() || undefined;
  const savedApiKey = saved.apiKey?.trim() || undefined;
  const savedExclusiveScope = asOptionalBoolean(saved.exclusiveScope);
  const baseUrl = envBaseUrl ?? savedBaseUrl ?? DEFAULT_BASE_URL;

  return {
    enabled: saved.enabled !== false,
    baseUrl,
    apiKey: envApiKey ?? savedApiKey,
    exclusiveScope: savedExclusiveScope ?? false,
    baseUrlSource: envBaseUrl ? "env" : savedBaseUrl ? "saved" : "default",
    apiKeySource: envApiKey ? "env" : savedApiKey ? "saved" : "missing",
    exclusiveScopeSource: savedExclusiveScope !== undefined ? "saved" : "default",
    previousDefaultProvider: saved.previousDefaultProvider,
    previousDefaultModel: saved.previousDefaultModel,
    previousThinkingLevel: saved.previousThinkingLevel,
  };
}

export function getMergedSavedGatewayConfig(cwd: string): SavedGatewayConfig {
  return {
    ...readGatewaySavedConfig(globalGatewayConfigPath()),
    ...readGatewaySavedConfig(projectGatewayConfigPath(cwd)),
  };
}

export function getSavedExclusiveScopeStatus(cwd: string): SavedExclusiveScopeStatus {
  return resolveSavedExclusiveScopeStatus(
    readGatewaySavedConfig(projectGatewayConfigPath(cwd)),
    readGatewaySavedConfig(globalGatewayConfigPath()),
  );
}

export function resolveSavedExclusiveScopeStatus(
  projectSaved: SavedGatewayConfig,
  globalSaved: SavedGatewayConfig,
): SavedExclusiveScopeStatus {
  const project = toSavedExclusiveScopeMode(projectSaved.exclusiveScope);
  const global = toSavedExclusiveScopeMode(globalSaved.exclusiveScope);

  if (project !== "inherit") {
    return {
      project,
      global,
      effective: project,
      effectiveSource: "project",
    };
  }

  if (global !== "inherit") {
    return {
      project,
      global,
      effective: global,
      effectiveSource: "global",
    };
  }

  return {
    project,
    global,
    effective: "additive",
    effectiveSource: "default",
  };
}

// -------------------------------------------------------------------------------------------------
// Config file paths
// -------------------------------------------------------------------------------------------------

export function globalGatewayConfigPath(): string {
  return globalAgentPath(SAVED_CONFIG_FILE);
}

export function projectGatewayConfigPath(cwd: string): string {
  return projectConfigPath(cwd, SAVED_CONFIG_FILE);
}

// -------------------------------------------------------------------------------------------------
// Config file I/O
// -------------------------------------------------------------------------------------------------

export function readGatewaySavedConfig(filePath: string): SavedGatewayConfig {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const record = parsed as Record<string, unknown>;
    return {
      enabled: asOptionalBoolean(record.enabled),
      baseUrl: asOptionalString(record.baseUrl),
      apiKey: asOptionalString(record.apiKey),
      exclusiveScope: asOptionalBoolean(record.exclusiveScope),
      previousEnabledModels: asOptionalStringArrayOrNull(record.previousEnabledModels),
      previousDefaultProvider: asOptionalString(record.previousDefaultProvider),
      previousDefaultModel: asOptionalString(record.previousDefaultModel),
      previousThinkingLevel: asOptionalString(record.previousThinkingLevel),
    };
  } catch {
    return {};
  }
}

export function writeGatewaySavedConfig(filePath: string, config: SavedGatewayConfig): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best-effort only (e.g. Windows may ignore POSIX perms)
  }
}

// -------------------------------------------------------------------------------------------------
// Value helpers
// -------------------------------------------------------------------------------------------------

export function normalizeBaseUrl(rawValue: string | undefined): string | undefined {
  const value = rawValue?.trim();
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function maskApiKey(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(Math.max(4, value.length));
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function describeConfigValue(value: string | undefined, source: ConfigSource): string {
  if (!value) {
    return "missing";
  }
  return `${value} (${source})`;
}

export function describeApiKey(value: string | undefined, source: ConfigSource): string {
  if (!value) {
    return "missing";
  }
  return `${maskApiKey(value)} (${source})`;
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asOptionalStringArrayOrNull(value: unknown): string[] | null | undefined {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function toSavedExclusiveScopeMode(value: boolean | undefined): SavedExclusiveScopeMode {
  if (value === true) {
    return "exclusive";
  }
  if (value === false) {
    return "additive";
  }
  return "inherit";
}
