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

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MODEL_ID, FALLBACK_MODEL_ID, PREVIOUS_DEFAULT_MODEL_ID } from "./config.ts";
import { toGatewayOpenAiBaseUrl } from "./gateway-url.ts";
import { ANTHROPIC_FINE_GRAINED_TOOL_STREAMING_BETA } from "./transport.ts";

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

const MODEL_FETCH_TIMEOUT_MS = 10_000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_DISCOVERED_MODELS = 64;

/**
 * Bootstrap-only defaults used before live gateway discovery completes.
 *
 * Includes at least one model from each provider registration so the
 * `sf-llm-gateway-internal/*` and `sf-llm-gateway-internal-anthropic/*`
 * wildcards in Pi's `enabledModels` both resolve during synchronous startup
 * resolution — otherwise Pi prints
 * `Warning: No models match pattern "sf-llm-gateway-internal/*"` before
 * async discovery can populate the catalog. The OpenAI-compat representative
 * is `gpt-5`, which the gateway has exposed consistently; discovery overwrites
 * this list the first time it succeeds.
 */
export const ALWAYS_INCLUDE_MODEL_IDS = [
  DEFAULT_MODEL_ID,
  PREVIOUS_DEFAULT_MODEL_ID,
  FALLBACK_MODEL_ID,
  "gpt-5",
];

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
  // LiteLLM's Codex path currently accepts only low/medium/high.
  reasoningEffortMap: {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "high",
  },
};

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

// -------------------------------------------------------------------------------------------------
// Static model catalog (presets for known models)
// -------------------------------------------------------------------------------------------------

export const MODEL_PRESETS: Record<string, Omit<GatewayModelDefinition, "id">> = {
  // --- Opus 4.7 (current default) ---
  //
  // contextWindow is 1M: live probe confirmed the upstream accepts >500K
  // input tokens with or without the context-1m beta header, so we surface
  // 1M to pi-ai. We still set the context-1m beta header in `betaHeaders`
  // so the request is on the documented 1M path. All other extended-
  // thinking features are GA and need no beta headers.
  //
  // maxTokens is deliberately 64_000 here. Live probes showed
  // `max_tokens: 128000 + effort: "max"` on heavier generations
  // intermittently surfaces `api_error: Internal server error` from
  // Anthropic upstream (~5% of trials). 64K matches what the gateway
  // advertises via /v1/model/info and showed no failures in the same
  // harness. The model hard ceiling is 128K (>128K returns 400); callers
  // who need the extra headroom can override per-request.
  [DEFAULT_MODEL_ID]: {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.7 [1M] Global",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    betaHeaders: [ONE_M_CONTEXT_BETA],
  },
  "claude-opus-4-7-v1": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.7 [1M] Legacy Alias",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    betaHeaders: [ONE_M_CONTEXT_BETA],
  },
  "claude-opus-4-7-20250416": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.7 [1M]",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    betaHeaders: [ONE_M_CONTEXT_BETA],
  },
  "us.anthropic.claude-opus-4-7-v1": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.7 [1M] US",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    betaHeaders: [ONE_M_CONTEXT_BETA],
  },
  // --- Opus 4.6 (previous default) ---
  [PREVIOUS_DEFAULT_MODEL_ID]: {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.6 [1M] Global",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    betaHeaders: [...DEFAULT_ANTHROPIC_BETA_HEADERS],
  },
  "us.anthropic.claude-opus-4-6-v1": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.6 [1M] US",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    betaHeaders: [...DEFAULT_ANTHROPIC_BETA_HEADERS],
  },
  [FALLBACK_MODEL_ID]: {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Sonnet 4.6 Global",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 64_000,
    betaHeaders: [INTERLEAVED_THINKING_BETA],
  },
  "claude-opus-4-5-20251101": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 32_768,
    betaHeaders: [INTERLEAVED_THINKING_BETA],
  },
  "claude-opus-4-20250514": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 32_768,
    betaHeaders: [INTERLEAVED_THINKING_BETA],
  },
  "claude-sonnet-4-20250514": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Sonnet 4",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 64_000,
    betaHeaders: [INTERLEAVED_THINKING_BETA],
  },
  "claude-sonnet-4-5-20250514": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Sonnet 4.5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 64_000,
    betaHeaders: [INTERLEAVED_THINKING_BETA],
  },
  "claude-haiku-4-5-20251001": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Haiku 4.5",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 8_192,
    betaHeaders: [],
  },
  "claude-3-7-sonnet-20250219": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude 3.7 Sonnet",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 64_000,
    betaHeaders: [INTERLEAVED_THINKING_BETA],
  },
  "gemini-3.1-pro-preview": {
    family: "google",
    name: "[SF LLM Gateway] Gemini 3.1 Pro Preview",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  },
  "gemini-2.5-pro": {
    family: "google",
    name: "[SF LLM Gateway] Gemini 2.5 Pro",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  },
  "gemini-2.5-flash": {
    family: "google",
    name: "[SF LLM Gateway] Gemini 2.5 Flash",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  },
  "gpt-5": {
    family: "openai",
    name: "[SF LLM Gateway] GPT-5",
    reasoning: true,
    input: ["text", "image"],
    // Gateway /v1/model/info confirms 272K input / 128K output on the
    // upstream OpenAI side. Probed live with ~233K-token prompt.
    contextWindow: 272_000,
    maxTokens: 128_000,
  },
  "gpt-5-mini": {
    family: "openai",
    name: "[SF LLM Gateway] GPT-5 Mini",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 272_000,
    maxTokens: 128_000,
  },
  "gpt-4o": {
    family: "openai",
    name: "[SF LLM Gateway] GPT-4o",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 16_384,
  },
  "gpt-4o-mini": {
    family: "openai",
    name: "[SF LLM Gateway] GPT-4o Mini",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 16_384,
  },
  "gpt-5.2-codex": {
    family: "codex",
    name: "[SF LLM Gateway] GPT-5.2 Codex",
    reasoning: true,
    input: ["text"],
    // Gateway /v1/model/info reports 272K/128K; same GPT-5 family backbone.
    contextWindow: 272_000,
    maxTokens: 128_000,
  },
  "gpt-5.3-codex": {
    family: "codex",
    name: "[SF LLM Gateway] GPT-5.3 Codex",
    reasoning: true,
    input: ["text"],
    contextWindow: 272_000,
    maxTokens: 128_000,
  },
};

// -------------------------------------------------------------------------------------------------
// Model list building
// -------------------------------------------------------------------------------------------------

/**
 * A gateway model tagged with the transport it should use. This tag is
 * internal to the extension: `lib/discovery.ts` strips it before registering
 * the model with pi, then `streamSimple` routes by model id at request time.
 */
export type TaggedGatewayModel = ProviderModelConfig & {
  api: "openai-completions" | "anthropic-messages";
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
    };
  }

  const compat = def.family === "codex" ? CODEX_OPENAI_COMPAT : COMMON_OPENAI_COMPAT;

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

export async function fetchGatewayModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
  const response = await fetchWithTimeout(
    `${toGatewayOpenAiBaseUrl(baseUrl)}/models`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    MODEL_FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Gateway model fetch failed (${response.status}).`);
  }

  let json: { data?: Array<{ id?: string }> };
  try {
    json = (await response.json()) as { data?: Array<{ id?: string }> };
  } catch {
    throw new Error("Gateway model response could not be parsed.");
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of json.data || []) {
    const id = (entry.id || "").trim();
    if (!MODEL_ID_PATTERN.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_DISCOVERED_MODELS) break;
  }
  return ids;
}

/**
 * Fetch richer per-model metadata from `/v1/model/info` and return a map
 * keyed by `model_name`. Failures are swallowed because enrichment is
 * strictly optional — the extension must keep working even when the info
 * endpoint times out or 500s.
 */
export async function fetchGatewayModelInfoMap(
  baseUrl: string,
  apiKey: string,
): Promise<GatewayModelInfoMap> {
  try {
    const response = await fetchWithTimeout(
      `${toGatewayOpenAiBaseUrl(baseUrl)}/model/info`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
      MODEL_FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      return {};
    }

    const json = (await response.json()) as {
      data?: Array<{
        model_name?: string;
        model_info?: Record<string, unknown>;
        litellm_params?: Record<string, unknown>;
      }>;
    };

    const map: GatewayModelInfoMap = {};
    for (const entry of json.data || []) {
      const id = typeof entry.model_name === "string" ? entry.model_name.trim() : "";
      if (!id || !MODEL_ID_PATTERN.test(id)) continue;
      const mi = entry.model_info ?? {};
      map[id] = {
        id,
        mode: typeof mi.mode === "string" ? (mi.mode as string) : undefined,
        litellmProvider:
          typeof mi.litellm_provider === "string" ? (mi.litellm_provider as string) : undefined,
        maxInputTokens: typeof mi.max_input_tokens === "number" ? mi.max_input_tokens : undefined,
        maxOutputTokens:
          typeof mi.max_output_tokens === "number" ? mi.max_output_tokens : undefined,
        inputCostPerToken:
          typeof mi.input_cost_per_token === "number" ? mi.input_cost_per_token : undefined,
        outputCostPerToken:
          typeof mi.output_cost_per_token === "number" ? mi.output_cost_per_token : undefined,
        cacheReadCostPerToken:
          typeof mi.cache_read_input_token_cost === "number"
            ? mi.cache_read_input_token_cost
            : undefined,
        cacheWriteCostPerToken:
          typeof mi.cache_creation_input_token_cost === "number"
            ? mi.cache_creation_input_token_cost
            : undefined,
        supportsReasoning:
          typeof mi.supports_reasoning === "boolean" ? mi.supports_reasoning : undefined,
        supportsVision: typeof mi.supports_vision === "boolean" ? mi.supports_vision : undefined,
        supportsFunctionCalling:
          typeof mi.supports_function_calling === "boolean"
            ? mi.supports_function_calling
            : undefined,
        supportsPromptCaching:
          typeof mi.supports_prompt_caching === "boolean" ? mi.supports_prompt_caching : undefined,
        rpm: typeof mi.rpm === "number" ? mi.rpm : undefined,
        tpm: typeof mi.tpm === "number" ? mi.tpm : undefined,
      };
    }
    return map;
  } catch {
    return {};
  }
}

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

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
