/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Model catalog, discovery, inference, and formatting for the SF LLM Gateway.
 *
 * Authenticated discovery supplies model IDs and neutral capability metadata.
 * Broad public family inference selects a generic protocol only when discovery
 * does not provide an explicit API mode. Exact route aliases, backend placement,
 * and deployment-specific capability policy do not belong in this module.
 *
 * The only module state is a process-local cache of Pi's immutable built-in catalog.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

// Model-discovery timeouts and id-validation regex live in
// `./models-internal/fetchers.ts`, next to the fetchers that consume them.

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
const MAX_INHERITED_CONTEXT_WINDOW = 1_000_000;
const GATEWAY_APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);

// -------------------------------------------------------------------------------------------------
// Conservative OpenAI-compatible defaults
// -------------------------------------------------------------------------------------------------

const BASE_OPENAI_COMPAT: ProviderModelConfig["compat"] = {
  supportsStore: false,
  supportsUsageInStreaming: true,
  maxTokensField: "max_tokens",
  supportsDeveloperRole: false,
};

const COMMON_OPENAI_COMPAT: ProviderModelConfig["compat"] = {
  ...BASE_OPENAI_COMPAT,
  supportsReasoningEffort: false,
};

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type GatewayModelFamily =
  "anthropic" | "google" | "openai" | "codex" | "deepseek" | "xai" | "unknown";

export type GatewayModelDefinition = {
  id: string;
  family: GatewayModelFamily;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
};

export type PiModelReference = Pick<
  Model<Api>,
  "id" | "name" | "api" | "reasoning" | "input" | "contextWindow" | "maxTokens" | "thinkingLevelMap"
>;

/**
 * Per-model metadata fetched from the gateway's `/v1/model/info` endpoint.
 * Every field is optional because LiteLLM can mark a model partial, and pure
 * functions should not assume any field is present.
 *
 * Only the subset the extension actually uses is surfaced here.
 */
export interface GatewayModelInfo {
  id: string;
  mode?: "chat" | "responses" | string;
  /** Max input tokens advertised by the gateway. May be stale/low for some models. */
  maxInputTokens?: number;
  /** Max output tokens advertised by the gateway. Usually reliable. */
  maxOutputTokens?: number;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
}

/**
 * Enrichment map built from `/v1/model/info`. Discovery passes this to
 * `buildDiscoveredModelList` so per-model pricing and capability flags can
 * override generic family inference when the gateway reports the field.
 */
export type GatewayModelInfoMap = Record<string, GatewayModelInfo>;

// -------------------------------------------------------------------------------------------------
// Model list building
// -------------------------------------------------------------------------------------------------

/**
 * A gateway model tagged with the real API transport used by Pi's complete
 * Provider API map.
 */
export type TaggedGatewayModel = ProviderModelConfig & {
  api: "openai-completions" | "anthropic-messages" | "openai-responses";
};

let piModelCatalog: PiModelReference[] | undefined;

function getPiModelReferences(id: string): PiModelReference[] {
  piModelCatalog ??= getBuiltinProviders().flatMap(
    (provider) => getBuiltinModels(provider) as readonly Model<Api>[],
  );
  return piModelCatalog.filter((model) => model.id === id);
}

function selectReference(models: readonly PiModelReference[]): PiModelReference | undefined {
  return [...models].sort(
    (a, b) =>
      b.contextWindow - a.contextWindow ||
      b.maxTokens - a.maxTokens ||
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name),
  )[0];
}

function isGatewayApi(api: string): api is TaggedGatewayModel["api"] {
  return GATEWAY_APIS.has(api);
}

/**
 * Build the post-discovery catalog using only model IDs the gateway actually
 * returned. Undiscovered aliases will not appear in the selector.
 *
 * The optional `modelInfoMap` supplies per-model metadata pulled from
 * `/v1/model/info`. Generic family inference fills only fields the gateway
 * does not report; the repository carries no exact-ID model catalog.
 */
export function buildDiscoveredModelList(
  discoveredIds: string[],
  modelInfoMap?: GatewayModelInfoMap,
): TaggedGatewayModel[] {
  const uniqueDiscoveredIds = [...new Set(discoveredIds)];
  return sortModelIds(uniqueDiscoveredIds).map((id) =>
    toProviderModelConfig(id, modelInfoMap?.[id]),
  );
}

export function toProviderModelConfig(
  id: string,
  info?: GatewayModelInfo,
  references: readonly PiModelReference[] = getPiModelReferences(id),
): TaggedGatewayModel {
  const def = inferModelDefinition(id);
  const reference = selectReference(references);
  const apiReference = selectReference(
    references.filter((candidate) => isGatewayApi(candidate.api)),
  );

  if (reference) {
    def.name = `[SF LLM Gateway] ${reference.name}`;
    def.reasoning = reference.reasoning;
    def.input = [...reference.input];
    def.contextWindow = Math.min(reference.contextWindow, MAX_INHERITED_CONTEXT_WINDOW);
    def.maxTokens = reference.maxTokens;
  }

  if (info) {
    if (typeof info.maxInputTokens === "number" && info.maxInputTokens > 0) {
      def.contextWindow = info.maxInputTokens;
    }
    if (typeof info.maxOutputTokens === "number" && info.maxOutputTokens > 0) {
      def.maxTokens = info.maxOutputTokens;
    }
    if (typeof info.supportsReasoning === "boolean") {
      def.reasoning = info.supportsReasoning;
    }
    if (info.supportsVision === true) {
      def.input = ["text", "image"];
    } else if (info.supportsVision === false) {
      def.input = ["text"];
    }
  }

  def.contextWindow = Math.min(def.contextWindow, MAX_INHERITED_CONTEXT_WINDOW);

  const api =
    info?.mode === "responses"
      ? "openai-responses"
      : def.family === "xai"
        ? "openai-completions"
        : apiReference && isGatewayApi(apiReference.api)
          ? apiReference.api
          : def.family === "anthropic"
            ? "anthropic-messages"
            : "openai-completions";

  const thinkingLevelMap = def.reasoning ? reference?.thinkingLevelMap : undefined;

  return {
    id: def.id,
    name: def.name,
    api,
    reasoning: def.reasoning,
    input: def.input,
    cost: { ...ZERO_COST },
    contextWindow: def.contextWindow,
    maxTokens: def.maxTokens,
    ...(thinkingLevelMap ? { thinkingLevelMap: { ...thinkingLevelMap } } : {}),
    ...(api === "openai-completions" || api === "openai-responses"
      ? { compat: COMMON_OPENAI_COMPAT }
      : {}),
  };
}

// -------------------------------------------------------------------------------------------------
// Model inference + identification
// -------------------------------------------------------------------------------------------------

export function resolvePreferredModelId(
  availableIds: string[],
  preferredIds: Array<string | undefined>,
): string | undefined {
  for (const preferredId of preferredIds) {
    const match = findMatchingModelId(preferredId, availableIds);
    if (match) {
      return match;
    }
  }

  return sortModelIds(availableIds)[0];
}

export function findMatchingModelId(
  preferredId: string | undefined,
  availableIds: string[],
): string | undefined {
  if (!preferredId) {
    return undefined;
  }

  return availableIds.includes(preferredId) ? preferredId : undefined;
}

export function getModelFamily(id: string): GatewayModelFamily {
  const lower = id.toLowerCase();

  if (lower.includes("codex")) return "codex";
  if (isAnthropicModelId(id)) return "anthropic";
  if (lower.includes("gemini") || lower.startsWith("google/")) return "google";
  if (lower.includes("deepseek") || lower.startsWith("deepseek/")) return "deepseek";
  if (lower.includes("grok") || lower.startsWith("xai/")) return "xai";
  if (
    lower.startsWith("gpt-") ||
    lower.includes("/gpt-") ||
    lower.startsWith("openai/") ||
    lower.includes("chatgpt")
  ) {
    return "openai";
  }
  return "unknown";
}

/** Returns true if a model ID looks like an Anthropic/Claude model. */
export function isAnthropicModelId(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes("claude") || lower.startsWith("us.anthropic.") || lower.startsWith("anthropic.")
  );
}

/** Conservative defaults used only when Pi and discovery omit neutral metadata. */
export function inferModelDefinition(id: string): GatewayModelDefinition {
  return {
    id,
    family: getModelFamily(id),
    name: `[SF LLM Gateway] ${id}`,
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}

export function getActiveModelDefinition(
  modelId: string | undefined,
  discoveredModelIds?: string[],
): GatewayModelDefinition | undefined {
  if (!modelId || !discoveredModelIds?.includes(modelId)) return undefined;
  const model = toProviderModelConfig(modelId);
  return {
    id: model.id,
    family: getModelFamily(model.id),
    name: model.name,
    reasoning: model.reasoning,
    input: [...model.input],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

// -------------------------------------------------------------------------------------------------
// Model discovery (network)
// -------------------------------------------------------------------------------------------------

export {
  fetchGatewayModelIdDiscovery,
  fetchGatewayModelIds,
  fetchGatewayModelInfoMap,
  fetchWithTimeout,
  GatewayModelDiscoveryError,
  type GatewayModelIdDiscovery,
} from "./models-internal/fetchers.ts";

// -------------------------------------------------------------------------------------------------
// Formatting helpers
// -------------------------------------------------------------------------------------------------

export function getShortModelLabel(modelId: string): string {
  return modelId;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(value)}`;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return "$0.00";
  }
  if (value > 0 && value < 0.01) {
    return "<$0.01";
  }
  if (value >= 1000) {
    return `$${value.toFixed(0)}`;
  }
  return `$${value.toFixed(2)}`;
}

// -------------------------------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------------------------------

export function sortModelIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}
