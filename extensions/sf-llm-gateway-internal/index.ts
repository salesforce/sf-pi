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
 * - Registers a static bootstrap catalog synchronously, then layers in the
 *   previous cached discovery catalog so Pi startup can resolve default and
 *   scoped models before async discovery finishes
 * - Dynamic model discovery via `/v1/models` for all valid gateway model IDs
 * - Static presets for common models, generic family-aware inference for newly discovered ones
 * - Uses Pi's built-in custom-provider support instead of models.json hacks
 * - Shows an explicit SF LLM Gateway footer status when one of these models is active
 * - Footer status includes chosen model, current context usage, and monthly gateway usage
 * - Defaults gateway sessions to Pi thinking level xhigh
 * - Repairs retired gateway enabledModels entries before startup validation
 * - Runtime beta header toggles with env var initial defaults
 * - Keeps the runtime spine in this file while pushing settings/status helpers to lib/
 *
 * Configuration:
 * - SF_LLM_GATEWAY_INTERNAL_BASE_URL   optional automation fallback. Normal users
 *                                       should configure the endpoint via setup.
 *                                       Saved config wins over env vars to avoid
 *                                       stale shell/Keychain exports shadowing new
 *                                       pasted values.
 * - SF_LLM_GATEWAY_INTERNAL_API_KEY    optional automation fallback. Normal users
 *                                       should paste/rotate keys with /login or setup.
 * - SF_LLM_GATEWAY_INTERNAL_BETAS      optional — comma-separated Anthropic beta
 *                                       header values. When set, only listed values are
 *                                       active. When unset, model defaults apply.
 *
 * Commands:
 * - /sf-llm-gateway-internal                     open status & controls panel (UI) or text status (headless)
 * - /sf-llm-gateway-internal status              show text status
 * - /sf-llm-gateway-internal setup [global|project]
 * - /sf-llm-gateway-internal on [global|project]   enable provider + set gateway default
 * - /sf-llm-gateway-internal off [global|project]  disable provider + set off-default
 * - /sf-llm-gateway-internal refresh               refresh models + monthly usage
 * - /sf-llm-gateway-internal set-default [global|project]
 * - /sf-llm-gateway-internal beta                  show beta header state
 * - /sf-llm-gateway-internal beta <name> on|off    toggle a beta header at runtime
 * - /sf-llm-gateway-internal models                list discovered models
 * - /sf-llm-gateway-internal usage-probe [--trace] classify user/key usage scope (--trace prints per-endpoint timings)
 * - /sf-llm-gateway-internal tokens <modelId> [prompt]
 * - /sf-llm-gateway-internal onboard
 * - /sf-llm-gateway-internal debug <modelId> [reasoning=<level>] [tool] [adaptive]
 * - /sf-llm-gateway-internal latency-probe [modelId] [--large] [--beta-compare] [--bedrock]
 *
 * Behavior matrix:
 *
 *   Event/Trigger               | Condition                          | Result
 *   ----------------------------|------------------------------------|-------------------------------
 *   Extension load              | enabled + has credentials          | Register static catalog, fire-and-forget discovery
 *   Extension load              | disabled                           | Unregister provider
 *   session_start               | —                                  | Sync defaults (sync), fire-and-forget discovery, one-time key-conflict notify
 *   turn_end                    | model is gateway model             | Update footer (context + monthly usage); first turn_end also kicks refreshUsageDetails
 *   turn_end                    | model is NOT gateway model         | Clear footer status
 *   model_select                | selected model is gateway          | Set thinking to xhigh
 *   after_provider_response     | model is gateway model + 2xx       | Clear any live throttle/upstream warning
 *   after_provider_response     | model is gateway model + 429       | Record throttle signal, footer shows ⚠ badge for 60s
 *   after_provider_response     | model is gateway model + 5xx       | Record upstream signal, footer shows ⚠ badge for 60s
 *   session_shutdown            | —                                  | Clear footer status + provider signal
 *   /command (no args)          | interactive UI                     | Open status & controls panel
 *   /command (no args)          | no UI                              | Print text status report
 *   /command on                 | missing credentials                | Prompt for credentials first
 *   /command on                 | credentials present                | Save config, set default, register, discover
 *   /command off                | —                                  | Disable, remove pattern, switch to off-default
 *   /command refresh            | —                                  | Re-discover, refresh monthly usage
 *   /command latency-probe      | —                                  | Run read-only gateway timing probes
 *   /command usage-probe        | —                                  | Force read-only usage probe
 *   /command beta <name> on     | —                                  | Toggle beta, re-register provider
 *   Monthly usage fetch         | cached < 60 s old                  | Use cache
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

import { Text } from "@earendil-works/pi-tui";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  MessageRenderer,
} from "@earendil-works/pi-coding-agent";

// --- Lib imports ---

import {
  PROVIDER_NAME,
  COMMAND_NAME,
  FRIENDLY_COMMAND_NAME,
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
  type SavedGatewayConfig,
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
function providerForModelId(modelId: string): string {
  void modelId;
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

import { GatewaySetupOverlayComponent, type SetupOverlayResult } from "./lib/setup-overlay.ts";
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
  registerCachedDiscoveryIfAvailable,
  registerProviderIfConfigured,
} from "./lib/discovery.ts";
import { migrateGatewaySettings } from "./lib/migrate-unify-provider.ts";
import { fetchTransformReport, formatTransformReport, type TransformProbe } from "./lib/debug.ts";
import { fetchGatewayDoctorReport, formatGatewayDoctorReport } from "./lib/doctor.ts";
import {
  fetchGatewayLatencyProbe,
  formatGatewayLatencyProbe,
  parseLatencyProbeArgs,
} from "./lib/latency-probe.ts";
import { countTokens, estimateSpend, formatTokenReport } from "./lib/token-counter.ts";
import { buildOnboardingUrl } from "./lib/onboarding.ts";
import { openUrlInBrowser } from "./lib/open-url.ts";
import {
  readClaudeCodeGatewayConfig,
  getClaudeCodeSettingsPath,
} from "./lib/claude-code-import.ts";
import {
  formatOnboardChainReport,
  runOnboardChain,
  shouldNotifyClaudeCodeFirstRun,
  type OnboardChainDeps,
  type OnboardChainResult,
} from "./lib/onboard-action.ts";
import { markClaudeCodeNotifyShown } from "./lib/onboarding-state.ts";
import {
  buildLaunchAgentPlist,
  buildZshenvBlock,
  defaultLaunchAgentPath,
  defaultZshenvPath,
  downloadBundle,
  loadLaunchAgent,
  probeBundleCandidates,
  writeLaunchAgentPlist,
  writeZshenvBlockSafely,
  type BundleProbeResult,
} from "./lib/ca-bundle-fixer.ts";
import { writeCaBundleFixerState } from "./lib/ca-bundle-fixer-state.ts";
import { writeCaProbeState } from "./lib/ca-probe-state.ts";
import {
  collectUsableCaBundlePaths,
  discoverGatewayOnboardingSources,
  formatDiscoveredCaBundleSummary,
} from "./lib/onboarding-sources.ts";
import {
  GATEWAY_COMMAND_SURFACE,
  getGatewayArgumentCompletions,
  formatGatewayAliasReference,
  formatGatewayCommandReference,
  type GatewayCommandId,
} from "./lib/command-surface.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import { runExtensionDoctor as runGatewayExtensionDoctor } from "./lib/doctor.ts";
import {
  getMonthlyUsageState,
  refreshMonthlyUsage,
  refreshUsageDetails,
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
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { markBootStep } from "../../lib/common/boot-timing.ts";
import { globalAgentPath } from "../../lib/common/pi-paths.ts";

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
    | "latency-probe"
    | "doctor"
    | "usage-probe"
    | "tokens"
    | "onboard"
    | "open-token"
    | "import-claude"
    | "fix-ca-bundle"
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
  const {
    monthlyUsage,
    monthlyUsageError,
    keyInfo,
    keyInfoError,
    health,
    healthError,
    connectionStatus,
    dailyActivity,
    dailyActivityError,
    keyList,
    keyListError,
  } = getMonthlyUsageState();
  return {
    discovery: getLastDiscovery(),
    monthlyUsage,
    monthlyUsageError,
    keyInfo,
    keyInfoError,
    health,
    healthError,
    connectionStatus: connectionStatus ?? null,
    dailyActivity: dailyActivity ?? null,
    dailyActivityError: dailyActivityError ?? null,
    keyList: keyList ?? null,
    keyListError: keyListError ?? null,
    runtimeBetaOverrides: getBetaOverrides(),
    runtimeExtraBetas: getBetaExtras(),
  };
}

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfLlmGatewayInternalExtension(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-llm-gateway-internal")) return;

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
  // reads global saved config first, then env vars as automation fallback.
  registerProviderIfConfigured(pi, getBetaOverrides(), getBetaExtras());

  // If a prior session discovered additional gateway models, register that
  // local cache now too. Pi resolves scoped model patterns before
  // session_start, so waiting until session_start would leave explicit model
  // allow-lists stuck on the smaller bootstrap catalog for this session.
  registerCachedDiscoveryIfAvailable(pi, getBetaOverrides(), getBetaExtras());

  // Contribute to the aggregated `/sf-pi doctor` view. The standalone
  // `/sf-llm-gateway-internal doctor` command keeps using
  // fetchGatewayDoctorReport directly for backwards-compat rendering.
  registerExtensionDoctor("sf-llm-gateway-internal", (cwd) => runGatewayExtensionDoctor(cwd));
  registerManagerDetailActions(pi, "sf-llm-gateway-internal", buildGatewayManagerActions(pi));

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

  pi.registerCommand(FRIENDLY_COMMAND_NAME, {
    description: "SF LLM Gateway — status, controls, and credential setup",
    getArgumentCompletions: getGatewayArgumentCompletions,
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, FRIENDLY_COMMAND_NAME, () =>
        handleCommand(pi, args.trim() ? args : "", ctx),
      );
    },
  });

  // The legacy `/sf-llm-gateway-internal` slash command was retired in
  // v0.56.0 — see ADR 0007. The provider id is still PROVIDER_NAME (=
  // sf-llm-gateway-internal) for model routing and pi-native auth
  // resolution; only the user-facing slash command went away. Users land
  // on /sf-llm-gateway as the single entry point. If any caller still
  // types the old name, pi's "unknown command" guidance covers it.

  // Deferred startup timers capture `ctx`, whose getters (cwd, ui, …) throw
  // once the ctx is stale after ctx.reload(). Track them so session_shutdown
  // cancels them before teardown; a reload within the timer window would
  // otherwise fire them against a stale ctx and crash pi.
  let deferredStartupTimers: Array<ReturnType<typeof setTimeout>> = [];
  const clearDeferredStartupTimers = () => {
    for (const t of deferredStartupTimers) clearTimeout(t);
    deferredStartupTimers = [];
  };

  pi.on("session_start", async (_event, ctx) => {
    clearDeferredStartupTimers();
    // Capture cwd while the ctx is valid; deferred callbacks must not read
    // ctx.cwd later (the getter throws on a stale ctx).
    const startupCwd = ctx.cwd;
    // Fresh session — forget any thinking-level we set in a previous session.
    lastAppliedThinkingLevel = undefined;

    // Install the retry-telemetry listener so transparent Anthropic
    // early-stream retries surface as user-visible notifications. These
    // retries use the same provider retry budget Pi passes through the
    // transport; the listener captures `ctx` by closure — session_shutdown
    // clears it so we do not hold a stale reference past the session.
    setRetryEventListener((event: RetryEvent) => {
      const level: "info" | "warning" = event.type === "retry_exhausted" ? "warning" : "info";
      ctx.ui.notify(formatRetryEventNotification(event), level);
    });

    // One-shot migration: rewrite references to the retired
    // `sf-llm-gateway-internal-anthropic` provider in pi's settings.json
    // files. Idempotent via a per-file sentinel under `sfPi`. See
    // lib/migrate-unify-provider.ts for details. Runs before the legacy
    // settings repair below so downstream repair never sees ghost ids.
    await markBootStep("sf-llm-gateway.settings-migrate", () => migrateGatewaySettings(ctx.cwd));

    // Repair legacy settings using the session's cwd (previously done at
    // factory time with process.cwd(), moved here for 0.68.0 compliance).
    await markBootStep("sf-llm-gateway.settings-repair", () => {
      repairGatewayEnabledModelSettings(ctx.cwd);
      repairGatewayDefaultModelSettings(ctx.cwd, DEFAULT_MODEL_ID);
    });

    // Phase 2.1: don't await `discoverAndRegister`. The bootstrap catalog
    // is registered synchronously in the factory, so models work immediately
    // even before live discovery completes. Awaiting here was the single
    // biggest contributor to slow `session_start` (~2-4s on cold network).
    //
    // Chunk 4/10: syncGatewaySessionDefaults now keeps only cheap local
    // setup in the awaited startup path. Footer usage refresh is display
    // state, and active-model correction is not startup's job — pi's own
    // settings resolver is the source of truth for the initial model.
    registerCachedDiscoveryIfAvailable(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);

    await markBootStep("sf-llm-gateway.sync-defaults", () =>
      syncGatewaySessionDefaults(pi, ctx, false, {
        awaitFooterRefresh: false,
        allowModelSwitch: false,
      }),
    );

    // Chunk 7: cached discovery is good enough for startup. Refresh the live
    // gateway catalog after first paint so model-list drift self-corrects
    // without adding network pressure to the boot path. Explicit
    // /sf-llm-gateway refresh still awaits discoverAndRegister immediately.
    const discoveryTimer = setTimeout(() => {
      void markBootStep("sf-llm-gateway.discover (deferred)", () =>
        discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), startupCwd),
      ).catch(() => undefined);
    }, 2_500);
    discoveryTimer.unref?.();
    deferredStartupTimers.push(discoveryTimer);

    // Phase 1.6: key-conflict detection is surfaced by sf-welcome's inline
    // gateway row and /sf-llm-gateway doctor / usage-probe --trace. Do not
    // toast during startup: notifications render over the splash and make
    // first paint noisy.

    // First-run Claude Code nudge. Cache-first, deferred past first paint:
    //  1. State-store read (cheap; "have we shown this?")
    //  2. Saved config read (cheap; "do they already have a key?")
    //  3. existsSync ~/.claude/settings.json (cheap)
    //  4. Only on hit — parse + score the Claude Code settings file once.
    // Sentinel-marked once shown so this never nags twice.
    const claudeNotifyTimer = setTimeout(() => {
      void markBootStep("sf-llm-gateway.claude-code-nudge (deferred)", () => {
        const decision = shouldNotifyClaudeCodeFirstRun({ cwd: startupCwd });
        if (!decision.shouldNotify) return Promise.resolve();
        const summary = decision.importedBaseUrl
          ? `Found gateway credentials in Claude Code (${decision.importedBaseUrl}). Run /${FRIENDLY_COMMAND_NAME} onboard to import them.`
          : `Found gateway credentials in Claude Code. Run /${FRIENDLY_COMMAND_NAME} onboard to import them.`;
        ctx.ui.notify(summary, "info");
        markClaudeCodeNotifyShown();
        return Promise.resolve();
      }).catch(() => undefined);
    }, 4_000);
    claudeNotifyTimer.unref?.();
    deferredStartupTimers.push(claudeNotifyTimer);
  });

  // Track whether we've already kicked off the cold-start details fetch
  // for this session. We delay it past first turn_end so cold session_start
  // stays fast (Phase 1.4 + 2.1).
  let detailsKickedOff = false;
  pi.on("turn_end", async (_event, ctx) => {
    // Refresh the `💰 $N/∞` pill right after every assistant turn so the
    // cost figure tracks the session closely. The refresh is throttled by
    // MONTHLY_USAGE_TTL_MS inside refreshMonthlyUsage(), so back-to-back
    // turns do not hammer the gateway — the network call only fires once
    // per TTL window.
    await updateFooterStatus(ctx, false);

    // Phase 1.4: details (daily activity, key list) are not on the splash
    // hot path. Kick them off after the first turn_end so they land before
    // the user opens /sf-llm-gateway, but never delay session_start.
    if (!detailsKickedOff) {
      detailsKickedOff = true;
      void refreshUsageDetails(false, ctx.cwd).catch(() => undefined);
    }
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
  // a live ⚠ badge without waiting for the 60-second /user/info refresh.
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
    clearDeferredStartupTimers();
    clearProviderSignal();
    clearRetryEventListener();
    lastAppliedThinkingLevel = undefined;
    detailsKickedOff = false;
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

export function buildGatewayManagerActions(pi: ExtensionAPI): ManagerDetailAction[] {
  return GATEWAY_COMMAND_SURFACE.map(
    (item): ManagerDetailAction =>
      gatewayManagerAction(
        pi,
        item.id,
        item.label,
        item.description,
        item.section,
        Boolean(item.acceptsScope),
      ),
  );
}

function gatewayManagerAction(
  pi: ExtensionAPI,
  command: GatewayCommandId,
  label: string,
  description: string,
  group: string,
  acceptsScope: boolean,
): ManagerDetailAction {
  return {
    id: command,
    label,
    description,
    group,
    acceptsScope,
    run: (ctx, scope) => handlePanelAction(pi, ctx, command, scope),
    ...(command === "setup" ? { closeBeforeRun: true } : {}),
  };
}

async function handleCommand(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (args.trim().length === 0 && ctx.hasUI) {
    return openGatewayInManager(pi, ctx, "detail");
  }

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
    case "latency-probe":
      return handleLatencyProbeCommand(pi, ctx, parsed.positional ?? []);
    case "doctor":
      return handleDoctorCommand(pi, ctx);
    case "usage-probe":
      return handleUsageProbeCommand(pi, ctx, parsed.positional ?? []);
    case "tokens":
      return handleTokensCommand(pi, ctx, parsed.positional ?? []);
    case "onboard":
      return handleOnboardCommand(pi, ctx, parsed.scope);
    case "open-token":
      return handleOpenTokenCommand(pi, ctx);
    case "import-claude":
      return handleImportClaudeCommand(pi, ctx, parsed.scope);
    case "fix-ca-bundle":
      return handleFixCaBundleCommand(pi, ctx);
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

async function openGatewayInManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  view: NonNullable<SfPiManagerOpenRoute["view"]>,
): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: "sf-llm-gateway-internal",
    view,
    actions: buildGatewayManagerActions(pi),
  });
  if (!opened) {
    ctx.ui.notify(
      "SF Pi Manager is unavailable. Try /sf-pi open sf-llm-gateway-internal.",
      "warning",
    );
  }
}

async function handlePanelAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  action: GatewayCommandId,
  scope: "global" | "project",
): Promise<void> {
  switch (action) {
    case "setup":
      return runSetupWizard(pi, ctx, scope);
    case "on":
      return enableGateway(pi, ctx, scope, true);
    case "off":
      return disableGateway(pi, ctx, scope);
    case "set-default":
      return handleSetDefaultCommand(pi, ctx, scope);
    case "refresh":
      return handleRefreshCommand(pi, ctx);
    case "models":
      return handleModelsCommand(pi, ctx);
    case "debug":
      return handleDebugCommand(pi, ctx, [getPanelDefaultModelId(ctx)]);
    case "latency-probe":
      return handleLatencyProbeCommand(pi, ctx, [getPanelDefaultModelId(ctx)]);
    case "doctor":
      return handleDoctorCommand(pi, ctx);
    case "usage-probe":
      return handleUsageProbeCommand(pi, ctx, []);
    case "tokens":
      return handleTokensCommand(pi, ctx, [getPanelDefaultModelId(ctx)]);
    case "onboard":
      return handleOnboardCommand(pi, ctx, scope);
    case "open-token":
      return handleOpenTokenCommand(pi, ctx);
    case "import-claude":
      return handleImportClaudeCommand(pi, ctx, scope);
    case "fix-ca-bundle":
      return handleFixCaBundleCommand(pi, ctx);
    case "beta":
      return handleBetaCommandImpl(pi, ctx, [], (summary, details, level) =>
        emitCommandOutput(pi, ctx, summary, details, level),
      );
    case "help":
      return handleHelpCommand(pi, ctx);
    case "status":
    default:
      return handleStatusCommand(pi, ctx);
  }
}

function getPanelDefaultModelId(ctx: ExtensionCommandContext): string {
  if (isGatewayProvider(ctx.model?.provider) && ctx.model?.id) {
    return ctx.model.id;
  }
  return DEFAULT_MODEL_ID;
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

async function handleDoctorCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  try {
    const report = await fetchGatewayDoctorReport(ctx.cwd);
    await emitCommandOutput(
      pi,
      ctx,
      "SF LLM Gateway Internal doctor.",
      formatGatewayDoctorReport(report),
      report.checks.some((check) => !check.ok) ? "warning" : "info",
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await emitCommandOutput(
      pi,
      ctx,
      "SF LLM Gateway Internal doctor failed.",
      [
        "SF LLM Gateway Doctor failed before completing checks.",
        "",
        detail,
        "",
        `Try /${FRIENDLY_COMMAND_NAME} status. If authentication is failing, open /${FRIENDLY_COMMAND_NAME} and paste a new gateway API key.`,
      ].join("\n"),
      "error",
    );
  }
}

async function handleUsageProbeCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  positional: string[],
): Promise<void> {
  // Phase 3.1: --trace renders the per-endpoint timings captured by the
  // last refresh. Useful for diagnosing "splash says Unreachable but chat
  // works" without re-running the probes via curl.
  const traceFlag = positional.some((arg) => arg === "--trace" || arg === "-t" || arg === "trace");

  await refreshMonthlyUsage(true, ctx.cwd);
  // Also pull daily-activity + key-list so the existing report below has
  // numbers to render. Phase 1.4 split these out of the primary refresh
  // for boot performance, but the usage-probe view wants the full picture.
  await refreshUsageDetails(true, ctx.cwd);

  const {
    monthlyUsage,
    monthlyUsageError,
    keyInfo,
    keyInfoError,
    connectionStatus,
    dailyActivity,
    dailyActivityError,
    keyConflict,
    lastProbeTrace,
  } = getMonthlyUsageState();

  if (traceFlag) {
    await emitCommandOutput(
      pi,
      ctx,
      "SF LLM Gateway Internal usage probe — trace.",
      formatProbeTraceReport(connectionStatus, lastProbeTrace, keyConflict),
      connectionStatus?.kind === "connected" ? "info" : "warning",
    );
    return;
  }

  const lines: string[] = [
    "Gateway usage probe",
    "",
    `Connection: ${connectionStatus?.kind ?? "not checked"}${connectionStatus?.source ? ` via ${connectionStatus.source}` : ""}`,
    `Monthly/user usage: ${monthlyUsage ? `$${monthlyUsage.spend.toFixed(2)} spent${monthlyUsage.budgetResetAt ? `, resets ${monthlyUsage.budgetResetAt}` : ""}` : (monthlyUsageError ?? "not loaded")}`,
    `Current key spend: ${keyInfo ? `$${keyInfo.spend.toFixed(2)}${keyInfo.keyName ? ` on ${keyInfo.keyName}` : ""}` : (keyInfoError ?? "not loaded")}`,
  ];

  if (dailyActivity) {
    lines.push(
      "",
      `Last ${dailyActivity.entries.length}d activity (${dailyActivity.startDate} → ${dailyActivity.endDate}):`,
    );
    for (const e of dailyActivity.entries) {
      const marker = e.failedRequests > 0 ? " \u26A0" : "";
      lines.push(
        `  ${e.date}: $${e.spend.toFixed(4)} across ${e.apiRequests} requests (${e.failedRequests} failed${marker})`,
      );
    }
  } else if (dailyActivityError) {
    lines.push("", `Daily activity: ${dailyActivityError}`);
  }

  lines.push(
    "",
    "Conclusion:",
    "- /key/info is key-scoped and can reset when keys rotate.",
    monthlyUsage?.budgetResetAt || monthlyUsage?.budgetDuration
      ? "- /user/info appears user-scoped but budget-windowed, so it is not a lifetime counter."
      : "- /user/info did not prove a true lifetime user counter.",
    "- /user/daily/activity adds per-day granularity including failed_requests (early-warning signal).",
    "- The welcome splash does not show Lifetime Usage unless a true user-lifetime endpoint exists.",
  );

  await emitCommandOutput(
    pi,
    ctx,
    "SF LLM Gateway Internal usage probe.",
    lines.join("\n"),
    connectionStatus?.kind === "connected" ? "info" : "warning",
  );
}

/**
 * Render the per-endpoint trace produced by the last refresh as a compact
 * table. Renders OK / FAIL with HTTP status or AbortError name plus per-probe
 * duration so users can answer:
 *   - which endpoint was slow?
 *   - which endpoint failed?
 *   - was the failure HTTP or transport-level?
 * without re-running curl by hand. Mirrors the offline test format used in
 * the original investigation.
 */
function formatProbeTraceReport(
  connectionStatus: import("./lib/monthly-usage.ts").GatewayConnectionStatus | undefined | null,
  trace: import("./lib/monthly-usage.ts").GatewayProbeTrace | undefined | null,
  keyConflict: import("./lib/monthly-usage.ts").KeyConflictWarning | undefined | null,
): string {
  const lines: string[] = ["Gateway probe trace", ""];
  lines.push(
    `Connection: ${connectionStatus?.kind ?? "not checked"}${
      connectionStatus?.source ? ` via ${connectionStatus.source}` : ""
    }${connectionStatus?.timedOut ? " (timed out)" : ""}${
      connectionStatus?.retried ? " (retried)" : ""
    }`,
  );
  if (connectionStatus?.detail) lines.push(`Detail: ${connectionStatus.detail}`);
  if (connectionStatus?.checkedAt) lines.push(`Checked at: ${connectionStatus.checkedAt}`);
  lines.push("");

  if (!trace) {
    lines.push("No trace recorded yet — run /sf-llm-gateway refresh and rerun.");
  } else {
    lines.push(
      `Last probe: total ${trace.totalMs} ms${trace.wasRetry ? " (after one-shot retry)" : ""}, started ${trace.startedAt}`,
    );
    lines.push("");
    lines.push("  source           path                      result");
    lines.push("  ---------------- ------------------------- ------");
    for (const entry of trace.entries) {
      const result = entry.ok
        ? `OK in ${entry.durationMs}ms`
        : entry.status
          ? `HTTP ${entry.status} in ${entry.durationMs}ms`
          : `${entry.errorName ?? "error"} after ${entry.durationMs}ms`;
      lines.push(`  ${pad(entry.source, 16)} ${pad(entry.path, 25)} ${result}`);
      if (!entry.ok && entry.errorMessage) {
        lines.push(`    → ${entry.errorMessage.slice(0, 200)}`);
      }
    }
  }

  if (keyConflict) {
    lines.push("", "Key conflict warning:", `  ${keyConflict.message}`);
  }

  return lines.join("\n");
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

/**
 * `/sf-llm-gateway-internal tokens <modelId> [prompt]` — count tokens for a
 * prompt on a specific model and show the gateway’s USD cost estimate. The
 * gateway tokenizer + pricing are used server-side so callers avoid shipping
 * a local tokenizer that drifts from upstream.
 *
 * When no prompt is provided we use a short canned probe so users get a sane
 * sanity check by typing just `/sf-llm-gateway-internal tokens gpt-5`.
 */
/**
 * `/sf-llm-gateway-internal onboard` — one-shot onboarding chain.
 *
 * Chains: Claude Code import → register provider → gateway doctor → set
 * default model. Stops short on errors and surfaces the next action
 * (e.g. fix-ca-bundle for a TLS failure) inline. The previous prose-only
 * "print gateway root URL" behavior is now covered by the `open-token`
 * action, which also actually opens a browser.
 */
async function handleOnboardCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  const result = await executeOnboardChain(pi, ctx, scope);
  await emitCommandOutput(
    pi,
    ctx,
    `SF LLM Gateway onboard — ${result.summary}`,
    formatOnboardChainReport(result),
    result.level,
  );
}

/**
 * Build the OnboardChainDeps closure over the live pi/ctx and run the
 * chain. Kept as a small helper so other call sites (panel action,
 * tests) can invoke the chain without re-deriving the deps.
 */
function mergeDiscoveredCaBundleCandidates(
  saved: SavedGatewayConfig,
  cwd: string,
): { added: string[]; summary: string[] } {
  const existing = Array.isArray(saved.caBundleCandidates)
    ? saved.caBundleCandidates.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const discovery = discoverGatewayOnboardingSources({ cwd, caBundleCandidates: existing });
  const usablePaths = collectUsableCaBundlePaths(discovery);
  const added = usablePaths.filter((candidate) => !existing.includes(candidate));
  if (added.length > 0) {
    saved.caBundleCandidates = [...existing, ...added];
  }
  return { added, summary: formatDiscoveredCaBundleSummary(discovery) };
}

async function executeOnboardChain(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<OnboardChainResult> {
  const deps: OnboardChainDeps = {
    importClaudeCode: async (importScope) => {
      const settingsPath = getClaudeCodeSettingsPath();
      const imported = readClaudeCodeGatewayConfig(settingsPath);
      if (!imported.ok) {
        return { ok: false, importedAny: false, detail: imported.reason };
      }
      const configPath =
        importScope === "project" ? projectGatewayConfigPath(ctx.cwd) : globalGatewayConfigPath();
      const saved = readGatewaySavedConfig(configPath);
      const changed: string[] = [];
      if (imported.baseUrl) {
        saved.baseUrl = imported.baseUrl;
        changed.push("base URL");
      }
      if (imported.apiKey) {
        saved.apiKey = imported.apiKey;
        changed.push("API key");
      }
      const caDiscovery = mergeDiscoveredCaBundleCandidates(saved, ctx.cwd);
      if (caDiscovery.added.length > 0) {
        changed.push(
          `${caDiscovery.added.length} CA bundle candidate${caDiscovery.added.length === 1 ? "" : "s"}`,
        );
      }
      if (changed.length === 0) {
        return {
          ok: true,
          importedAny: false,
          detail:
            "Claude Code settings present, but no new gateway URL, token, or CA bundle candidate was detected.",
        };
      }
      writeGatewaySavedConfig(configPath, saved);
      return {
        ok: true,
        importedAny: true,
        detail: `Imported ${changed.join(" + ")} into ${importScope} scope.`,
      };
    },
    registerProvider: async () => {
      await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);
    },
    runDoctor: async () => {
      const report = await fetchGatewayDoctorReport(ctx.cwd);
      const allOk = report.checks.length > 0 && report.checks.every((check) => check.ok);
      const summary = allOk
        ? "Gateway preflight passed."
        : `Gateway preflight reported ${report.checks.filter((check) => !check.ok).length} failing check(s).`;
      return { allOk, failureClass: report.failureClass, summary };
    },
    setDefault: async (setScope) => {
      await applyGatewayDefault(pi, ctx, setScope);
    },
    hasUsableSavedConfig: () => {
      const config = getGatewayConfig(ctx.cwd);
      return Boolean(config.baseUrl) && Boolean(config.apiKey);
    },
  };
  return runOnboardChain(scope, deps);
}

/**
 * `/sf-llm-gateway fix-ca-bundle` — corporate CA bundle fixer.
 *
 * Walks the user through:
 *   1. Probe well-known + saved-config-extras candidate paths.
 *   2. Adopt the first valid bundle, OR offer to download from a
 *      configured `caBundleSource` URL when nothing was found.
 *   3. Confirm + write the LaunchAgent plist.
 *   4. Confirm + apply the sentinel-guarded ~/.zshenv block.
 *   5. Set NODE_EXTRA_CA_CERTS in-process and re-run the doctor so the
 *      user sees green checks before relaunching pi.
 *
 * Every disk-mutating step is HITL-gated. macOS-only — returns a clean
 * "not applicable" report on Linux/Windows so callers don't have to
 * platform-gate the action.
 */
async function handleFixCaBundleCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (process.platform !== "darwin") {
    await emitCommandOutput(
      pi,
      ctx,
      "fix-ca-bundle is macOS-only.",
      [
        "This action targets the macOS Node TLS-keychain gap. On Linux/Windows, Node already",
        "trusts the system CA store via OpenSSL \u2014 set NODE_EXTRA_CA_CERTS in your shell if your",
        "corporate setup needs it, no LaunchAgent required.",
      ].join("\n"),
      "info",
    );
    return;
  }

  const config = getGatewayConfig(ctx.cwd);
  const sourceDiscovery = discoverGatewayOnboardingSources({
    cwd: ctx.cwd,
    caBundleCandidates: config.caBundleCandidates,
  });
  const discoveredCandidates = collectUsableCaBundlePaths(sourceDiscovery);
  const candidateExtras = [...config.caBundleCandidates, ...discoveredCandidates];

  // Step 1 — probe candidates.
  const candidates = probeBundleCandidates(candidateExtras);
  const adopted = candidates.find((entry) => entry.valid);
  let bundlePath: string | undefined = adopted?.path;
  let source: "adopt" | "bootstrap" = "adopt";
  const summaryLines: string[] = [
    "fix-ca-bundle plan",
    "",
    `Probed candidates (${candidates.length}):`,
    ...candidates.map((entry) => formatProbeRow(entry)),
    ...formatDiscoveredCaBundleSummary(sourceDiscovery).map((line) => `  • ${line}`),
    "",
  ];

  if (!bundlePath) {
    // Step 2 — bootstrap path. Only proceed when a download URL is
    // configured — we never bake an internal hostname into the public
    // repo.
    if (!config.caBundleSource) {
      await emitCommandOutput(
        pi,
        ctx,
        "fix-ca-bundle: no bundle found and no download URL configured.",
        [
          ...summaryLines,
          "No valid PEM bundle was found at the well-known paths and no caBundleSource",
          "is configured. Either:",
          "  - save your bundle's absolute path into sfPi.gateway.caBundleCandidates and rerun, or",
          "  - set sfPi.gateway.caBundleSource (or SF_LLM_GATEWAY_INTERNAL_CA_BUNDLE_SOURCE) to a",
          "    download URL the agent can fetch the PEM from, then rerun.",
          "",
          "Public sf-pi ships no default download URL on purpose: the bundle source is",
          "organization-specific.",
        ].join("\n"),
        "warning",
      );
      return;
    }
    if (ctx.hasUI) {
      const proceed = await ctx.ui.confirm(
        `Download CA bundle from ${config.caBundleSource}?`,
        "This will save the PEM to ~/.pi/agent/sf-llm-gateway-internal/ca-bundle.pem.",
      );
      if (!proceed) {
        await emitCommandOutput(
          pi,
          ctx,
          "fix-ca-bundle cancelled.",
          "User declined to download the CA bundle.",
          "info",
        );
        return;
      }
    }
    const destPath = globalAgentPath("sf-llm-gateway-internal", "ca-bundle.pem");
    const downloaded = await downloadBundle(config.caBundleSource, destPath);
    if (!downloaded.ok || !downloaded.path) {
      await emitCommandOutput(
        pi,
        ctx,
        "fix-ca-bundle: download failed.",
        [
          ...summaryLines,
          `Download from ${config.caBundleSource} failed: ${downloaded.reason}`,
        ].join("\n"),
        "error",
      );
      return;
    }
    bundlePath = downloaded.path;
    source = "bootstrap";
    summaryLines.push(`Downloaded ${downloaded.bytesWritten ?? 0} bytes \u2192 ${bundlePath}`, "");
  } else {
    summaryLines.push(`Adopted ${bundlePath} (${adopted?.sizeBytes ?? "?"} bytes)`, "");
  }

  // Step 3 — LaunchAgent plist.
  const plistPath = defaultLaunchAgentPath();
  const plistXml = buildLaunchAgentPlist(bundlePath);
  if (ctx.hasUI) {
    const proceedPlist = await ctx.ui.confirm(
      `Write LaunchAgent to ${plistPath}?`,
      "This makes NODE_EXTRA_CA_CERTS available to apps launched from Dock/Spotlight.",
    );
    if (!proceedPlist) {
      await emitCommandOutput(
        pi,
        ctx,
        "fix-ca-bundle cancelled at LaunchAgent step.",
        [...summaryLines, "User declined to write the LaunchAgent."].join("\n"),
        "info",
      );
      return;
    }
  }
  try {
    await writeLaunchAgentPlist(plistPath, plistXml);
    summaryLines.push(`Wrote ${plistPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitCommandOutput(
      pi,
      ctx,
      "fix-ca-bundle: could not write LaunchAgent.",
      [...summaryLines, `Failed to write ${plistPath}: ${message}`].join("\n"),
      "error",
    );
    return;
  }
  const loadResult = loadLaunchAgent(plistPath);
  summaryLines.push(
    loadResult.ok
      ? `LaunchAgent loaded: ${loadResult.output || "(no output)"}`
      : `LaunchAgent load failed (will still load on next login): ${loadResult.output}`,
  );
  summaryLines.push("");

  // Step 4 — ~/.zshenv block.
  const zshenvPath = defaultZshenvPath();
  const zshenvBlock = buildZshenvBlock(bundlePath);
  if (ctx.hasUI) {
    const proceedZsh = await ctx.ui.confirm(
      `Add sentinel-guarded export to ${zshenvPath}?`,
      `Block:\n${zshenvBlock}\n\nIdempotent: re-runs replace the same block, never duplicate.`,
    );
    if (!proceedZsh) {
      await emitCommandOutput(
        pi,
        ctx,
        "fix-ca-bundle cancelled at ~/.zshenv step.",
        [...summaryLines, "User declined to update ~/.zshenv. LaunchAgent is still active."].join(
          "\n",
        ),
        "info",
      );
      return;
    }
  }
  const zshenvResult = writeZshenvBlockSafely(zshenvPath, bundlePath);
  summaryLines.push(zshenvResult.message);
  summaryLines.push("");

  // Step 5 — in-process env + doctor re-probe.
  process.env.NODE_EXTRA_CA_CERTS = bundlePath;
  let doctorAfter: Awaited<ReturnType<typeof fetchGatewayDoctorReport>> | undefined;
  try {
    doctorAfter = await fetchGatewayDoctorReport(ctx.cwd);
    summaryLines.push(
      doctorAfter.failureClass === null
        ? "Doctor re-probe: every check passed."
        : `Doctor re-probe: failureClass=${doctorAfter.failureClass}.`,
    );
  } catch (error) {
    summaryLines.push(
      `Doctor re-probe error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Step 6 — record state and clear stale TLS verdict so the splash
  // nudge stops surfacing.
  writeCaBundleFixerState({
    appliedAt: new Date().toISOString(),
    bundlePath,
    plistPath,
    source,
  });
  if (doctorAfter && doctorAfter.failureClass === null) {
    writeCaProbeState({
      at: new Date().toISOString(),
      lastFailureClass: null,
      hasNodeExtraCaCerts: true,
      platform: process.platform,
    });
  }

  summaryLines.push(
    "",
    "Relaunch pi from Dock/Spotlight to inherit NODE_EXTRA_CA_CERTS in future GUI sessions.",
  );

  await emitCommandOutput(
    pi,
    ctx,
    "fix-ca-bundle applied.",
    summaryLines.join("\n"),
    doctorAfter && doctorAfter.failureClass !== null ? "warning" : "info",
  );
}

function formatProbeRow(probe: BundleProbeResult): string {
  if (probe.valid) {
    return `  \u2713 ${probe.path} (${probe.sizeBytes ?? "?"} bytes)`;
  }
  return `  \u00b7 ${probe.path} \u2014 ${probe.reason ?? "invalid"}`;
}

async function handleOpenTokenCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  await openGatewayTokenPage(pi, ctx);
}

async function openGatewayTokenPage(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  baseUrlOverride?: string,
): Promise<void> {
  const config = getGatewayConfig(ctx.cwd);
  const url = buildOnboardingUrl(baseUrlOverride ?? config.baseUrl);
  if (!url) {
    await emitCommandOutput(
      pi,
      ctx,
      "SF LLM Gateway token page — base URL is not configured.",
      [
        `Enter the gateway base URL in /${FRIENDLY_COMMAND_NAME} first, then choose Open token page.`,
        `Env-var fallback for automation: ${BASE_URL_ENV}.`,
      ].join("\n"),
      "warning",
    );
    return;
  }

  const result = openUrlInBrowser(url);
  const browserErrorLines = result.ok ? [] : ["", `Browser opener error: ${result.error}`];
  const report = [
    result.ok
      ? "Opened the gateway root in your browser."
      : "Could not open a browser automatically.",
    "",
    url,
    "",
    "After sign-in, create or rotate an API token, copy it, then paste it into the setup page.",
    ...browserErrorLines,
  ].join("\n");

  await emitCommandOutput(
    pi,
    ctx,
    result.ok ? "SF LLM Gateway token page opened." : "SF LLM Gateway token page URL.",
    report,
    result.ok ? "info" : "warning",
  );
}

async function handleImportClaudeCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  await importClaudeCodeGatewayConfig(pi, ctx, scope);
}

async function importClaudeCodeGatewayConfig(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  const settingsPath = getClaudeCodeSettingsPath();
  const imported = readClaudeCodeGatewayConfig(settingsPath);
  if (!imported.ok) {
    await emitCommandOutput(
      pi,
      ctx,
      "Claude Code gateway import did not find reusable settings.",
      [
        `Claude Code settings: ${settingsPath}`,
        imported.reason,
        ...imported.warnings.map((warning) => `Warning: ${warning}`),
      ].join("\n"),
      "warning",
    );
    return;
  }

  const configPath =
    scope === "project" ? projectGatewayConfigPath(ctx.cwd) : globalGatewayConfigPath();
  const saved = readGatewaySavedConfig(configPath);
  const changed: string[] = [];

  if (imported.baseUrl) {
    saved.baseUrl = imported.baseUrl;
    changed.push(`Base URL from ${imported.baseUrlPath ?? "Claude Code settings"}`);
  }
  if (imported.apiKey) {
    saved.apiKey = imported.apiKey;
    changed.push(`API key from ${imported.apiKeyPath ?? "Claude Code settings"}`);
  }
  const caDiscovery = mergeDiscoveredCaBundleCandidates(saved, ctx.cwd);
  if (caDiscovery.added.length > 0) {
    changed.push(
      `${caDiscovery.added.length} CA bundle candidate${caDiscovery.added.length === 1 ? "" : "s"}`,
    );
  }

  if (changed.length === 0) {
    await emitCommandOutput(
      pi,
      ctx,
      "Claude Code gateway import found nothing to save.",
      `Claude Code settings: ${settingsPath}`,
      "warning",
    );
    return;
  }

  writeGatewaySavedConfig(configPath, saved);
  await discoverAndRegister(pi, getBetaOverrides(), getBetaExtras(), ctx.cwd);
  await updateFooterStatus(ctx, false);
  const config = getGatewayConfig(ctx.cwd);
  const doctor = await fetchGatewayDoctorReport(ctx.cwd);
  const doctorPassed = doctor.checks.length > 0 && doctor.checks.every((check) => check.ok);
  const defaultLines = doctorPassed ? await applyGatewayDefault(pi, ctx, scope) : [];
  const followUp = doctorPassed
    ? "Gateway preflight passed; gateway default was applied automatically."
    : doctor.failureClass === "tls"
      ? `Gateway preflight found a TLS issue. Next: /${FRIENDLY_COMMAND_NAME} fix-ca-bundle.`
      : doctor.failureClass === "auth"
        ? `Gateway preflight found an auth issue. Next: rotate or re-paste the key via /${FRIENDLY_COMMAND_NAME} setup.`
        : doctor.failureClass === "redirect"
          ? "Gateway preflight hit an SSO/browser redirect. Confirm the saved URL is the API gateway root."
          : "Gateway preflight did not pass; default provider was not changed.";

  const report = [
    `Imported Claude Code gateway settings into ${scope} scope.`,
    `- Claude Code settings: ${settingsPath}`,
    `- Save file: ${configPath}`,
    `- Imported: ${changed.join(", ")}`,
    `- Base URL: ${describeConfigValue(config.baseUrl, config.baseUrlSource)}`,
    `- API key: ${describeApiKey(config.apiKey, config.apiKeySource)}`,
    ...caDiscovery.summary.map((line) => `- ${line}`),
    "",
    `Doctor: ${doctorPassed ? "passed" : `needs attention (${doctor.failureClass ?? "unknown"})`}`,
    followUp,
    ...(defaultLines.length > 0 ? ["", ...defaultLines] : []),
    ...imported.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");

  await emitCommandOutput(
    pi,
    ctx,
    doctorPassed
      ? "Claude Code gateway settings imported and configured."
      : "Claude Code gateway settings imported.",
    report,
    doctorPassed ? "info" : "warning",
  );
}

async function handleLatencyProbeCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string[],
): Promise<void> {
  const options = parseLatencyProbeArgs(args, getPanelDefaultModelId(ctx));
  const report = await fetchGatewayLatencyProbe(ctx.cwd, options);
  await emitCommandOutput(
    pi,
    ctx,
    report.ok
      ? `Latency probe for ${options.modelId}.`
      : `Latency probe for ${options.modelId} found issues.`,
    formatGatewayLatencyProbe(report),
    report.ok ? "info" : "warning",
  );
}

async function handleTokensCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string[],
): Promise<void> {
  if (args.length === 0) {
    await emitCommandOutput(
      pi,
      ctx,
      "SF LLM Gateway Internal tokens — missing model id.",
      [
        `Usage: /${FRIENDLY_COMMAND_NAME} tokens <modelId> [prompt words here]`,
        "",
        "Examples:",
        `  /${FRIENDLY_COMMAND_NAME} tokens gpt-5 Hello world how are you today`,
        `  /${FRIENDLY_COMMAND_NAME} tokens claude-opus-4-7`,
      ].join("\n"),
      "warning",
    );
    return;
  }

  const [modelId, ...promptTokens] = args;
  if (!modelId) {
    ctx.ui.notify(`Usage: /${FRIENDLY_COMMAND_NAME} tokens <modelId> [prompt]`, "warning");
    return;
  }
  const prompt =
    promptTokens.length > 0
      ? promptTokens.join(" ")
      : `Hello world — sanity probe from /${FRIENDLY_COMMAND_NAME} tokens.`;

  const [tokensResult, spendResult] = await Promise.all([
    countTokens(ctx.cwd, { model: modelId, prompt }),
    estimateSpend(ctx.cwd, { model: modelId, prompt }),
  ]);

  const report = [formatTokenReport(tokensResult, spendResult), "", `Prompt: ${prompt}`].join("\n");

  await emitCommandOutput(
    pi,
    ctx,
    tokensResult.ok
      ? `Token count for ${modelId}.`
      : `Token count failed: ${tokensResult.error ?? "unknown error"}`,
    report,
    tokensResult.ok ? "info" : "warning",
  );
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
        `Usage: /${FRIENDLY_COMMAND_NAME} debug <modelId> [reasoning=<level>] [tool] [adaptive]`,
        "",
        "Examples:",
        `  /${FRIENDLY_COMMAND_NAME} debug claude-opus-4-7 adaptive reasoning=xhigh`,
        `  /${FRIENDLY_COMMAND_NAME} debug gpt-5 reasoning=high`,
        `  /${FRIENDLY_COMMAND_NAME} debug gpt-5.3-codex reasoning=medium tool`,
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
      `Usage: /${FRIENDLY_COMMAND_NAME} debug <modelId> [reasoning=<level>] [tool] [adaptive]`,
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

async function applyGatewayDefault(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<string[]> {
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

  return [
    `Default updated in ${scope} settings.`,
    `- Provider: ${effectiveProviderName}`,
    `- Model: ${effectiveModelId}${effectiveModelId !== DEFAULT_MODEL_ID ? ` (resolved from ${DEFAULT_MODEL_ID})` : ""}`,
    `- Thinking: ${DEFAULT_THINKING_LEVEL}`,
    `- Context: ${effectiveModel.contextWindow.toLocaleString()} tokens`,
    `- Max output: ${effectiveModel.maxTokens.toLocaleString()} tokens`,
    `- Route: Global`,
  ];
}

async function handleSetDefaultCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  scope: "global" | "project",
): Promise<void> {
  const report = (await applyGatewayDefault(pi, ctx, scope)).join("\n");
  await emitCommandOutput(pi, ctx, "SF LLM Gateway Internal default updated.", report, "info");
}

async function handleHelpCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const help = [
    `/${FRIENDLY_COMMAND_NAME} with no args opens the setup/settings page.`,
    `/${COMMAND_NAME} remains as a backward-compatible status/controls alias.`,
    "",
    ...formatGatewayCommandReference(FRIENDLY_COMMAND_NAME),
    "",
    ...formatGatewayAliasReference(),
    "",
    "Beta aliases:",
    ...KNOWN_BETAS.map((b) => `- ${b.aliases[0]} → ${b.value}`),
    "",
    "Built-in default base URL: (none — set via setup wizard)",
    `Automation fallback env vars (used only when saved config is blank): ${BASE_URL_ENV}, ${API_KEY_ENV}`,
    `Optional env: ${BETAS_ENV} (comma-separated Anthropic betas; unset = model defaults)`,
    `Setup also supports browser token generation, Claude Code import, and additive vs exclusive scoped model behavior.`,
    `Beta command accepts either a known alias or a raw Anthropic beta value.`,
    `Saved config file: ${globalGatewayConfigPath()} or ${projectGatewayConfigPath(process.cwd())}`,
    `Disable fallback default: ${OFF_DEFAULT_PROVIDER}/${OFF_DEFAULT_MODEL_ID}`,
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

  if (sub === "status") {
    return { subcommand: "status", scope };
  }
  if (sub === "refresh") {
    return { subcommand: "refresh", scope };
  }
  if (sub === "set-default") {
    return { subcommand: "set-default", scope };
  }
  if (sub === "help") {
    return { subcommand: "help", scope };
  }
  if (sub === "setup" || sub === "configure" || sub === "connect") {
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
  if (sub === "doctor" || sub === "dr") {
    return { subcommand: "doctor", scope };
  }
  if (sub === "usage-probe" || sub === "usage") {
    return { subcommand: "usage-probe", scope, positional: tokens.slice(1) };
  }
  if (sub === "debug") {
    return { subcommand: "debug", scope, positional: tokens.slice(1) };
  }
  if (sub === "latency-probe" || sub === "latency") {
    return { subcommand: "latency-probe", scope, positional: tokens.slice(1) };
  }
  if (sub === "tokens" || sub === "count") {
    return { subcommand: "tokens", scope, positional: tokens.slice(1) };
  }
  if (sub === "onboard") {
    return { subcommand: "onboard", scope };
  }
  if (sub === "open-token" || sub === "open" || sub === "browser") {
    return { subcommand: "open-token", scope };
  }
  if (sub === "import-claude" || sub === "import-claude-code") {
    return { subcommand: "import-claude", scope };
  }
  if (sub === "fix-ca-bundle" || sub === "fix-ca" || sub === "ca-bundle") {
    return { subcommand: "fix-ca-bundle", scope };
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
      `Run /${FRIENDLY_COMMAND_NAME} on ${scope} to enable with prompts, or edit ${globalGatewayConfigPath()} manually.`,
      "warning",
    );
    return;
  }

  while (true) {
    const result = await ctx.ui.custom<SetupOverlayResult | undefined>(
      (_tui, theme, _keybindings, done) =>
        new GatewaySetupOverlayComponent(theme, scope, ctx.cwd, done),
      {
        overlay: true,
        // Use function form for responsive sizing on terminal resize
        overlayOptions: () => ({
          anchor: "center" as const,
          width: "82%",
          minWidth: 84,
        }),
      },
    );

    if (!result) {
      return;
    }

    if (result.action === "open-token") {
      await openGatewayTokenPage(pi, ctx, result.baseUrl);
      continue;
    }

    if (result.action === "import-claude") {
      await importClaudeCodeGatewayConfig(pi, ctx, scope);
      continue;
    }

    // The config panel wrote the saved config to disk before returning; no
    // second write is needed here. We only dispatch on the action.
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
    return;
  }
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
        `Use /${FRIENDLY_COMMAND_NAME} setup ${scope} or set ${BASE_URL_ENV} / ${API_KEY_ENV}.`,
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
      `Set ${API_KEY_ENV}, or run /${FRIENDLY_COMMAND_NAME} setup ${scope} in interactive Pi. Use ${BASE_URL_ENV} only if you need to override the built-in default.`,
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
      ? `\nCurrently using ${BASE_URL_ENV} because no saved value exists. Saving here makes pi ignore stale shell/Keychain exports.`
      : "\nLeave this blank to clear the saved value for this scope. This extension has no built-in default URL — use setup for normal onboarding or env vars for automation.";

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
      ? `\nCurrently using ${API_KEY_ENV} because no saved key exists. Saving here makes pi ignore stale shell/Keychain exports.`
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
  if (ctx.hasUI) {
    await openInfoPanel(ctx, { title: summary, body: details || summary, severity: level });
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
  options: { awaitFooterRefresh?: boolean; allowModelSwitch?: boolean } = {},
): Promise<void> {
  const startupDefault = getEffectiveDefaultModelSetting(ctx.cwd);
  const startupDefaultIsGateway = isGatewayProvider(startupDefault.provider);
  if (startupDefaultIsGateway) {
    const desiredModelId = resolveGatewayDefaultModelId([
      startupDefault.modelId,
      DEFAULT_MODEL_ID,
      PREVIOUS_DEFAULT_MODEL_ID,
      FALLBACK_MODEL_ID,
    ]);
    repairGatewayDefaultModelSettings(ctx.cwd, desiredModelId);

    if (options.allowModelSwitch !== false) {
      const desiredProvider = providerForModelId(desiredModelId);
      if (ctx.model?.provider !== desiredProvider || ctx.model.id !== desiredModelId) {
        const desiredModel = ctx.modelRegistry.find(desiredProvider, desiredModelId);
        if (desiredModel) {
          await pi.setModel(desiredModel);
        }
      }
    }
  }

  const currentModelIsGateway = isGatewayProvider(ctx.model?.provider);
  const mayHaveSwitchedToGateway = options.allowModelSwitch !== false && startupDefaultIsGateway;
  if (currentModelIsGateway || mayHaveSwitchedToGateway) {
    // At session startup the current thinking level is pi's resolved default
    // (settings or xhigh from our `on` command). Apply through the
    // user-respecting helper so users who edited settings to a different
    // default do not get overridden by the extension. When startup model
    // switching is disabled, don't mutate thinking for a non-gateway model.
    applyGatewayDefaultThinkingLevel(pi);
  }

  if (options.awaitFooterRefresh === false) {
    const footerTimer = setTimeout(() => {
      void markBootStep("sf-llm-gateway.sync.footer-refresh (deferred)", () =>
        updateFooterStatus(ctx, forceRefreshUsage),
      ).catch(() => undefined);
    }, 3_000);
    footerTimer.unref?.();
    return;
  }

  await markBootStep("sf-llm-gateway.sync.footer-refresh", () =>
    updateFooterStatus(ctx, forceRefreshUsage),
  );
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
  ctx.ui.setStatus(STATUS_KEY, buildFooterStatus(getRuntimeStatusState()));
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
