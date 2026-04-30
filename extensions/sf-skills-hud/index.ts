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
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { SkillsHudComponent } from "./lib/hud-component.ts";
import {
  buildSkillsHudState,
  formatSkillsHudSummary,
  type SkillsHudState,
} from "./lib/skill-state.ts";

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

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfSkillsHud(pi: ExtensionAPI) {
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
    handler: async (args, ctx) => {
      const subcommand = args.trim().toLowerCase();

      if (subcommand === "help") {
        ctx.ui.notify(
          [
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
            "  /sf-skills       Show current summary",
            "  /sf-skills help  Show this help",
          ].join("\n"),
          "info",
        );
        return;
      }

      refreshHud(ctx);
      ctx.ui.notify(formatSkillsHudSummary(hudState).join("\n"), "info");
    },
  });
}
