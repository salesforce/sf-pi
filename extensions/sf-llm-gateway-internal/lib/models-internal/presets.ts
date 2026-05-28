/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Static MODEL_PRESETS table for the SF LLM Gateway.
 *
 * Pure data; the neighboring `models-internal/` modules and the public
 * barrel at `lib/models.ts` consume this catalog when a preset is needed
 * during inference, list building, or labelling.
 *
 * Field-level notes (1M context, 64K maxTokens floor for Opus 4.7, etc.)
 * live inline next to each entry. The shape is `Omit<GatewayModelDefinition,
 * "id">` because the id is the record key — keeping the keys and values
 * in lockstep prevents drift between the two.
 */
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MODEL_ID, FALLBACK_MODEL_ID, PREVIOUS_DEFAULT_MODEL_ID } from "../config.ts";
import type { GatewayModelDefinition } from "../models.ts";

// Re-imported here so presets stay self-contained; mirrors the source-of-truth
// values exported from `lib/models.ts` (the public barrel).
const ONE_M_CONTEXT_BETA = "context-1m-2025-08-07";
const OUTPUT_128K_BETA = "output-128k-2025-02-19";
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";

const DEFAULT_ANTHROPIC_BETA_HEADERS = [
  ONE_M_CONTEXT_BETA,
  OUTPUT_128K_BETA,
  INTERLEAVED_THINKING_BETA,
] as const;

/**
 * Opus 4.7+ thinking-level map. Pi's user-facing `xhigh` selector maps to
 * Anthropic's native `max` effort tier on the wire. The gateway now accepts
 * `{low, medium, high, max}` for all Opus 4.7+ models (verified via live
 * probes May 2026). Previous restriction to `high` only has been lifted.
 */
const OPUS_47_THINKING_LEVEL_MAP: ProviderModelConfig["thinkingLevelMap"] = {
  xhigh: "max",
};

/**
 * Always include these model IDs in the bootstrap list so Pi resolves the
 * `sf-llm-gateway-internal/*` enabledModels wildcard before async discovery
 * finishes. Discovery overwrites this list once it returns.
 */
export const ALWAYS_INCLUDE_MODEL_IDS = [
  DEFAULT_MODEL_ID,
  PREVIOUS_DEFAULT_MODEL_ID,
  FALLBACK_MODEL_ID,
  "gpt-5",
];

export const MODEL_PRESETS: Record<string, Omit<GatewayModelDefinition, "id">> = {
  // --- Opus 4.8 ---
  //
  // 1M context, 128K output (confirmed via /model_group/info and live probes).
  // Supports effort=max natively. Same thinking-level map as 4.7.
  "claude-opus-4-8": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.8 [1M] Global",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    betaHeaders: [],
    thinkingLevelMap: OPUS_47_THINKING_LEVEL_MAP,
  },
  // --- Opus 4.7 (current default) ---
  //
  // contextWindow is 1M: live probes confirmed the upstream accepts >200K
  // input tokens without the context-1m beta header, and gateway metadata
  // now advertises 1M natively. Keep default betaHeaders empty so the
  // default Opus 4.7 path avoids deprecated / unnecessary beta flags.
  //
  // maxTokens is 128_000. Live probes (May 2026) confirmed
  // `max_tokens: 128000 + effort: "max"` works reliably — the earlier
  // intermittent `api_error` at this setting has been resolved upstream.
  [DEFAULT_MODEL_ID]: {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.7 [1M] Global",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    betaHeaders: [],
    thinkingLevelMap: OPUS_47_THINKING_LEVEL_MAP,
  },
  "claude-opus-4-7-v1": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.7 [1M] Legacy Alias",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    betaHeaders: [],
    thinkingLevelMap: OPUS_47_THINKING_LEVEL_MAP,
  },
  "claude-opus-4-7-20250416": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.7 [1M]",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    betaHeaders: [],
    thinkingLevelMap: OPUS_47_THINKING_LEVEL_MAP,
  },
  "us.anthropic.claude-opus-4-7-v1": {
    family: "anthropic",
    name: "[SF LLM Gateway] Claude Opus 4.7 [1M] US",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    betaHeaders: [],
    thinkingLevelMap: OPUS_47_THINKING_LEVEL_MAP,
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
    // upstream OpenAI side.
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
  // --- GPT-5.5 ---
  //
  // Gateway /v1/model/info reports 1,050,000 input / 128,000 output for
  // this model. We advertise 1M context in the selector; the gateway
  // will accept up to ~1.05M but rounding down keeps pi's context-window
  // math honest.
  //
  // `thinkingLevelMap` is intentionally omitted — gpt-5.5 has no
  // wire-value we can attach to the selected level on this gateway, so
  // exposing the picker would be misleading.
  "gpt-5.5": {
    family: "openai",
    name: "[SF LLM Gateway] GPT-5.5 [1M]",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
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
