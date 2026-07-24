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
import { toGatewayRootBaseUrl } from "./gateway-url.ts";

// -------------------------------------------------------------------------------------------------
// Public constants
// -------------------------------------------------------------------------------------------------

export const PROVIDER_NAME = "sf-llm-gateway-internal";
// Friendly display name surfaced in pi's `/login` listing. pi >= 0.71 shows
// this as the provider label; older pi releases ignore the field. Keep the
// label source-agnostic: access is determined by the user's configured gateway
// endpoint and credentials, not by a public default endpoint in this repo.
export const PROVIDER_DISPLAY_NAME = "SF LLM Gateway";
export const COMMAND_NAME = "sf-llm-gateway-internal";
export const FRIENDLY_COMMAND_NAME = "sf-llm-gateway";
export const STATUS_KEY = "sf-llm-gateway-internal";
export const ENABLED_MODEL_PATTERN = `${PROVIDER_NAME}/*`;

/**
 * The sf-pi 0.20.x line registered a second provider for Claude models:
 *   "sf-llm-gateway-internal-anthropic"
 * That provider no longer exists — every model now runs under
 * PROVIDER_NAME. Claude is still routed to the Anthropic-native transport,
 * but the unified provider's custom `streamSimple` does that internally by
 * model id. The legacy id is exported here only so the one-shot settings
 * migrator can detect and rewrite it.
 */
export const LEGACY_PROVIDER_NAME_ANTHROPIC = "sf-llm-gateway-internal-anthropic";
export const LEGACY_ENABLED_MODEL_PATTERN_ANTHROPIC = `${LEGACY_PROVIDER_NAME_ANTHROPIC}/*`;

export const BASE_URL_ENV = "SF_LLM_GATEWAY_BASE_URL";
export const API_KEY_ENV = "SF_LLM_GATEWAY_API_KEY";
export const HELP_URL_ENV = "SF_LLM_GATEWAY_HELP_URL";
export const CA_BUNDLE_SOURCE_ENV = "SF_LLM_GATEWAY_CA_BUNDLE_SOURCE";

// Legacy aliases remain supported so existing automation keeps working while
// public docs and setup copy move to source-agnostic names.
export const LEGACY_BASE_URL_ENV = "SF_LLM_GATEWAY_INTERNAL_BASE_URL";
export const LEGACY_API_KEY_ENV = "SF_LLM_GATEWAY_INTERNAL_API_KEY";
export const LEGACY_HELP_URL_ENV = "SF_LLM_GATEWAY_INTERNAL_HELP_URL";
export const LEGACY_CA_BUNDLE_SOURCE_ENV = "SF_LLM_GATEWAY_INTERNAL_CA_BUNDLE_SOURCE";

// No default endpoint is shipped. Users configure their own compatible gateway
// root URL via `/sf-llm-gateway setup`; env vars are automation fallbacks when
// no saved config exists.
export const DEFAULT_BASE_URL = "";

export const DEFAULT_MODEL_ID = "gpt-5.6-sol";
export const FALLBACK_MODEL_ID = "claude-sonnet-5";

/** Previous default kept as a named constant for backward compatibility in presets. */
export const PREVIOUS_DEFAULT_MODEL_ID = "claude-opus-4-8";
// When the user turns the gateway off, switch them to a model that actually
// exists on the gateway. `openai-codex/gpt-5.5` used to be here but is not
// a published model id on the gateway; use the real GPT-5 on the openai
// provider bundled with pi instead.
export const OFF_DEFAULT_PROVIDER = "openai";
export const OFF_DEFAULT_MODEL_ID = "gpt-5";

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
  /**
   * Optional URL surfaced by the doctor as a trailing "More info" link.
   * Empty / undefined by default; users may set this to point at their own
   * gateway setup documentation.
   */
  helpUrl?: string;
  /**
   * Optional URL the `/sf-llm-gateway fix-ca-bundle` action downloads
   * from when no local CA bundle candidate is found. Saved-config wins
   * over the matching env var. Empty default — users opt in.
   */
  caBundleSource?: string;
  /**
   * Optional extra absolute paths the CA-bundle probe scans before the
   * built-in well-known list. Lets internal admins point pi at
   * non-standard install paths without code changes.
   */
  caBundleCandidates?: string[] | null;
};

export type GatewayConfig = {
  enabled: boolean;
  baseUrl?: string;
  exclusiveScope: boolean;
  baseUrlSource: ConfigSource;
  exclusiveScopeSource: Extract<ConfigSource, "saved" | "default">;
  previousDefaultProvider?: string;
  previousDefaultModel?: string;
  /** Optional doctor "More info" URL. Resolved saved > env > undefined. */
  helpUrl?: string;
  helpUrlSource: ConfigSource;
  /** Optional CA-bundle download URL for `fix-ca-bundle`. Resolved saved > env > undefined. */
  caBundleSource?: string;
  caBundleSourceSource: ConfigSource;
  /** Extra absolute paths the CA-bundle probe should scan first. Saved-config only. */
  caBundleCandidates: string[];
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

  const envBaseUrl = normalizeBaseUrl(readGatewayEnv(BASE_URL_ENV, LEGACY_BASE_URL_ENV));
  const savedBaseUrl = normalizeBaseUrl(saved.baseUrl);
  const savedExclusiveScope = asOptionalBoolean(saved.exclusiveScope);
  const baseUrl = savedBaseUrl ?? envBaseUrl ?? DEFAULT_BASE_URL;
  const optional = resolveOptionalEnvBackedValues(saved);

  return {
    enabled: saved.enabled !== false,
    baseUrl,
    exclusiveScope: savedExclusiveScope ?? false,
    baseUrlSource: savedBaseUrl ? "saved" : envBaseUrl ? "env" : "default",
    exclusiveScopeSource: savedExclusiveScope !== undefined ? "saved" : "default",
    previousDefaultProvider: saved.previousDefaultProvider,
    previousDefaultModel: saved.previousDefaultModel,
    helpUrl: optional.helpUrl,
    helpUrlSource: optional.helpUrlSource,
    caBundleSource: optional.caBundleSource,
    caBundleSourceSource: optional.caBundleSourceSource,
    caBundleCandidates: optional.caBundleCandidates,
  };
}

/**
 * Resolve the optional env-backed fields shared by getGatewayConfig and
 * getGlobalOnlyGatewayConfig: helpUrl + caBundleSource + caBundleCandidates.
 * Saved config wins over env so a stale shell export can't shadow a
 * deliberately-saved value.
 */
function resolveOptionalEnvBackedValues(saved: SavedGatewayConfig): {
  helpUrl?: string;
  helpUrlSource: ConfigSource;
  caBundleSource?: string;
  caBundleSourceSource: ConfigSource;
  caBundleCandidates: string[];
} {
  const savedHelpUrl = asOptionalString(saved.helpUrl);
  const envHelpUrl = readGatewayEnv(HELP_URL_ENV, LEGACY_HELP_URL_ENV)?.trim() || undefined;
  const savedCaSource = asOptionalString(saved.caBundleSource);
  const envCaSource =
    readGatewayEnv(CA_BUNDLE_SOURCE_ENV, LEGACY_CA_BUNDLE_SOURCE_ENV)?.trim() || undefined;
  const candidates = Array.isArray(saved.caBundleCandidates)
    ? saved.caBundleCandidates.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  return {
    helpUrl: savedHelpUrl ?? envHelpUrl,
    helpUrlSource: savedHelpUrl ? "saved" : envHelpUrl ? "env" : "missing",
    caBundleSource: savedCaSource ?? envCaSource,
    caBundleSourceSource: savedCaSource ? "saved" : envCaSource ? "env" : "missing",
    caBundleCandidates: candidates,
  };
}

/**
 * Global-only config resolution for the factory phase before session_start.
 * Reads env vars and the global Pi agent saved config but not the project-level
 * config (which requires a session cwd).
 */
export function getGlobalOnlyGatewayConfig(): GatewayConfig {
  const saved = readGatewaySavedConfig(globalGatewayConfigPath());

  const envBaseUrl = normalizeBaseUrl(readGatewayEnv(BASE_URL_ENV, LEGACY_BASE_URL_ENV));
  const savedBaseUrl = normalizeBaseUrl(saved.baseUrl);
  const savedExclusiveScope = asOptionalBoolean(saved.exclusiveScope);
  const baseUrl = savedBaseUrl ?? envBaseUrl ?? DEFAULT_BASE_URL;
  const optional = resolveOptionalEnvBackedValues(saved);

  return {
    enabled: saved.enabled !== false,
    baseUrl,
    exclusiveScope: savedExclusiveScope ?? false,
    baseUrlSource: savedBaseUrl ? "saved" : envBaseUrl ? "env" : "default",
    exclusiveScopeSource: savedExclusiveScope !== undefined ? "saved" : "default",
    previousDefaultProvider: saved.previousDefaultProvider,
    previousDefaultModel: saved.previousDefaultModel,
    helpUrl: optional.helpUrl,
    helpUrlSource: optional.helpUrlSource,
    caBundleSource: optional.caBundleSource,
    caBundleSourceSource: optional.caBundleSourceSource,
    caBundleCandidates: optional.caBundleCandidates,
  };
}

export function readGatewayEnv(primaryName: string, legacyName?: string): string | undefined {
  const primary = process.env[primaryName];
  if (primary !== undefined) return primary;
  return legacyName ? process.env[legacyName] : undefined;
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
      baseUrl: normalizeBaseUrl(asOptionalString(record.baseUrl)),
      apiKey: asOptionalString(record.apiKey),
      exclusiveScope: asOptionalBoolean(record.exclusiveScope),
      previousEnabledModels: asOptionalStringArrayOrNull(record.previousEnabledModels),
      previousDefaultProvider: asOptionalString(record.previousDefaultProvider),
      previousDefaultModel: asOptionalString(record.previousDefaultModel),
      helpUrl: asOptionalString(record.helpUrl),
      caBundleSource: asOptionalString(record.caBundleSource),
      caBundleCandidates: asOptionalStringArrayOrNull(record.caBundleCandidates),
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
    if (url.username || url.password) {
      return undefined;
    }
    return toGatewayRootBaseUrl(url.toString().replace(/\/$/, ""));
  } catch {
    return undefined;
  }
}

export function describeConfigValue(value: string | undefined, source: ConfigSource): string {
  if (!value) {
    return "missing";
  }
  return `${value} (${source})`;
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
