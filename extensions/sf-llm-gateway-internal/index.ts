/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-llm-gateway-internal behavior contract
 *
 * - Registers the Salesforce LLM Gateway as a SINGLE pi-native provider
 *   (`sf-llm-gateway-internal`). One row in `/login`, one paste-token flow,
 *   one saved credential. All registered models inherit the provider-level
 *   `openai-completions` api so pi always invokes our unified `streamSimple`.
 *   That dispatcher detects Claude model ids and delegates them to the native
 *   Anthropic transport internally. Claude still runs on the native Anthropic
 *   path because the OpenAI-compat proxy splits thinking+text across choices
 *   and intermittently drops the final text delta, producing empty assistant
 *   turns that force "continue".
 *
 *   See `lib/discovery.ts` for the dispatcher and `lib/migrate-unify-
 *   provider.ts` for the one-shot settings migration that rewrites the
 *   retired `sf-llm-gateway-internal-anthropic` references in users'
 *   settings.json files.
 * - Registers a static bootstrap catalog synchronously so Pi startup can resolve
 *   defaults/scoped models without warnings before async discovery finishes
 * - Dynamic model discovery via `/v1/models` for all valid gateway model IDs
 * - Static presets for common models, generic family-aware inference for newly discovered ones
 * - Uses Pi's built-in custom-provider support instead of models.json hacks
 * - Shows an explicit SF LLM Gateway footer status when one of these models is active
 * - Footer status includes chosen model, current context usage, and monthly gateway usage
 * - Defaults gateway sessions to Pi thinking level xhigh
 * - Repairs legacy exact gateway enabledModels entries before startup validation
 * - Runtime beta header toggles with env var initial defaults
 * - Keeps the runtime spine in this file while pushing settings/status helpers to lib/
 *
 * Configuration:
 * - SF_LLM_GATEWAY_INTERNAL_BASE_URL   required — the gateway endpoint, configured via
 *                                       the setup wizard or env var. This extension has
 *                                       no built-in default because it targets a
 *                                       Salesforce-internal endpoint that is not publicly
 *                                       reachable.
 * - SF_LLM_GATEWAY_INTERNAL_API_KEY    required for real requests and monthly usage
 * - SF_LLM_GATEWAY_INTERNAL_BETAS      optional — comma-separated Anthropic beta
 *                                       header values. When set, only listed values are
 *                                       active. When unset, model defaults apply.
 *
 * Commands:
 * - /sf-llm-gateway-internal                     show status
 * - /sf-llm-gateway-internal setup [global|project]
 * - /sf-llm-gateway-internal on [global|project]   enable provider + set Opus 4.7 default
 * - /sf-llm-gateway-internal off [global|project]  disable provider + set GPT 5.5 default
 * - /sf-llm-gateway-internal refresh               refresh models + monthly usage
 * - /sf-llm-gateway-internal set-default [global|project]
 * - /sf-llm-gateway-internal beta                  show beta header state
 * - /sf-llm-gateway-internal beta <name> on|off    toggle a beta header at runtime
 * - /sf-llm-gateway-internal models                list discovered models
 *
 * Behavior matrix:
 *
 *   Event/Trigger               | Condition                          | Result
 *   ----------------------------|------------------------------------|-------------------------------
 *   Extension load              | enabled + has credentials          | Register static catalog, fire-and-forget discovery
 *   Extension load              | disabled                           | Unregister provider
 *   session_start               | —                                  | Re-discover models, sync session defaults
 *   turn_end                    | model is gateway model             | Update footer (context + monthly usage)
 *   turn_end                    | model is NOT gateway model         | Clear footer status
 *   model_select                | selected model is gateway          | Set thinking to xhigh
 *   after_provider_response     | model is gateway model + 2xx       | Clear any live throttle/upstream warning
 *   after_provider_response     | model is gateway model + 429       | Record throttle signal, footer shows ⚠ badge for 60s
 *   after_provider_response     | model is gateway model + 5xx       | Record upstream signal, footer shows ⚠ badge for 60s
 *   session_shutdown            | —                                  | Clear footer status + provider signal
 *   /command on                 | missing credentials                | Prompt for credentials first
 *   /command on                 | credentials present                | Save config, set default, register, discover
 *   /command off                | —                                  | Disable, remove pattern, switch to off-default
 *   /command refresh            | —                                  | Re-discover, refresh monthly usage
 *   /command beta <name> on     | —                                  | Toggle beta, re-register provider
 *   Monthly usage fetch         | cached < 5 min old                 | Use cache
 *   Monthly usage fetch         | stale or forced                    | Fetch from gateway /user/info
 *
 * Reader guide:
 * - Start at the extension entry point to see the runtime spine
 * - Then read provider registration/discovery and command routing
 * - Provider discovery lives in lib/discovery.ts
 * - Monthly usage caching lives in lib/monthly-usage.ts
 * - Pi settings mutations live in lib/pi-settings.ts
 * - Footer/status formatting lives in lib/status.ts
 * - The TUI setup overlay is in lib/setup-overlay.ts
 */

import { Text } from "@mariozechner/pi-tui";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  MessageRenderer,
} from "@mariozechner/pi-coding-agent";

// --- Lib imports ---

import {
  PROVIDER_NAME,
  COMMAND_NAME,
  STATUS_KEY,
  ENABLED_MODEL_PATTERN,
  BASE_URL_ENV,
  API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_ID,
  FALLBACK_MODEL_ID,
  PREVIOUS_DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
  OFF_DEFAULT_PROVIDER,
  OFF_DEFAULT_MODEL_ID,
  OFF_DEFAULT_THINKING_LEVEL,
  BETAS_ENV,
  getGatewayConfig,
  readGatewaySavedConfig,
  writeGatewaySavedConfig,
  globalGatewayConfigPath,
  projectGatewayConfigPath,
  normalizeBaseUrl,
  describeConfigValue,
  describeApiKey,
  asOptionalString,
} from "./lib/config.ts";

/**
 * Since R1·Unify only one gateway provider is registered; every gateway
 * model (OpenAI-compat AND Claude) lives under PROVIDER_NAME. The helper
 * stays as a named function so call sites keep reading naturally even
 * though the check is now trivial.
 */
function isGatewayProvider(provider: string | undefined): boolean {
  return provider === PROVIDER_NAME;
}

/**
 * Every discovered model is hosted by the single unified provider. Pi sees
 * each one under the provider-level API; the custom streamSimple dispatcher
 * handles Claude-vs-OpenAI routing internally by model id.
 */
function providerForModelId(_modelId: string): string {
  return PROVIDER_NAME;
}

import {
  KNOWN_BETAS,
  ALWAYS_INCLUDE_MODEL_IDS,
  MODEL_PRESETS,
  resolveEffectiveBetas,
  inferModelDefinition,
  isAnthropicModelId,
  getModelFamily,
  findMatchingModelId,
  resolvePreferredModelId,
} from "./lib/models.ts";
import {
  getBetaExtras,
  getBetaOverrides,
  handleBetaCommand as handleBetaCommandImpl,
} from "./lib/beta-controls.ts";

import {
  GatewaySetupOverlayComponent,
  type SetupOverlayResult,
  getSetupOverlayState,
  saveSetupOverlayInputs,
} from "./lib/setup-overlay.ts";
import { buildFooterStatus, buildStatusReport } from "./lib/status.ts";
import {
  applyGatewayModelScope,
  getEffectiveDefaultModelSetting,
  globalSettingsPath,
  normalizeLegacyGatewayEnabledModels,
  projectSettingsPath,
  readSettings,
  removeEnabledModelPattern,
  restoreEnabledModelsSnapshot,
  shouldCaptureExclusiveScopeSnapshot,
  snapshotEnabledModelsForExclusiveScope,
  writeSettings,
} from "./lib/pi-settings.ts";
import {
  discoverAndRegister,
  getLastDiscovery,
  registerProviderIfConfigured,
} from "./lib/discovery.ts";
import { migrateGatewaySettings } from "./lib/migrate-unify-provider.ts";
import { fetchTransformReport, formatTransformReport, type TransformProbe } from "./lib/debug.ts";
import {
  getMonthlyUsageState,
  refreshMonthlyUsage,
  registerGatewayMonthlyUsageRefresher,
} from "./lib/monthly-usage.ts";
import { clearProviderSignal, recordProviderResponse } from "./lib/provider-telemetry.ts";
import {
  clearRetryEventListener,
  formatRetryEventNotification,
  setRetryEventListener,
  type RetryEvent,
} from "./lib/retry-telemetry.ts";
import { installWireTrace, isWireTraceEnabled } from "./lib/wire-trace.ts";

// -------------------------------------------------------------------------------------------------
// Extension-only types
// -------------------------------------------------------------------------------------------------

type CommandArgs = {
  subcommand:
    | "status"
    | "refresh"
    | "set-default"
    | "help"
    | "beta"
    | "models"
    | "debug"
    | "on"
    | "off"
    | "setup";
  scope: "global" | "project";
  betaArgs?: string[];
  /** Positional args for subcommands that take them (e.g. debug). */
  positional?: string[];
};

// -------------------------------------------------------------------------------------------------
// In-memory runtime state
// -------------------------------------------------------------------------------------------------

/**
 * Last thinking level this extension actively set on the session.
 *
 * We use this to distinguish "nobody picked a level, give them our default"
 * from "the user just picked medium, leave them alone". If the session's
 * current thinking level matches what we last set, the user has not touched
 * it and we are free to re-apply DEFAULT_THINKING_LEVEL. If it differs, the
 * user (or another extension) changed it and we respect that choice.
 *
 * Reset to undefined on session_shutdown so each new session starts fresh.
 */
let lastAppliedThinkingLevel: string | undefined;

function getRuntimeStatusState() {
  const { monthlyUsage, monthlyUsageError, keyInfo, keyInfoError, health, healthError } =
    getMonthlyUsageState();
  return {
    discovery: getLastDiscovery(),
    monthlyUsage,
    monthlyUsageError,
    keyInfo,
    keyInfoError,
    health,
    healthError,
    runtimeBetaOverrides: getBetaOverrides(),
    runtimeExtraBetas: getBetaExtras(),
  };
}

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfLlmGatewayInternalExtension(pi: ExtensionAPI) {
  // Register the monthly-usage refresher into the shared store so UI
  // extensions (sf-welcome, sf-devbar) can trigger refreshes and read state
  // without importing from this extension. unregisterMonthlyUsage is called
  // on session_shutdown to avoid leaking the refresher across reloads.
  let unregisterMonthlyUsage: (() => void) | null = registerGatewayMonthlyUsageRefresher();

  // Opt-in wire-level trace. Activated by SF_LLM_GATEWAY_INTERNAL_TRACE=1.
  // Writes raw request/response bytes under Pi's global agent directory.
  // Intended for debugging sessions where the gateway returns empty/odd responses;
  // no-op otherwise. See lib/wire-trace.ts for details.
  if (isWireTraceEnabled()) {
    installWireTrace();
  }

  // Register a static catalog synchronously so Pi's startup can resolve
  // defaultProvider/defaultModel and enabledModels patterns immediately.
  // Uses a minimal registration that does not need cwd — the config layer
  // still reads env vars and the global saved config for credentials.
  registerProviderIfConfigured(pi, getBetaOverrides(), getBetaExtras());

  // Rendering hook for any sendMessage traffic the extension emits on behalf
  // of the gateway. Single registration now that the retired anthropic
  // sub-provider is gone.
  const renderGatewayMessage: MessageRenderer<unknown> = (message, _options, theme) => {
    const content =
      typeof message.content === "string"
        ? message.content
        : (message.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
    const header = theme.fg("accent", theme.bold("[SF LLM Gateway Internal]"));
    return new Text(`${header}\n${content}`, 0, 0);
  };
  pi.registerMessageRenderer(PROVIDER_NAME, renderGatewayMessage);

  pi.registerCommand(COMMAND_NAME, {
    description: "Minimal SF LLM Gateway provider status and defaults",
    getArgumentCompletions: (prefix: string) => {
      const subcommands = [
        "setup",
        "on",
        "off",
        "refresh",
        "set-default",
        "models",
        "beta",
        "debug",
        "help",
      ];
      const tokens = prefix.trim().split(/\s+/);
      const current = tokens[tokens.length - 1] ?? "";

      // First token: subcommand completion
      if (tokens.length <= 1) {
        const matches = subcommands
          .filter((s) => s.startsWith(current.toLowerCase()))
          .map((s) => ({ value: s, label: s }));
        return matches.length > 0 ? matches : null;
      }

      const sub = tokens[0]?.toLowerCase();

      // Beta subcommand: complete beta aliases
      if (sub === "beta" && tokens.length <= 2) {
        const aliases = KNOWN_BETAS.map((b) => b.aliases[0])
          .filter((a) => a.startsWith(current.toLowerCase()))
          .map((a) => ({ value: a, label: a }));
        // Also offer "reset"
        if ("reset".startsWith(current.toLowerCase())) {
          aliases.push({ value: "reset", label: "reset" });
        }
        return aliases.length > 0 ? aliases : null;
      }

      // Beta on/off toggle
      if (sub === "beta" && tokens.length <= 3) {
        const toggles = ["on", "off"]
          .filter((s) => s.startsWith(current.toLowerCase()))
          .map((s) => ({ value: s, label: s }));
        return toggles.length > 0 ? toggles : null;
      }

      // Scope completion for subcommands that accept it
      const scopedSubs = ["setup", "on", "off", "set-default"];
      if (scopedSubs.includes(sub ?? "") && tokens.length <= 2) {
        const scopes = ["global", "project"]
          .filter((s) => s.startsWith(current.toLowerCase()))
          .map((s) => ({ value: s, label: s }));
        return scopes.length > 0 ? scopes : null;
      }

      return null;
    },
    handler: async (args, ctx) => {
      await handleCommand(pi, args, ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    // Fresh session — forget any thinking-level we set in a previous session.
    lastAppliedThinkingLevel = undefined;

    // Install the retry-telemetry listener so transparent inner-stream
    // retries surface as user-visible notifications. Before this, the
    // robust retry was fully silent and users had no way to tell whether
    // pi had tried anything or was just slow. The listener captures `ctx`
    // by closure — session_shutdown clears it so we do not hold a stale
    // reference past the session.
    setRetryEventListener((event: RetryEvent) => {
      const level: "info" | "warning" = event.type === "retry_exhausted" ? "warning" : "info";
      ctx.ui.notify(formatRetryEventNotification(event), level);
    });

    // One-shot migration: rewrite references to the retired
    // `sf-llm-gateway-internal-anthropic` provider in pi's settings.json
    // files. Idempotent via a per-file sentinel under `sfPi`. See
    // lib/migrate-unify-provider.ts for details. Runs before the legacy
    // settings repair below so downstream repair never sees ghost ids.
    migrateGatewaySettings(ctx.cwd);

    // Repair legacy settings using the session's cwd (previously done at
    // factory time with process.cwd(), moved here for 0.68.0 compliance).
    repairGatewayEnabledModelSettings(ctx.cwd);
    repairGatewayDefaultModelSettings(ctx.cwd, DEFAULT_MODEL_ID);

    await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);
    await syncGatewaySessionDefaults(pi, ctx, false);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await updateFooterStatus(ctx, false);
  });

  pi.on("model_select", async (event, ctx) => {
    if (isGatewayProvider(event.model.provider)) {
      // xhigh is still the extension's *recommended* default on gateway
      // models, but we no longer force it on every model_select — that
      // overwrote user-initiated level changes and silently inflated every
      // turn into a heavy-workload request profile (adaptive + effort=xhigh
      // + 64K max_tokens), which correlates with Anthropic's intermittent
      // `api_error: Internal server error` on long streaming turns.
      //
      // Re-apply the default only when the current level still matches what
      // we last set (i.e. nobody has touched it since). That way:
      //   - fresh session or first gateway switch: user gets xhigh
      //   - user runs /thinking medium, then switches models: stays medium
      //   - user runs /thinking medium, switches off gateway and back on:
      //     stays medium (we do not re-force xhigh)
      applyGatewayDefaultThinkingLevel(pi);
    }
    await updateFooterStatus(ctx, false);
  });

  // Capture gateway-side throttle/upstream signals so the footer can render
  // a live ⚠ badge without waiting for the 5-minute /user/info refresh.
  // Only records when the active model is a gateway model so non-gateway
  // traffic never populates the badge. See lib/provider-telemetry.ts.
  pi.on("after_provider_response", async (event, ctx) => {
    // isGatewayProvider() narrows on `provider`, but not on `ctx.model` as a
    // whole, so TS still treats model as possibly undefined. Re-check
    // explicitly instead of using a non-null assertion.
    if (!ctx.model || !isGatewayProvider(ctx.model.provider)) return;
    recordProviderResponse(event.status, event.headers, ctx.model.id);
    await updateFooterStatus(ctx, false);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearProviderSignal();
    clearRetryEventListener();
    lastAppliedThinkingLevel = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
    if (unregisterMonthlyUsage) {
      unregisterMonthlyUsage();
      unregisterMonthlyUsage = null;
    }
  });
}

/**
 * Set thinking level to the extension's recommended default, but only when
 * the user has not explicitly changed it since we last set it. See the
 * block comment on `lastAppliedThinkingLevel` for the rationale.
 *
 * Returns true when the level was actually applied, false when respected.
 *
 * Exported for unit tests — the helpers below let tests drive the module's
 * internal state deterministically without booting a real pi session.
 */
export function applyGatewayDefaultThinkingLevel(pi: ExtensionAPI): boolean {
  const currentLevel = pi.getThinkingLevel();
  if (lastAppliedThinkingLevel !== undefined && currentLevel !== lastAppliedThinkingLevel) {
    // User changed it — respect the override.
    return false;
  }
  pi.setThinkingLevel(DEFAULT_THINKING_LEVEL);
  lastAppliedThinkingLevel = DEFAULT_THINKING_LEVEL;
  return true;
}

/** Test-only: read the last thinking level this extension actively applied. */
export function __getLastAppliedThinkingLevelForTests(): string | undefined {
  return lastAppliedThinkingLevel;
}

/** Test-only: reset the module-level state between test cases. */
export function __resetThinkingLevelStateForTests(): void {
  lastAppliedThinkingLevel = undefined;
}

// -------------------------------------------------------------------------------------------------
// Command flow
// -------------------------------------------------------------------------------------------------

async function handleCommand(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const parsed = parseCommandArgs(args);

  switch (parsed.subcommand) {
    case "setup":
      return runSetupWizard(pi, ctx, parsed.scope);
    case "on":
      return enableGateway(pi, ctx, parsed.scope, true);
    case "off":
      return disableGateway(pi, ctx, parsed.scope);
    case "refresh":
      return handleRefreshCommand(pi, ctx);
    case "models":
      return handleModelsCommand(pi, ctx);
    case "debug":
      return handleDebugCommand(pi, ctx, parsed.positional ?? []);
    case "beta":
      return handleBetaCommandImpl(pi, ctx, parsed.betaArgs ?? [], (summary, details, level) =>
        emitCommandOutput(pi, ctx, summary, details, level),
      );
    case "set-default":
      return handleSetDefaultCommand(pi, ctx, parsed.scope);
    case "help":
      return handleHelpCommand(pi, ctx);
    default:
      return handleStatusCommand(pi, ctx);
  }
}

async function handleRefreshCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const state = await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);
  await syncGatewaySessionDefaults(pi, ctx, true);
  const report = buildStatusReport(ctx, state.source !== "disabled", getRuntimeStatusState());
  await emitCommandOutput(
    pi,
    ctx,
    `SF LLM Gateway Internal refreshed (${state.modelIds.length} models, source: ${state.source}).`,
    report,
    state.error ? "warning" : "info",
  );
}

async function handleModelsCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const state = getLastDiscovery();
  const lines = [
    `Model discovery: ${state?.source ?? "not run"}${state?.error ? ` ⚠ ${state.error}` : ""}`,
    `Discovered at: ${state?.discoveredAt ?? "never"}`,
    "",
    "Registered models:",
    ...(state?.modelIds ?? ALWAYS_INCLUDE_MODEL_IDS).map((id) => {
      const preset = MODEL_PRESETS[id];
      const inferred = preset ? { id, ...preset } : inferModelDefinition(id);
      const betas = isAnthropicModelId(id)
        ? resolveEffectiveBetas(inferred.betaHeaders ?? [], getBetaOverrides(), getBetaExtras())
        : [];
      return `- ${id}  ::  family=${getModelFamily(id)}  ::  ${inferred.name}  ::  betas=${betas.length > 0 ? betas.join(", ") : "none"}`;
    }),
  ];
  await emitCommandOutput(pi, ctx, "SF LLM Gateway Internal models.", lines.join("\n"), "info");
}

/**
 * Render the gateway's view of a request for a given model.
 *
 * Usage: `/sf-llm-gateway-internal debug <modelId> [reasoning=<level>] [tool] [adaptive]`
 *
 * The gateway's /utils/transform_request endpoint echoes the upstream URL,
 * headers, and body LiteLLM would send. That makes this the fastest way to
 * verify whether our shims are producing a payload shape the gateway will
 * accept, without actually running a completion and burning tokens.
 */
async function handleDebugCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string[],
): Promise<void> {
  if (args.length === 0) {
    await emitCommandOutput(
      pi,
      ctx,
      "SF LLM Gateway Internal debug — missing model id.",
      [
        `Usage: /${COMMAND_NAME} debug <modelId> [reasoning=<level>] [tool] [adaptive]`,
        "",
        "Examples:",
        `  /${COMMAND_NAME} debug claude-opus-4-7 adaptive reasoning=max`,
        `  /${COMMAND_NAME} debug gpt-5 reasoning=high`,
        `  /${COMMAND_NAME} debug gpt-5.3-codex reasoning=medium tool`,
      ].join("\n"),
      "warning",
    );
    return;
  }

  const [modelId, ...rest] = args;
  if (!modelId) {
    // Redundant with the `args.length === 0` guard above, but explicit so TS
    // narrows the destructured `modelId` from `string | undefined` to `string`
    // without needing a non-null assertion.
    ctx.ui.notify(
      `Usage: /${COMMAND_NAME} debug <modelId> [reasoning=<level>] [tool] [adaptive]`,
      "warning",
    );
    return;
  }
  const probe: TransformProbe = { model: modelId };
  for (const token of rest) {
    const lower = token.toLowerCase();
    if (lower === "tool") {
      probe.withTool = true;
      continue;
    }
    if (lower === "adaptive") {
      probe.adaptive = true;
      continue;
    }
    const reasoningMatch = lower.match(/^reasoning=(minimal|low|medium|high|xhigh)$/);
    if (reasoningMatch) {
      probe.reasoning = reasoningMatch[1] as TransformProbe["reasoning"];
      continue;
    }
  }

  const report = await fetchTransformReport(ctx.cwd, probe);
  await emitCommandOutput(
    pi,
    ctx,
    report.ok
      ? `Transform probe for ${report.model}.`
      : `Transform probe failed: ${report.error ?? "unknown error"}`,
    formatTransformReport(report),
    report.ok ? "info" : "warning",
  );
}

async function handleSetDefaultCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  const settingsPath = scope === "project" ? projectSettingsPath(ctx.cwd) : globalSettingsPath();

  await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);

  const effectiveModelId = resolveGatewayDefaultModelId([
    DEFAULT_MODEL_ID,
    PREVIOUS_DEFAULT_MODEL_ID,
    FALLBACK_MODEL_ID,
  ]);
  const effectivePreset = MODEL_PRESETS[effectiveModelId];
  const effectiveModel = effectivePreset
    ? { id: effectiveModelId, ...effectivePreset }
    : inferModelDefinition(effectiveModelId);
  const effectiveProviderName = providerForModelId(effectiveModelId);

  const settings = readSettings(settingsPath);
  settings.defaultProvider = effectiveProviderName;
  settings.defaultModel = effectiveModelId;
  settings.defaultThinkingLevel = DEFAULT_THINKING_LEVEL;
  writeSettings(settingsPath, settings);

  const model = ctx.modelRegistry.find(effectiveProviderName, effectiveModelId);
  if (model) {
    await pi.setModel(model);
    // Explicit user command — always apply the recommended default here.
    pi.setThinkingLevel(DEFAULT_THINKING_LEVEL);
    lastAppliedThinkingLevel = DEFAULT_THINKING_LEVEL;
  }

  await updateFooterStatus(ctx, true);

  const report = [
    `Default updated in ${scope} settings.`,
    `- Provider: ${effectiveProviderName}`,
    `- Model: ${effectiveModelId}${effectiveModelId !== DEFAULT_MODEL_ID ? ` (resolved from ${DEFAULT_MODEL_ID})` : ""}`,
    `- Thinking: ${DEFAULT_THINKING_LEVEL}`,
    `- Context: ${effectiveModel.contextWindow.toLocaleString()} tokens`,
    `- Max output: ${effectiveModel.maxTokens.toLocaleString()} tokens`,
    `- Route: Global`,
  ].join("\n");

  await emitCommandOutput(pi, ctx, "SF LLM Gateway Internal default updated.", report, "info");
}

async function handleHelpCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const help = [
    "Commands:",
    `- /${COMMAND_NAME}`,
    `- /${COMMAND_NAME} setup [global|project]    # guided TUI setup`,
    `- /${COMMAND_NAME} on [global|project]       # enable provider + set Opus 4.7 default`,
    `- /${COMMAND_NAME} off [global|project]      # disable provider + set ${OFF_DEFAULT_PROVIDER}/${OFF_DEFAULT_MODEL_ID}`,
    `- /${COMMAND_NAME} refresh`,
    `- /${COMMAND_NAME} set-default [global|project]`,
    `- /${COMMAND_NAME} models`,
    `- /${COMMAND_NAME} debug <modelId> [reasoning=<level>] [tool] [adaptive]`,
    `- /${COMMAND_NAME} beta`,
    `- /${COMMAND_NAME} beta <name> on|off`,
    "",
    "Beta aliases:",
    ...KNOWN_BETAS.map((b) => `- ${b.aliases[0]} → ${b.value}`),
    "",
    `Built-in default base URL: ${DEFAULT_BASE_URL || "(none — set via setup wizard or env)"}`,
    `Env vars (optional overrides / credentials): ${BASE_URL_ENV}, ${API_KEY_ENV}`,
    `Optional env: ${BETAS_ENV} (comma-separated Anthropic betas; unset = model defaults)`,
    `Setup also supports additive vs exclusive scoped model behavior.`,
    `Beta command accepts either a known alias or a raw Anthropic beta value.`,
    `Saved config file: ${globalGatewayConfigPath()} or ${projectGatewayConfigPath(process.cwd())}`,
  ].join("\n");

  await emitCommandOutput(pi, ctx, "SF LLM Gateway Internal help", help, "info");
}

async function handleStatusCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const registered = getLastDiscovery()?.source !== "disabled";
  await updateFooterStatus(ctx, false);
  const report = buildStatusReport(ctx, registered, getRuntimeStatusState());
  await emitCommandOutput(
    pi,
    ctx,
    "SF LLM Gateway Internal status posted.",
    report,
    registered ? "info" : "warning",
  );
}

// Exported for unit tests.
export function parseCommandArgs(args: string): CommandArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const sub = (tokens[0] ?? "status").toLowerCase();
  const scopeToken = (tokens[1] ?? "global").toLowerCase();
  const scope = scopeToken === "project" ? "project" : "global";

  if (sub === "refresh") {
    return { subcommand: "refresh", scope };
  }
  if (sub === "set-default") {
    return { subcommand: "set-default", scope };
  }
  if (sub === "help") {
    return { subcommand: "help", scope };
  }
  if (sub === "setup" || sub === "configure") {
    return { subcommand: "setup", scope };
  }
  if (sub === "on" || sub === "enable") {
    return { subcommand: "on", scope };
  }
  if (sub === "off" || sub === "disable") {
    return { subcommand: "off", scope };
  }
  if (sub === "beta") {
    return { subcommand: "beta", scope, betaArgs: tokens.slice(1) };
  }
  if (sub === "models") {
    return { subcommand: "models", scope };
  }
  if (sub === "debug") {
    return { subcommand: "debug", scope, positional: tokens.slice(1) };
  }
  return { subcommand: "status", scope };
}

function setEnabledModelsSetting(
  settings: Record<string, unknown>,
  enabledModels: string[] | undefined,
): void {
  if (enabledModels === undefined) {
    delete settings.enabledModels;
    return;
  }
  settings.enabledModels = enabledModels;
}

function getAvailableGatewayModelIds(): string[] {
  const discoveredIds = getLastDiscovery()?.modelIds;
  return discoveredIds && discoveredIds.length > 0 ? discoveredIds : ALWAYS_INCLUDE_MODEL_IDS;
}

function resolveGatewayDefaultModelId(preferredIds: Array<string | undefined>): string {
  return resolvePreferredModelId(getAvailableGatewayModelIds(), preferredIds) ?? DEFAULT_MODEL_ID;
}

function repairGatewayEnabledModelSettings(cwd: string): void {
  const settingsPaths = [globalSettingsPath(), projectSettingsPath(cwd)];

  for (const settingsPath of settingsPaths) {
    const settings = readSettings(settingsPath);
    if (!Array.isArray(settings.enabledModels)) {
      continue;
    }

    const currentEnabledModels = settings.enabledModels.filter(
      (value): value is string => typeof value === "string",
    );
    const normalizedEnabledModels = normalizeLegacyGatewayEnabledModels(settings.enabledModels);
    if (!normalizedEnabledModels) {
      continue;
    }

    const unchanged =
      currentEnabledModels.length === normalizedEnabledModels.length &&
      currentEnabledModels.every((value, index) => value === normalizedEnabledModels[index]);
    if (unchanged) {
      continue;
    }

    settings.enabledModels = normalizedEnabledModels;
    writeSettings(settingsPath, settings);
  }
}

function repairGatewayDefaultModelSettings(cwd: string, desiredModelId: string): void {
  const availableIds = getAvailableGatewayModelIds();
  const settingsPaths = [globalSettingsPath(), projectSettingsPath(cwd)];

  for (const settingsPath of settingsPaths) {
    const settings = readSettings(settingsPath);
    if (!isGatewayProvider(asOptionalString(settings.defaultProvider))) {
      continue;
    }

    const configuredModelId = asOptionalString(settings.defaultModel);
    if (!configuredModelId || configuredModelId === desiredModelId) {
      continue;
    }

    const resolvedConfiguredModelId = findMatchingModelId(configuredModelId, availableIds);
    if (resolvedConfiguredModelId !== desiredModelId) {
      continue;
    }

    settings.defaultModel = desiredModelId;
    if (asOptionalString(settings.defaultThinkingLevel) !== DEFAULT_THINKING_LEVEL) {
      settings.defaultThinkingLevel = DEFAULT_THINKING_LEVEL;
    }
    writeSettings(settingsPath, settings);
  }
}

// -------------------------------------------------------------------------------------------------
// TUI Setup Wizard (orchestration — component is in lib)
// -------------------------------------------------------------------------------------------------

async function runSetupWizard(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  if (!ctx.hasUI) {
    await emitCommandOutput(
      pi,
      ctx,
      "Interactive setup needs Pi UI.",
      `Run /${COMMAND_NAME} on ${scope} to enable with prompts, or edit ${globalGatewayConfigPath()} manually.`,
      "warning",
    );
    return;
  }

  const setupState = getSetupOverlayState(ctx.cwd, scope);
  const result = await ctx.ui.custom<SetupOverlayResult | undefined>(
    (_tui, theme, _keybindings, done) =>
      new GatewaySetupOverlayComponent(theme, scope, ctx.cwd, setupState, done),
    {
      overlay: true,
      // Use function form for responsive sizing on terminal resize
      overlayOptions: () => ({
        anchor: "center" as const,
        width: "78%",
        minWidth: 78,
      }),
    },
  );

  if (!result) {
    return;
  }

  saveSetupOverlayInputs(ctx.cwd, scope, result);

  if (result.action === "save-enable") {
    await enableGateway(pi, ctx, scope, false);
    return;
  }

  if (result.action === "disable") {
    await disableGateway(pi, ctx, scope);
    return;
  }

  const config = getGatewayConfig(ctx.cwd);
  await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);
  await updateFooterStatus(ctx, false);

  const report = [
    `Saved ${scope} gateway fallback settings.`,
    `- Base URL: ${describeConfigValue(config.baseUrl, config.baseUrlSource)}`,
    `- API key: ${describeApiKey(config.apiKey, config.apiKeySource)}`,
    `- Scoped model mode: ${config.exclusiveScope ? "exclusive" : "additive"}`,
    `- Effective enabled: ${config.enabled ? "yes" : "no"}`,
    `- Save file: ${scope === "project" ? projectGatewayConfigPath(ctx.cwd) : globalGatewayConfigPath()}`,
  ].join("\n");

  await emitCommandOutput(pi, ctx, "SF LLM Gateway Internal setup saved.", report, "info");
}

// -------------------------------------------------------------------------------------------------
// Enable / disable gateway
// -------------------------------------------------------------------------------------------------

async function enableGateway(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
  promptForMissingCredentials: boolean,
): Promise<void> {
  const settingsPath = scope === "project" ? projectSettingsPath(ctx.cwd) : globalSettingsPath();
  const configPath =
    scope === "project" ? projectGatewayConfigPath(ctx.cwd) : globalGatewayConfigPath();

  const settings = readSettings(settingsPath);

  if (promptForMissingCredentials) {
    const configured = await ensureGatewayCredentialsConfigured(pi, ctx, scope);
    if (!configured) {
      return;
    }
  }

  const saved = readGatewaySavedConfig(configPath);
  const exclusiveScope = saved.exclusiveScope === true;

  if (!isGatewayProvider(asOptionalString(settings.defaultProvider))) {
    saved.previousDefaultProvider = asOptionalString(settings.defaultProvider);
    saved.previousDefaultModel = asOptionalString(settings.defaultModel);
    saved.previousThinkingLevel = asOptionalString(settings.defaultThinkingLevel);
  }

  if (exclusiveScope) {
    if (shouldCaptureExclusiveScopeSnapshot(settings.enabledModels, saved.previousEnabledModels)) {
      saved.previousEnabledModels = snapshotEnabledModelsForExclusiveScope(settings.enabledModels);
    }
  } else {
    delete saved.previousEnabledModels;
  }

  saved.enabled = true;
  writeGatewaySavedConfig(configPath, saved);

  const config = getGatewayConfig(ctx.cwd);
  if (!config.baseUrl || !config.apiKey) {
    await emitCommandOutput(
      pi,
      ctx,
      "SF LLM Gateway Internal is still missing configuration.",
      [
        `Base URL: ${describeConfigValue(config.baseUrl, config.baseUrlSource)}`,
        `API key: ${describeApiKey(config.apiKey, config.apiKeySource)}`,
        `Use /${COMMAND_NAME} setup ${scope} or set ${BASE_URL_ENV} / ${API_KEY_ENV}.`,
      ].join("\n"),
      "warning",
    );
    return;
  }

  const state = await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);
  const effectiveDefaultModelId = resolveGatewayDefaultModelId([
    DEFAULT_MODEL_ID,
    PREVIOUS_DEFAULT_MODEL_ID,
    FALLBACK_MODEL_ID,
  ]);
  const effectiveProviderName = providerForModelId(effectiveDefaultModelId);

  settings.defaultProvider = effectiveProviderName;
  settings.defaultModel = effectiveDefaultModelId;
  settings.defaultThinkingLevel = DEFAULT_THINKING_LEVEL;
  setEnabledModelsSetting(settings, applyGatewayModelScope(settings.enabledModels, exclusiveScope));
  writeSettings(settingsPath, settings);

  const model = ctx.modelRegistry.find(effectiveProviderName, effectiveDefaultModelId);
  if (model) {
    const changed = await pi.setModel(model);
    if (changed) {
      // Explicit enable command — always apply the recommended default here.
      pi.setThinkingLevel(DEFAULT_THINKING_LEVEL);
      lastAppliedThinkingLevel = DEFAULT_THINKING_LEVEL;
    }
  }

  await updateFooterStatus(ctx, true);

  const report = [
    `Enabled in ${scope} settings.`,
    `- Provider: ${effectiveProviderName}`,
    `- Model: ${effectiveDefaultModelId}${effectiveDefaultModelId !== DEFAULT_MODEL_ID ? ` (resolved from ${DEFAULT_MODEL_ID})` : ""}`,
    `- Thinking: ${DEFAULT_THINKING_LEVEL}`,
    `- Scoped model mode: ${exclusiveScope ? `exclusive (gateway-only: ${ENABLED_MODEL_PATTERN})` : `additive (prepended ${ENABLED_MODEL_PATTERN})`}`,
    `- Base URL: ${describeConfigValue(config.baseUrl, config.baseUrlSource)}`,
    `- API key: ${describeApiKey(config.apiKey, config.apiKeySource)}`,
    `- Discovery source: ${state.source}${state.error ? ` (${state.error})` : ""}`,
  ].join("\n");

  await emitCommandOutput(
    pi,
    ctx,
    "SF LLM Gateway Internal enabled.",
    report,
    state.error ? "warning" : "info",
  );
}

async function disableGateway(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  const settingsPath = scope === "project" ? projectSettingsPath(ctx.cwd) : globalSettingsPath();
  const configPath =
    scope === "project" ? projectGatewayConfigPath(ctx.cwd) : globalGatewayConfigPath();

  const settings = readSettings(settingsPath);
  const saved = readGatewaySavedConfig(configPath);
  const exclusiveScope = saved.exclusiveScope === true;
  const restoredEnabledModels = exclusiveScope
    ? restoreEnabledModelsSnapshot(saved.previousEnabledModels)
    : removeEnabledModelPattern(settings.enabledModels);

  saved.enabled = false;
  delete saved.previousEnabledModels;
  writeGatewaySavedConfig(configPath, saved);

  setEnabledModelsSetting(settings, restoredEnabledModels);
  settings.defaultProvider = OFF_DEFAULT_PROVIDER;
  settings.defaultModel = OFF_DEFAULT_MODEL_ID;
  settings.defaultThinkingLevel = OFF_DEFAULT_THINKING_LEVEL;

  writeSettings(settingsPath, settings);

  let switchedToOffDefault = false;
  if (isGatewayProvider(ctx.model?.provider)) {
    const offDefaultModel = ctx.modelRegistry.find(OFF_DEFAULT_PROVIDER, OFF_DEFAULT_MODEL_ID);
    if (offDefaultModel) {
      switchedToOffDefault = await pi.setModel(offDefaultModel);
      if (switchedToOffDefault) {
        pi.setThinkingLevel(OFF_DEFAULT_THINKING_LEVEL);
        lastAppliedThinkingLevel = OFF_DEFAULT_THINKING_LEVEL;
      }
    }
  }

  await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);
  await updateFooterStatus(ctx, false);

  const report = [
    `Disabled in ${scope} settings.`,
    `- Scoped models: ${exclusiveScope ? "restored the previous scoped model set" : `removed ${ENABLED_MODEL_PATTERN}`}`,
    `- New default: ${OFF_DEFAULT_PROVIDER}/${OFF_DEFAULT_MODEL_ID}`,
    `- Thinking: ${OFF_DEFAULT_THINKING_LEVEL}`,
    `- Switched current session model: ${switchedToOffDefault ? "yes" : "no"}`,
    `- Saved credentials remain in ${scope === "project" ? projectGatewayConfigPath(ctx.cwd) : globalGatewayConfigPath()}`,
  ].join("\n");

  await emitCommandOutput(pi, ctx, "SF LLM Gateway Internal disabled.", report, "info");
}

async function ensureGatewayCredentialsConfigured(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<boolean> {
  let config = getGatewayConfig(ctx.cwd);
  if (config.baseUrl && config.apiKey) {
    return true;
  }

  if (!ctx.hasUI) {
    await emitCommandOutput(
      pi,
      ctx,
      "SF LLM Gateway Internal needs configuration.",
      `Set ${API_KEY_ENV}, or run /${COMMAND_NAME} setup ${scope} in interactive Pi. Use ${BASE_URL_ENV} only if you need to override the built-in default.`,
      "warning",
    );
    return false;
  }

  if (!config.baseUrl) {
    const ok = await promptAndSaveBaseUrl(pi, ctx, scope, { quiet: true });
    if (!ok) {
      await emitCommandOutput(
        pi,
        ctx,
        "Setup cancelled.",
        "Base URL was not configured.",
        "warning",
      );
      return false;
    }
  }

  config = getGatewayConfig(ctx.cwd);
  if (!config.apiKey) {
    const ok = await promptAndSaveApiKey(pi, ctx, scope, { quiet: true });
    if (!ok) {
      await emitCommandOutput(
        pi,
        ctx,
        "Setup cancelled.",
        "API key was not configured.",
        "warning",
      );
      return false;
    }
  }

  config = getGatewayConfig(ctx.cwd);
  return Boolean(config.baseUrl && config.apiKey);
}

async function promptAndSaveBaseUrl(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
  options?: { quiet?: boolean },
): Promise<boolean> {
  const configPath =
    scope === "project" ? projectGatewayConfigPath(ctx.cwd) : globalGatewayConfigPath();
  const saved = readGatewaySavedConfig(configPath);
  const resolved = getGatewayConfig(ctx.cwd);

  const hint =
    resolved.baseUrlSource === "env"
      ? `\nCurrent value comes from ${BASE_URL_ENV}; a saved value is used only when the env var is absent.`
      : DEFAULT_BASE_URL
        ? `\nLeave this blank to remove the saved value for this scope and fall back to other saved scopes or the built-in default (${DEFAULT_BASE_URL}).`
        : `\nLeave this blank to clear the saved value for this scope. This extension has no built-in default URL — you must provide one via env var or setup.`;

  const value = await ctx.ui.input(
    `SF LLM Gateway base URL (${scope})${hint}`,
    saved.baseUrl ?? resolved.baseUrl ?? DEFAULT_BASE_URL,
  );

  if (value == null) {
    return false;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    delete saved.baseUrl;
  } else {
    const normalized = normalizeBaseUrl(trimmed);
    if (!normalized) {
      await emitCommandOutput(
        pi,
        ctx,
        "Invalid base URL.",
        "Please enter a valid http:// or https:// URL.",
        "warning",
      );
      return false;
    }
    saved.baseUrl = normalized;
  }

  writeGatewaySavedConfig(configPath, saved);
  await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);
  await updateFooterStatus(ctx, false);

  if (!options?.quiet) {
    await emitCommandOutput(
      pi,
      ctx,
      "Saved SF LLM Gateway base URL.",
      `Base URL source is now ${describeConfigValue(getGatewayConfig(ctx.cwd).baseUrl, getGatewayConfig(ctx.cwd).baseUrlSource)}.`,
      "info",
    );
  }
  return true;
}

async function promptAndSaveApiKey(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
  options?: { quiet?: boolean },
): Promise<boolean> {
  const configPath =
    scope === "project" ? projectGatewayConfigPath(ctx.cwd) : globalGatewayConfigPath();
  const saved = readGatewaySavedConfig(configPath);
  const resolved = getGatewayConfig(ctx.cwd);

  const hint =
    resolved.apiKeySource === "env"
      ? `\nCurrent value comes from ${API_KEY_ENV}; a saved value is used only when the env var is absent.`
      : "";

  const value = await ctx.ui.input(`SF LLM Gateway API key (${scope})${hint}`, "");

  if (value == null) {
    return false;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    delete saved.apiKey;
  } else {
    saved.apiKey = trimmed;
  }

  writeGatewaySavedConfig(configPath, saved);
  await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);
  await updateFooterStatus(ctx, false);

  if (!options?.quiet) {
    const next = getGatewayConfig(ctx.cwd);
    await emitCommandOutput(
      pi,
      ctx,
      "Saved SF LLM Gateway API key.",
      `API key source is now ${describeApiKey(next.apiKey, next.apiKeySource)}.`,
      "info",
    );
  }
  return true;
}

// Render command output for both TUI and headless runs.
//
// In interactive Pi (hasUI=true) we put the full report into `notify` —
// Pi's notification popup renders multi-line content, and every other
// extension in this repo (sf-devbar, sf-slack, sf-pi-manager, sf-welcome)
// uses the same pattern. Without this, only the short `summary` string is
// shown and the actual report never reaches the user.
//
// In headless mode we still surface the summary via notify and push the
// detailed report into the transcript via sendMessage so it shows up in
// session logs / non-TUI transports.
async function emitCommandOutput(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  summary: string,
  details: string,
  level: "info" | "warning" | "error",
): Promise<void> {
  const body = details ? `${summary}\n\n${details}` : summary;

  if (ctx.hasUI) {
    ctx.ui.notify(body, level);
    return;
  }

  ctx.ui.notify(summary, level);
  pi.sendMessage(
    {
      customType: PROVIDER_NAME,
      content: details,
      display: true,
      details: {},
    },
    { triggerTurn: false },
  );
}

// -------------------------------------------------------------------------------------------------
// Footer status + session defaults
// -------------------------------------------------------------------------------------------------

async function syncGatewaySessionDefaults(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  forceRefreshUsage: boolean,
): Promise<void> {
  const startupDefault = getEffectiveDefaultModelSetting(ctx.cwd);
  if (isGatewayProvider(startupDefault.provider)) {
    const desiredModelId = resolveGatewayDefaultModelId([
      startupDefault.modelId,
      DEFAULT_MODEL_ID,
      PREVIOUS_DEFAULT_MODEL_ID,
      FALLBACK_MODEL_ID,
    ]);
    repairGatewayDefaultModelSettings(ctx.cwd, desiredModelId);
    const desiredProvider = providerForModelId(desiredModelId);
    if (ctx.model?.provider !== desiredProvider || ctx.model.id !== desiredModelId) {
      const desiredModel = ctx.modelRegistry.find(desiredProvider, desiredModelId);
      if (desiredModel) {
        await pi.setModel(desiredModel);
      }
    }
  }

  if (isGatewayProvider(ctx.model?.provider) || isGatewayProvider(startupDefault.provider)) {
    // At session startup the current thinking level is pi's resolved default
    // (settings or xhigh from our `on` command). Apply through the
    // user-respecting helper so users who edited settings to a different
    // default do not get overridden by the extension.
    applyGatewayDefaultThinkingLevel(pi);
  }

  await updateFooterStatus(ctx, forceRefreshUsage);
}

async function updateFooterStatus(
  ctx: ExtensionContext,
  forceRefreshUsage: boolean,
): Promise<void> {
  if (!isGatewayProvider(ctx.model?.provider)) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  await refreshMonthlyUsage(forceRefreshUsage, ctx.cwd);
  ctx.ui.setStatus(STATUS_KEY, buildFooterStatus(ctx, getRuntimeStatusState()));
}

// Exported for unit tests.
export {
  applyGatewayModelScope,
  ensureEnabledModelPattern,
  isExclusiveEnabledModelPattern,
  normalizeLegacyGatewayEnabledModels,
  removeEnabledModelPattern,
  restoreEnabledModelsSnapshot,
  shouldCaptureExclusiveScopeSnapshot,
  snapshotEnabledModelsForExclusiveScope,
} from "./lib/pi-settings.ts";
