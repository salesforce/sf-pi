/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-skills-hud behavior contract
 *
 * Shows a persistent, pinned HUD in the top-right corner once the session has
 * actually used at least one skill. The HUD stays out of the way by using a
 * non-capturing overlay, so scrolling chat content and tool output do not move it.
 *
 * Skill state model:
 * - Live: skill usage still present in the current LLM context
 * - Earlier: skill usage seen on the current branch, but no longer present in
 *   the active context after compaction or later conversation growth
 *
 * Detection signals:
 * - explicit `/skill:name` invocations (parsed from skill blocks in user messages)
 * - assistant `read` tool calls that open a discovered `SKILL.md`
 *
 * Behavior matrix:
 *
 *   Event             | Result
 *   ------------------|-------------------------------------------------------------
 *   session_start     | Mount hidden passive overlay and reconstruct current state
 *   message_end       | Re-scan branch/context and refresh the HUD
 *   session_tree      | Re-scan after branch navigation
 *   session_compact   | Re-scan after compaction changes the active context
 *   session_shutdown  | Dismiss overlay and clear in-memory references
 *   /sf-skills        | Show a textual summary of live and earlier skills
 */
import {
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { SkillsHudComponent } from "./lib/hud-component.ts";
import {
  buildSkillsHudState,
  formatSkillsHudSummary,
  type SkillsHudState,
} from "./lib/skill-state.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import {
  buildToggleExtensionAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../sf-pi-manager/lib/extension-toggle.ts";
import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const COMMAND_NAME = "sf-skills";

const EMPTY_STATE: SkillsHudState = {
  live: [],
  earlier: [],
  hasAny: false,
  discoveredCount: 0,
  usedCount: 0,
};

type SkillsAction = "summary" | "help" | "close" | LifecycleActionId;

const SKILLS_ACTIONS: CommandPanelAction<SkillsAction>[] = [
  {
    value: "summary",
    label: "Show skill summary",
    description: "Print live and earlier skill usage detected in the current session branch.",
    group: "Status",
  },
  {
    value: "help",
    label: "Show help",
    description: "Explain what Live and Earlier mean and how the passive HUD behaves.",
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
function buildSkillsActions(cwd: string): CommandPanelAction<SkillsAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: "sf-skills-hud", cwd });
  return toggle ? [...SKILLS_ACTIONS, toggle] : SKILLS_ACTIONS;
}

function renderSkillsHelp(): string {
  return [
    "sf-skills — Skills HUD summary",
    "",
    "What it shows:",
    "  • Live now — skills still present in active context",
    "  • Earlier — skills used on this branch but no longer live after compaction/growth",
    "",
    "Behavior:",
    "  • Pinned as a passive top-right overlay",
    "  • Hidden until at least one skill is used",
    "",
    "Commands:",
    "  /sf-skills          Open status & controls panel",
    "  /sf-skills summary  Show current summary",
    "  /sf-skills help     Show this help",
  ].join("\n");
}

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfSkillsHud(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-skills-hud")) return;

  let hudState: SkillsHudState = EMPTY_STATE;
  let hudComponent: SkillsHudComponent | null = null;
  let dismissHud: (() => void) | null = null;

  function refreshHud(ctx: ExtensionContext): void {
    const branchEntries = ctx.sessionManager.getBranch();

    hudState = buildSkillsHudState({
      branchEntries,
      sessionContext: buildSessionContext(branchEntries, ctx.sessionManager.getLeafId()),
      commands: pi.getCommands(),
      cwd: ctx.cwd,
    });

    hudComponent?.setState(hudState);
  }

  function ensureHudMounted(ctx: ExtensionContext): void {
    if (!ctx.hasUI || hudComponent || dismissHud) {
      return;
    }

    void ctx.ui
      .custom<void>(
        (tui, theme, _keybindings, done) => {
          const component = new SkillsHudComponent(tui, theme, hudState);
          hudComponent = component;
          dismissHud = () => {
            dismissHud = null;
            hudComponent = null;
            done(undefined);
          };
          return component;
        },
        {
          overlay: true,
          overlayOptions: () => ({
            anchor: "top-right",
            width: "30%",
            minWidth: 36,
            margin: { top: 1, right: 2 },
            nonCapturing: true,
            visible: (terminalWidth, terminalHeight) => {
              return hudState.hasAny && terminalWidth >= 100 && terminalHeight >= 14;
            },
          }),
        },
      )
      .catch(() => {
        hudComponent = null;
        dismissHud = null;
      });
  }

  function dismissOverlay(): void {
    dismissHud?.();
    dismissHud = null;
    hudComponent = null;
  }

  function rebuildAndRender(ctx: ExtensionContext): void {
    ensureHudMounted(ctx);
    refreshHud(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    dismissOverlay();
    hudState = EMPTY_STATE;
    if (!ctx.hasUI) {
      return;
    }
    rebuildAndRender(ctx);
  });

  pi.on("message_end", async (_event, ctx) => {
    rebuildAndRender(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    rebuildAndRender(ctx);
  });

  pi.on("session_compact", async (_event, ctx) => {
    rebuildAndRender(ctx);
  });

  pi.on("session_shutdown", async (event) => {
    dismissOverlay();
    // Preserve in-memory state on reload — session_start will rebuild it anyway.
    // On other shutdown paths, clear state to avoid stale references.
    if (event.reason !== "reload") {
      hudState = EMPTY_STATE;
    }
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "Show the current SF Skills HUD summary",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase();
      const items = SKILLS_ACTIONS.filter((action) => action.value !== "close")
        .filter((action) => action.value.startsWith(lower))
        .map((action) => ({
          value: action.value,
          label: action.value,
          description: action.description,
        }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim().toLowerCase();
      if (subcommand === "" && ctx.hasUI) {
        await handleSkillsPanel(ctx);
        return;
      }
      await handleSkillsCommand(ctx, subcommand === "" ? "summary" : subcommand);
    },
  });

  async function handleSkillsPanel(ctx: ExtensionCommandContext): Promise<void> {
    const panelState: CommandPanelState<SkillsAction> = {};
    await openCommandPanel(ctx, {
      title: "🎯 SF Skills HUD — status & controls",
      subtitle: "Review skill activity surfaced in the floating HUD.",
      statusLines: () => {
        refreshHud(ctx);
        return [
          `${hudState.hasAny ? "✓" : "○"} Usage detected ${hudState.hasAny ? "yes" : "no"}`,
          `• Live skills    ${hudState.live.length}`,
          `• Earlier skills ${hudState.earlier.length}`,
          `• Discovered     ${hudState.discoveredCount}`,
        ];
      },
      actions: () => buildSkillsActions(ctx.cwd),
      closeValue: "close",
      state: panelState,
      onAction: (action) => handleSkillsCommand(ctx, action, true),
    });
  }

  async function handleSkillsCommand(
    ctx: ExtensionCommandContext,
    subcommand: string,
    fromPanel = false,
  ): Promise<void> {
    if (subcommand === "lifecycle.toggle") {
      await performToggleExtension(ctx, "sf-skills-hud");
      return;
    }
    if (subcommand === "help") {
      await emitSkillsOutput(ctx, "SF Skills HUD help", renderSkillsHelp(), "info", fromPanel);
      return;
    }

    if (subcommand === "summary") {
      refreshHud(ctx);
      await emitSkillsOutput(
        ctx,
        "SF Skills HUD summary",
        formatSkillsHudSummary(hudState).join("\n"),
        "info",
        fromPanel,
      );
      return;
    }

    await emitSkillsOutput(
      ctx,
      "Unknown command",
      `Unknown /${COMMAND_NAME} subcommand: ${subcommand}. Use summary or help.`,
      "warning",
      fromPanel,
    );
  }

  async function emitSkillsOutput(
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
}
