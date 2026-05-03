/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-welcome — Salesforce-branded splash screen for sf-pi.
 *
 * Displays a two-column overlay on startup with:
 *   Left column:  Gradient Pi logo, model info, monthly cost bar, extension health, Slack status
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
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@mariozechner/pi-coding-agent";
import type { Component, Focusable, OverlayHandle, TUI } from "@mariozechner/pi-tui";
import {
  collectSplashData,
  detectSfEnvironment,
  getCachedSfEnvironmentInfo,
  readCurrentPiVersion,
  refreshAnnouncementsSummary,
  resolveLifetimeUsage,
  resolveMonthlyUsage,
} from "./lib/splash-data.ts";
import { acknowledgeAnnouncementsRevision } from "../../lib/common/catalog-state/announcements-state.ts";
import { SfWelcomeOverlay, SfWelcomeHeader } from "./lib/splash-component.ts";
import { isQuietStartupEnabled, isVerboseStartupRequested } from "./lib/startup-mode.ts";

import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import { requirePiVersion, setWorkingVisible } from "../../lib/common/pi-compat.ts";
import {
  refreshMonthlyUsage,
  subscribeMonthlyUsageState,
} from "../../lib/common/monthly-usage/store.ts";
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

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfWelcome(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-welcome")) return;

  let dismissOverlay: ((persistSeen?: boolean) => void) | null = null;
  let overlayRequestRender: (() => void) | null = null;
  let headerActive = false;
  /** Unsubscribe from the gateway usage store. Set during session_start and
   * cleared on dismiss / session_shutdown so we don't leak listeners across
   * reloads. */
  let unsubscribeUsageStore: (() => void) | null = null;
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
      ctx.ui.setHeader(undefined);
    }
    markWhatsNewSeen();
    markAnnouncementsSeen();
    // Subscription lifetime matches the splash lifetime — once the splash
    // is dismissed there is no component to repaint, so drop the listener.
    unsubscribeUsageStore?.();
    unsubscribeUsageStore = null;
  }

  // --- Session start: show splash screen ---
  pi.on("session_start", async (event, ctx) => {
    const runId = ++startupRunId;
    const generation = beginActiveSession(ctx);

    // Reset state
    dismissOverlay = null;
    overlayRequestRender = null;
    headerActive = false;
    shouldDismissEarly = false;
    isStreaming = false;

    if (!ctx.hasUI) return;

    // Only show the splash on initial startup — not on resume, reload, fork, etc.
    if (event.reason !== "startup") return;

    // Gather splash data
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
    void refreshMonthlyUsage(false, ctx.cwd).catch(() => undefined);

    const data = collectSplashData(modelName, providerName, ctx.cwd, MONTHLY_BUDGET_FALLBACK);

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

    // Prefer the last persisted snapshot so the splash can show useful org
    // context immediately, then refresh in place in the background.
    const cachedSfEnvironment = getCachedSfEnvironmentInfo(ctx.cwd);
    data.sfEnvironment = cachedSfEnvironment
      ? { ...cachedSfEnvironment, refreshing: true }
      : {
          cliInstalled: false,
          loading: true,
        };

    // Pi resolves startup display from project/global settings, with
    // --verbose overriding quietStartup. Built-in Pi flags are not extension
    // flags, so use argv detection instead of pi.getFlag().
    const isQuiet = isQuietStartupEnabled(ctx.cwd, isVerboseStartupRequested());
    if (isQuiet) {
      setupHeader(ctx, data, generation);
    } else {
      setupOverlay(ctx, data, generation);
    }

    // Background detection: keep startup responsive while SF CLI commands run.
    // Force a refresh on startup, but reuse the shared sf-environment runtime
    // so welcome and sf-devbar do not duplicate CLI work.

    void detectSfEnvironment(exec, ctx.cwd, { force: true })
      .then((env) => {
        if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
        data.sfEnvironment = env;

        if (headerActive) {
          setupHeader(ctx, data, generation);
          return;
        }

        overlayRequestRender?.();
      })
      .catch(() => {
        if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
        if (!data.sfEnvironment || data.sfEnvironment.loading) {
          data.sfEnvironment = { cliInstalled: false, loading: false };
        } else {
          data.sfEnvironment = { ...data.sfEnvironment, refreshing: false };
        }

        if (headerActive) {
          setupHeader(ctx, data, generation);
          return;
        }

        overlayRequestRender?.();
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
      const lifetime = resolveLifetimeUsage();
      data.monthlyCost = usage.monthlyCost;
      data.monthlyBudget = usage.monthlyBudget;
      data.monthlyUsageSource = usage.monthlyUsageSource;
      data.lifetimeCost = lifetime.lifetimeCost;
      data.lifetimeUsageSource = lifetime.lifetimeUsageSource;

      if (headerActive) {
        setupHeader(ctx, data, generation);
        return;
      }
      overlayRequestRender?.();
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
        if (headerActive) {
          setupHeader(ctx, data, generation);
          return;
        }
        overlayRequestRender?.();
      })
      .catch(() => {
        // Silent — refreshAnnouncementsSummary already swallows errors, but
        // we add a guard here so a theoretical rejection can't leak.
      });

    // Fire the one-time font-install prompt as a deferred, non-awaited
    // side task. Running it unawaited keeps session_start non-blocking,
    // and Pi will render the confirm dialog after the splash dismisses
    // (so the user sees the splash first, then a single prompt).
    void maybePromptFontInstall(ctx, generation);
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
    unsubscribeUsageStore?.();
    unsubscribeUsageStore = null;
    endActiveSession(ctx);
  });

  // --- /sf-welcome command ---
  pi.registerCommand(COMMAND_NAME, {
    description: "Show the sf-pi welcome splash screen summary",
    handler: async (_args, ctx) => {
      const modelName = ctx.model?.name || ctx.model?.id || "No model";
      const providerName = ctx.model?.provider || "Unknown provider";

      // Refresh the gateway's monthly-usage cache *before* reading it so the
      // /sf-welcome summary matches the bottom-bar value even when the user
      // runs the command mid-session. Without this, the handler would read
      // stale cache or — if the cache was never populated — fall back to
      // the local session-file estimate silently.
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
      const lifetimeSuffix = data.lifetimeUsageSource === "sessions" ? " (local estimate)" : "";

      const lines = [
        "sf-pi Welcome Summary",
        "",
        `Model: ${data.modelName}`,
        `Provider: ${data.providerName}`,
        "",
        `Monthly cost: $${data.monthlyCost.toFixed(2)} / ${budgetLabel}${costPercent}${sourceSuffix}`,
        `Lifetime cost: $${data.lifetimeCost.toFixed(2)}${lifetimeSuffix}`,
        `Slack: ${data.slackConnected ? "✓ Connected" : "✗ Not connected"}`,
        "",
        "sf-pi Extensions:",
        ...healthLines,
        "",
        `Loaded: ${data.loadedCounts.extensions} extensions, ${data.loadedCounts.skills} skills, ${data.loadedCounts.promptTemplates} prompt templates`,
        "",
        "Recent Sessions:",
        ...data.recentSessions.map((s) => `  • ${s.name} (${s.timeAgo})`),
      ];

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // --- /sf-setup-fonts command ---
  //
  // Manual entry point for installing the bundled MesloLGM Nerd Font
  // Mono TTFs. Delegates to the shared runFontInstall() helper so the
  // one-time splash prompt and this command emit the exact same output.
  pi.registerCommand(FONTS_COMMAND_NAME, {
    description: "Install the bundled Nerd Font used by the sf-pi splash",
    handler: async (_args, ctx) => {
      const result = await runFontInstall(exec);
      ctx.ui.notify(result.summary, result.severity);
      // Record that the user has made a decision so the one-time splash
      // prompt doesn't also ask. Users running this explicitly are
      // clearly opting in.
      writeWelcomeState({
        fontInstallDecision: "yes",
        fontInstallPromptedAt: new Date().toISOString(),
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

  function setupHeader(
    ctx: ExtensionContext,
    data: ReturnType<typeof collectSplashData>,
    generation: number,
  ) {
    if (!ctx.hasUI || !isActiveSession(ctx, generation)) return;
    const header = new SfWelcomeHeader(data);
    headerActive = true;

    ctx.ui.setHeader(() => ({
      render(width: number): string[] {
        if (!isActiveSession(ctx, generation)) return [];
        return header.render(width);
      },
      invalidate() {
        if (isActiveSession(ctx, generation)) header.invalidate();
      },
    }));
  }

  function setupOverlay(
    ctx: ExtensionContext,
    data: ReturnType<typeof collectSplashData>,
    generation: number,
  ) {
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
    setWorkingVisible(ctx, false);

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

          let countdown = 30;
          let dismissed = false;
          const intervalRef: { current?: ReturnType<typeof setInterval> } = {};
          // Separate interval for the Pi + SALESFORCE color shimmer. Ticks
          // every 300 ms for a few seconds, then stops — so the animation
          // is a one-time "boot-up moment," not an ongoing repaint cost.
          //
          // Opt-out: set SF_PI_REDUCED_MOTION=1 to skip the animation
          // entirely. Honors the motion-preference convention used by
          // prefers-reduced-motion in modern OSes.
          const headerIntervalRef: { current?: ReturnType<typeof setInterval> } = {};
          const reducedMotion =
            process.env.SF_PI_REDUCED_MOTION === "1" || process.env.SF_PI_REDUCED_MOTION === "true";
          const HEADER_FRAME_MS = 300;
          const HEADER_ANIMATION_FRAMES = 20; // 20 × 300 ms = 6 s
          let headerOffset = 0;

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
            if (!dismissed && isActiveSession(ctx, generation)) tui.requestRender();
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
          // independently of the countdown interval so the 300 ms shimmer
          // cadence can't be distorted by the 1 s tick. Stops itself once
          // HEADER_ANIMATION_FRAMES frames have elapsed (final state
          // freezes as the permanent look of the mark).
          if (!reducedMotion) {
            headerIntervalRef.current = setInterval(() => {
              if (dismissed) return;
              if (!isActiveSession(ctx, generation)) {
                clearInterval(headerIntervalRef.current);
                return;
              }
              headerOffset += 1;
              welcome.setHeaderOffset(headerOffset);
              tui.requestRender();
              if (headerOffset >= HEADER_ANIMATION_FRAMES) {
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
              setWorkingVisible(ctx, true);
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
        setWorkingVisible(ctx, true);
        // Debug-ish log, but `no-console` only allows warn/error/info. Overlay
        // failures are rare and worth surfacing, so route through console.warn.
        if (isActiveSession(ctx, generation)) console.warn("[sf-welcome] Overlay failed:", error);
      });
  }
}
