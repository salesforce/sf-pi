/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-devbar behavior contract
 *
 * Bespoke Salesforce developer status bar with two rendering surfaces:
 *   - Top bar (widget above editor): model, thinking, folder, git, context window
 *   - Bottom bar (custom footer): project-scoped org, monthly budget, extensions
 *
 * All data sources are async and non-blocking. Bars render immediately with
 * cached/partial data and fill in as results arrive.
 *
 * Behavior matrix:
 *
 *   Event/Trigger         | Result
 *   ----------------------|------------------------------------------------------------
 *   session_start         | Activate both bars, load cached org, start async checks
 *   session_shutdown      | Restore default footer + clear widget
 *   model_select          | Update model name, detect SF LLM Gateway, refresh bars
 *   thinking_level_select | Repaint top bar immediately on thinking-level change
 *   turn_start            | Set thinking indicator on top bar
 *   turn_end              | Refresh git changes, update context bar, trigger footer repaint
 *   agent_end             | Final git refresh + footer repaint
 *   /sf-devbar            | Toggle bars on/off
 *   /sf-devbar help       | Show help
 *   Ctrl+Shift+B          | Keyboard toggle for bars
 *   --no-devbar flag      | Launch pi without the status bar
 *
 * Pi SDK features used:
 *   setWidget, setFooter, setTitle
 *   session_start, session_shutdown (with reason), model_select, turn_start, turn_end, agent_end
 *   before_agent_start (with systemPromptOptions)
 *   registerCommand, registerShortcut, registerFlag
 *   getThinkingLevel, getContextUsage, ctx.model, ctx.cwd, ctx.hasUI
 *   pi.exec()
 *   footerData (getGitBranch, onBranchChange, getExtensionStatuses)
 *   theme.fg, theme.bold
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { markBootStep } from "../../lib/common/boot-timing.ts";
import { shouldInjectOnce } from "../../lib/common/session/inject-once.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
  bindPiForSessionPersistence,
  restoreFromSessionEntries,
} from "../../lib/common/sf-environment/shared-runtime.ts";
import { getSfLspHealth, onSfLspHealthChange } from "../../lib/common/sf-lsp-health/index.ts";
import type { SfEnvironment } from "../../lib/common/sf-environment/types.ts";
import {
  formatAgentContext,
  formatDetailedStatus,
} from "../../lib/common/sf-environment/format-agent-context.ts";
import { renderTopBarLine, type TopBarState } from "./lib/top-bar.ts";
import { renderBottomBarParts, type BottomBarState } from "./lib/bottom-bar.ts";
import { getGitChanges, type GitChanges } from "./lib/git-changes.ts";
import { formatImageWidthPill, readTerminalDevbarSettings } from "./lib/settings-reader.ts";
import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import { basename } from "node:path";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { filterEnabledExtensionStatuses } from "../../lib/common/sf-pi-extension-state.ts";
import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import {
  buildToggleExtensionAction,
  isLifecycleToggleAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const WIDGET_KEY = "sf-devbar";
const COMMAND_NAME = "sf-devbar";
const FLAG_NAME = "no-devbar";

/**
 * customType used for the inject-once-on-change <sf_environment> block.
 * Exported as a const so the production injection, the dedup predicate,
 * and the source-level test all reference the same value.
 */
export const SF_ORG_CONTEXT_ENTRY_TYPE = "sf-org-context";

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfDevBar(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-devbar")) return;

  // Bind the Pi API to the shared runtime so org detection results are
  // persisted into the session via appendEntry(). This lets the cache
  // participate in /tree branching and session resume.
  bindPiForSessionPersistence(pi);

  // --- Shared mutable state ---
  let enabled = true;
  let env: SfEnvironment | null = null;
  let gitChanges: GitChanges | null = null;
  let isThinking = false;
  /** Pre-formatted inline-image-width pill (e.g. "img:120c"). Empty string
   * when the user keeps the default so the top bar stays unchanged. */
  let imageWidthPill = "";

  // Reference to footer's tui.requestRender for reactive updates.
  // The wrapper installed below includes a session-generation guard so stale
  // async callbacks from a pre-/reload context cannot render into a new session.
  let requestFooterRender: (() => void) | null = null;

  // Active session guard. Pi 0.70+ reports stale extension context usage more
  // aggressively, so async callbacks must prove they still belong to the same
  // session_start generation before touching UI or session-scoped state.
  let activeSessionGeneration = 0;
  let activeSessionKey: string | null = null;

  // Track the latest git branch from footerData for use in async callbacks
  let latestGitBranch: string | null = null;

  // LSP health is read fresh from lib/common/sf-lsp-health at every
  // top-bar render (see buildTopBarState). The widget factory subscribes
  // to health changes and calls tui.requestRender() on each update so
  // the bar stays in sync.

  // Reference to the top-bar component's requestRender. Needed because the
  // top bar is now driven by a Pi widget factory (not a static string
  // array) so we can right-align the LSP segment against the terminal's
  // current width.
  let requestTopBarRender: (() => void) | null = null;

  // Use the shared exec adapter instead of a per-extension wrapper
  const exec = buildExecFn(pi);

  // --- Register --no-devbar flag ---
  pi.registerFlag(FLAG_NAME, {
    description: "Launch without the SF DevBar status bars",
    type: "boolean",
    default: false,
  });

  function sessionKey(ctx: ExtensionContext): string {
    return `${ctx.sessionManager.getSessionId()}::${ctx.cwd}`;
  }

  function beginActiveSession(ctx: ExtensionContext): number {
    activeSessionGeneration += 1;
    activeSessionKey = sessionKey(ctx);
    return activeSessionGeneration;
  }

  function endActiveSession(ctx?: ExtensionContext): void {
    if (!ctx || activeSessionKey === sessionKey(ctx)) {
      activeSessionGeneration += 1;
      activeSessionKey = null;
      requestFooterRender = null;
    }
  }

  function isActiveSession(
    ctx: ExtensionContext,
    generation: number = activeSessionGeneration,
  ): boolean {
    return generation === activeSessionGeneration && activeSessionKey === sessionKey(ctx);
  }

  // --- Helper: collect top-bar state from current data ---
  function buildTopBarState(ctx: ExtensionContext): TopBarState {
    const model = ctx.model;
    const thinkingLevel = pi.getThinkingLevel();
    const contextUsage = ctx.getContextUsage();
    // Keep the raw float — the top bar renders 1/8-block partials for a
    // ~1% granular fill and a one-decimal percent label (e.g. "1.2%").
    // Rounding to an integer here would collapse both back to 1% steps.
    const contextPercent =
      contextUsage && contextUsage.contextWindow > 0
        ? (contextUsage.tokens / contextUsage.contextWindow) * 100
        : null;

    return {
      modelName: model?.name ?? model?.id,
      modelProvider: model?.provider,
      contextWindow: contextUsage?.contextWindow,
      thinkingLevel,
      folderName: basename(ctx.cwd),
      gitBranch: latestGitBranch, // Use the latest known branch from footerData
      gitChanges,
      contextPercent,
      isThinking,
      imageWidthPill,
      // Always read fresh — the widget factory re-renders on every health
      // change, and buildTopBarState is only called from inside render(),
      // so this stays consistent with the terminal output.
      lspHealth: getSfLspHealth(),
    };
  }

  /**
   * Re-read Pi's terminal.* settings and refresh the inline image pill.
   *
   * Pi does not emit a dedicated settings_change event today, so we refresh
   * on session_start plus whenever the user toggles or pins the devbar.
   * Reads are cheap (<1ms) and any failure silently falls back to "no pill".
   */
  function refreshImageWidthPill(cwd: string): void {
    const { imageWidthCells } = readTerminalDevbarSettings(cwd);
    imageWidthPill = formatImageWidthPill(imageWidthCells);
  }

  // --- Helper: collect bottom-bar state ---
  function buildBottomBarState(): BottomBarState {
    return {
      orgName: env?.org?.alias ?? env?.org?.username ?? env?.config?.targetOrg,
      orgType: env?.org?.orgType,
      projectDetected: env?.project?.detected,
      orgDetected: env?.org?.detected,
    };
  }

  // Latest gitBranch passed to the component (resolved on every render).
  // Using the same model as the footer — the component pulls fresh state
  // each render cycle so we only need to call tui.requestRender() on
  // change.
  let topBarBranchHint: string | null | undefined = undefined;

  // --- Helper: update the top-bar widget ---
  function updateTopBar(ctx: ExtensionContext, gitBranch?: string | null) {
    if (!enabled || !ctx.hasUI || !isActiveSession(ctx)) return;
    if (gitBranch !== undefined) topBarBranchHint = gitBranch;
    mountTopBarWidget(ctx);
    requestTopBarRender?.();
  }

  /**
   * Mount the top-bar widget as a component factory so we have access to
   * the current terminal width at render time. This is what lets us
   * right-align the LSP health segment against the terminal's right edge
   * even as the window resizes.
   */
  function mountTopBarWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      requestTopBarRender = () => tui.requestRender();

      // Subscribe to LSP health changes *inside* the widget factory so
      // `tui.requestRender()` is always bound by the time any listener
      // fires. Subscribing from session_start is racy: the first doctor
      // probe can resolve before Pi has called our factory, leaving no
      // way to trigger a repaint until some OTHER event forces one.
      const unsub = onSfLspHealthChange(() => {
        tui.requestRender();
      });

      return {
        render: (width: number): string[] => {
          if (!enabled || !isActiveSession(ctx)) return [];
          const state = buildTopBarState(ctx);
          if (topBarBranchHint !== undefined) state.gitBranch = topBarBranchHint;
          return renderTopBarLine(state, theme, width);
        },
        invalidate() {},
        dispose() {
          unsub();
          requestTopBarRender = null;
        },
      };
    });
  }

  // --- Helper: update terminal title ---
  function updateTitle(ctx: ExtensionContext) {
    if (!ctx.hasUI || !isActiveSession(ctx)) return;

    const folder = basename(ctx.cwd);
    const orgLabel = env?.project?.detected
      ? (env?.org?.alias ?? env?.config?.targetOrg)
      : undefined;
    const orgType = env?.project?.detected ? env?.org?.orgType : undefined;
    const typeSuffix = orgType && orgType !== "unknown" ? ` (${orgType})` : "";

    const titleParts = ["pi"];
    if (orgLabel) titleParts.push(`${orgLabel}${typeSuffix}`);
    titleParts.push(folder);

    ctx.ui.setTitle(titleParts.join(" — "));
  }

  // --- Helper: refresh git changes (async, non-blocking) ---
  function refreshGitChanges(
    ctx: ExtensionContext,
    gitBranch?: string | null,
    generation: number = activeSessionGeneration,
  ) {
    getGitChanges(exec, ctx.cwd)
      .then((changes) => {
        if (!isActiveSession(ctx, generation)) return;
        gitChanges = changes;
        // Use the explicitly passed branch, or fall back to the latest known branch
        updateTopBar(ctx, gitBranch !== undefined ? gitBranch : latestGitBranch);
        requestFooterRender?.();
      })
      .catch(() => {
        // Silently ignore — git may not be available
      });
  }

  // ===========================================================================================
  // Event handlers
  // ===========================================================================================

  // --- Session start: activate bars ---
  pi.on("session_start", async (_event, ctx) => {
    const generation = beginActiveSession(ctx);

    // Check --no-devbar flag. Extension flags are registered without the CLI
    // `--` prefix; passing the prefixed form falls through to undefined.
    if (pi.getFlag(FLAG_NAME) === true) {
      enabled = false;
      return;
    }

    if (!ctx.hasUI) {
      endActiveSession(ctx);
      return;
    }
    enabled = true;

    // Load cached org data for instant warm start, then refresh in background.
    // First restore from session entries (supports resume and branching),
    // then fall back to the cross-session persisted disk cache.
    restoreFromSessionEntries(ctx, ctx.cwd);
    env = getCachedSfEnvironment(ctx.cwd);

    // Phase-2-followup: don't fire a forced fresh detection at session_start.
    // The disk cache + session-restored snapshot is good enough for the
    // splash and the first turn. Forcing a refresh here was the largest
    // single fire-and-forget contributor to event-loop saturation during
    // boot (boot-timing reported 17-30s wall when 8+ other steps competed,
    // vs <1s direct-invocation). Two scheduling rules now apply:
    //
    //   1. If we have NO cached env at all, fall through to a deferred
    //      cache-priming refresh after the boot-storm settles (5s). This
    //      keeps first-launch experience usable without making it worse.
    //   2. Otherwise, skip the session_start refresh entirely. The footer
    //      and top-bar already render from cache. Live refresh is
    //      available via /sf-org refresh whenever the user wants the
    //      latest org status.
    //
    // Stale-cache UX: if the cache is older than 60 minutes we still
    // schedule a deferred refresh, capped at one fire-and-forget call.
    const STALE_CACHE_MS = 60 * 60 * 1000;
    const DEFERRED_REFRESH_DELAY_MS = 5_000;
    const cacheStale = !env || (env.detectedAt && Date.now() - env.detectedAt > STALE_CACHE_MS);
    if (cacheStale) {
      const deferred = setTimeout(() => {
        if (!isActiveSession(ctx, generation)) return;
        markBootStep("sf-devbar.env-detect (deferred)", () =>
          getSharedSfEnvironment(exec, ctx.cwd, { force: true }),
        )
          .then((freshEnv) => {
            if (!isActiveSession(ctx, generation)) return;
            env = freshEnv;
            updateTitle(ctx);
            updateTopBar(ctx);
            requestFooterRender?.();
          })
          .catch(() => {
            // Detection failed — keep showing cached data if available
          });
      }, DEFERRED_REFRESH_DELAY_MS);
      // Don't keep the event loop alive solely for this timer; if the
      // session shuts down before the refresh fires, drop it cleanly.
      deferred.unref?.();
    }

    // Reset per-session state
    gitChanges = null;
    isThinking = false;
    refreshImageWidthPill(ctx.cwd);

    // Set terminal title
    updateTitle(ctx);

    // Render initial top bar (without git branch — footer callback provides it)
    updateTopBar(ctx);

    // LSP health subscription lives inside the widget factory now (see
    // `mountTopBarWidget`) so it can't race the first render cycle.

    // Activate the custom footer
    ctx.ui.setFooter((tui, theme, footerData) => {
      // Subscribe to reactive git branch changes
      const unsub = footerData.onBranchChange(() => {
        if (!isActiveSession(ctx, generation)) return;
        const branch = footerData.getGitBranch();
        latestGitBranch = branch ?? null;
        updateTopBar(ctx, branch);
        tui.requestRender();
      });

      // Store requestRender so async updates can trigger re-renders
      requestFooterRender = () => {
        if (isActiveSession(ctx, generation)) tui.requestRender();
      };

      // Kick off initial git branch-aware top bar render
      if (isActiveSession(ctx, generation)) {
        const initialBranch = footerData.getGitBranch();
        latestGitBranch = initialBranch ?? null;
        updateTopBar(ctx, initialBranch);
      }

      return {
        dispose: () => {
          unsub();
          if (isActiveSession(ctx, generation)) {
            requestFooterRender = null;
          }
        },
        // Footer content uses theme.fg() during render, so no cached themed
        // strings need rebuilding. If we ever cache themed content in variables,
        // invalidate() must rebuild them here. See tui.md "Invalidation and
        // Theme Changes" for the rebuild-on-invalidate pattern.
        invalidate() {},
        render(width: number): string[] {
          if (!enabled || !isActiveSession(ctx, generation)) return [];

          const state = buildBottomBarState();
          const statuses = footerData.getExtensionStatuses();
          state.extensionStatuses = filterEnabledExtensionStatuses(ctx.cwd, statuses);

          const { left, right } = renderBottomBarParts(state, theme);

          const leftW = visibleWidth(left);
          const rightW = visibleWidth(right);
          const pad = " ".repeat(Math.max(1, width - leftW - rightW));

          // No top border line — matches the top bar's clean style
          return [truncateToWidth(left + pad + right, width)];
        },
      };
    });

    // Fire-and-forget: async git changes
    refreshGitChanges(ctx, null, generation);
  });

  // --- Session shutdown: clean exit ---
  // Uses the shutdown reason to decide cleanup depth. On reload, skip footer/widget
  // teardown since the new extension instance will re-set them immediately.
  pi.on("session_shutdown", async (event, ctx) => {
    endActiveSession(ctx);
    if (!ctx.hasUI) return;
    if (event.reason === "reload") return; // New instance handles re-init
    ctx.ui.setFooter(undefined);
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  });

  // --- Model select: update model display ---
  pi.on("model_select", async (_event, ctx) => {
    if (!enabled || !ctx.hasUI || !isActiveSession(ctx)) return;
    updateTopBar(ctx);
    requestFooterRender?.();
  });

  // --- Thinking level change: repaint the rainbow badge instantly ---
  //
  // pi emits `thinking_level_select` whenever the user flips thinking
  // level (shortcut, settings, or model clamp). Without this, the devbar only
  // re-reads `pi.getThinkingLevel()` on the next turn boundary, leaving the
  // badge stale while idle.
  pi.on("thinking_level_select", async (_event, ctx) => {
    if (!enabled || !ctx.hasUI || !isActiveSession(ctx)) return;
    updateTopBar(ctx);
  });

  // --- Turn start: set thinking indicator ---
  pi.on("turn_start", async (_event, ctx) => {
    if (!enabled || !ctx.hasUI || !isActiveSession(ctx)) return;
    isThinking = true;
    updateTopBar(ctx);
  });

  // --- Turn end: refresh footer + context bar ---
  pi.on("turn_end", async (_event, ctx) => {
    if (!enabled || !ctx.hasUI || !isActiveSession(ctx)) return;
    isThinking = false;
    requestFooterRender?.();
    updateTopBar(ctx);
  });

  // --- Agent end: git refresh + footer repaint ---
  pi.on("agent_end", async (_event, ctx) => {
    if (!enabled || !ctx.hasUI || !isActiveSession(ctx)) return;
    isThinking = false;
    requestFooterRender?.();
    refreshGitChanges(ctx);
    updateTopBar(ctx);
  });

  // --- Before agent start: inject Salesforce environment context into system prompt ---
  // Uses systemPromptOptions to inspect what tools/skills are active, so the
  // injected context is tool-aware (e.g. richer metadata when SF tools are loaded).
  //
  // Inject-once-on-change semantics:
  //   - Inject when no live <sf_environment> entry exists (first turn / post-compaction).
  //   - Skip when an existing live entry's content matches what we'd inject now
  //     (env unchanged — the common case for every subsequent turn).
  //   - Re-inject when env content has changed (e.g. user ran `/sf-org refresh`
  //     and the org alias / API version / project shifted). The fresh entry
  //     supersedes the stale one in the live window so the model sees current
  //     environment values.
  //
  // formatAgentContext is byte-stable across turns when env doesn't change
  // (the human-friendly "Detected Xs ago" line lives in formatDetailedStatus,
  // a separate function used by the /sf-org panel) so the equality check is
  // a sound "did anything material change?" signal.
  pi.on("before_agent_start", async (event, ctx) => {
    if (!env) return;

    const { systemPromptOptions } = event;
    const context = formatAgentContext(env, {
      activeTools: systemPromptOptions.selectedTools,
      activeSkills: systemPromptOptions.skills?.map((s) => s.name),
    });
    if (!context) return;

    const stillFresh = (entry: { content: string | unknown[] }) =>
      typeof entry.content === "string" && entry.content === context;
    if (!shouldInjectOnce(ctx.sessionManager.getEntries(), SF_ORG_CONTEXT_ENTRY_TYPE, stillFresh))
      return;

    return {
      message: {
        customType: SF_ORG_CONTEXT_ENTRY_TYPE,
        content: context,
        display: false,
      },
    };
  });

  type DevbarAction = "status" | "toggle" | "refresh" | "help" | "close" | LifecycleActionId;

  const DEVBAR_ACTIONS: CommandPanelAction<DevbarAction>[] = [
    {
      value: "status",
      label: "Show current status",
      description: "Print the detected Salesforce org/environment details used by the bottom bar.",
      group: "Status",
    },
    {
      value: "toggle",
      label: "Toggle bars on/off",
      description: "Enable or disable the top-bar widget and custom footer for this session.",
      group: "Controls",
    },
    {
      value: "refresh",
      label: "Refresh org environment",
      description:
        "Force re-detection of the Salesforce CLI org/project environment and repaint bars.",
      group: "Troubleshooting",
    },
    {
      value: "help",
      label: "Show help",
      description: "Print commands, keyboard shortcut, and launch flag reference.",
      group: "Reference",
    },
    {
      value: "close",
      label: "Close",
      description: "Dismiss this panel.",
      group: LIFECYCLE_GROUP,
    },
  ];

  // Compose the live action list so the lifecycle toggle row reflects the
  // current enablement state on every panel open.
  function buildDevbarActions(cwd: string): CommandPanelAction<DevbarAction>[] {
    const toggle = buildToggleExtensionAction({ extensionId: "sf-devbar", cwd });
    return toggle ? [...DEVBAR_ACTIONS, toggle] : DEVBAR_ACTIONS;
  }

  async function handleDevbarPanel(ctx: ExtensionCommandContext): Promise<void> {
    const panelState: CommandPanelState<DevbarAction> = {};
    await openCommandPanel(ctx, {
      title: "📊 SF DevBar — status & controls",
      subtitle: "Manage the top status bar and Salesforce environment context.",
      statusLines: () => buildDevbarPanelStatus(ctx),
      actions: () => buildDevbarActions(ctx.cwd),
      closeValue: "close",
      state: panelState,
      onAction: (action) => handleDevbarCommand(ctx, action, true),
      // Lifecycle toggle calls ctx.reload() — must close panel first so the
      // ctx.ui.custom() promise resolves before the runtime is invalidated.
      closeBeforeAction: isLifecycleToggleAction,
    });
  }

  async function handleDevbarCommand(
    ctx: ExtensionCommandContext,
    sub: string,
    fromPanel = false,
  ): Promise<void> {
    if (sub === "lifecycle.toggle") {
      await performToggleExtension(ctx, "sf-devbar");
      return;
    }
    if (sub === "help") {
      await emitDevbarOutput(ctx, "SF DevBar help", renderDevbarHelp(), "info", fromPanel);
      return;
    }

    if (sub === "status") {
      await showDevbarOrgStatus(ctx, false, fromPanel);
      return;
    }

    if (sub === "refresh") {
      await showDevbarOrgStatus(ctx, true, fromPanel);
      return;
    }

    if (sub === "toggle") {
      await toggleDevbar(ctx, fromPanel);
      return;
    }

    await emitDevbarOutput(
      ctx,
      "Unknown command",
      `Unknown /${COMMAND_NAME} subcommand: ${sub}. Use status, toggle, refresh, help.`,
      "warning",
      fromPanel,
    );
  }

  async function toggleDevbar(ctx: ExtensionCommandContext, fromPanel = false): Promise<void> {
    enabled = !enabled;

    if (enabled) {
      env = getCachedSfEnvironment(ctx.cwd);
      refreshImageWidthPill(ctx.cwd);
      updateTitle(ctx);
      updateTopBar(ctx);
      requestFooterRender?.();
      await emitDevbarOutput(
        ctx,
        "SF DevBar enabled",
        "Top bar and footer are active for this session.",
        "success",
        fromPanel,
      );
    } else {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      requestFooterRender?.();
      await emitDevbarOutput(
        ctx,
        "SF DevBar disabled",
        "Top bar and footer are hidden for this session.",
        "info",
        fromPanel,
      );
    }
  }

  async function showDevbarOrgStatus(
    ctx: ExtensionCommandContext,
    force: boolean,
    fromPanel = false,
  ): Promise<void> {
    if (force || !env) {
      ctx.ui.setStatus(`${COMMAND_NAME}-command`, "SF DevBar: detecting Salesforce environment…");
      try {
        env = await getSharedSfEnvironment(exec, ctx.cwd, force ? { force: true } : undefined);
        updateTitle(ctx);
        updateTopBar(ctx);
        requestFooterRender?.();
      } catch (err) {
        await emitDevbarOutput(ctx, "Detection failed", String(err), "error", fromPanel);
        return;
      } finally {
        ctx.ui.setStatus(`${COMMAND_NAME}-command`, undefined);
      }
    }

    await emitDevbarOutput(
      ctx,
      force ? "SF DevBar environment refreshed" : "SF DevBar status",
      formatDetailedStatus(env),
      "info",
      fromPanel,
    );
  }

  async function emitDevbarOutput(
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

  function buildDevbarPanelStatus(ctx: ExtensionCommandContext): string[] {
    return [
      `${enabled ? "✓" : "○"} Bars          ${enabled ? "enabled" : "disabled"}`,
      `${env ? "✓" : "◐"} SF environment ${env ? formatEnvSummary(env) : "not detected yet"}`,
      `• Model         ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown"}`,
      `• Image pill    ${imageWidthPill || "default"}`,
      `• Shortcut      Ctrl+Shift+B`,
    ];
  }

  function formatEnvSummary(value: SfEnvironment): string {
    if (!value.project.detected) return "not an SFDX project";
    const org = value.org.alias ?? value.config.targetOrg ?? value.org.username ?? "no default org";
    return `${org} (${value.org.orgType})`;
  }

  function renderDevbarHelp(): string {
    return [
      "sf-devbar — Salesforce Developer Status Bar",
      "",
      "Commands:",
      `  /${COMMAND_NAME}          Open status & controls panel`,
      `  /${COMMAND_NAME} status   Show current org/environment details`,
      `  /${COMMAND_NAME} toggle   Toggle bars on/off`,
      `  /${COMMAND_NAME} refresh  Force re-detection`,
      `  /${COMMAND_NAME} help     Show this help`,
      "",
      "Keyboard shortcut:",
      "  Ctrl+Shift+B    Toggle bars on/off",
      "",
      "CLI flag:",
      "  pi --no-devbar  Launch without status bars",
    ].join("\n");
  }

  // ===========================================================================================
  // Command: /sf-devbar
  // ===========================================================================================

  pi.registerCommand(COMMAND_NAME, {
    description: "Show and control the SF DevBar status bars",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase();
      const items = DEVBAR_ACTIONS.filter((action) => action.value !== "close")
        .filter((action) => action.value.startsWith(lower))
        .map((action) => ({
          value: action.value,
          label: action.value,
          description: action.description,
        }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await handleDevbarPanel(ctx);
          return;
        }
        await handleDevbarCommand(ctx, sub === "" ? "toggle" : sub);
      });
    },
  });

  // ===========================================================================================
  // Keyboard shortcut: Ctrl+Shift+B
  // ===========================================================================================

  pi.registerShortcut("ctrl+shift+b", {
    description: "Toggle SF DevBar status bars",
    handler: async (ctx) => {
      enabled = !enabled;

      if (enabled) {
        env = getCachedSfEnvironment(ctx.cwd);
        refreshImageWidthPill(ctx.cwd);
        updateTitle(ctx);
        updateTopBar(ctx);
        requestFooterRender?.();
        ctx.ui.notify("SF DevBar enabled", "info");
      } else {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        requestFooterRender?.();
        ctx.ui.notify("SF DevBar disabled", "info");
      }
    },
  });

  // ===========================================================================================
  // Command: /sf-org — shared Salesforce environment status
  // ===========================================================================================
  //
  // /sf-org follows the same panel pattern as /sf-devbar so users get the
  // same status-and-controls surface across every /sf-* command. Direct
  // text subcommands (/sf-org refresh, /sf-org help) still work for muscle
  // memory and headless invocation.

  type SfOrgAction = "status" | "refresh" | "open-setup" | "help" | "close";

  const SF_ORG_ACTIONS: CommandPanelAction<SfOrgAction>[] = [
    {
      value: "status",
      label: "Show current status",
      description: "Print the detected Salesforce CLI / project / org details.",
      group: "Status",
    },
    {
      value: "refresh",
      label: "Refresh org environment",
      description: "Force re-detection of CLI / project / org and repaint the bars.",
      group: "Troubleshooting",
    },
    {
      value: "open-setup",
      label: "Open org Setup in browser",
      description: "Run sf org open --path /lightning/setup/SetupOneHome/home for the active org.",
      group: "Actions",
    },
    {
      value: "help",
      label: "Show help",
      description: "Print commands and direct subcommand reference.",
      group: "Reference",
    },
    {
      value: "close",
      label: "Close",
      description: "Dismiss this panel.",
      group: "Lifecycle",
    },
  ];

  function buildSfOrgStatusLines(): string[] {
    if (!env) {
      return ["◐ Environment    detecting…"];
    }
    const cli = env.cli.installed
      ? `✓ SF CLI         v${env.cli.version ?? "unknown"}`
      : "✗ SF CLI         not installed";
    const project = env.project.detected
      ? `✓ Project        ${env.project.name ?? "detected"}`
      : "⚠ Project        not an SFDX project";
    const orgLabel = env.org.alias ?? env.config.targetOrg ?? env.org.username ?? "—";
    const orgType = env.org.orgType && env.org.orgType !== "unknown" ? ` (${env.org.orgType})` : "";
    const org = env.org.detected
      ? `✓ Org            ${orgLabel}${orgType}`
      : `⚠ Org            no default${orgLabel !== "—" ? ` — ${orgLabel}` : ""}`;
    const apiVersion = env.project.sourceApiVersion
      ? `• API version    ${env.project.sourceApiVersion}`
      : "• API version    —";
    return [cli, project, org, apiVersion];
  }

  async function handleSfOrgPanel(ctx: ExtensionCommandContext): Promise<void> {
    const panelState: CommandPanelState<SfOrgAction> = {};
    await openCommandPanel(ctx, {
      title: "🌐 SF Org — Salesforce environment",
      subtitle: "Inspect the active Salesforce CLI / project / org and refresh detection.",
      statusLines: () => buildSfOrgStatusLines(),
      actions: () => SF_ORG_ACTIONS,
      closeValue: "close",
      state: panelState,
      onAction: (action) => handleSfOrgAction(ctx, action, true),
      // /sf-org doesn't currently route lifecycle.toggle (sf-devbar's panel
      // owns that toggle for the underlying extension), so closeBeforeAction
      // is intentionally omitted.
    });
  }

  async function handleSfOrgAction(
    ctx: ExtensionCommandContext,
    action: SfOrgAction | string,
    fromPanel: boolean,
  ): Promise<void> {
    if (action === "help") {
      const help = [
        "sf-org — Salesforce environment status",
        "",
        "Commands:",
        "  /sf-org            Open status & controls panel",
        "  /sf-org status     Show current environment status",
        "  /sf-org refresh    Re-detect environment",
        "  /sf-org open       Open org Setup in browser",
        "  /sf-org help       Show this help",
      ].join("\n");
      await emitSfOrgOutput(ctx, "sf-org help", help, "info", fromPanel);
      return;
    }

    if (action === "refresh") {
      ctx.ui.setStatus("sf-org-command", "Detecting Salesforce environment…");
      try {
        env = await getSharedSfEnvironment(exec, ctx.cwd, { force: true });
        updateTitle(ctx);
        updateTopBar(ctx);
        requestFooterRender?.();
        await emitSfOrgOutput(
          ctx,
          "sf-org environment refreshed",
          formatDetailedStatus(env),
          "info",
          fromPanel,
        );
      } catch (err) {
        await emitSfOrgOutput(ctx, "Detection failed", String(err), "error", fromPanel);
      } finally {
        ctx.ui.setStatus("sf-org-command", undefined);
      }
      return;
    }

    if (action === "open-setup") {
      const alias = env?.org?.alias ?? env?.config?.targetOrg;
      if (!alias) {
        await emitSfOrgOutput(
          ctx,
          "No default org",
          "There is no default org configured for this directory. Run /sf-org refresh after `sf config set target-org=<alias>`.",
          "warning",
          fromPanel,
        );
        return;
      }
      ctx.ui.setStatus("sf-org-command", `Opening Setup for ${alias}…`);
      try {
        await exec(
          "sf",
          ["org", "open", "--path", "/lightning/setup/SetupOneHome/home", "--target-org", alias],
          { cwd: ctx.cwd },
        );
        await emitSfOrgOutput(
          ctx,
          "Opened in browser",
          `Opened Setup for ${alias} via sf org open.`,
          "info",
          fromPanel,
        );
      } catch (err) {
        await emitSfOrgOutput(ctx, "Open failed", String(err), "error", fromPanel);
      } finally {
        ctx.ui.setStatus("sf-org-command", undefined);
      }
      return;
    }

    // Default: status (also handles unknown subcommands as a safety fallback)
    if (!env) {
      ctx.ui.setStatus("sf-org-command", "Detecting Salesforce environment…");
      try {
        env = await getSharedSfEnvironment(exec, ctx.cwd);
        updateTitle(ctx);
        updateTopBar(ctx);
        requestFooterRender?.();
      } catch (err) {
        await emitSfOrgOutput(ctx, "Detection failed", String(err), "error", fromPanel);
        return;
      } finally {
        ctx.ui.setStatus("sf-org-command", undefined);
      }
    }
    await emitSfOrgOutput(ctx, "sf-org status", formatDetailedStatus(env), "info", fromPanel);
  }

  async function emitSfOrgOutput(
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

  pi.registerCommand("sf-org", {
    description: "Show Salesforce org status and environment info",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase();
      const items = SF_ORG_ACTIONS.filter((action) => action.value !== "close")
        .filter((action) => action.value.startsWith(lower))
        .map((action) => ({
          value: action.value,
          label: action.value,
          description: action.description,
        }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, "sf-org", async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await handleSfOrgPanel(ctx);
          return;
        }
        // Map legacy `open` shorthand to the panel action id so headless
        // invocations stay one-to-one with the menu rows.
        const action = sub === "open" ? "open-setup" : sub || "status";
        await handleSfOrgAction(ctx, action, false);
      });
    },
  });
}
