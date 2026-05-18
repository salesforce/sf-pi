/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-skills behavior contract (HUD slice)
 *
 * Shows a persistent, pinned HUD in the top-right corner once the session has
 * actually used at least one skill. The HUD stays out of the way by using a
 * non-capturing overlay, so scrolling chat content and tool output do not move it.
 *
 * Skill state model:
 * - In context: skill usage still present in the current LLM context
 * - Earlier in session: skill usage seen on the current branch, but no longer
 *   present in the active context after compaction or later conversation growth
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
 *   /sf-skills        | Show a textual summary of in-context and earlier skills
 */
import {
  buildSessionContext,
  parseSkillBlock,
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
import { loadUsageMap, recordSkillInvocation } from "./lib/usage-store.ts";
import { applyPrunePlan, buildPrunePlan } from "./lib/prune.ts";
import { planDisable, planEnable } from "./lib/settings-coverage.ts";
import { SkillsTableOverlayComponent, type TableResult } from "./lib/table-overlay/index.ts";

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

type SkillsAction =
  | "summary"
  | "table"
  | "metrics"
  | "prune"
  | "help"
  | "close"
  | LifecycleActionId;

const SKILLS_ACTIONS: CommandPanelAction<SkillsAction>[] = [
  {
    value: "summary",
    label: "Show skill summary",
    description: "Print in-context and earlier skill usage detected in the current session branch.",
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
    value: "metrics",
    label: "Show usage metrics",
    description: "Top-N skill invocations split by global / project counters.",
    group: "Status",
  },
  {
    value: "prune",
    label: "Prune stale & orphan (dry-run)",
    description:
      "Report stale settings entries and orphan managed clones. Run /sf-skills prune --apply to delete.",
    group: "Maintenance",
  },
  {
    value: "help",
    label: "Show help",
    description:
      "Explain what In context and Earlier in session mean and how the passive HUD behaves.",
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

function renderMetrics(cwd: string): string {
  const global = loadUsageMap("global", cwd);
  const project = loadUsageMap("project", cwd);
  if (global.size === 0 && project.size === 0) {
    return [
      "No skill invocations recorded yet.",
      "",
      "Counters bump when you type /skill:<name> at the prompt. The HUD",
      "shows in-session usage; this view persists across sessions.",
    ].join("\n");
  }
  const top = (m: Map<string, { count: number; lastUsedAt: string }>): string[] => {
    const sorted = [...m.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    if (sorted.length === 0) return ["  (no entries)"];
    return sorted.map(
      ([name, rec], i) =>
        `  ${String(i + 1).padStart(2)}. ${name.padEnd(28)} ${String(rec.count).padStart(4)}  last ${rec.lastUsedAt}`,
    );
  };
  return [
    "Top skill usage (global, all projects):",
    ...top(global),
    "",
    "Top skill usage (this project):",
    ...top(project),
  ].join("\n");
}

function renderSkillsHelp(): string {
  return [
    "sf-skills — skills manager + HUD",
    "",
    "HUD (passive top-right overlay):",
    "  • In context — skills still present in active context",
    "  • Earlier in session — skills used on this branch but no longer in context after compaction/growth",
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

  pi.on("before_agent_start", async (event, ctx) => {
    // Bump persistent counters on explicit /skill:<name> invocations.
    // We mirror sf-skills-hud's signal model (explicit only) so the
    // counter never drifts ahead of what the HUD calls "used".
    const text = typeof event.prompt === "string" ? event.prompt : "";
    if (!text) return;
    const block = parseSkillBlock(text);
    if (!block?.name) return;
    try {
      recordSkillInvocation(block.name, ctx.cwd);
    } catch {
      // Counters are best-effort — never break a turn.
    }
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
        // Forward the apply flag for prune so '/sf-skills prune --apply' works.
        const tail = trimmed.slice(head.length).trim();
        const subcommand =
          head === "prune" && /(^|\s)--apply(\s|$)/.test(tail) ? "prune --apply" : head;
        await handleSkillsCommand(ctx, subcommand);
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
          `• In context         ${hudState.live.length}`,
          `• Earlier in session ${hudState.earlier.length}`,
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

    if (subcommand === "metrics") {
      await emitSkillsOutput(
        ctx,
        "SF Skills usage metrics",
        renderMetrics(ctx.cwd),
        "info",
        fromPanel,
      );
      return;
    }

    if (subcommand === "prune") {
      await runPrune(ctx, false, fromPanel);
      return;
    }

    if (subcommand === "prune --apply" || subcommand === "prune-apply") {
      await runPrune(ctx, true, fromPanel);
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
    const usage = loadUsageMap("all", ctx.cwd);
    const active = buildActiveRows({ commands, cwd: ctx.cwd, usage });
    const discover = buildDiscoverRows({ commands, cwd: ctx.cwd, usage });

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
    const skipped: string[] = [];
    const expansions: string[] = [];

    for (const t of result.toggles) {
      const bucket = buckets[t.scope];
      if (t.enable) {
        // Native pi-aware enable: if the file is already covered by a
        // wider settings entry, the toggle is a no-op (and would have
        // produced a duplicate-load warning before this fix).
        const plan = planEnable({ skillPath: t.skillPath, scope: t.scope, cwd: ctx.cwd });
        if (plan.alreadyCovered) {
          // Cross-scope: pi loads from global+project additively, so a skill
          // already covered in EITHER scope is loaded for this session.
          // Adding it again would only produce a name-collision warning.
          const where = plan.coveredInScope ?? t.scope;
          skipped.push(
            where === t.scope
              ? `${t.name} → ${t.scope}: already wired in this scope`
              : `${t.name} → ${t.scope}: already loaded via ${where} settings (would duplicate)`,
          );
          continue;
        }
        for (const value of plan.add) bucket.add.push(value);
      } else {
        // Native pi-aware disable: if a parent dir covers the file, expand
        // it into per-file entries minus the disabled one. If neither the
        // file nor a parent is wired (auto-discovered or bundled), refuse.
        const plan = planDisable({ skillPath: t.skillPath, scope: t.scope, cwd: ctx.cwd });
        if (plan.coverage === "none") {
          skipped.push(
            `${t.name} → ${t.scope}: not wired in this scope (auto-discovered or bundled)`,
          );
          continue;
        }
        for (const value of plan.remove) bucket.remove.push(value);
        for (const value of plan.add) bucket.add.push(value);
        if (plan.coverage === "parent" && plan.expandedFrom) {
          expansions.push(
            `${plan.expandedFrom} → ${plan.expandedSiblingCount ?? 0} per-file entr${
              plan.expandedSiblingCount === 1 ? "y" : "ies"
            } (so ${t.name} can be excluded)`,
          );
        }
      }
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

    const lines: string[] = [];
    if (summary.length > 0) lines.push(`Applied: ${summary.join(", ")}`);
    for (const e of expansions) lines.push(`Expanded ${e}`);
    for (const s of skipped) lines.push(`Skipped ${s}`);

    if (summary.length === 0) {
      ctx.ui.notify(
        lines.length > 0 ? lines.join("\n") : "No changes — nothing to apply.",
        skipped.length > 0 ? "warning" : "info",
      );
      return;
    }
    ctx.ui.notify(`${lines.join("\n")}\nReloading…`, "info");
    await ctx.reload();
  }

  async function runPrune(
    ctx: ExtensionCommandContext,
    apply: boolean,
    fromPanel: boolean,
  ): Promise<void> {
    const plan = buildPrunePlan(ctx.cwd);
    const lines: string[] = [];
    lines.push(`Stale settings entries: ${plan.staleWired.length}`);
    for (const raw of plan.staleWired) lines.push(`  ○ ${raw}`);
    lines.push("");
    lines.push(`Orphan managed clones: ${plan.orphanManagedDirs.length}`);
    for (const orphan of plan.orphanManagedDirs) {
      lines.push(`  ○ [${orphan.scope}] ${orphan.absolutePath}`);
    }

    if (!apply) {
      lines.push("");
      lines.push(
        plan.staleWired.length === 0 && plan.orphanManagedDirs.length === 0
          ? "Nothing to prune. ✨"
          : "Run '/sf-skills prune --apply' to remove the entries above.",
      );
      await emitSkillsOutput(ctx, "SF Skills prune (dry-run)", lines.join("\n"), "info", fromPanel);
      return;
    }

    const outcome = applyPrunePlan(plan, ctx.cwd, {
      removeStale: true,
      deleteOrphans: true,
    });
    lines.push("");
    lines.push(
      `Removed ${outcome.staleRemoved} stale entr${outcome.staleRemoved === 1 ? "y" : "ies"}, ` +
        `deleted ${outcome.dirsDeleted} orphan dir${outcome.dirsDeleted === 1 ? "" : "s"}.`,
    );
    if (outcome.errors.length > 0) {
      lines.push("");
      lines.push("Errors:");
      for (const err of outcome.errors) lines.push(`  ⚠  ${err}`);
    }
    await emitSkillsOutput(
      ctx,
      "SF Skills prune",
      lines.join("\n"),
      outcome.errors.length > 0 ? "warning" : "info",
      fromPanel,
    );
    if (outcome.staleRemoved > 0 || outcome.dirsDeleted > 0) {
      await ctx.reload();
    }
  }
}
