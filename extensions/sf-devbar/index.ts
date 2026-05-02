/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-devbar behavior contract
 *
 * Bespoke Salesforce developer status bar with two rendering surfaces:
 *   - Top bar (widget above editor): model, thinking, folder, git, context window
 *   - Bottom bar (custom footer): org, CLI, connection, monthly budget, extensions
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
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
  bindPiForSessionPersistence,
  restoreFromSessionEntries,
} from "../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../lib/common/sf-environment/types.ts";
import {
  formatAgentContext,
  formatDetailedStatus,
} from "../../lib/common/sf-environment/format-agent-context.ts";
import { renderTopBar, type TopBarState } from "./lib/top-bar.ts";
import { renderBottomBarParts, type BottomBarState } from "./lib/bottom-bar.ts";
import { getGitChanges, type GitChanges } from "./lib/git-changes.ts";
import { checkCliFreshness, type CliFreshnessResult } from "./lib/cli-freshness.ts";
import { formatImageWidthPill, readTerminalDevbarSettings } from "./lib/settings-reader.ts";
import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import { basename } from "node:path";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const WIDGET_KEY = "sf-devbar";
const COMMAND_NAME = "sf-devbar";
const FLAG_NAME = "no-devbar";

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
  let cliFreshness: CliFreshnessResult = { status: "checking" };
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
      connectedStatus: env?.org?.connectedStatus,
      orgDetected: env?.org?.detected,
      cliVersion: env?.cli?.version,
      cliFreshness: cliFreshness.status,
    };
  }

  // --- Helper: update the top-bar widget ---
  function updateTopBar(ctx: ExtensionContext, gitBranch?: string | null) {
    if (!enabled || !ctx.hasUI || !isActiveSession(ctx)) return;

    const state = buildTopBarState(ctx);
    // Merge git branch if provided (from footerData)
    if (gitBranch !== undefined) state.gitBranch = gitBranch;

    const theme = ctx.ui.theme;
    const lines = renderTopBar(state, theme);
    ctx.ui.setWidget(WIDGET_KEY, lines);
  }

  // --- Helper: update terminal title ---
  function updateTitle(ctx: ExtensionContext) {
    if (!ctx.hasUI || !isActiveSession(ctx)) return;

    const folder = basename(ctx.cwd);
    const orgLabel = env?.org?.alias ?? env?.config?.targetOrg;
    const orgType = env?.org?.orgType;
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

  // --- Helper: refresh session stats ---
  // (Stats were previously tracked here for bottom-bar token/cost display.
  //  Removed — top bar context window and monthly budget are sufficient.)

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

    // Trigger the shared async detection chain in the common environment runtime.
    getSharedSfEnvironment(exec, ctx.cwd, { force: true })
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

    // Reset per-session state
    gitChanges = null;
    cliFreshness = { status: "checking" };
    isThinking = false;
    refreshImageWidthPill(ctx.cwd);

    // Set terminal title
    updateTitle(ctx);

    // Render initial top bar (without git branch — footer callback provides it)
    updateTopBar(ctx);

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
          state.extensionStatuses = statuses;

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

    // Fire-and-forget: CLI freshness check
    if (env?.cli?.version) {
      checkCliFreshness(exec, env.cli.version)
        .then((result) => {
          if (!isActiveSession(ctx, generation)) return;
          cliFreshness = result;
          requestFooterRender?.();
        })
        .catch(() => {
          cliFreshness = { status: "unknown" };
        });
    } else {
      cliFreshness = { status: "unknown" };
    }
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
  pi.on("before_agent_start", async (event, _ctx) => {
    if (!env) return;

    const { systemPromptOptions } = event;
    const context = formatAgentContext(env, {
      activeTools: systemPromptOptions.selectedTools,
      activeSkills: systemPromptOptions.skills?.map((s) => s.name),
    });
    if (!context) return;

    return {
      message: {
        customType: "sf-org-context",
        content: context,
        display: false,
      },
    };
  });

  // ===========================================================================================
  // Command: /sf-devbar
  // ===========================================================================================

  pi.registerCommand(COMMAND_NAME, {
    description: "Toggle the SF DevBar status bars on/off",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();

      if (sub === "help") {
        ctx.ui.notify(
          [
            "sf-devbar — Salesforce Developer Status Bar",
            "",
            "Commands:",
            `  /${COMMAND_NAME}          Toggle bars on/off`,
            `  /${COMMAND_NAME} help     Show this help`,
            "",
            "Keyboard shortcut:",
            "  Ctrl+Shift+B    Toggle bars on/off",
            "",
            "CLI flag:",
            "  pi --no-devbar  Launch without status bars",
          ].join("\n"),
          "info",
        );
        return;
      }

      // Default: toggle
      enabled = !enabled;

      if (enabled) {
        // Re-read cached env in case it changed while disabled
        env = getCachedSfEnvironment(ctx.cwd);
        // Also re-read terminal settings so the image-width pill reflects
        // edits the user made while the bars were off.
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

  pi.registerCommand("sf-org", {
    description: "Show Salesforce org status and environment info",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();

      if (sub === "refresh") {
        ctx.ui.notify("Detecting Salesforce environment…", "info");
        try {
          env = await getSharedSfEnvironment(exec, ctx.cwd, { force: true });
          updateTitle(ctx);
          updateTopBar(ctx);
          requestFooterRender?.();
          ctx.ui.notify(formatDetailedStatus(env), "info");
        } catch (err) {
          ctx.ui.notify(`Detection failed: ${err}`, "error");
        }
        return;
      }

      if (sub === "help") {
        ctx.ui.notify(
          [
            "sf-org — Salesforce environment status",
            "",
            "Commands:",
            "  /sf-org            Show current environment status",
            "  /sf-org refresh    Re-detect environment",
            "  /sf-org help       Show this help",
          ].join("\n"),
          "info",
        );
        return;
      }

      // Default: show status
      if (!env) {
        ctx.ui.notify("Detecting Salesforce environment…", "info");
        try {
          env = await getSharedSfEnvironment(exec, ctx.cwd);
          updateTitle(ctx);
          updateTopBar(ctx);
          requestFooterRender?.();
        } catch (err) {
          ctx.ui.notify(`Detection failed: ${err}`, "error");
          return;
        }
      }

      ctx.ui.notify(formatDetailedStatus(env), "info");
    },
  });
}
