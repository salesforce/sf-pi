/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Anthropic beta header controls for the gateway.
 *
 * State layer for `/sf-llm-gateway-internal beta …`. Owns:
 *   - `defaultBetas` — runtime override for the model-default Anthropic betas
 *     (null = follow model defaults, non-null Set = explicit allowlist).
 *   - `extraBetas`   — extra betas injected on top of model defaults.
 *
 * The state is seeded at module load from `SF_LLM_GATEWAY_INTERNAL_BETAS`.
 * Command handlers mutate it via `getBetaState()` + `setBetaState()`; the
 * extension entry point reads it when building discovery/status calls.
 *
 * Kept as a thin mutable module instead of a class because there is one
 * runtime-wide state, and callers already share module scope across
 * `index.ts` and `lib/status.ts`.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { BETAS_ENV, COMMAND_NAME } from "./config.ts";
import { discoverAndRegister } from "./discovery.ts";
import {
  DEFAULT_ANTHROPIC_BETA_HEADERS,
  KNOWN_BETAS,
  isDefaultAnthropicBeta,
  normalizeBetaValue,
} from "./models.ts";

export interface BetaRuntimeState {
  /** null = use model defaults. Non-null = explicit allowlist. */
  defaultBetas: Set<string> | null;
  /** Extras injected on top of model defaults. */
  extraBetas: Set<string>;
}

let current: BetaRuntimeState = initBetaStateFromEnv();

export function getBetaState(): BetaRuntimeState {
  return current;
}

export function getBetaOverrides(): Set<string> | null {
  return current.defaultBetas;
}

export function getBetaExtras(): Set<string> {
  return current.extraBetas;
}

export function initBetaStateFromEnv(): BetaRuntimeState {
  const raw = process.env[BETAS_ENV];
  if (raw === undefined) {
    return { defaultBetas: null, extraBetas: new Set() };
  }

  const parsed = raw
    .split(",")
    .map((value) => normalizeBetaValue(value))
    .filter((value): value is string => Boolean(value));

  return {
    defaultBetas: new Set(parsed.filter((value) => isDefaultAnthropicBeta(value))),
    extraBetas: new Set(parsed.filter((value) => !isDefaultAnthropicBeta(value))),
  };
}

function hasRuntimeBetaOverrides(): boolean {
  return current.defaultBetas !== null || current.extraBetas.size > 0;
}

export function getRuntimeBetaSource(): string {
  if (process.env[BETAS_ENV] !== undefined) {
    return "env override";
  }
  return hasRuntimeBetaOverrides() ? "command override" : "model defaults";
}

function isKnownBetaActive(value: string): boolean {
  if (isDefaultAnthropicBeta(value)) {
    return current.defaultBetas === null ? true : current.defaultBetas.has(value);
  }
  return current.extraBetas.has(value);
}

function getCustomInjectedBetas(): string[] {
  return [...current.extraBetas]
    .filter((value) => !KNOWN_BETAS.some((beta) => beta.value === value))
    .sort();
}

/**
 * Handle `/sf-llm-gateway-internal beta [args…]`.
 *
 * `emitOutput` is passed in so we reuse the shared notify/sendMessage
 * helper from the entry point without creating a circular import.
 */
export async function handleBetaCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string[],
  emitOutput: (
    summary: string,
    details: string,
    level: "info" | "warning" | "error",
  ) => Promise<void>,
): Promise<void> {
  if (args.length === 0) {
    const customBetas = getCustomInjectedBetas();
    const lines = [
      "Anthropic beta header state:",
      `Source: ${getRuntimeBetaSource()}`,
      "",
      ...KNOWN_BETAS.map((beta) => {
        const active = isKnownBetaActive(beta.value);
        return `  ${active ? "\u2705" : "\u274c"} ${beta.aliases[0]}  (${beta.value})`;
      }),
      ...(customBetas.length > 0
        ? ["", "Custom injected betas:", ...customBetas.map((value) => `  ✅ ${value}`)]
        : []),
      "",
      `To toggle: /${COMMAND_NAME} beta <name> on|off`,
      `Use a known alias or a raw Anthropic beta value.`,
      `To reset to model defaults: /${COMMAND_NAME} beta reset`,
    ];
    await emitOutput("SF LLM Gateway Internal beta state.", lines.join("\n"), "info");
    return;
  }

  if (args[0]?.toLowerCase() === "reset") {
    current = initBetaStateFromEnv();
    await discoverAndRegister(pi, current.defaultBetas, current.extraBetas, ctx.cwd);
    await emitOutput(
      "Beta overrides reset.",
      process.env[BETAS_ENV] === undefined
        ? "Anthropic beta headers now follow model defaults."
        : `Anthropic beta headers now follow ${BETAS_ENV}.`,
      "info",
    );
    return;
  }

  const betaName = args[0];
  const action = args[1]?.toLowerCase();
  if (!betaName || (action !== "on" && action !== "off")) {
    await emitOutput(
      "Invalid beta command.",
      `Usage: /${COMMAND_NAME} beta <name> on|off\nKnown aliases: ${KNOWN_BETAS.map((beta) => beta.aliases[0]).join(", ")}`,
      "warning",
    );
    return;
  }

  const normalized = normalizeBetaValue(betaName);
  if (!normalized) {
    await emitOutput(
      `Unknown beta: ${betaName}`,
      `Known aliases: ${KNOWN_BETAS.map((beta) => beta.aliases[0]).join(", ")}`,
      "warning",
    );
    return;
  }

  const isDefaultBeta = isDefaultAnthropicBeta(normalized);

  if (isDefaultBeta) {
    // Lazily materialize the override Set the first time we touch a
    // model-default beta, then apply the add/delete against it.
    const overrides = current.defaultBetas ?? new Set(DEFAULT_ANTHROPIC_BETA_HEADERS);
    if (action === "on") overrides.add(normalized);
    else overrides.delete(normalized);
    current = { ...current, defaultBetas: overrides };
  } else {
    if (action === "on") current.extraBetas.add(normalized);
    else current.extraBetas.delete(normalized);
  }

  await discoverAndRegister(pi, current.defaultBetas, current.extraBetas, ctx.cwd);

  const alias = KNOWN_BETAS.find((beta) => beta.value === normalized)?.aliases[0] ?? normalized;
  const detail = isDefaultBeta
    ? `${normalized} is now ${action} for model-default Anthropic betas.`
    : `${normalized} is now ${action} as an injected Anthropic beta.`;

  await emitOutput(`Beta ${alias}: ${action}`, detail, "info");
}
