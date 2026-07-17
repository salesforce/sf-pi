/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-welcome — Salesforce-branded splash screen for sf-pi.
 *
 * Displays a two-column overlay on startup with:
 *   Left column:  Gradient Pi logo, model info, optional gateway usage,
 *                 environment checks, and release freshness rows
 *   Right column: Announcements, loaded counts, recent sessions,
 *                  recommended extensions, attribution
 *
 * Supports two modes:
 *   - quietStartup: false (default) → Dismissable overlay
 *   - quietStartup: true            → Persistent header above input
 *   (--verbose overrides quietStartup and forces the overlay)
 *
 * Dismissal triggers:
 *   - Any keypress
 *   - Agent starts responding (agent_start event)
 *   - Tool call execution
 *
 * Behavior matrix:
 *
 *   Event/Trigger         | Condition                    | Result
 *   ----------------------|------------------------------|-------------------------------------------
 *   session_start         | reason="startup", no quiet   | Show overlay splash
 *   session_start         | reason="startup", quiet=true | Show persistent header
 *   session_start         | reason!="startup"            | Skip (resume, reload, fork, etc.)
 *   agent_start           | overlay visible              | Dismiss overlay
 *   tool_call             | overlay visible              | Dismiss overlay
 *   any keypress          | overlay visible              | Dismiss overlay
 *   /sf-welcome           | always                       | Show splash info summary
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { getFirstTokenCompletionsFromActions } from "../../lib/common/command-actions.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";

import type { SplashData } from "./lib/types.ts";
import { matchesKey } from "@earendil-works/pi-tui";
import {
  collectInitialSplashData,
  collectSplashData,
  detectSfCliStatus,
  detectPiReleaseStatus,
  detectSfPiReleaseStatus,
  detectSfSkillsStatus,
  readCachedSfCliStatus,
  readCachedSfSkillsStatus,
  reconcileCachedSfSkillsStatus,
  refreshAnnouncementsSummary,
  resolveMonthlyUsage,
  writeCachedPiReleaseStatus,
  writeCachedSfCliStatus,
  writeCachedSfSkillsStatus,
} from "./lib/splash-data.ts";
import { readCachedNodeCertStatus, writeCachedNodeCertStatus } from "./lib/node-cert-cache.ts";
import { writeCachedFontRuntimeStatus } from "./lib/font-status-cache.ts";
import { detectHunkStatus, writeCachedHunkStatus } from "./lib/hunk-status.ts";
import { detectHomebrewStatus, writeCachedHomebrewStatus } from "./lib/homebrew-status.ts";
import {
  detectBrowserRuntimeStatus,
  writeCachedBrowserRuntimeStatus,
} from "../../lib/common/browser-runtime-status/store.ts";
import { acknowledgeAnnouncementsRevision } from "../../lib/common/catalog-state/announcements-state.ts";
import { SfWelcomeHeader } from "./lib/splash-component.ts";
import {
  refreshRuntimeDiagnosticsCache,
  resolveConfiguredWelcomeMode,
  runDoctorDiagnostics,
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
import { FONT_FAMILY_NAME, isFontFamilyInstalled } from "./lib/font-status.ts";
import { readWelcomeState, writeWelcomeState } from "./lib/state-store.ts";
import { resolveGlyphMode } from "../../lib/common/glyph-policy.ts";
import { discoverLoadedCounts } from "./lib/splash-data.ts";
import {
  bootTimingLogPath,
  flushBootTiming,
  markBootStep,
  resetBootTiming,
} from "../../lib/common/boot-timing.ts";

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
const HEADER_ANIMATION_DURATION_MS = 8_000;
const HEADER_ANIMATION_FRAMES = Math.ceil(HEADER_ANIMATION_DURATION_MS / HEADER_FRAME_MS);

function isReducedMotionRequested(): boolean {
  return process.env.SF_PI_REDUCED_MOTION === "1" || process.env.SF_PI_REDUCED_MOTION === "true";
}

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfWelcome(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-welcome")) return;

  let headerActive = false;
  let activeHeader: SfWelcomeHeader | null = null;
  let headerRequestRender: ((force?: boolean) => void) | null = null;
  let headerAnimationTimer: ReturnType<typeof setInterval> | null = null;
  let headerInputUnsubscribe: (() => void) | null = null;
  let headerOffset = 0;
  /** Unsubscribe from the gateway usage store. Set during session_start and
   * cleared on dismiss / session_shutdown so we don't leak listeners across
   * reloads. */
  let unsubscribeUsageStore: (() => void) | null = null;
  let unsubscribeSlackStore: (() => void) | null = null;
  let startupRunId = 0;
  let activeSessionGeneration = 0;
  let activeSessionKey: string | null = null;
  /** Announcements revision active at session_start. Persisted when the
   * splash is dismissed so the maintainer nudge doesn't re-arm until the
   * manifest revision actually bumps. */
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

  function runtimeToolNames(): { activeToolNames: string[]; allToolNames: string[] } {
    try {
      return {
        activeToolNames: typeof pi.getActiveTools === "function" ? pi.getActiveTools() : [],
        allToolNames:
          typeof pi.getAllTools === "function" ? pi.getAllTools().map((tool) => tool.name) : [],
      };
    } catch {
      return { activeToolNames: [], allToolNames: [] };
    }
  }

  /**
   * Persist the current announcements revision exactly once per startup.
   * Any user-visible dismiss path counts as acknowledgement so the footer
   * nudge clears.
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

  function stopHeaderDismissListener(): void {
    headerInputUnsubscribe?.();
    headerInputUnsubscribe = null;
  }

  function resetHeaderAnimation(): void {
    stopHeaderAnimation();
    stopHeaderDismissListener();
    activeHeader = null;
    headerRequestRender = null;
    headerOffset = 0;
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

  function startHeaderDismissListener(ctx: ExtensionContext, generation: number): void {
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
    }
  }

  /**
   * Phase 2.2: debounced repaint coalescer.
   *
   * Multiple async data sources (gateway usage probe, slack scope check,
   * sf-cli detection, announcements feed) each finish on their own and
   * trigger a forced repaint. Without coalescing the splash forces 5–7
   * full overlay redraws during hydration, which reads as visual jitter
   * on slower terminals. A 60ms trailing debounce drops that to 2–3
   * paints without any user-visible delay (well below the 100ms
   * perceptual threshold). Force is OR'ed across coalesced calls so a
   * single force=true callsite is preserved through the merge.
   */
  let coalesceForce = false;
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSplashRepaint(
    ctx: ExtensionContext,
    generation: number,
    force: boolean = false,
  ): void {
    coalesceForce = coalesceForce || force;
    if (coalesceTimer) return;
    coalesceTimer = setTimeout(() => {
      const f = coalesceForce;
      coalesceForce = false;
      coalesceTimer = null;
      refreshMountedSplash(ctx, generation, f);
    }, 60);
    coalesceTimer.unref?.();
  }

  // Helper: dismiss welcome screen header
  function dismiss(ctx: ExtensionContext) {
    if (!isActiveSession(ctx)) return;
    if (headerActive) {
      headerActive = false;
      resetHeaderAnimation();
      ctx.ui.setHeader(undefined);
    }
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
    headerActive = false;
    resetHeaderAnimation();

    if (!ctx.hasUI) return;

    // Only show the splash on initial startup — not on resume, reload, fork, etc.
    if (event.reason !== "startup") return;

    const modelName = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown provider";
    const startupDoctorReport = runDoctorDiagnostics({ cwd: ctx.cwd, runtime: "cached" });
    const startupDoctorNudge = summarizeStartupDoctorNudge(startupDoctorReport) ?? undefined;
    const data = collectInitialSplashData(
      modelName,
      providerName,
      MONTHLY_BUDGET_FALLBACK,
      ctx.cwd,
      { doctor: startupDoctorNudge, ...runtimeToolNames() },
    );
    const cachedSfCli = readCachedSfCliStatus();
    if (cachedSfCli) {
      data.sfCli = cachedSfCli;
    }
    // sf-skills status is also cache-first — the deferred refresh below
    // populates the live value and writes back to disk for the next launch.
    const cachedSfSkills = reconcileCachedSfSkillsStatus(ctx.cwd, readCachedSfSkillsStatus());
    if (cachedSfSkills) {
      data.sfSkills = cachedSfSkills;
    }
    const cachedNodeCert = readCachedNodeCertStatus();
    if (cachedNodeCert) {
      data.nodeCert = cachedNodeCert;
    }
    data.doctor = startupDoctorNudge;

    // Startup is intentionally non-blocking: render as a header so the user
    // can type while background rows refresh. The full overlay remains useful
    // for previews/tests but is no longer used on automatic startup.
    const welcomeMode = resolveConfiguredWelcomeMode(ctx.cwd);
    if (welcomeMode === "off") return;
    setupHeader(ctx, data, generation);

    // Kick the gateway's monthly-usage cache in the background so the splash
    // matches the bottom bar. We don't await it here — the splash renders
    // immediately with whatever cache is available and repaints when the
    // shared store publishes.
    //
    // Chunk 5: delay this slightly so first paint and cheap local hydration
    // win the event-loop race. Gateway status is display data and already
    // renders as "Checking..." until the probe completes.
    const gatewayRefreshTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      void markBootStep("sf-welcome.gateway-refresh", () =>
        refreshMonthlyUsage(true, ctx.cwd),
      ).catch(() => undefined);
    }, 700);
    gatewayRefreshTimer.unref?.();

    setImmediate(() => {
      try {
        if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
        const currentSfCli = data.sfCli;
        const currentPiRelease = data.piRelease;
        const currentNodeCert = data.nodeCert;
        // Phase 2.3: split heavy FS work across two ticks. The first tick
        // runs collectSplashData EXCEPT loadedCounts (skipped via the
        // optional second-arg flag) so the splash paints model + gateway +
        // slack + sf-cli rows immediately. The loaded-counts FS scan, which
        // walks ~/.pi, ~/.claude, and the project tree, runs on the next
        // tick. On a warm cache the difference is invisible; on a cold
        // cache (machine just woke) the splash paints ~50ms sooner.
        const fullData = markBootStep("sf-welcome.collect-splash", () =>
          collectSplashData(modelName, providerName, ctx.cwd, MONTHLY_BUDGET_FALLBACK, {
            doctor: data.doctor,
            includeLoadedCounts: false,
            includeSessionCostFallback: false,
            ...runtimeToolNames(),
          }),
        );
        // collectSplashData is sync — markBootStep returns the sync result
        // wrapped in a resolved Promise; settle synchronously below.
        void fullData.then((settled) => {
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          Object.assign(data, settled);
          data.sfCli = currentSfCli ?? { installed: false, freshness: "checking", loading: true };
          data.piRelease = currentPiRelease ?? data.piRelease;
          data.nodeCert = currentNodeCert ?? { kind: "checking", loading: true };
          data.doctor = startupDoctorNudge;

          if (data.announcements && data.announcements.visible.length > 0) {
            pendingAckedRevision = data.announcements.revision || undefined;
          } else {
            pendingAckedRevision = undefined;
          }

          scheduleSplashRepaint(ctx, generation);

          // Loaded-counts FS scan deferred to a second tick so the splash
          // paints with everything else first. Re-runs the scan because
          // collectSplashData already filled stale zeros — cheaper than
          // restructuring collectSplashData to take a flag.
          setImmediate(() => {
            if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
            try {
              const counts = markBootStep("sf-welcome.loaded-counts", () =>
                discoverLoadedCounts(ctx.cwd),
              );
              void counts.then((c) => {
                if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
                data.loadedCounts = c;
                data.loadedCountsLoading = false;
                scheduleSplashRepaint(ctx, generation);
              });
            } catch {
              // Best-effort — a partial splash with zero counts is fine.
            }
          });
        });
      } catch {
        // Best-effort hydration: keep the initial splash visible even if a
        // local settings/session scan fails unexpectedly.
      }
    });

    const doctorRefreshTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      void markBootStep("sf-welcome.doctor-runtime-refresh", () => refreshRuntimeDiagnosticsCache())
        .then(() => {
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          const report = runDoctorDiagnostics({ cwd: ctx.cwd, runtime: "cached" });
          data.doctor = summarizeStartupDoctorNudge(report) ?? undefined;
          scheduleSplashRepaint(ctx, generation);
        })
        .catch(() => undefined);
    }, 1_500);
    doctorRefreshTimer.unref?.();

    // Background CLI status: cache-first for first paint, live refresh later.
    // SF CLI freshness is informational, so we defer the subprocess + npm
    // registry check by 2s. The row renders cached status immediately when
    // available, otherwise "Checking..." until the refresh lands.
    const sfCliTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      void markBootStep("sf-welcome.sf-cli-detect", () => detectSfCliStatus(exec))
        .then((cli) => {
          writeCachedSfCliStatus(cli);
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.sfCli = cli;

          scheduleSplashRepaint(ctx, generation);
        })
        .catch(() => {
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.sfCli = { installed: false, freshness: "unknown", loading: false };
          scheduleSplashRepaint(ctx, generation);
        });
    }, 2_000);
    sfCliTimer.unref?.();

    // Background sf-skills status: same cache-first pattern as the CLI row
    // but staggered 500 ms after it so the two network probes (npm registry
    // + GitHub compare API) don't pile up on the same event-loop tick. The
    // local FS detection is sync and cheap (~1 ms); the network call is the
    // only thing that's deferred.
    const sfSkillsTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      void markBootStep("sf-welcome.sf-skills-detect", () => detectSfSkillsStatus(ctx.cwd))
        .then((skills) => {
          writeCachedSfSkillsStatus(skills);
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.sfSkills = skills;
          scheduleSplashRepaint(ctx, generation);
        })
        .catch(() => {
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          // Detection itself never throws — this catch is defensive only.
          // Keep whatever cache the splash already painted with.
          if (!data.sfSkills) {
            data.sfSkills = { installKind: "not-installed", freshness: "unknown", loading: false };
            scheduleSplashRepaint(ctx, generation);
          }
        });
    }, 2_500);
    sfSkillsTimer.unref?.();

    // Background Pi release freshness: cache-first for first paint, live
    // refresh later. This mirrors Pi's documented update check endpoint but
    // is delayed so it never competes with startup. It also respects
    // PI_OFFLINE and PI_SKIP_VERSION_CHECK.
    const piReleaseTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      void markBootStep("sf-welcome.pi-release-detect", () => detectPiReleaseStatus())
        .then((status) => {
          writeCachedPiReleaseStatus(status);
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.piRelease = status;
          scheduleSplashRepaint(ctx, generation);
        })
        .catch(() => {
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          if (data.piRelease) {
            data.piRelease = { ...data.piRelease, freshness: "unknown", loading: false };
          }
          scheduleSplashRepaint(ctx, generation);
        });
    }, 3_000);
    piReleaseTimer.unref?.();

    // Background Node CA status: cache-first and strictly local. This runs
    // after the SF CLI / SF Skills / Pi release probes so it cannot affect first paint,
    // and it performs no network, subprocess, or recursive filesystem work.
    const nodeCertTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      try {
        const cert = markBootStep("sf-welcome.node-cert-detect", async () => {
          const { detectNodeCertStatus } = await import("./lib/node-cert-status.ts");
          return detectNodeCertStatus(ctx.cwd);
        });
        void cert
          .then((status) => {
            writeCachedNodeCertStatus(status);
            if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
            data.nodeCert = status;
            scheduleSplashRepaint(ctx, generation);
          })
          .catch(() => {
            if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
            data.nodeCert = { kind: "unknown", loading: false };
            scheduleSplashRepaint(ctx, generation);
          });
      } catch {
        if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
        data.nodeCert = { kind: "unknown", loading: false };
        scheduleSplashRepaint(ctx, generation);
      }
    }, 3_500);
    nodeCertTimer.unref?.();

    // Background font status: cache-first, then a local-only user font
    // directory check. No subprocess here; /sf-setup-fonts owns install and
    // font-cache refresh.
    const fontStatusTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      try {
        const font = markBootStep("sf-welcome.font-status-detect", async () => {
          const { detectFontRuntimeStatus } = await import("./lib/font-status.ts");
          return detectFontRuntimeStatus({ cwd: ctx.cwd });
        });
        void font
          .then((status) => {
            writeCachedFontRuntimeStatus(status);
            if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
            data.fontRuntime = status;
            scheduleSplashRepaint(ctx, generation);
          })
          .catch(() => {
            if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
            data.fontRuntime = {
              fontFamily: FONT_FAMILY_NAME,
              glyphMode: data.fontRuntime?.glyphMode ?? "emoji",
              supportedPlatform: process.platform === "darwin" || process.platform === "linux",
              installed: data.fontRuntime?.installed ?? false,
              kind: "unknown",
              loading: false,
            };
            scheduleSplashRepaint(ctx, generation);
          });
      } catch {
        if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
        data.fontRuntime = {
          fontFamily: FONT_FAMILY_NAME,
          glyphMode: data.fontRuntime?.glyphMode ?? "emoji",
          supportedPlatform: process.platform === "darwin" || process.platform === "linux",
          installed: data.fontRuntime?.installed ?? false,
          kind: "unknown",
          loading: false,
        };
        scheduleSplashRepaint(ctx, generation);
      }
    }, 4_000);
    fontStatusTimer.unref?.();

    // Background Hunk readiness: optional review-tool nudge only. This does
    // not open Hunk or create review annotations.
    const hunkTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      void markBootStep("sf-welcome.hunk-detect", () => detectHunkStatus(exec))
        .then((status) => {
          writeCachedHunkStatus(status);
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.hunk = status;
          scheduleSplashRepaint(ctx, generation);
        })
        .catch(() => {
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.hunk = { installed: false, loading: false };
          scheduleSplashRepaint(ctx, generation);
        });
    }, 4_500);
    hunkTimer.unref?.();

    // Background Homebrew readiness: bounded local package-manager status only.
    // Do not run brew update/outdated/doctor from the splash.
    const homebrewTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      void markBootStep("sf-welcome.homebrew-detect", () => detectHomebrewStatus(exec))
        .then((status) => {
          writeCachedHomebrewStatus(status);
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.homebrew = status;
          scheduleSplashRepaint(ctx, generation);
        })
        .catch(() => {
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.homebrew = { kind: "unknown", loading: false, platform: process.platform };
          scheduleSplashRepaint(ctx, generation);
        });
    }, 5_000);
    homebrewTimer.unref?.();

    // Background agent-browser install/freshness check. This preserves the SF
    // Browser lazy-runtime boundary: version probe only, no Chrome/CDP launch.
    const browserRuntimeTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      void markBootStep("sf-welcome.agent-browser-detect", () => detectBrowserRuntimeStatus(exec))
        .then((status) => {
          writeCachedBrowserRuntimeStatus(status);
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.browserRuntime = status;
          scheduleSplashRepaint(ctx, generation);
        })
        .catch(() => {
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.browserRuntime = { installed: false, freshness: "unknown", loading: false };
          scheduleSplashRepaint(ctx, generation);
        });
    }, 5_500);
    browserRuntimeTimer.unref?.();

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
      const usage = resolveMonthlyUsage(MONTHLY_BUDGET_FALLBACK, {
        includeSessionFallback: false,
      });
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
      // Phase 1.6: surface the cross-source key conflict on the splash row.
      data.gatewayKeyConflict = data.gatewayVisible ? (gatewayState.keyConflict ?? null) : null;

      scheduleSplashRepaint(ctx, generation);
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
      scheduleSplashRepaint(ctx, generation);
    });

    // Refresh announcements from the remote feed (when configured) in the
    // background. Updates the data payload in place and repaints the splash
    // once the fetch settles. The sync payload has already populated
    // `data.announcements` with bundled + cached remote entries, so a
    // failed/disabled fetch simply leaves those intact.
    // Announcements only repaint the right column — zero impact on first
    // glance — so they fire last. 800 ms is past the typical splash
    // hydration phase but still well within the 30 s splash visibility
    // window. Same `unref` pattern as sf-cli-detect so the deferred work
    // never holds the event loop open.
    const announcementsTimer = setTimeout(() => {
      if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
      void markBootStep("sf-welcome.announcements-refresh", () =>
        refreshAnnouncementsSummary(ctx.cwd),
      )
        .then((summary) => {
          if (runId !== startupRunId || !isActiveSession(ctx, generation)) return;
          data.sfPiRelease = detectSfPiReleaseStatus(ctx.cwd);
          if (!summary) {
            scheduleSplashRepaint(ctx, generation);
            return;
          }
          data.announcements = summary;
          if (summary.visible.length > 0) {
            pendingAckedRevision = summary.revision || undefined;
          }
          scheduleSplashRepaint(ctx, generation);
        })
        .catch(() => {
          // Silent — refreshAnnouncementsSummary already swallows errors, but
          // we add a guard here so a theoretical rejection can't leak.
        });
    }, 800);
    announcementsTimer.unref?.();

    // Fire the one-time font-install prompt as a deferred, non-awaited
    // side task. Running it unawaited keeps session_start non-blocking,
    // and Pi will render the confirm dialog after the splash dismisses
    // (so the user sees the splash first, then a single prompt).
    if (!startupDoctorReport.safeStartRequested) {
      void maybePromptFontInstall(ctx, generation);
    }
  });

  // --- Dismiss on agent activity ---
  // Phase 3.2: when SF_PI_BOOT_TIMING=1 is active, drop a one-time hint
  // about the persisted log path so users know where to look. Suppressed
  // when not enabled so normal sessions don't get a no-op notification.
  pi.on("session_start", async (_event, ctx) => {
    const enabled =
      process.env.SF_PI_BOOT_TIMING === "1" || process.env.SF_PI_BOOT_TIMING === "true";
    if (!enabled || !ctx.hasUI) return;
    // Defer slightly so the notification doesn't compete with the splash.
    setTimeout(() => {
      try {
        ctx.ui.notify(
          `Boot timing report saved to ${bootTimingLogPath()} (also printed to stderr).`,
          "info",
        );
      } catch {
        // best-effort
      }
    }, 2_000);
  });

  pi.on("agent_start", async (_event, ctx) => {
    dismiss(ctx);
  });

  pi.on("tool_call", async (_event, ctx) => {
    dismiss(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const wasActive = isActiveSession(ctx);
    if (!wasActive) return;

    // Phase 3.2: finalize the boot-timing report on shutdown so any step
    // that landed after the last debounced flush still makes it to disk.
    // No-op when SF_PI_BOOT_TIMING isn't set.
    flushBootTiming();
    resetBootTiming();

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

  // ---------------------------------------------------------------------------
  // /sf-welcome panel actions and helpers
  // ---------------------------------------------------------------------------

  type WelcomeAction = "summary" | "fonts" | "help";

  const WELCOME_ACTIONS: Array<{
    value: WelcomeAction;
    label: string;
    description: string;
    group: string;
  }> = [
    {
      value: "summary",
      label: "Show splash summary",
      description:
        "Print the same model, monthly-cost, gateway/slack, Node CA, release freshness, extension health, and recent-session lines the splash shows on startup.",
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
  ];

  // --- /sf-welcome command ---
  pi.registerCommand(COMMAND_NAME, {
    description: "Show the sf-pi welcome splash summary, status, and controls",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(WELCOME_ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await openWelcomeInManager(ctx, "detail");
          return;
        }
        const action = WELCOME_ACTIONS.some((item) => item.value === sub)
          ? (sub as WelcomeAction)
          : "summary";
        await handleWelcomeAction(ctx, action);
      });
    },
  });

  function buildWelcomeManagerActions(): ManagerDetailAction[] {
    return WELCOME_ACTIONS.map((action) => ({
      id: action.value,
      label: action.label,
      description: action.description,
      group: action.group,
      run: (ctx) => handleWelcomeAction(ctx, action.value),
    }));
  }

  registerManagerDetailActions(pi, COMMAND_NAME, buildWelcomeManagerActions());

  async function openWelcomeInManager(
    ctx: ExtensionCommandContext,
    view: NonNullable<SfPiManagerOpenRoute["view"]>,
  ): Promise<void> {
    const opened = await openExtensionInManager(pi, ctx, {
      extensionId: COMMAND_NAME,
      view,
      actions: buildWelcomeManagerActions(),
    });
    if (!opened) {
      ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-welcome.", "warning");
    }
  }

  async function handleWelcomeAction(
    ctx: ExtensionCommandContext,
    action: WelcomeAction,
  ): Promise<void> {
    if (action === "summary") {
      const summary = await buildWelcomeSummary(ctx);
      await emitWelcomeOutput(ctx, "sf-pi welcome summary", summary, "info");
      return;
    }

    if (action === "fonts") {
      const { runFontInstall } = await import("./lib/font-installer.ts");
      const result = await runFontInstall(exec);
      const { detectFontRuntimeStatus } = await import("./lib/font-status.ts");
      writeCachedFontRuntimeStatus(detectFontRuntimeStatus({ cwd: ctx.cwd }));
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
          "  /sf-welcome          Open SF Welcome in the SF Pi Manager.",
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
  // action and direct /sf-welcome summary fallback.
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
      // the shared usage/status cache.
    }

    const data = collectSplashData(modelName, providerName, ctx.cwd, MONTHLY_BUDGET_FALLBACK, {
      ...runtimeToolNames(),
    });
    try {
      const { detectNodeCertStatus } = await import("./lib/node-cert-status.ts");
      const nodeCert = detectNodeCertStatus(ctx.cwd);
      writeCachedNodeCertStatus(nodeCert);
      data.nodeCert = nodeCert;
    } catch {
      data.nodeCert ??= { kind: "unknown", loading: false };
    }
    data.sfPiRelease = detectSfPiReleaseStatus(ctx.cwd);
    try {
      const piRelease = await detectPiReleaseStatus();
      writeCachedPiReleaseStatus(piRelease);
      data.piRelease = piRelease;
    } catch {
      data.piRelease ??= {
        freshness: "unknown",
        loading: false,
        updateCommand: "pi update --self --force",
      };
    }
    const healthLines = data.extensionHealth.map((ext) => {
      const statusIcon = ext.status === "active" ? "●" : ext.status === "locked" ? "◆" : "○";
      return `  ${statusIcon} ${ext.name} — ${ext.status}`;
    });
    const budgetLabel = data.monthlyBudget === null ? "∞" : `$${data.monthlyBudget}`;
    const costPercent =
      typeof data.monthlyBudget === "number" && data.monthlyBudget > 0
        ? ` (${((data.monthlyCost / data.monthlyBudget) * 100).toFixed(1)}%)`
        : "";
    const usingGatewayModel =
      data.providerName.toLowerCase().includes("gateway") ||
      data.modelName.toLowerCase().includes("gateway");
    const monthlyUsageLines =
      usingGatewayModel && data.monthlyUsageSource === "gateway"
        ? [`Monthly usage: $${data.monthlyCost.toFixed(2)} / ${budgetLabel}${costPercent}`]
        : [];
    const gatewayStatus = data.gatewayVisible
      ? (data.gatewayStatus?.kind ?? "not checked")
      : "hidden";
    const slackStatus = data.slackVisible ? (data.slackStatus?.kind ?? "not checked") : "hidden";
    const nodeCertStatus = data.nodeCert?.kind ?? "not checked";
    const nodeRuntimeStatus = data.nodeRuntime
      ? `${data.nodeRuntime.version} (${data.nodeRuntime.kind}, requires >=${data.nodeRuntime.requiredVersion})`
      : "not checked";
    const herdrRuntimeStatus = formatPlainHerdrRuntimeStatus(data.herdrRuntime);
    const fontRuntimeStatus = data.fontRuntime?.kind ?? "not checked";
    const hunkStatus = data.hunk?.installed
      ? `installed${data.hunk.installedVersion ? ` v${data.hunk.installedVersion}` : ""}`
      : data.hunk?.loading
        ? "checking"
        : "optional · not installed";
    const homebrewStatus = data.homebrew
      ? data.homebrew.kind === "installed"
        ? `installed${data.homebrew.version ? ` v${data.homebrew.version}` : ""}`
        : data.homebrew.kind
      : "not checked";
    const browserRuntimeStatus = formatPlainBrowserRuntimeStatus(data.browserRuntime);
    const autoUpdateStatus = data.autoUpdate
      ? `${data.autoUpdate.enabled ? "on" : "off · optional"}${data.autoUpdate.status.lastResult ? ` (${data.autoUpdate.status.lastResult})` : ""}`
      : "not checked";
    const activeExtensionCount = data.extensionHealth.filter(
      (ext) => ext.status === "active" || ext.status === "locked",
    ).length;
    const totalExtensionCount = data.extensionHealth.length;

    return [
      "sf-pi Welcome Summary",
      "",
      `Model: ${data.modelName}`,
      `Provider: ${data.providerName}`,
      "",
      ...monthlyUsageLines,
      `Gateway: ${gatewayStatus}`,
      `Slack: ${slackStatus}`,
      `Node.js: ${nodeRuntimeStatus}`,
      `Herdr (Multiplexer): ${herdrRuntimeStatus}`,
      `Fonts: ${fontRuntimeStatus}`,
      `Hunk (Code Review): ${hunkStatus}`,
      `Homebrew: ${homebrewStatus}`,
      `SF Browser: ${browserRuntimeStatus}`,
      `Auto Update: ${autoUpdateStatus}`,
      `Node CA Certs: ${nodeCertStatus}`,
      `sf-pi: ${formatPlainReleaseStatus(data.sfPiRelease)} (${activeExtensionCount}/${totalExtensionCount} extensions active)`,
      `Pi: ${formatPlainReleaseStatus(data.piRelease)}`,
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

  function formatPlainBrowserRuntimeStatus(status: SplashData["browserRuntime"]): string {
    if (!status) return "not checked";
    if (status.loading) return "checking";
    if (!status.installed) return "missing";
    const version = status.installedVersion ? ` v${status.installedVersion}` : "";
    const freshness = status.checkSkipped ? "latest check skipped" : status.freshness;
    return `installed${version} (${freshness})`;
  }

  function formatPlainHerdrPiIntegration(status: SplashData["herdrRuntime"]): string {
    const pi = status?.piIntegration;
    if (!pi) return "Pi state not checked";
    if (pi.kind === "installed") {
      return `Pi state${typeof pi.version === "number" ? ` v${pi.version}` : " installed"}`;
    }
    if (pi.kind === "missing") return "Pi state not installed";
    return "Pi state unknown";
  }

  function formatPlainHerdrRuntimeStatus(status: SplashData["herdrRuntime"]): string {
    if (!status) return "not checked";
    const piState = formatPlainHerdrPiIntegration(status);
    if (status.kind === "ready") return `tool active · pane control ready · ${piState}`;
    if (status.kind === "tool-only") return `tool active · not inside Herdr · ${piState}`;
    if (status.kind === "installed-not-active") {
      return status.activeControlEnv
        ? `package installed · tool inactive · ${piState}`
        : `package installed · not inside Herdr · ${piState}`;
    }
    if (status.kind === "disabled") return "sf-herdr disabled";
    return `package not installed · ${piState}`;
  }

  function formatPlainReleaseStatus(
    status: SplashData["sfPiRelease"] | SplashData["piRelease"],
  ): string {
    if (!status) return "not checked";
    const installed = status.installedVersion ? `v${status.installedVersion}` : "version unknown";
    if (status.freshness === "latest") return `latest · ${installed}`;
    if (status.freshness === "update-available") {
      const latest = status.latestVersion ? `v${status.latestVersion}` : "latest";
      return `update available · ${installed} → ${latest}`;
    }
    if (status.freshness === "checking" || status.loading) return `checking latest · ${installed}`;
    const reason = status.checkSkipped ? "latest check skipped" : "latest unknown";
    return `installed · ${installed} (${reason})`;
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
  // Mono TTFs. No-args /sf-setup-fonts opens SF Welcome in the SF Pi Manager;
  // direct subcommands delegate to runFontInstall() for the actual install — the splash
  // prompt and this panel emit the exact same install output.

  type SfSetupFontsAction = "status" | "install" | "reset" | "help";

  const SF_SETUP_FONTS_ACTIONS: Array<{
    value: SfSetupFontsAction;
    label: string;
    description: string;
    group: string;
  }> = [
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
        "  /sf-setup-fonts          Open SF Welcome in the SF Pi Manager",
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
        const { runFontInstall } = await import("./lib/font-installer.ts");
        const result = await runFontInstall(exec);
        const { detectFontRuntimeStatus } = await import("./lib/font-status.ts");
        writeCachedFontRuntimeStatus(detectFontRuntimeStatus({ cwd: ctx.cwd }));
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
    getArgumentCompletions: (prefix) =>
      getFirstTokenCompletionsFromActions(SF_SETUP_FONTS_ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, FONTS_COMMAND_NAME, async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await openWelcomeInManager(ctx, "detail");
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

    const { runFontInstall } = await import("./lib/font-installer.ts");
    const result = await runFontInstall(exec, platform);
    const { detectFontRuntimeStatus } = await import("./lib/font-status.ts");
    writeCachedFontRuntimeStatus(detectFontRuntimeStatus({ cwd: ctx.cwd, platform }));
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
    headerActive = true;

    ctx.ui.setHeader((tui) => {
      activeHeader = header;
      headerRequestRender = (force = false) => tui.requestRender(force);
      startHeaderAnimation(ctx, generation);
      startHeaderDismissListener(ctx, generation);

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
}
