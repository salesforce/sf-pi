/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-skills behavior contract (HUD slice)
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
  isLifecycleToggleAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";
import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { handleDefaults, parseDefaultsArgs } from "./lib/skills-command.ts";
import { updateSkillSources } from "../../lib/common/skill-sources/skill-sources.ts";
import { buildActiveRows, buildDiscoverRows } from "./lib/table-data.ts";
import { SkillsTableOverlayComponent, type TableResult } from "./lib/table-overlay.ts";

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

type SkillsAction = "summary" | "table" | "help" | "close" | LifecycleActionId;

const SKILLS_ACTIONS: CommandPanelAction<SkillsAction>[] = [
  {
    value: "summary",
    label: "Show skill summary",
    description: "Print live and earlier skill usage detected in the current session branch.",
    group: "Status",
  },
  {
    value: "table",
    label: "Open skills table",
    description:
      "Tabbed datatable: Active, Discover, Stats. Toggle global / project wiring per row.",
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
  const toggle = buildToggleExtensionAction({ extensionId: "sf-skills", cwd });
  return toggle ? [...SKILLS_ACTIONS, toggle] : SKILLS_ACTIONS;
}

function renderSkillsHelp(): string {
  return [
    "sf-skills — skills manager + HUD",
    "",
    "HUD (passive top-right overlay):",
    "  • Live now — skills still present in active context",
    "  • Earlier — skills used on this branch but no longer live after compaction/growth",
    "  • Hidden until at least one skill is used",
    "",
    "Datatable (/sf-skills table):",
    "  • Tabs: Active / Discover / Stats",
    "  • Active — every skill pi.getCommands() reports right now, with Wired column",
    "  • Discover — active set + on-disk candidates not yet in settings.skills[]",
    "  • Stats — per-skill usage counters (populated as you invoke /skill:<name>)",
    "  • g toggles global wiring, p toggles project, enter applies, esc cancels",
    "",
    "Defaults (forcedotcom/afv-library):",
    "  • /sf-skills defaults install  [project|global]",
    "  • /sf-skills defaults update   [project|global]",
    "  • /sf-skills defaults link <path> [project|global]",
    "  • /sf-skills defaults unlink <path> [project|global] [--delete]",
    "",
    "Commands:",
    "  /sf-skills           Open status & controls panel",
    "  /sf-skills summary   HUD summary text",
    "  /sf-skills table     Open the tabbed datatable",
    "  /sf-skills defaults  Manage afv-library installs (see above)",
    "  /sf-skills help      Show this help",
  ].join("\n");
}

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export default function sfSkills(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-skills")) return;

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
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const trimmed = args.trim();
        if (trimmed === "" && ctx.hasUI) {
          await handleSkillsPanel(ctx);
          return;
        }
        // Top-level subcommand: route `defaults ...` into the management
        // dispatcher; everything else stays in the HUD-flavored handler.
        const head = trimmed.split(/\s+/, 1)[0]?.toLowerCase() ?? "summary";
        if (head === "defaults") {
          const tail = trimmed.slice("defaults".length);
          const parsed = parseDefaultsArgs(tail);
          await handleDefaults(ctx, parsed, async (title, body, level) => {
            ctx.ui.notify(
              body ? `${title}\n\n${body}` : title,
              level === "success" ? "info" : level,
            );
          });
          return;
        }
        await handleSkillsCommand(ctx, head);
      });
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
      // Lifecycle toggle calls ctx.reload() — must close panel first so the
      // ctx.ui.custom() promise resolves before the runtime is invalidated.
      closeBeforeAction: isLifecycleToggleAction,
    });
  }

  async function handleSkillsCommand(
    ctx: ExtensionCommandContext,
    subcommand: string,
    fromPanel = false,
  ): Promise<void> {
    if (subcommand === "lifecycle.toggle") {
      await performToggleExtension(ctx, "sf-skills");
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

    if (subcommand === "table") {
      await openSkillsTable(ctx);
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

  async function openSkillsTable(ctx: ExtensionCommandContext): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify(
        "The skills table needs an interactive terminal. Use /sf-skills summary or /sf-skills defaults status instead.",
        "info",
      );
      return;
    }
    const commands = pi.getCommands();
    const active = buildActiveRows({ commands, cwd: ctx.cwd });
    const discover = buildDiscoverRows({ commands, cwd: ctx.cwd });

    ctx.ui.setWorkingVisible(false);
    let result: TableResult | undefined;
    try {
      result = await ctx.ui.custom<TableResult | undefined>(
        (_tui, theme, _keybindings, done) =>
          new SkillsTableOverlayComponent(theme, { active, discover, cwd: ctx.cwd }, done),
        {
          overlay: true,
          overlayOptions: () => ({
            anchor: "center" as const,
            width: "82%",
            minWidth: 80,
          }),
        },
      );
    } finally {
      ctx.ui.setWorkingVisible(true);
    }

    if (!result || result.kind === "cancel") return;
    await applyTableResult(ctx, result);
  }

  async function applyTableResult(
    ctx: ExtensionCommandContext,
    result: Extract<TableResult, { kind: "apply" }>,
  ): Promise<void> {
    const buckets: Record<"global" | "project", { add: string[]; remove: string[] }> = {
      global: { add: [], remove: [] },
      project: { add: [], remove: [] },
    };
    for (const t of result.toggles) {
      const bucket = buckets[t.scope];
      if (t.enable) bucket.add.push(t.skillPath);
      else bucket.remove.push(t.skillPath);
    }
    for (const c of result.addCandidates) {
      buckets[c.scope].add.push(c.settingsValue);
    }

    const summary: string[] = [];
    try {
      for (const scope of ["global", "project"] as const) {
        const b = buckets[scope];
        if (b.add.length === 0 && b.remove.length === 0) continue;
        const updated = updateSkillSources({
          add: b.add,
          remove: b.remove,
          scope,
          cwd: ctx.cwd,
        });
        summary.push(`${scope} skills[] (${updated.skills.length})`);
      }
    } catch (error) {
      ctx.ui.notify(
        `Failed to apply skill toggles: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
      return;
    }

    if (summary.length === 0) {
      ctx.ui.notify("No changes — nothing to apply.", "info");
      return;
    }
    ctx.ui.notify(`Applied: ${summary.join(", ")}. Reloading…`, "info");
    await ctx.reload();
  }
}
