/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Model catalog, discovery, inference, and formatting for the SF LLM Gateway.
 *
 * Design note — why Claude carries an internal `api: "anthropic-messages"`
 * tag:
 *
 * The gateway exposes Claude on both `/v1/chat/completions` (LiteLLM's
 * OpenAI-compat translator) and `/v1/messages` (native Anthropic Messages).
 * The OpenAI-compat path is fragile for Claude: adaptive thinking, multi-choice
 * streaming, and prompt caching get mis-shaped and occasionally drop the final
 * text delta, producing empty assistant turns that force the user to type
 * "continue". Pi-ai has a first-class Anthropic transport that handles all of
 * that natively.
 *
 * In the unified single-provider design, this file still tags Claude with the
 * desired transport for internal routing, but `lib/discovery.ts` strips that
 * tag before handing models to pi. If pi sees a per-model anthropic api, it
 * bypasses our provider-level `streamSimple` dispatcher and appends
 * `/v1/messages` to the provider's OpenAI baseUrl (`<gateway>/v1`), producing
 * `<gateway>/v1/v1/messages`. The dispatcher instead detects Claude by id,
 * clones the model to Anthropic internally, and rewrites baseUrl to the
 * gateway root.
 *
 * Non-Claude families (Gemini, GPT, Codex) stay on OpenAI-compat.
 *
 * This file is pure data + pure functions — no mutable runtime state.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MODEL_ID, FALLBACK_MODEL_ID, PREVIOUS_DEFAULT_MODEL_ID } from "./config.ts";

import {
  isGpt5BedrockResponsesModelId,
  isGpt56BedrockResponsesModelId,
  isGpt56FamilyResponsesModelId,
  isGpt5FamilyResponsesModelId,
  isGpt55ModelId,
  isOpus46OrNewerModelId,
  isOpus47OrNewerModelId,
} from "./transport.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

// Model-discovery timeouts and id-validation regex live in
// `./models-internal/fetchers.ts`, next to the fetchers that consume them.

// Bootstrap defaults + the static catalog live in `./models-internal/presets.ts`.
// Imported here under the same names so internal callers in this file
// (buildBootstrapModelList, getModelMetadata, getActiveModelDefinition,
// getShortModelLabel) keep referring to the same symbols, and re-exported
// below so external consumers see them at this module's surface.
import { ALWAYS_INCLUDE_MODEL_IDS, MODEL_PRESETS } from "./models-internal/presets.ts";
export { ALWAYS_INCLUDE_MODEL_IDS, MODEL_PRESETS };

export function getStaticGatewayModelIds(): string[] {
  return sortModelIds([...new Set([...ALWAYS_INCLUDE_MODEL_IDS, ...Object.keys(MODEL_PRESETS)])]);
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

// -------------------------------------------------------------------------------------------------
// OpenAI-compat compat blocks (Gemini / GPT / Codex)
// -------------------------------------------------------------------------------------------------
//
// `supportsStore: false` everywhere — LiteLLM rejects the OpenAI `store` field
// when it proxies to Bedrock or Anthropic. Keeping it off also silences the
// noisy LiteLLM warning for gateways that ignore it entirely.

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

const CODEX_OPENAI_COMPAT: ProviderModelConfig["compat"] = {
  ...BASE_OPENAI_COMPAT,
  supportsReasoningEffort: true,
};

/**
 * Codex thinking-level mapping.
 *
 * Moved from `compat.reasoningEffortMap` to model-level `thinkingLevelMap`
 * for pi >= 0.72 (pi-mono #3208). LiteLLM's Codex path accepts
 * low/medium/high/max, so `minimal` clamps to low while Pi's `xhigh` and
 * `max` selectors map to the live-proven strongest `max` tier. Every mapped
 * level is a string (not null) because those selector levels remain visible.
 */
const CODEX_THINKING_LEVEL_MAP: ProviderModelConfig["thinkingLevelMap"] = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max",
};

// Opus 4.7 thinking-level map lives in `./models-internal/presets.ts` next
// to the model entries that consume it.

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type GatewayModelFamily =
  "anthropic" | "google" | "openai" | "codex" | "deepseek" | "unknown";

export type GatewayModelDefinition = {
  id: string;
  family: GatewayModelFamily;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  /**
   * Optional thinking-level map forwarded to the registered pi model.
   *
   * Use cases:
   *  - Expose `xhigh` or `max` on a reasoning model that supports it (pi hides
   *    advanced levels unless an explicit mapping is present; see
   *    `getSupportedThinkingLevels` in pi-ai which uses `mapped !== undefined`
   *    as the opt-in check).
   *  - Collapse unsupported levels onto a gateway-accepted value with a
   *    string mapping, or hide/skip them entirely with `null`.
   *
   * Keep this map minimal: unset keys fall back to the provider's default
   * mapping in pi-ai's transport (`mapThinkingLevelToEffort` for
   * anthropic-messages, `reasoning_effort` passthrough for
   * openai-completions). Only list levels that need a non-default value.
   */
  thinkingLevelMap?: ProviderModelConfig["thinkingLevelMap"];
};

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
  /** LiteLLM's idea of the upstream provider, e.g. "openai", "bedrock_converse", "gemini". */
  litellmProvider?: string;
  /** Max input tokens advertised by the gateway. May be stale/low for some models. */
  maxInputTokens?: number;
  /** Max output tokens advertised by the gateway. Usually reliable. */
  maxOutputTokens?: number;
  /** Dollars per input token. Multiply by 1M for $/M-tokens display. */
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  /** Cost per cache-read input token (Anthropic prompt caching, etc.). */
  cacheReadCostPerToken?: number;
  /** Cost per cache-creation input token (Anthropic prompt caching writes). */
  cacheWriteCostPerToken?: number;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  supportsFunctionCalling?: boolean;
  supportsPromptCaching?: boolean;
  rpm?: number;
  tpm?: number;
}

/**
 * Enrichment map built from `/v1/model/info`. Discovery passes this to
 * `buildDiscoveredModelList` so per-model pricing and capability flags can
 * override inference defaults when a preset does not already cover the model.
 */
export type GatewayModelInfoMap = Record<string, GatewayModelInfo>;

/**
 * Per-model-group metadata from `/model_group/info`. Complements
 * `/v1/model/info` with the upstream `providers` array — the list of cloud
 * providers the gateway admin has registered behind a given model group.
 * The extension snapshots this at session_start and watches for drift so a
 * silent admin reroute (e.g. adding an `anthropic` backing to a group that
 * was `bedrock`-only) can be surfaced in the status report.
 */
export interface GatewayModelGroupInfo {
  modelGroup: string;
  providers: string[];
}

export type GatewayModelGroupInfoMap = Record<string, GatewayModelGroupInfo>;

// MODEL_PRESETS source of truth lives in `./models-internal/presets.ts`
// and is re-exported above next to ALWAYS_INCLUDE_MODEL_IDS.

// -------------------------------------------------------------------------------------------------
// Model list building
// -------------------------------------------------------------------------------------------------

/**
 * A gateway model tagged with the transport it should use. This tag is
 * internal to the extension: `lib/discovery.ts` strips it before registering
 * the model with pi, then `streamSimple` routes by model id at request time.
 */
export type TaggedGatewayModel = ProviderModelConfig & {
  api: "openai-completions" | "anthropic-messages" | "openai-responses";
};

export function shouldForceAdaptiveThinking(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return (
    isOpus46OrNewerModelId(modelId) ||
    lower.includes("sonnet-4-6") ||
    lower.includes("sonnet-4.6") ||
    lower.includes("sonnet-5")
  );
}

/**
 * Map pi's thinking scale to the live-proven GPT-5.5 Responses window.
 * Live probe on 2026-07-12 showed this route rejects wire `max` but accepts
 * wire `xhigh`, so Pi's `max` and `xhigh` both map to `xhigh`. `minimal`
 * still clamps upward because the upstream Responses API rejects it here.
 */
export const GPT55_RESPONSES_THINKING_LEVEL_MAP: ProviderModelConfig["thinkingLevelMap"] = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
};

/**
 * Clamp pi's thinking scale for gpt-5 / gpt-5-mini on the Responses
 * API. Upstream OpenAI supports `minimal | low | medium | high` here but
 * rejects `xhigh` (verified live) — so pi's `xhigh` must clamp to `high`.
 * `minimal` passes straight through, unlike gpt-5.5 which requires clamping
 * up because its LiteLLM / upstream windows do not overlap on `minimal`.
 */
export const GPT5_RESPONSES_THINKING_LEVEL_MAP: ProviderModelConfig["thinkingLevelMap"] = {
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
};

/** Live-proven GPT-5.6 Responses map for non-Bedrock gateway routes. */
export const GPT56_RESPONSES_THINKING_LEVEL_MAP: ProviderModelConfig["thinkingLevelMap"] = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/**
 * GPT-5.6 Bedrock Responses map. Live probes reject `minimal`; `low` showed
 * route instability, so low-end selectors clamp to medium while xhigh/max
 * remain available because the route accepted them.
 */
export const GPT56_BEDROCK_RESPONSES_THINKING_LEVEL_MAP: ProviderModelConfig["thinkingLevelMap"] = {
  minimal: "medium",
  low: "medium",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/**
 * Conservative map for older GPT-5 Bedrock Responses model IDs. Live probes
 * show `high` is the stable common effort tier for these routes, while lower
 * efforts can fail before the model responds. Keep this strict until the
 * gateway advertises or proves broader support.
 */
export const GPT5_BEDROCK_RESPONSES_THINKING_LEVEL_MAP: ProviderModelConfig["thinkingLevelMap"] = {
  minimal: "high",
  low: "high",
  medium: "high",
  high: "high",
  xhigh: "high",
};

/**
 * Build the startup bootstrap catalog only.
 *
 * These IDs are local fallback presets so Pi can resolve gateway defaults and
 * keep curated models selectable when live discovery is unavailable or returns
 * only non-callable sentinels. Once discovery succeeds, the provider is
 * re-registered with the exact gateway model IDs instead of this bootstrap.
 */
export function buildBootstrapModelList(): TaggedGatewayModel[] {
  return getStaticGatewayModelIds().map((id) => toProviderModelConfig(id));
}

/**
 * Build the post-discovery catalog using only model IDs the gateway actually
 * returned. Stale preset aliases will not appear in the selector.
 *
 * The optional `modelInfoMap` supplies per-model metadata pulled from
 * `/v1/model/info`. When a model has no preset and the inference defaults are
 * missing or wrong, we fall back to the gateway's numbers. Presets always win
 * because we have verified cases where the gateway's own metadata is stale
 * (e.g. LiteLLM reports Claude `max_input_tokens=200000` while the upstream
 * Bedrock deployment actually serves 1M).
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

export function toProviderModelConfig(id: string, info?: GatewayModelInfo): TaggedGatewayModel {
  const preset = MODEL_PRESETS[id];
  const hasPreset = Boolean(preset);
  const def = preset ? { id, ...preset } : inferModelDefinition(id);

  // Apply /v1/model/info enrichment ONLY when we do not have a preset. Our
  // presets are hand-tuned and already know, for example, that Opus 4.7 runs
  // at 1M context even though LiteLLM's metadata says 200K.
  if (!hasPreset && info) {
    if (typeof info.maxInputTokens === "number" && info.maxInputTokens > 0) {
      def.contextWindow = info.maxInputTokens;
    }
    if (typeof info.maxOutputTokens === "number" && info.maxOutputTokens > 0) {
      def.maxTokens = info.maxOutputTokens;
    }
    if (typeof info.supportsReasoning === "boolean") {
      def.reasoning = info.supportsReasoning;
    }
    if (info.supportsVision === false) {
      def.input = ["text"];
    } else if (info.supportsVision === true && !def.input.includes("image")) {
      def.input = [...def.input, "image"];
    }
  }

  if (def.family === "anthropic") {
    // Native Anthropic Messages path — pi-ai handles adaptive thinking,
    // prompt caching, tool-input streaming compatibility, and multi-block
    // streaming natively. SF Pi no longer sends Gateway-owned Anthropic beta
    // headers; live probes showed current Gateway Claude routes work without
    // them for small prompts, max thinking, and tool calls.
    const compat: NonNullable<ProviderModelConfig["compat"]> = {
      ...(shouldForceAdaptiveThinking(def.id) ? { forceAdaptiveThinking: true } : {}),
      // Haiku 4.5 rejects per-tool `eager_input_streaming`. Setting this
      // AnthropicMessagesCompat flag to false makes pi-ai (1) drop the
      // per-tool field entirely and (2) auto-attach the legacy
      // `fine-grained-tool-streaming-2025-05-14` beta header on tool-enabled
      // requests, which is the streaming path Haiku 4.5 accepts. Opus and
      // Sonnet still accept eager streaming, so we leave the flag undefined
      // there to keep pi-ai on its default fast path.
      ...(isHaiku45ModelId(def.id) ? { supportsEagerToolInputStreaming: false } : {}),
    };

    return {
      id: def.id,
      name: def.name,
      api: "anthropic-messages",
      reasoning: def.reasoning,
      input: def.input,
      cost: { ...ZERO_COST },
      contextWindow: def.contextWindow,
      maxTokens: def.maxTokens,
      // Forward model-specific thinking opt-ins so Pi's `/thinking`
      // selector exposes only gateway-proven levels.
      ...(def.thinkingLevelMap ? { thinkingLevelMap: def.thinkingLevelMap } : {}),
      ...(Object.keys(compat).length > 0 ? { compat } : {}),
    };
  }

  const isCodex = def.family === "codex";
  const isGpt55 = isGpt55ModelId(def.id);
  const isGpt56Family = isGpt56FamilyResponsesModelId(def.id);
  const isGpt5Family = isGpt5FamilyResponsesModelId(def.id);
  const compat = isCodex ? CODEX_OPENAI_COMPAT : COMMON_OPENAI_COMPAT;

  // Non-Codex gpt-5 family models route through the OpenAI Responses API
  // (`POST /responses` on this gateway; `/v1/responses` is SSO-only). The
  // working reasoning.effort window is model-specific:
  //   - gpt-5 / gpt-5-mini: minimal | low | medium | high  (xhigh → high)
  //   - gpt-5.5:            low | medium | high | xhigh    (minimal → low,
  //                                                         Pi max → xhigh)
  //   - gpt-5.6:            low | medium | high | xhigh | max
  //   - older gpt-5 Bedrock: high only                     (all levels → high)
  // The internal api tag is stripped before pi registers the model so pi
  // still calls the provider-level `streamSimple` hook; the dispatcher
  // reads the id to pick the right shim.
  if (isGpt5Family) {
    return {
      id: def.id,
      name: def.name,
      api: "openai-responses",
      reasoning: def.reasoning,
      input: def.input,
      cost: { ...ZERO_COST },
      contextWindow: def.contextWindow,
      maxTokens: def.maxTokens,
      compat,
      thinkingLevelMap: isGpt56BedrockResponsesModelId(def.id)
        ? GPT56_BEDROCK_RESPONSES_THINKING_LEVEL_MAP
        : isGpt56Family
          ? GPT56_RESPONSES_THINKING_LEVEL_MAP
          : isGpt5BedrockResponsesModelId(def.id)
            ? GPT5_BEDROCK_RESPONSES_THINKING_LEVEL_MAP
            : isGpt55
              ? GPT55_RESPONSES_THINKING_LEVEL_MAP
              : GPT5_RESPONSES_THINKING_LEVEL_MAP,
    };
  }

  return {
    id: def.id,
    name: def.name,
    api: "openai-completions",
    reasoning: def.reasoning,
    input: def.input,
    cost: { ...ZERO_COST },
    contextWindow: def.contextWindow,
    maxTokens: def.maxTokens,
    compat,
    // thinkingLevelMap is model-level in pi >= 0.72; it replaces the old
    // compat.reasoningEffortMap that was silently dropped in 0.72.
    ...(isCodex ? { thinkingLevelMap: CODEX_THINKING_LEVEL_MAP } : {}),
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

  if (availableIds.includes(preferredId)) {
    return preferredId;
  }

  const normalizedPreferredId = normalizeComparableModelId(preferredId);
  const normalizedMatches = availableIds.filter(
    (availableId) => normalizeComparableModelId(availableId) === normalizedPreferredId,
  );

  return sortModelIds(normalizedMatches)[0];
}

export function getModelFamily(id: string): GatewayModelFamily {
  const lower = id.toLowerCase();

  if (lower.includes("codex")) return "codex";
  if (isAnthropicModelId(id)) return "anthropic";
  if (lower.includes("gemini") || lower.startsWith("google/")) return "google";
  if (lower.includes("deepseek") || lower.startsWith("deepseek/")) return "deepseek";
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

/**
 * True for Claude Haiku 4.5 variants. Haiku 4.5 rejects the per-tool
 * `eager_input_streaming` field that pi-ai's Anthropic transport emits
 * by default; matching this id pattern lets us flip the AnthropicMessagesCompat
 * override that switches pi-ai onto the legacy tool-streaming compatibility
 * path. Opus / Sonnet still accept eager streaming, so the override
 * stays scoped to Haiku 4.5.
 *
 * Matches both dash and dot spellings, dated suffixes, and Bedrock-prefixed
 * ids (e.g. `claude-haiku-4-5`, `claude-haiku-4.5`,
 * `claude-haiku-4-5-20251001`, `anthropic.claude-haiku-4.5`,
 * `us.anthropic.claude-haiku-4-5-v1`).
 */
export function isHaiku45ModelId(id: string): boolean {
  const lower = id.toLowerCase();
  return lower.includes("haiku-4-5") || lower.includes("haiku-4.5");
}

/** Infer reasonable defaults for a gateway model ID that has no preset. */
export function inferModelDefinition(id: string): GatewayModelDefinition {
  const lower = id.toLowerCase();
  const family = getModelFamily(id);

  if (family === "google") {
    return {
      id,
      family,
      name: `[SF LLM Gateway] ${id}`,
      reasoning: lower.includes("2.5") || lower.includes("3"),
      input: ["text", "image"],
      contextWindow: 1_000_000,
      maxTokens: lower.includes("2.0-flash") ? 8_192 : 65_536,
    };
  }

  if (family === "codex") {
    return {
      id,
      family,
      name: `[SF LLM Gateway] ${id}`,
      reasoning: true,
      input: ["text"],
      contextWindow: 272_000,
      maxTokens: 128_000,
    };
  }

  if (family === "deepseek") {
    return {
      id,
      family,
      name: `[SF LLM Gateway] ${id}`,
      reasoning: lower.includes("r1") || lower.includes("reason"),
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 32_768,
    };
  }

  if (family === "openai") {
    const isGpt5 = lower.includes("gpt-5");
    const is4o = lower.includes("4o");
    return {
      id,
      family,
      name: `[SF LLM Gateway] ${id}`,
      reasoning: isGpt5,
      input: ["text", "image"],
      // GPT-5 family: 272K/128K confirmed on the gateway.
      // GPT-4o family: 128K/16K.
      contextWindow: is4o ? 128_000 : isGpt5 ? 272_000 : 200_000,
      maxTokens:
        is4o || lower.includes("mini") ? (isGpt5 ? 128_000 : 16_384) : isGpt5 ? 128_000 : 32_768,
    };
  }

  if (family === "anthropic") {
    const isOpus = lower.includes("opus");
    const isHaiku = lower.includes("haiku");
    const is47OrNewer = isOpus47OrNewerModelId(id);
    const is46OrNewer =
      isOpus46OrNewerModelId(id) || lower.includes("4-6") || lower.includes("4.6");
    const has1m = is46OrNewer && isOpus;
    const reasoning =
      !isHaiku &&
      (lower.includes("opus") ||
        lower.includes("sonnet-4") ||
        lower.includes("3-7-sonnet") ||
        is46OrNewer);

    // Opus 4.7+ output: 128K confirmed stable via live probes (May 2026).
    // Older Opus with 1M context (4.6) also gets 128K. Others get 32K/64K.
    const maxTokens = isHaiku
      ? 8_192
      : isOpus
        ? is47OrNewer
          ? 128_000
          : has1m
            ? 128_000
            : 32_768
        : 64_000;

    return {
      id,
      family,
      name: `[SF LLM Gateway] ${id}`,
      reasoning,
      input: ["text", "image"],
      contextWindow: has1m ? 1_000_000 : 200_000,
      maxTokens,
    };
  }

  return {
    id,
    family,
    name: `[SF LLM Gateway] ${id}`,
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 16_384,
  };
}

export function getActiveModelDefinition(
  modelId: string | undefined,
  discoveredModelIds?: string[],
): GatewayModelDefinition | undefined {
  if (!modelId) return undefined;
  const preset = MODEL_PRESETS[modelId];
  if (preset) return { id: modelId, ...preset };
  if (discoveredModelIds?.includes(modelId)) return inferModelDefinition(modelId);
  return undefined;
}

// -------------------------------------------------------------------------------------------------
// Model discovery (network)
// -------------------------------------------------------------------------------------------------

export {
  fetchGatewayModelGroupInfo,
  fetchGatewayModelIdDiscovery,
  fetchGatewayModelIds,
  fetchGatewayModelInfoMap,
  fetchWithTimeout,
  diffModelGroupProviders,
  type GatewayModelIdDiscovery,
  type ModelGroupDrift,
} from "./models-internal/fetchers.ts";

// -------------------------------------------------------------------------------------------------
// Formatting helpers
// -------------------------------------------------------------------------------------------------

export function getShortModelLabel(modelId: string): string {
  if (modelId === DEFAULT_MODEL_ID) {
    return "GPT-5.6 Sol [1M]";
  }
  if (modelId === PREVIOUS_DEFAULT_MODEL_ID) {
    return "Opus 4.8 [1M]";
  }
  if (modelId === "claude-opus-4-7" || modelId === "claude-opus-4-7-v1") {
    return "Opus 4.7 [1M]";
  }
  if (modelId === "claude-opus-4-6-v1") {
    return "Opus 4.6 [1M]";
  }
  if (modelId === FALLBACK_MODEL_ID) {
    return "Sonnet 5";
  }

  const preset = MODEL_PRESETS[modelId];
  if (preset) {
    return preset.name.replace(/^\[SF LLM Gateway\]\s*/, "");
  }

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
  if (value >= 1000) {
    return `$${value.toFixed(0)}`;
  }
  return `$${value.toFixed(2)}`;
}

// -------------------------------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------------------------------

export function sortModelIds(ids: string[]): string[] {
  const rank = (id: string): number => {
    if (id === DEFAULT_MODEL_ID) return 0;
    if (id === PREVIOUS_DEFAULT_MODEL_ID) return 1;
    if (id === FALLBACK_MODEL_ID) return 2;

    const family = getModelFamily(id);
    const lower = id.toLowerCase();

    if (family === "anthropic") {
      if (lower.includes("opus")) return 2;
      if (lower.includes("sonnet")) return 3;
      return 4;
    }
    if (family === "google") {
      if (lower.includes("pro")) return 5;
      if (lower.includes("flash")) return 6;
      return 7;
    }
    if (family === "codex") return 8;
    if (family === "openai") return 9;
    return 10;
  };

  return [...ids].sort((a, b) => {
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.localeCompare(b);
  });
}

function normalizeComparableModelId(id: string): string {
  return id
    .toLowerCase()
    .replace(/^(?:us\.)?anthropic\./, "")
    .replace(/-\d{8}$/, "")
    .replace(/-v\d+$/, "");
}
