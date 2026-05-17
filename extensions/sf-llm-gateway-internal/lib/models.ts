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
  ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA,
  isGpt5FamilyResponsesModelId,
  isGpt55ModelId,
} from "./transport.ts";

// -------------------------------------------------------------------------------------------------
// Anthropic beta headers
// -------------------------------------------------------------------------------------------------
//
// These are still exposed so the `/sf-llm-gateway-internal beta` command and
// the status report keep working. The values are forwarded as an
// `anthropic-beta` request header on Claude models. Pi-ai passes custom
// model.headers through to the Anthropic SDK, so this keeps working under the
// native Anthropic Messages path.

export const ONE_M_CONTEXT_BETA = "context-1m-2025-08-07";
export const OUTPUT_128K_BETA = "output-128k-2025-02-19";
export const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
export const PROMPT_CACHING_BETA = "prompt-caching-2024-07-31";
export const CONTEXT_MANAGEMENT_BETA = "context-management-2025-06-27";
export const EFFORT_BETA = "effort-2025-11-24";
export const PROMPT_CACHING_SCOPE_BETA = "prompt-caching-scope-2026-01-05";
export const COMPACT_BETA = "compact-2026-01-12";

/**
 * Anthropic betas that are part of the extension's model-default behavior.
 * Opus 4.7 is GA and needs none; older reasoning Claudes still benefit from
 * interleaved-thinking. Runtime commands/env can inject more on top.
 */
export const DEFAULT_ANTHROPIC_BETA_HEADERS = [
  ONE_M_CONTEXT_BETA,
  OUTPUT_128K_BETA,
  INTERLEAVED_THINKING_BETA,
] as const;

/** All known beta headers with short aliases for the toggle command. */
export const KNOWN_BETAS: ReadonlyArray<{ value: string; aliases: string[] }> = [
  { value: ONE_M_CONTEXT_BETA, aliases: ["context-1m", "1m"] },
  { value: OUTPUT_128K_BETA, aliases: ["output-128k", "128k"] },
  { value: INTERLEAVED_THINKING_BETA, aliases: ["interleaved-thinking", "interleaved"] },
  { value: PROMPT_CACHING_BETA, aliases: ["prompt-caching", "cache"] },
  { value: CONTEXT_MANAGEMENT_BETA, aliases: ["context-management"] },
  { value: EFFORT_BETA, aliases: ["effort"] },
  { value: PROMPT_CACHING_SCOPE_BETA, aliases: ["prompt-caching-scope", "cache-scope"] },
  { value: COMPACT_BETA, aliases: ["compact"] },
];

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
 * for pi >= 0.72 (pi-mono #3208). LiteLLM's Codex path only accepts
 * low/medium/high, so we collapse the two pi levels the gateway rejects
 * (`minimal` and `xhigh`) onto the nearest supported value. Every level is a
 * string (not null) because we still want all five pi levels to appear in
 * the selector and cycle — they just all resolve to one of three gateway
 * values.
 */
const CODEX_THINKING_LEVEL_MAP: ProviderModelConfig["thinkingLevelMap"] = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
};

// Opus 4.7 thinking-level map lives in `./models-internal/presets.ts` next
// to the model entries that consume it.

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type GatewayModelFamily =
  | "anthropic"
  | "google"
  | "openai"
  | "codex"
  | "deepseek"
  | "unknown";

export type GatewayModelDefinition = {
  id: string;
  family: GatewayModelFamily;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  betaHeaders?: string[];
  /**
   * Optional thinking-level map forwarded to the registered pi model.
   *
   * Use cases:
   *  - Expose `xhigh` on a reasoning model that supports it (pi hides
   *    `xhigh` unless an explicit mapping is present; see `getSupportedThinkingLevels`
   *    in pi-ai which uses `mapped !== undefined` as the opt-in check).
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

/**
 * Clamp pi's 5-level thinking scale to the 3-level window that works on
 * `POST /responses` for gpt-5.5. The boundary values (`minimal`, `xhigh`)
 * are rejected by either LiteLLM's Pydantic validator (`xhigh`) or the
 * upstream OpenAI Responses API (`minimal`), so neither end of pi's scale
 * is reachable on this path. Evidence is recorded in the local PLAN doc.
 */
export const GPT55_RESPONSES_THINKING_LEVEL_MAP: ProviderModelConfig["thinkingLevelMap"] = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
};

/**
 * Clamp pi's 5-level thinking scale for gpt-5 / gpt-5-mini on the Responses
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

/**
 * Build the startup bootstrap catalog only.
 *
 * These IDs are local fallback presets so Pi can resolve gateway defaults
 * before async discovery completes. Once discovery succeeds, the provider is
 * re-registered with the exact gateway model IDs instead of this bootstrap.
 */
export function buildBootstrapModelList(
  runtimeBetaOverrides: Set<string> | null,
  runtimeExtraBetas: Set<string>,
): TaggedGatewayModel[] {
  return sortModelIds(ALWAYS_INCLUDE_MODEL_IDS).map((id) =>
    toProviderModelConfig(id, runtimeBetaOverrides, runtimeExtraBetas),
  );
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
  runtimeBetaOverrides: Set<string> | null,
  runtimeExtraBetas: Set<string>,
  modelInfoMap?: GatewayModelInfoMap,
): TaggedGatewayModel[] {
  const uniqueDiscoveredIds = [...new Set(discoveredIds)];
  return sortModelIds(uniqueDiscoveredIds).map((id) =>
    toProviderModelConfig(id, runtimeBetaOverrides, runtimeExtraBetas, modelInfoMap?.[id]),
  );
}

export function toProviderModelConfig(
  id: string,
  runtimeBetaOverrides: Set<string> | null,
  runtimeExtraBetas: Set<string>,
  info?: GatewayModelInfo,
): TaggedGatewayModel {
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
    // prompt caching, and multi-block streaming natively. We only attach
    // `anthropic-beta` when the model / runtime asks for it.
    //
    // IMPORTANT — beta-merge shim:
    //   pi-ai builds the Anthropic client with
    //     defaultHeaders["anthropic-beta"] = "fine-grained-tool-streaming-2025-05-14"
    //   and then merges model.headers on top with Object.assign. That replaces
    //   the entire `anthropic-beta` value instead of comma-merging, so setting
    //   any custom beta (e.g. context-1m-2025-08-07) here silently drops pi-ai's
    //   default. fine-grained-tool-streaming is what makes tool argument
    //   streaming robust on long generations — losing it correlates with the
    //   late-stream `api_error: Internal server error` reports on Opus 4.7.
    //
    //   Until pi-ai's mergeHeaders is fixed upstream to comma-merge this one
    //   header, we always include fine-grained-tool-streaming in our beta list
    //   so the final header carries both values.
    const effectiveBetas = resolveEffectiveBetas(
      def.betaHeaders ?? [],
      runtimeBetaOverrides,
      runtimeExtraBetas,
    );
    const mergedBetas = [
      ...new Set([...effectiveBetas, ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA]),
    ];
    return {
      id: def.id,
      name: def.name,
      api: "anthropic-messages",
      reasoning: def.reasoning,
      input: def.input,
      cost: { ...ZERO_COST },
      contextWindow: def.contextWindow,
      maxTokens: def.maxTokens,
      headers: { "anthropic-beta": mergedBetas.join(",") },
      // Forward Opus 4.7's xhigh opt-in so pi's `/thinking` selector
      // actually exposes the level that the DEFAULT_THINKING_LEVEL
      // constant wants to ride on.
      ...(def.thinkingLevelMap ? { thinkingLevelMap: def.thinkingLevelMap } : {}),
      // Haiku 4.5 rejects per-tool `eager_input_streaming`. Setting this
      // AnthropicMessagesCompat flag to false makes pi-ai (1) drop the
      // per-tool field entirely and (2) auto-attach the legacy
      // `fine-grained-tool-streaming-2025-05-14` beta header on tool-enabled
      // requests, which is the streaming path Haiku 4.5 accepts. Opus and
      // Sonnet still accept eager streaming, so we leave compat undefined
      // there to keep pi-ai on its default fast path.
      ...(isHaiku45ModelId(def.id) ? { compat: { supportsEagerToolInputStreaming: false } } : {}),
    };
  }

  const isCodex = def.family === "codex";
  const isGpt55 = isGpt55ModelId(def.id);
  const isGpt5Family = isGpt5FamilyResponsesModelId(def.id);
  const compat = isCodex ? CODEX_OPENAI_COMPAT : COMMON_OPENAI_COMPAT;

  // gpt-5, gpt-5-mini, gpt-5.5 all route through the OpenAI Responses API
  // (`POST /responses` on this gateway; `/v1/responses` is SSO-only). The
  // working reasoning.effort window is model-specific:
  //   - gpt-5 / gpt-5-mini: minimal | low | medium | high  (xhigh → high)
  //   - gpt-5.5:            low | medium | high            (minimal → low,
  //                                                        xhigh  → high)
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
      thinkingLevelMap: isGpt55
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
// Beta header resolution
// -------------------------------------------------------------------------------------------------

/**
 * Given a model's default beta list, return the effective list after applying
 * optional allow-list overrides for default betas plus any always-add extras.
 */
export function resolveEffectiveBetas(
  modelDefaults: string[],
  runtimeOverrides: Set<string> | null,
  runtimeExtraBetas: Set<string>,
): string[] {
  const defaults =
    runtimeOverrides === null
      ? modelDefaults
      : modelDefaults.filter((beta) => runtimeOverrides.has(beta));
  return [...new Set([...defaults, ...runtimeExtraBetas])];
}

/** Resolve a short alias to the full beta value. */
export function resolveBetaAlias(input: string): string | undefined {
  const lower = input.toLowerCase().trim();
  if (!lower) return undefined;
  for (const known of KNOWN_BETAS) {
    if (known.value === lower || known.aliases.some((alias) => alias === lower)) {
      return known.value;
    }
  }
  return undefined;
}

export function normalizeBetaValue(input: string): string | undefined {
  const lower = input.toLowerCase().trim();
  if (!lower) return undefined;
  return resolveBetaAlias(lower) ?? lower;
}

export function isDefaultAnthropicBeta(value: string): boolean {
  return DEFAULT_ANTHROPIC_BETA_HEADERS.includes(
    value as (typeof DEFAULT_ANTHROPIC_BETA_HEADERS)[number],
  );
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
 * override that switches pi-ai onto the legacy `fine-grained-tool-streaming-2025-05-14`
 * beta path. Opus / Sonnet still accept eager streaming, so the override
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
    const is47OrNewer = lower.includes("4-7") || lower.includes("4.7");
    const is46OrNewer = lower.includes("4-6") || lower.includes("4.6") || is47OrNewer;
    const has1m = is46OrNewer && isOpus;
    const reasoning =
      !isHaiku &&
      (lower.includes("opus") ||
        lower.includes("sonnet-4") ||
        lower.includes("3-7-sonnet") ||
        is46OrNewer);

    // Beta headers:
    //  - Opus 4.7: extended thinking is GA, but we still send
    //    `context-1m-2025-08-07` to stay on the documented 1M path and to
    //    keep contextWindow truthful in the catalog.
    //  - Opus 4.6: carries the default beta stack (1m + output-128k +
    //    interleaved-thinking) that unlocked its 1M window pre-GA.
    //  - Older reasoning models: interleaved-thinking only.
    const betaHeaders = is47OrNewer
      ? [ONE_M_CONTEXT_BETA]
      : has1m
        ? [...DEFAULT_ANTHROPIC_BETA_HEADERS]
        : reasoning
          ? [INTERLEAVED_THINKING_BETA]
          : [];

    // Opus 4.7 output default is 64K. Avoids the `api_error: Internal
    // server error` window observed at 128K + effort=max. Model hard
    // ceiling is 128K; callers can opt into that per request.
    const opus47OutputTokens = 64_000;
    const maxTokens = isHaiku
      ? 8_192
      : isOpus
        ? is47OrNewer
          ? opus47OutputTokens
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
      betaHeaders,
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
  fetchGatewayModelIds,
  fetchGatewayModelInfoMap,
  fetchWithTimeout,
  diffModelGroupProviders,
  type ModelGroupDrift,
} from "./models-internal/fetchers.ts";

// -------------------------------------------------------------------------------------------------
// Formatting helpers
// -------------------------------------------------------------------------------------------------

export function getShortModelLabel(modelId: string): string {
  if (modelId === DEFAULT_MODEL_ID || modelId === "claude-opus-4-7-v1") {
    return "Opus 4.7 [1M]";
  }
  if (modelId === PREVIOUS_DEFAULT_MODEL_ID) {
    return "Opus 4.6 [1M]";
  }
  if (modelId === FALLBACK_MODEL_ID) {
    return "Sonnet 4.6";
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
