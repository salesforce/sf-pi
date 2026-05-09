/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-welcome — Salesforce-branded splash screen for sf-pi.
 *
 * Displays a two-column overlay on startup with:
 *   Left column:  Gradient Pi logo, model info, monthly cost bar, extension health,
 *                 Slack, Gateway, and SF CLI status
 *   Right column: Announcements, What's New, loaded counts, recent sessions,
 *                  recommended extensions, attribution
 *
 * Supports two modes:
 *   - quietStartup: false (default) → Dismissable overlay with countdown
 *   - quietStartup: true            → Persistent header above input
 *   (--verbose overrides quietStartup and forces the overlay)
 *
 * Dismissal triggers:
 *   - Any keypress
 *   - Agent starts responding (agent_start event)
 *   - Tool call execution
 *   - Countdown reaches zero (30s)
 *
 * Persistence:
 *   - On dismiss the extension writes the current pi-coding-agent version to
 *     `~/.pi/agent/sf-welcome-state.json` so the What's New panel only reappears
 *     after the next pi version bump.
 *
 * Behavior matrix:
 *
 *   Event/Trigger         | Condition                    | Result
 *   ----------------------|------------------------------|-------------------------------------------
 *   session_start         | reason="startup", no quiet   | Show overlay splash with countdown
 *   session_start         | reason="startup", quiet=true | Show persistent header
 *   session_start         | reason!="startup"            | Skip (resume, reload, fork, etc.)
 *   agent_start           | overlay visible              | Dismiss overlay + persist seen version
 *   tool_call             | overlay visible              | Dismiss overlay + persist seen version
 *   any keypress          | overlay visible              | Dismiss overlay + persist seen version
 *   countdown=0           | overlay visible              | Dismiss overlay + persist seen version
 *   /sf-welcome           | always                       | Show splash info summary
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import {
  buildToggleExtensionAction,
  isLifecycleToggleAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";
import type { SplashData } from "./lib/types.ts";
import {
  matchesKey,
  type Component,
  type Focusable,
  type OverlayHandle,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  collectInitialSplashData,
  collectSplashData,
  detectSfCliStatus,
  readCurrentPiVersion,
  refreshAnnouncementsSummary,
  resolveMonthlyUsage,
} from "./lib/splash-data.ts";
import { acknowledgeAnnouncementsRevision } from "../../lib/common/catalog-state/announcements-state.ts";
import { SfWelcomeOverlay, SfWelcomeHeader } from "./lib/splash-component.ts";
import { isQuietStartupEnabled, isVerboseStartupRequested } from "./lib/startup-mode.ts";
import {
  resolveConfiguredWelcomeMode,
  runDoctorDiagnostics,
  shouldForceSafeWelcome,
  summarizeStartupDoctorNudge,
} from "../../lib/common/doctor/diagnostics.ts";

import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import {
  getMonthlyUsageState,
  refreshMonthlyUsage,
  subscribeMonthlyUsageState,
} from "../../lib/common/monthly-usage/store.ts";
import { subscribeSlackStatus } from "../../lib/common/slack-status/store.ts";
import { isSfPiExtensionEnabled } from "../../lib/common/sf-pi-extension-state.ts";
import { FONT_FAMILY_NAME, isFontFamilyInstalled, runFontInstall } from "./lib/font-installer.ts";
import { readWelcomeState, writeWelcomeState } from "./lib/state-store.ts";
import { resolveGlyphMode } from "../../lib/common/glyph-policy.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const COMMAND_NAME = "sf-welcome";
const FONTS_COMMAND_NAME = "sf-setup-fonts";
/** Fallback budget used only when the gateway hasn't populated a live
 * monthly usage snapshot yet. Once the gateway reports real numbers,
 * they replace this value (and may be ∞ if there's no fixed cap). */
const MONTHLY_BUDGET_FALLBACK = 3000;
const HEADER_FRAME_MS = 400;
const HEADER_ANIMATION_FRAMES = 13; // 13 × 400 ms ≈ 5 s
const HEADER_DISMISS_SECONDS = 30;

function isReducedMotionRequested(): boolean {
  return process.env.SF_PI_REDUCED_MOTION === "1" || process.env.SF_PI_REDUCED_MOTION === "true";
}

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfWelcome(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-welcome")) return;

  let dismissOverlay: ((persistSeen?: boolean) => void) | null = null;
  let overlayRequestRender: (() => void) | null = null;
  let headerActive = false;
  let activeHeader: SfWelcomeHeader | null = null;
  let headerRequestRender: ((force?: boolean) => void) | null = null;
  let headerAnimationTimer: ReturnType<typeof setInterval> | null = null;
  let headerCountdownTimer: ReturnType<typeof setInterval> | null = null;
  let headerInputUnsubscribe: (() => void) | null = null;
  let headerOffset = 0;
  let headerCountdown = HEADER_DISMISS_SECONDS;
  /** Unsubscribe from the gateway usage store. Set during session_start and
   * cleared on dismiss / session_shutdown so we don't leak listeners across
   * reloads. */
  let unsubscribeUsageStore: (() => void) | null = null;
  let unsubscribeSlackStore: (() => void) | null = null;
  let shouldDismissEarly = false;
  let isStreaming = false;
  let startupRunId = 0;
  let activeSessionGeneration = 0;
  let activeSessionKey: string | null = null;
  /** Snapshot of the pi version active for the current startup. Persisted
   * the first time the user dismisses this startup's splash so repeat
   * launches skip the What's New panel until pi updates again. */
  let pendingSeenVersion: string | undefined;
  /** Announcements revision active at session_start. Persisted alongside
   * the What's New ack when the splash is dismissed so the maintainer
   * nudge doesn't re-arm until the manifest revision actually bumps. */
  let pendingAckedRevision: string | undefined;

  // Use the shared exec adapter instead of a per-extension wrapper
  const exec = buildExecFn(pi);

  function sessionKey(ctx: ExtensionContext): string {
    return `${ctx.sessionManager.getSessionId()}::${ctx.cwd}`;
  }

  function beginActiveSession(ctx: ExtensionContext): number {
    activeSessionGeneration += 1;
    activeSessionKey = sessionKey(ctx);
    return activeSessionGeneration;
  }

  function endActiveSession(ctx: ExtensionContext): void {
    if (activeSessionKey === sessionKey(ctx)) {
      activeSessionGeneration += 1;
      activeSessionKey = null;
      startupRunId += 1;
    }
  }

  function isActiveSession(ctx: ExtensionContext, generation = activeSessionGeneration): boolean {
    return generation === activeSessionGeneration && activeSessionKey === sessionKey(ctx);
  }

  /**
   * Persist the current pi version exactly once per startup.
   *
   * We only write on dismiss (not on session_start) so a user who reloads
   * 30 times without dismissing never over-writes their "last seen"
   * pointer. Downgrades still write the lower version so the panel
   * doesn't replay an older changelog on next launch.
   */
  function markWhatsNewSeen() {
    if (!pendingSeenVersion) return;
    const toPersist = pendingSeenVersion;
    pendingSeenVersion = undefined;
    writeWelcomeState({ lastSeenPiVersion: toPersist });
  }

  /**
   * Persist the current announcements revision exactly once per startup.
   * Same contract as markWhatsNewSeen(): any user-visible dismiss path
   * counts as acknowledgement so the footer nudge clears.
   */
  function markAnnouncementsSeen() {
    if (!pendingAckedRevision) return;
    const toPersist = pendingAckedRevision;
    pendingAckedRevision = undefined;
    acknowledgeAnnouncementsRevision(toPersist);
  }

  function stopHeaderAnimation(): void {
    if (headerAnimationTimer) {
      clearInterval(headerAnimationTimer);
      headerAnimationTimer = null;
    }
  }

  function stopHeaderCountdown(): void {
    if (headerCountdownTimer) {
      clearInterval(headerCountdownTimer);
      headerCountdownTimer = null;
    }
    headerInputUnsubscribe?.();
    headerInputUnsubscribe = null;
  }

  function resetHeaderAnimation(): void {
    stopHeaderAnimation();
    stopHeaderCountdown();
    activeHeader = null;
    headerRequestRender = null;
    headerOffset = 0;
    headerCountdown = HEADER_DISMISS_SECONDS;
  }

  function startHeaderAnimation(ctx: ExtensionContext, generation: number): void {
    if (
      headerAnimationTimer ||
      isReducedMotionRequested() ||
      headerOffset >= HEADER_ANIMATION_FRAMES
    ) {
      return;
    }

    headerAnimationTimer = setInterval(() => {
      if (!headerActive || !isActiveSession(ctx, generation)) {
        stopHeaderAnimation();
        return;
      }

      headerOffset += 1;
      activeHeader?.setHeaderOffset(headerOffset);
      activeHeader?.invalidate();
      headerRequestRender?.(true);

      if (headerOffset >= HEADER_ANIMATION_FRAMES) {
        stopHeaderAnimation();
      }
    }, HEADER_FRAME_MS);
  }

  function startHeaderCountdown(ctx: ExtensionContext, generation: number): void {
    if (headerCountdownTimer) return;

    headerCountdownTimer = setInterval(() => {
      if (!headerActive || !isActiveSession(ctx, generation)) {
        stopHeaderCountdown();
        return;
      }

      headerCountdown -= 1;
      activeHeader?.setCountdown(headerCountdown);
      activeHeader?.invalidate();
      headerRequestRender?.();

      if (headerCountdown <= 0) {
        dismiss(ctx);
      }
    }, 1000);

    headerInputUnsubscribe ??= ctx.ui.onTerminalInput((data) => {
      if (!headerActive || !isActiveSession(ctx, generation)) return;
      if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
        dismiss(ctx);
        return { consume: true };
      }
      return;
    });
  }

  function refreshMountedSplash(
    ctx: ExtensionContext,
    generation: number,
    force: boolean = false,
  ): void {
    if (!isActiveSession(ctx, generation)) return;
    if (headerActive) {
      activeHeader?.invalidate();
      headerRequestRender?.(force);
      return;
    }
    overlayRequestRender?.();
  }

  // Helper: dismiss welcome screen (overlay or header)
  function dismiss(ctx: ExtensionContext) {
    if (!isActiveSession(ctx)) return;
    if (dismissOverlay) {
      dismissOverlay();
      dismissOverlay = null;
      overlayRequestRender = null;
    } else {
      // Overlay not set up yet — mark for immediate dismissal
      shouldDismissEarly = true;
    }
    if (headerActive) {
      headerActive = false;
      resetHeaderAnimation();
      ctx.ui.setHeader(undefined);
    }
    markWhatsNewSeen();
    markAnnouncementsSeen();
    // Subscription lifetime matches the splash lifetime — once the splash
    // is dismissed there is no component to repaint, so drop the listener.
    unsubscribeUsageStore?.();
    unsubscribeUsageStore = null;
    unsubscribeSlackStore?.();
    unsubscribeSlackStore = null;
  }

  // --- Session start: show splash screen ---
  pi.on("session_start", async (event, ctx) => {
    const runId = ++startupRunId;
    const generation = beginActiveSession(ctx);

    // Reset state
    dismissOverlay = null;
    overlayRequestRender = null;
    headerActive = false;
    resetHeaderAnimation();
    shouldDismissEarly = false;
    isStreaming = false;

    if (!ctx.hasUI) return;

    // Only show the splash on initial startup — not on resume, reload, fork, etc.
    if (event.reason !== "startup") return;

    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown provider";
    // Capture the current pi version so we can persist it once the splash
    // is dismissed. Done here (not inside collectSplashData) so a cached
    // splash render never races with the current process's version.
    pendingSeenVersion = readCurrentPiVersion();
    // Kick the gateway's monthly-usage cache in the background so the splash
    // matches the bottom bar. We don't await it here — the splash renders
    // immediately with whatever cache is available and we re-render below
    // once the store publishes.
    //
    // We intentionally do NOT listen to this promise to drive a repaint. The
    // gateway extension registers its refresher during its own session_start
    // handler, and extension load order is not guaranteed — if sf-welcome
    // runs first, this call is a no-op against an empty store. Instead we
    // subscribe to the store below and repaint on every publish.
    void refreshMonthlyUsage(true, ctx.cwd).catch(() => undefined);

    const data = collectInitialSplashData(modelName, providerName, MONTHLY_BUDGET_FALLBACK);
    const doctorReport = runDoctorDiagnostics({ cwd: ctx.cwd });
    data.doctor = summarizeStartupDoctorNudge(doctorReport) ?? undefined;

    // Safe-start policy: setup warnings, SF_PI_SAFE_START, or explicit
    // sfPi.welcome.mode=header keep startup non-blocking. Users can still
    // force the full overlay with sfPi.welcome.mode=overlay or --verbose.
    const welcomeMode = resolveConfiguredWelcomeMode(ctx.cwd);
    if (welcomeMode === "off") return;
    const verboseRequested = isVerboseStartupRequested();
    const isQuiet = isQuietStartupEnabled(ctx.cwd, verboseRequested);
    const forceHeader = shouldForceSafeWelcome(doctorReport);
    const safeStart = doctorReport.safeStartRequested;
    if (
      welcomeMode === "header" ||
      safeStart ||
      (!verboseRequested && welcomeMode !== "overlay" && (forceHeader || isQuiet))
    ) {
      setupHeader(ctx, data, generation);
    } else {
      setupOverlay(ctx, data, generation);
    }

    setImmediate(() => {
      try {
        if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
        const currentSfCli = data.sfCli;
        const fullData = collectSplashData(
          modelName,
          providerName,
          ctx.cwd,
          MONTHLY_BUDGET_FALLBACK,
        );
        Object.assign(data, fullData);
        data.sfCli = currentSfCli ?? { installed: false, freshness: "checking", loading: true };
        data.doctor =
          summarizeStartupDoctorNudge(runDoctorDiagnostics({ cwd: ctx.cwd })) ?? undefined;

        // First-ever launch: the state file has no lastSeenPiVersion and
        // buildWhatsNewPayload returns nothing. Seed the state eagerly so the
        // next pi update actually produces a What's New panel on dismiss.
        if (!data.whatsNew && pendingSeenVersion) {
          writeWelcomeState({ lastSeenPiVersion: pendingSeenVersion });
          pendingSeenVersion = undefined;
        }

        // Capture the active announcements revision so the dismissal path can
        // persist it. Only arm the pending ack when there is something visible
        // — otherwise we'd claim the revision was "seen" when no panel
        // actually rendered it.
        if (data.announcements && data.announcements.visible.length > 0) {
          pendingAckedRevision = data.announcements.revision || undefined;
        } else {
          pendingAckedRevision = undefined;
        }

        refreshMountedSplash(ctx, generation);
      } catch {
        // Best-effort hydration: keep the initial splash visible even if a
        // local settings/session scan fails unexpectedly.
      }
    });

    // Background CLI status: keep startup responsive while `sf --version` and
    // the optional npm latest-version lookup run. No org/config commands are
    // issued from sf-welcome.
    void detectSfCliStatus(exec)
      .then((cli) => {
        if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
        data.sfCli = cli;

        refreshMountedSplash(ctx, generation);
      })
      .catch(() => {
        if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
        data.sfCli = { installed: false, freshness: "unknown", loading: false };
        refreshMountedSplash(ctx, generation);
      });

    // Subscribe to the gateway usage store so any time the provider publishes
    // a new snapshot (first populate, periodic refresh, /sf-llm-gateway-internal
    // refresh) the splash repaints with live numbers. This is the source of
    // truth for keeping the splash and bottom bar in sync regardless of
    // extension load order.
    //
    // Clean up any previous subscription first — a rapid session_start /
    // session_shutdown cycle could otherwise stack listeners.
    unsubscribeUsageStore?.();
    unsubscribeUsageStore = subscribeMonthlyUsageState(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      const usage = resolveMonthlyUsage(MONTHLY_BUDGET_FALLBACK);
      const gatewayState = getMonthlyUsageState();
      data.monthlyCost = usage.monthlyCost;
      data.monthlyBudget = usage.monthlyBudget;
      data.monthlyUsageSource = usage.monthlyUsageSource;
      const activeGateway =
        data.providerName.toLowerCase().includes("gateway") ||
        data.modelName.toLowerCase().includes("gateway");
      const gatewayStatus = gatewayState.connectionStatus;
      data.gatewayVisible =
        isSfPiExtensionEnabled(ctx.cwd, "sf-llm-gateway-internal") &&
        (activeGateway ||
          !!gatewayState.monthlyUsage ||
          (!!gatewayStatus &&
            gatewayStatus.kind !== "checking" &&
            gatewayStatus.kind !== "not-configured"));
      data.gatewayStatus = data.gatewayVisible ? (gatewayStatus ?? null) : null;
      data.gatewayLoading =
        data.gatewayVisible && gatewayState.connectionStatus?.kind === "checking";

      refreshMountedSplash(ctx, generation);
    });

    unsubscribeSlackStore?.();
    unsubscribeSlackStore = subscribeSlackStatus((status) => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      data.slackVisible =
        isSfPiExtensionEnabled(ctx.cwd, "sf-slack") &&
        status.kind !== "hidden" &&
        status.kind !== "not-configured";
      data.slackStatus = status;
      data.slackConnected = status.kind === "ready";
      data.slackLoading = status.kind === "loading";
      refreshMountedSplash(ctx, generation);
    });

    // Refresh announcements from the remote feed (when configured) in the
    // background. Updates the data payload in place and repaints the splash
    // once the fetch settles. The sync payload has already populated
    // `data.announcements` with bundled + cached remote entries, so a
    // failed/disabled fetch simply leaves those intact.
    void refreshAnnouncementsSummary(ctx.cwd)
      .then((summary) => {
        if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
        if (!summary) return;
        data.announcements = summary;
        if (summary.visible.length > 0) {
          pendingAckedRevision = summary.revision || undefined;
        }
        refreshMountedSplash(ctx, generation);
      })
      .catch(() => {
        // Silent — refreshAnnouncementsSummary already swallows errors, but
        // we add a guard here so a theoretical rejection can't leak.
      });

    // Fire the one-time font-install prompt as a deferred, non-awaited
    // side task. Running it unawaited keeps session_start non-blocking,
    // and Pi will render the confirm dialog after the splash dismisses
    // (so the user sees the splash first, then a single prompt).
    if (!doctorReport.safeStartRequested) {
      void maybePromptFontInstall(ctx, generation);
    }
  });

  // --- Dismiss on agent activity ---
  pi.on("agent_start", async (_event, ctx) => {
    isStreaming = true;
    dismiss(ctx);
  });

  pi.on("tool_call", async (_event, ctx) => {
    dismiss(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const wasActive = isActiveSession(ctx);
    if (!wasActive) return;

    if (dismissOverlay) {
      dismissOverlay(false);
    }
    dismissOverlay = null;
    overlayRequestRender = null;
    shouldDismissEarly = false;
    isStreaming = false;

    if (headerActive && ctx.hasUI) {
      ctx.ui.setHeader(undefined);
    }
    headerActive = false;
    resetHeaderAnimation();
    unsubscribeUsageStore?.();
    unsubscribeUsageStore = null;
    unsubscribeSlackStore?.();
    unsubscribeSlackStore = null;
    endActiveSession(ctx);
  });

  // --- /sf-welcome command ---
  pi.registerCommand(COMMAND_NAME, {
    description: "Show the sf-pi welcome splash summary, status, and controls",
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await handleWelcomePanel(ctx);
          return;
        }
        // Direct subcommand or headless invocation — emit the summary as plain
        // text so `pi -p /sf-welcome` keeps printing something useful.
        const summary = await buildWelcomeSummary(ctx);
        if (ctx.hasUI) {
          ctx.ui.notify(summary, "info");
          return;
        }
        console.info(summary);
      });
    },
  });

  // ---------------------------------------------------------------------------
  // /sf-welcome panel actions and helpers
  // ---------------------------------------------------------------------------

  type WelcomeAction = "summary" | "fonts" | "help" | "close" | LifecycleActionId;

  const WELCOME_ACTIONS: CommandPanelAction<WelcomeAction>[] = [
    {
      value: "summary",
      label: "Show splash summary",
      description:
        "Print the same model, monthly-cost, gateway/slack, extension health, and recent-session lines the splash shows on startup.",
      group: "Diagnostics",
    },
    {
      value: "fonts",
      label: "Install bundled Nerd Font",
      description:
        "Install the MesloLGM Nerd Font Mono TTFs locally so terminal glyphs render correctly. Idempotent.",
      group: "Configuration",
    },
    {
      value: "help",
      label: "Show help",
      description:
        "Print /sf-welcome usage, including how to re-run the splash and trigger the font installer.",
      group: "Reference",
    },
    {
      value: "close",
      label: "Close",
      description: "Dismiss this panel.",
      group: LIFECYCLE_GROUP,
    },
  ];

  function buildWelcomeActions(cwd: string): CommandPanelAction<WelcomeAction>[] {
    const toggle = buildToggleExtensionAction({ extensionId: "sf-welcome", cwd });
    return toggle ? [...WELCOME_ACTIONS, toggle] : WELCOME_ACTIONS;
  }

  async function handleWelcomePanel(ctx: ExtensionCommandContext): Promise<void> {
    const panelState: CommandPanelState<WelcomeAction> = {};
    await openCommandPanel(ctx, {
      title: "👋 SF Welcome — status & controls",
      subtitle:
        "Re-display the splash summary, install bundled fonts, or toggle the splash itself.",
      statusLines: () => buildWelcomePanelStatusLines(ctx),
      actions: () => buildWelcomeActions(ctx.cwd),
      closeValue: "close",
      state: panelState,
      onAction: (action) => handleWelcomeAction(ctx, action),
      // Lifecycle toggle calls ctx.reload() — must close panel first so the
      // ctx.ui.custom() promise resolves before the runtime is invalidated.
      closeBeforeAction: isLifecycleToggleAction,
    });
  }

  function buildWelcomePanelStatusLines(ctx: ExtensionCommandContext): string[] {
    const enabled = isSfPiExtensionEnabled(ctx.cwd, "sf-welcome");
    // isFontFamilyInstalled takes the platform; we pass nothing so it uses
    // the current process.platform default. The font name is purely
    // descriptive on the status line.
    const fontsInstalled = isFontFamilyInstalled();
    const decision = readWelcomeState().fontInstallDecision ?? "never asked";
    return [
      `${enabled ? "✓" : "✗"} Extension     ${enabled ? "enabled" : "disabled"}`,
      `• Bundled font  ${fontsInstalled ? "installed" : "not installed"} (${FONT_FAMILY_NAME})`,
      `• Font prompt   ${decision}`,
    ];
  }

  async function handleWelcomeAction(
    ctx: ExtensionCommandContext,
    action: WelcomeAction,
  ): Promise<void> {
    // The shared command-panel guarantees the closeValue row never reaches
    // here — see lib/common/command-panel.ts. No "close" branch needed.
    if (action === "lifecycle.toggle") {
      await performToggleExtension(ctx, "sf-welcome");
      return;
    }

    if (action === "summary") {
      const summary = await buildWelcomeSummary(ctx);
      await emitWelcomeOutput(ctx, "sf-pi welcome summary", summary, "info");
      return;
    }

    if (action === "fonts") {
      const result = await runFontInstall(exec);
      // Record that the user explicitly opted in so the one-time startup
      // splash prompt does not ask again. Mirrors the /sf-setup-fonts
      // command behavior.
      writeWelcomeState({
        fontInstallDecision: "yes",
        fontInstallPromptedAt: new Date().toISOString(),
      });
      await emitWelcomeOutput(
        ctx,
        "Nerd Font install",
        result.summary,
        result.severity === "warning" ? "warning" : "info",
      );
      return;
    }

    if (action === "help") {
      await emitWelcomeOutput(
        ctx,
        "sf-welcome help",
        [
          "sf-welcome — splash summary, font installer, and lifecycle toggle.",
          "",
          "Commands:",
          "  /sf-welcome          Open the status & controls panel.",
          "  /sf-welcome summary  Print the splash summary as text.",
          "  /sf-setup-fonts      Install the bundled Nerd Font (alias of the panel action).",
          "",
          "Lifecycle:",
          "  Disable here, or run /sf-pi disable sf-welcome to skip the splash.",
        ].join("\n"),
        "info",
      );
      return;
    }
  }

  // Build the splash summary text used by both the panel "Show summary"
  // action and the legacy /sf-welcome (no panel) plain-text fallback.
  // Pulled out of the command handler so both call sites stay in sync.
  async function buildWelcomeSummary(ctx: ExtensionContext): Promise<string> {
    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown provider";

    // Refresh the gateway's monthly-usage cache *before* reading it so the
    // summary matches the bottom-bar value even when the user runs the
    // command mid-session.
    try {
      await refreshMonthlyUsage(true, ctx.cwd);
    } catch {
      // Best-effort — refreshMonthlyUsage already captures the error on
      // the cache and surfaces it through the "local estimate" suffix.
    }

    const data = collectSplashData(modelName, providerName, ctx.cwd, MONTHLY_BUDGET_FALLBACK);
    const healthLines = data.extensionHealth.map((ext) => {
      const statusIcon = ext.status === "active" ? "●" : ext.status === "locked" ? "◆" : "○";
      return `  ${statusIcon} ${ext.name} — ${ext.status}`;
    });
    const budgetLabel = data.monthlyBudget === null ? "∞" : `$${data.monthlyBudget}`;
    const costPercent =
      typeof data.monthlyBudget === "number" && data.monthlyBudget > 0
        ? ` (${((data.monthlyCost / data.monthlyBudget) * 100).toFixed(1)}%)`
        : "";
    const sourceSuffix = data.monthlyUsageSource === "sessions" ? " (local estimate)" : "";
    const gatewayStatus = data.gatewayVisible
      ? (data.gatewayStatus?.kind ?? "not checked")
      : "hidden";
    const slackStatus = data.slackVisible ? (data.slackStatus?.kind ?? "not checked") : "hidden";

    return [
      "sf-pi Welcome Summary",
      "",
      `Model: ${data.modelName}`,
      `Provider: ${data.providerName}`,
      "",
      `Monthly cost: $${data.monthlyCost.toFixed(2)} / ${budgetLabel}${costPercent}${sourceSuffix}`,
      `Gateway: ${gatewayStatus}`,
      `Slack: ${slackStatus}`,
      "",
      "sf-pi Extensions:",
      ...healthLines,
      "",
      `Loaded: ${data.loadedCounts.extensions} extensions, ${data.loadedCounts.skills} skills, ${data.loadedCounts.promptTemplates} prompt templates`,
      "",
      "Recent Sessions:",
      ...data.recentSessions.map((s) => `  • ${s.name} (${s.timeAgo})`),
    ].join("\n");
  }

  async function emitWelcomeOutput(
    ctx: ExtensionCommandContext,
    title: string,
    body: string,
    severity: InfoPanelSeverity,
  ): Promise<void> {
    if (ctx.hasUI) {
      await openInfoPanel(ctx, { title, body, severity });
      return;
    }
    console.info(body);
  }

  // --- /sf-setup-fonts command ---
  //
  // Manual entry point for installing the bundled MesloLGM Nerd Font
  // Mono TTFs. Wrapped in the standard /sf-* status & controls panel so
  // the surface stays consistent with /sf-devbar, /sf-data360, etc.
  // Delegates to runFontInstall() for the actual install — the splash
  // prompt and this panel emit the exact same install output.

  type SfSetupFontsAction = "status" | "install" | "reset" | "help" | "close";

  const SF_SETUP_FONTS_ACTIONS: CommandPanelAction<SfSetupFontsAction>[] = [
    {
      value: "status",
      label: "Show font installation status",
      description:
        "Print whether the bundled Nerd Font is installed and the recorded user decision.",
      group: "Status",
    },
    {
      value: "install",
      label: "Install bundled Nerd Font",
      description: `Copy ${FONT_FAMILY_NAME} TTFs into your user fonts folder. Records the decision so the splash won't re-ask.`,
      group: "Actions",
    },
    {
      value: "reset",
      label: "Reset prompt decision",
      description: "Clear the recorded yes/no answer so the splash asks again on the next session.",
      group: "Troubleshooting",
    },
    {
      value: "help",
      label: "Show help",
      description: "Print commands and platform support reference.",
      group: "Reference",
    },
    {
      value: "close",
      label: "Close",
      description: "Dismiss this panel.",
      group: "Lifecycle",
    },
  ];

  function buildSfSetupFontsStatusLines(): string[] {
    const installed = isFontFamilyInstalled();
    const decision = readWelcomeState().fontInstallDecision ?? "never asked";
    const platform = process.platform;
    const supported = platform === "darwin" || platform === "linux";
    return [
      `${installed ? "✓" : "○"} Bundled font   ${installed ? "installed" : "not installed"} (${FONT_FAMILY_NAME})`,
      `• Decision       ${decision}`,
      `${supported ? "✓" : "⚠"} Platform       ${platform} ${supported ? "" : "(manual install only)"}`.trim(),
    ];
  }

  async function handleSfSetupFontsPanel(ctx: ExtensionCommandContext): Promise<void> {
    const panelState: CommandPanelState<SfSetupFontsAction> = {};
    await openCommandPanel(ctx, {
      title: "🔤 SF Fonts — bundled Nerd Font installer",
      subtitle: "Install the Nerd Font used by the sf-pi splash, or review the install state.",
      statusLines: () => buildSfSetupFontsStatusLines(),
      actions: () => SF_SETUP_FONTS_ACTIONS,
      closeValue: "close",
      state: panelState,
      onAction: (action) => handleSfSetupFontsAction(ctx, action, true),
    });
  }

  async function handleSfSetupFontsAction(
    ctx: ExtensionCommandContext,
    action: SfSetupFontsAction | string,
    fromPanel: boolean,
  ): Promise<void> {
    if (action === "help") {
      const help = [
        "sf-setup-fonts — install the bundled Nerd Font",
        "",
        "Commands:",
        "  /sf-setup-fonts          Open status & controls panel",
        "  /sf-setup-fonts install  Install (records decision = yes)",
        "  /sf-setup-fonts status   Show install state",
        "  /sf-setup-fonts reset    Clear recorded yes/no answer",
        "  /sf-setup-fonts help     Show this help",
        "",
        `Bundled font: ${FONT_FAMILY_NAME}`,
        "Supported platforms: macOS, Linux. Windows: install manually.",
      ].join("\n");
      await emitSfSetupFontsOutput(ctx, "sf-setup-fonts help", help, "info", fromPanel);
      return;
    }

    if (action === "install") {
      ctx.ui.setStatus("sf-setup-fonts", "Installing bundled Nerd Font…");
      try {
        const result = await runFontInstall(exec);
        // Record decision so the splash won't re-ask.
        writeWelcomeState({
          fontInstallDecision: "yes",
          fontInstallPromptedAt: new Date().toISOString(),
        });
        // runFontInstall returns severity: "info" | "warning". Map straight
        // through; the panel surface widens to "info" | "warning" | "error"
        // | "success" but we never see error/success from this code path.
        await emitSfSetupFontsOutput(
          ctx,
          "sf-setup-fonts install",
          result.summary,
          result.severity,
          fromPanel,
        );
      } catch (err) {
        await emitSfSetupFontsOutput(ctx, "Install failed", String(err), "error", fromPanel);
      } finally {
        ctx.ui.setStatus("sf-setup-fonts", undefined);
      }
      return;
    }

    if (action === "reset") {
      writeWelcomeState({
        fontInstallDecision: undefined,
        fontInstallPromptedAt: undefined,
      });
      await emitSfSetupFontsOutput(
        ctx,
        "sf-setup-fonts reset",
        "Cleared recorded font-install decision. The splash will ask again on the next session.",
        "info",
        fromPanel,
      );
      return;
    }

    // Default: status (also handles unknown subcommands)
    const lines = ["sf-setup-fonts status", "", ...buildSfSetupFontsStatusLines()];
    await emitSfSetupFontsOutput(ctx, "sf-setup-fonts status", lines.join("\n"), "info", fromPanel);
  }

  async function emitSfSetupFontsOutput(
    ctx: ExtensionCommandContext,
    title: string,
    body: string,
    level: "info" | "warning" | "error" | "success",
    fromPanel: boolean,
  ): Promise<void> {
    if (fromPanel && ctx.hasUI) {
      await openInfoPanel(ctx, { title, body, severity: level });
      return;
    }
    ctx.ui.notify(body ? `${title}\n\n${body}` : title, level === "success" ? "info" : level);
  }

  pi.registerCommand(FONTS_COMMAND_NAME, {
    description: "Install the bundled Nerd Font used by the sf-pi splash",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase();
      const items = SF_SETUP_FONTS_ACTIONS.filter((action) => action.value !== "close")
        .filter((action) => action.value.startsWith(lower))
        .map((action) => ({
          value: action.value,
          label: action.value,
          description: action.description,
        }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, FONTS_COMMAND_NAME, async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await handleSfSetupFontsPanel(ctx);
          return;
        }
        // Map empty/no-UI to install for backwards compatibility (the original
        // handler always ran the installer when invoked).
        const action = sub === "" ? "install" : sub;
        await handleSfSetupFontsAction(ctx, action, false);
      });
    },
  });

  // -------------------------------------------------------------------------------------------------
  // One-time font-install prompt
  // -------------------------------------------------------------------------------------------------

  /**
   * Ask the user once, ever, whether we should install the bundled Nerd
   * Font. Records the decision in sf-welcome-state.json so we never
   * re-ask. The manual `/sf-setup-fonts` command remains available as
   * an escape hatch.
   *
   * Guards (all must be true for the prompt to fire):
   *   - Session is still active.
   *   - State file has no previous decision.
   *   - Platform is macOS or Linux (Windows would get manual instructions
   *     anyway — not useful as a Y/N prompt).
   *   - Glyph mode resolves to ASCII (emoji renders fine for this user).
   *   - The font family isn't already on disk.
   */
  async function maybePromptFontInstall(ctx: ExtensionContext, generation: number): Promise<void> {
    if (!ctx.hasUI) return;
    if (!isActiveSession(ctx, generation)) return;

    const platform = process.platform;
    if (platform !== "darwin" && platform !== "linux") return;

    const state = readWelcomeState();
    if (state.fontInstallDecision) return;

    if (resolveGlyphMode({ cwd: ctx.cwd }) !== "ascii") return;
    if (isFontFamilyInstalled()) return;

    const title = "Install bundled Nerd Font?";
    const body = [
      `sf-pi can install ${FONT_FAMILY_NAME} into your user fonts folder so the`,
      "splash icons render correctly. ~3 MB, user-only, asks exactly once.",
      "",
      "You can always run /sf-setup-fonts later.",
    ].join("\n");

    let proceed: boolean;
    try {
      proceed = await ctx.ui.confirm(title, body);
    } catch {
      // If the dialog was cancelled for any reason (session teardown,
      // theme reload), treat it as "no decision" — we'll ask next time.
      return;
    }

    const promptedAt = new Date().toISOString();

    if (!proceed) {
      writeWelcomeState({ fontInstallDecision: "no", fontInstallPromptedAt: promptedAt });
      return;
    }

    // User said yes. Run the shared installer and show the same summary
    // notification /sf-setup-fonts would.
    writeWelcomeState({ fontInstallDecision: "yes", fontInstallPromptedAt: promptedAt });

    const result = await runFontInstall(exec, platform);
    if (!isActiveSession(ctx, generation)) return;
    ctx.ui.notify(result.summary, result.severity);
  }

  // -------------------------------------------------------------------------------------------------
  // Setup helpers
  // -------------------------------------------------------------------------------------------------

  function setupHeader(ctx: ExtensionContext, data: SplashData, generation: number) {
    if (!ctx.hasUI || !isActiveSession(ctx, generation)) return;
    const header = new SfWelcomeHeader(data);
    header.setHeaderOffset(headerOffset);
    header.setCountdown(headerCountdown);
    headerActive = true;

    ctx.ui.setHeader((tui) => {
      activeHeader = header;
      headerRequestRender = (force = false) => tui.requestRender(force);
      startHeaderAnimation(ctx, generation);
      startHeaderCountdown(ctx, generation);

      return {
        render(width: number): string[] {
          if (!isActiveSession(ctx, generation)) return [];
          return header.render(width);
        },
        invalidate() {
          if (isActiveSession(ctx, generation)) header.invalidate();
        },
        dispose() {
          if (activeHeader === header) {
            activeHeader = null;
            headerRequestRender = null;
          }
        },
      };
    });

    // Pi paints one default frame before extensions bind. Force a full repaint
    // immediately after installing the header so the default editor frame is
    // replaced as quickly as sf-pi can manage without Pi core changes.
    headerRequestRender?.(true);
  }

  function setupOverlay(ctx: ExtensionContext, data: SplashData, generation: number) {
    // Pi guarantees the TUI is ready by session_start — no setTimeout needed.
    if (!ctx.hasUI || !isActiveSession(ctx, generation)) return;
    if (shouldDismissEarly || isStreaming) {
      shouldDismissEarly = false;
      return;
    }

    // Skip if session already has activity. `getBranch()` returns SessionEntry
    // which only carries message/custom/etc. entries — tool activity is nested
    // inside message.content. Type the iteration as a loose shape so we can
    // also defensively check for legacy tool_call/tool_result entry types that
    // some upstream versions may expose separately.
    type ActivityEntry = { type: string; message?: { role?: string } };
    const sessionEvents: ActivityEntry[] = ctx.sessionManager?.getBranch?.() ?? [];
    const hasActivity = sessionEvents.some(
      (e) =>
        (e.type === "message" && e.message?.role === "assistant") ||
        e.type === "tool_call" ||
        e.type === "tool_result",
    );
    if (hasActivity) return;

    // Hide pi's built-in working loader row while the splash overlay is up
    // so an early streaming start doesn't paint a loader behind the welcome
    // panel. Restored in the component's dispose handler (every dismiss
    // path goes through dispose). No-op on pi < 0.70.3.
    ctx.ui.setWorkingVisible(false);

    // The overlay component we return also exposes `focused` (Focusable) so the
    // TUI can manage cursor visibility, and a `dispose()` method that pi calls
    // when the overlay closes. Neither is part of plain `Component`, so we
    // describe the return shape explicitly.
    type OverlayComponent = Component & Focusable & { dispose?(): void };
    ctx.ui
      .custom<void>(
        (
          tui: TUI,
          _theme: Theme,
          _keybindings: KeybindingsManager,
          done: (result: void) => void,
        ): OverlayComponent => {
          if (!isActiveSession(ctx, generation)) {
            done();
            return {
              focused: false,
              render: () => [],
              invalidate: () => {},
              handleInput: () => {},
              dispose: () => {},
            };
          }

          const welcome = new SfWelcomeOverlay(data);

          // Same startup smoothing as quiet-header mode: once the overlay has
          // a TUI handle, force a full repaint to replace Pi's default frame.
          tui.requestRender(true);

          let countdown = 30;
          let dismissed = false;
          const intervalRef: { current?: ReturnType<typeof setInterval> } = {};
          // Separate interval for the Pi + SALESFORCE color shimmer.
          // Ticks for ~5 seconds on boot, then stops — the animation is
          // a one-time "boot-up moment," not an ongoing repaint cost.
          //
          // Opt-out: set SF_PI_REDUCED_MOTION=1 to skip the animation
          // entirely. Honors the motion-preference convention used by
          // prefers-reduced-motion in modern OSes.
          const headerIntervalRef: { current?: ReturnType<typeof setInterval> } = {};
          const reducedMotion = isReducedMotionRequested();
          let overlayHeaderOffset = 0;

          const doDismiss = (persistSeen: boolean = true) => {
            if (dismissed) return;
            dismissed = true;
            clearInterval(intervalRef.current);
            clearInterval(headerIntervalRef.current);
            if (dismissOverlay === doDismiss) {
              dismissOverlay = null;
            }
            if (isActiveSession(ctx, generation)) {
              overlayRequestRender = null;
            }
            // Persist the seen version on every user-visible dismiss path,
            // including countdown expiry and direct keypress dismissals that
            // bypass the outer dismiss() helper. Shutdown passes false.
            if (persistSeen) {
              markWhatsNewSeen();
              markAnnouncementsSeen();
            }
            done();
          };

          // Store dismiss callback for external triggers
          dismissOverlay = doDismiss;

          // Wire the external render hook through the captured `tui` so
          // async refreshes (SF env detection, monthly usage) can repaint
          // the overlay immediately instead of waiting for the next 1s
          // countdown tick. OverlayHandle doesn't expose a repaint API, so
          // this is the authoritative path.
          overlayRequestRender = () => {
            if (!dismissed && isActiveSession(ctx, generation)) tui.requestRender(true);
          };

          // Check if early dismissal was requested between the outer check and this point
          if (shouldDismissEarly) {
            shouldDismissEarly = false;
            doDismiss();
          }

          intervalRef.current = setInterval(() => {
            if (dismissed) return;
            if (!isActiveSession(ctx, generation)) {
              doDismiss(false);
              return;
            }
            countdown--;
            welcome.setCountdown(countdown);
            tui.requestRender();
            if (countdown <= 0) doDismiss();
          }, 1000);

          // Kick off the color-cycle animation for the brand mark. Runs
          // independently of the countdown interval so the 400 ms
          // shimmer cadence can't be distorted by the 1 s tick. Stops
          // itself once HEADER_ANIMATION_FRAMES frames have elapsed;
          // the final frame becomes the permanent look of the mark.
          //
          // `welcome.invalidate()` before requestRender is belt-and-
          // braces: the TUI's diff engine skips the repaint if render()
          // returns bytes identical to the previous frame. Invalidating
          // first drops any cached output so the new offset always paints.
          if (!reducedMotion) {
            headerIntervalRef.current = setInterval(() => {
              if (dismissed) return;
              if (!isActiveSession(ctx, generation)) {
                clearInterval(headerIntervalRef.current);
                return;
              }
              overlayHeaderOffset += 1;
              welcome.setHeaderOffset(overlayHeaderOffset);
              welcome.invalidate();
              // force:true bypasses pi-tui's diff cache so the new
              // per-character color bytes definitely land on screen
              // (sf-tui.d.ts requestRender(force?: boolean)).
              tui.requestRender(true);
              if (overlayHeaderOffset >= HEADER_ANIMATION_FRAMES) {
                clearInterval(headerIntervalRef.current);
              }
            }, HEADER_FRAME_MS);
          }

          return {
            focused: false,
            invalidate: () => {
              if (isActiveSession(ctx, generation)) welcome.invalidate();
            },
            render: (width: number) =>
              isActiveSession(ctx, generation) ? welcome.render(width) : [],
            handleInput: () => doDismiss(),
            dispose: () => {
              dismissed = true;
              if (dismissOverlay === doDismiss) {
                dismissOverlay = null;
              }
              if (isActiveSession(ctx, generation)) {
                overlayRequestRender = null;
              }
              clearInterval(intervalRef.current);
              clearInterval(headerIntervalRef.current);
              // Restore the built-in working loader row we hid before opening
              // the overlay. Runs on every close path (countdown, keypress,
              // external dismiss, session shutdown).
              ctx.ui.setWorkingVisible(true);
            },
          };
        },
        {
          overlay: true,
          // Use function form for responsive sizing on terminal resize.
          // Anchored top-left with a 1-col left margin so the splash
          // hugs pi's own left-aligned chrome (prompt row, bottom bar)
          // instead of floating center-screen on wide terminals.
          overlayOptions: () => ({
            anchor: "top-left" as const,
            margin: { top: 1, left: 1 },
          }),
          onHandle: (_handle: OverlayHandle) => {
            // OverlayHandle exposes hide/setHidden/focus/unfocus but no
            // requestRender. The factory above wires overlayRequestRender
            // through the captured `tui` instance, which is the right place
            // to trigger repaints. Kept as a typed reference so future code
            // that needs the handle has it.
          },
        },
      )
      .catch((error) => {
        // If custom() itself rejects we never got a dispose call, so restore
        // the loader row here as a belt-and-suspenders fallback.
        ctx.ui.setWorkingVisible(true);
        // Debug-ish log, but `no-console` only allows warn/error/info. Overlay
        // failures are rare and worth surfacing, so route through console.warn.
        if (isActiveSession(ctx, generation)) console.warn("[sf-welcome] Overlay failed:", error);
      });
  }
}
