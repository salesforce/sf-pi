/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-skills behavior contract (HUD slice)
 *
 * Shows a pinned HUD in the top-right corner while at least one skill is still
 * present in the active LLM context. The HUD stays out of the way by using a
 * non-capturing overlay, so scrolling chat content and tool output do not move it.
 *
 * Skill state model:
 * - In context: skill usage still present in the current LLM context and shown
 *   in the floating HUD
 * - Earlier in session: skill usage seen on the current branch, but no longer
 *   present in the active context after compaction or later conversation growth;
 *   available in `/sf-skills summary`, not in the floating HUD
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
  loadSkills,
  loadSkillsFromDir,
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
import { setSourceGate, upsertSource } from "../../lib/common/skill-sources/source-registry.ts";
import { loadUsageMap, recordSkillInvocation } from "./lib/usage-store.ts";
import { applyPrunePlan, buildPrunePlan } from "./lib/prune.ts";
import { gatherCatalogInput } from "./lib/gather.ts";
import { buildSkillCatalog, type SkillCatalog } from "./lib/catalog.ts";
import {
  planConflictWinner,
  planConsolidateScopes,
  planRescopeToProject,
  planSkillGate,
  type ScopeOps,
} from "./lib/resolution.ts";
import { SkillFunnelViewComponent } from "./lib/funnel-view/index.ts";
import type { FunnelAction, FunnelResult } from "./lib/funnel-view/types.ts";
import { applyFileAction, type FileActionOp } from "./lib/conflict-actions.ts";

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
  | "funnel"
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
    value: "funnel",
    label: "Open skill funnel",
    description:
      "Catalog → Sources → Global → Project → Conflicts. Gate sources, toggle skills per scope, resolve conflicts.",
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
    "  • Floating HUD hides when no skills remain in active context",
    "",
    "Funnel (/sf-skills funnel):",
    "  • Tabs: Catalog / Sources / Global / Project / Conflicts",
    "  • Catalog — every skill found across every source (incl. gated-off + losers)",
    "  • Sources — Source Gate: which roots Pi sees (a adds a custom path)",
    "  • Global / Project — Skill Gate per scope; g toggles global, p toggles project",
    "  • Conflicts — pick a winner (w) for resolvable name collisions",
    "  • enter applies staged changes, esc cancels",
    "",
    "Defaults (forcedotcom/afv-library):",
    "  • /sf-skills defaults install  [project|global]   (default: project; clones once, shared)",
    "  • /sf-skills defaults update   [project|global]",
    "  • /sf-skills defaults link <path> [project|global]",
    "  • /sf-skills defaults unlink <path> [project|global] [--delete]",
    "",
    "Commands:",
    "  /sf-skills           Open status & controls panel",
    "  /sf-skills summary   HUD summary text",
    "  /sf-skills funnel    Open the skill funnel",
    "  /sf-skills defaults  Manage afv-library installs (see above)",
    "  /sf-skills help      Show this help",
  ].join("\n");
}

// -------------------------------------------------------------------------------------------------
// Extension entry point
// -------------------------------------------------------------------------------------------------

export function shouldShowFloatingHud(
  state: SkillsHudState,
  terminalWidth: number,
  terminalHeight: number,
): boolean {
  return state.live.length > 0 && terminalWidth >= 100 && terminalHeight >= 14;
}

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
    if (ctx.mode !== "tui" || hudComponent || dismissHud) {
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
              return shouldShowFloatingHud(hudState, terminalWidth, terminalHeight);
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

  pi.on("session_start", async (event, ctx) => {
    dismissOverlay();
    hudState = EMPTY_STATE;
    if (ctx.mode !== "tui") {
      return;
    }
    if (event.reason === "reload") {
      // reload() emits session_start while it is still unwinding the previous
      // runtime. Mounting a ctx.ui.custom overlay synchronously here strands
      // the overlay promise and freezes all input (the same failure mode the
      // command panel guards against). Defer the HUD mount until reload() has
      // fully returned and the event loop turns.
      const timer = setTimeout(() => rebuildAndRender(ctx), 0);
      timer.unref?.();
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
      // Close the panel BEFORE actions that open their own overlay or call
      // ctx.reload(): the lifecycle toggle (reload) and the funnel (a nested
      // capturing overlay that itself reloads on apply). Otherwise reload tears
      // the runtime down while this panel's ctx.ui.custom() promise is still
      // mounted, stranding it — pi never calls its done(), and all input
      // freezes until Ctrl+C. This is the lifecycle shorthand
      // (`closeBeforeAction: isLifecycleToggleAction`) plus the nested funnel
      // overlay case. See lib/common/command-panel.ts.
      closeBeforeAction: (action) => isLifecycleToggleAction(action) || action === "funnel",
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

    if (subcommand === "funnel" || subcommand === "table") {
      await openFunnel(ctx);
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

  async function openFunnel(ctx: ExtensionCommandContext): Promise<void> {
    if (ctx.mode !== "tui") {
      const message =
        "The skill funnel needs an interactive Pi TUI. Use /sf-skills summary or /sf-skills metrics instead.";
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.info(message);
      return;
    }

    // Heavy catalog work happens HERE, on explicit /sf-skills intent — never
    // in a session hook. See tests/boot-path.test.ts for the enforced contract.
    const input = gatherCatalogInput({
      cwd: ctx.cwd,
      deps: { loadSkills, loadSkillsFromDir, getCommands: () => pi.getCommands() },
    });
    const catalog = buildSkillCatalog(input);

    ctx.ui.setWorkingVisible(false);
    let result: FunnelResult | undefined;
    try {
      result = await ctx.ui.custom<FunnelResult>(
        (_tui, theme, _keybindings, done) =>
          new SkillFunnelViewComponent(theme, { catalog, cwd: ctx.cwd }, done),
        {
          overlay: true,
          // Fixed max column width (pi clamps to the terminal on narrow
          // screens); the component's flex columns fill whatever it gets, so
          // the funnel is responsive between ~84 and ~152 columns.
          overlayOptions: () => ({
            anchor: "center" as const,
            width: 152,
            minWidth: 84,
            maxHeight: "90%",
          }),
        },
      );
    } finally {
      ctx.ui.setWorkingVisible(true);
    }

    if (!result || result.kind === "cancel") return;
    if (result.kind === "resolve") {
      await resolveConflictByFile(ctx, catalog, result.name, result.winnerPath);
      return;
    }
    if (result.kind === "consolidate") {
      await consolidateScopes(ctx, catalog);
      return;
    }
    if (result.kind === "rescope") {
      await rescopeToProject(ctx, catalog, result.skillPaths, result.label);
      return;
    }
    await applyFunnelResult(ctx, catalog, result.actions);
  }

  /**
   * Move global-enabled skills to the current project (drop global, add
   * project). Because removing from global affects every other project, any
   * multi-skill move confirms first.
   */
  async function rescopeToProject(
    ctx: ExtensionCommandContext,
    catalog: SkillCatalog,
    skillPaths: string[],
    label: string,
  ): Promise<void> {
    const wanted = new Set(skillPaths);
    const targets = catalog.skills.filter((s) => wanted.has(s.filePath) && s.enabledGlobal);
    if (targets.length === 0) {
      ctx.ui.notify("Nothing to move — no global-enabled skills in the selection.", "info");
      return;
    }
    if (targets.length > 1) {
      const confirmed = await ctx.ui.confirm(
        `Move ${targets.length} skill(s) to project scope?`,
        `Moving ${label} removes ${targets.length} skill(s) from global settings — they will be DISABLED in your other projects (re-enable per project as needed). They stay enabled here.`,
      );
      if (!confirmed) return;
    }

    const plan = planRescopeToProject({ skills: targets, cwd: ctx.cwd });
    const summary: string[] = [];
    try {
      for (const op of plan.ops) {
        const updated = updateSkillSources({
          add: op.add,
          remove: op.remove,
          scope: op.scope,
          cwd: ctx.cwd,
        });
        summary.push(`${op.scope} skills[] (${updated.skills.length})`);
      }
    } catch (error) {
      ctx.ui.notify(
        `Failed to move to project: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
      return;
    }
    if (summary.length === 0) {
      ctx.ui.notify("Nothing to change.", "info");
      return;
    }
    ctx.ui.notify(
      `Moved ${plan.affected} skill(s) to project scope. Applied: ${summary.join(", ")}\nReloading…`,
      "info",
    );
    await ctx.reload();
  }

  /**
   * Bulk-resolve "wired in both global and project" duplicates (the
   * afv-installed-twice mess). Prompts which scope to keep, then removes the
   * other scope's wiring for every duplicated skill in one reload.
   */
  async function consolidateScopes(
    ctx: ExtensionCommandContext,
    catalog: SkillCatalog,
  ): Promise<void> {
    // Count duplicates up front so we can tell the user what they're fixing.
    const preview = planConsolidateScopes({ catalog, keepScope: "project", cwd: ctx.cwd });
    if (preview.affected === 0) {
      ctx.ui.notify(
        "No skills are wired in both global and project — nothing to consolidate.",
        "info",
      );
      return;
    }
    const OPTIONS: Array<{ label: string; scope: "project" | "global" | "cancel" }> = [
      {
        label: `Keep project, drop global (recommended) — fixes ${preview.affected} duplicate(s)`,
        scope: "project",
      },
      { label: "Keep global, drop project", scope: "global" },
      { label: "Cancel", scope: "cancel" },
    ];
    const picked = await ctx.ui.select(
      `${preview.affected} skill(s) are wired in BOTH global and project. Which scope should win?`,
      OPTIONS.map((o) => o.label),
    );
    const keep = OPTIONS.find((o) => o.label === picked)?.scope;
    if (!keep || keep === "cancel") return;

    const plan = planConsolidateScopes({ catalog, keepScope: keep, cwd: ctx.cwd });
    const summary: string[] = [];
    try {
      for (const op of plan.ops) {
        const updated = updateSkillSources({
          add: op.add,
          remove: op.remove,
          scope: op.scope,
          cwd: ctx.cwd,
        });
        summary.push(`${op.scope} skills[] (${updated.skills.length})`);
      }
    } catch (error) {
      ctx.ui.notify(
        `Failed to consolidate: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
      return;
    }
    if (summary.length === 0) {
      ctx.ui.notify("Nothing to change.", "info");
      return;
    }
    ctx.ui.notify(
      `Consolidated ${plan.affected} duplicate(s) to ${keep} scope. Applied: ${summary.join(", ")}\nReloading…`,
      "info",
    );
    await ctx.reload();
  }

  /**
   * Interactive, consent-gated file-level conflict resolution (ADR-0018).
   * Keeps the chosen winner; the loser copies are disabled / quarantined /
   * deleted on the user's explicit choice. Delete double-confirms.
   */
  async function resolveConflictByFile(
    ctx: ExtensionCommandContext,
    catalog: SkillCatalog,
    name: string,
    winnerPath: string,
  ): Promise<void> {
    const conflict = catalog.conflicts.find((c) => c.name === name);
    if (!conflict) {
      ctx.ui.notify(`Conflict "${name}" is no longer present.`, "info");
      return;
    }
    const losers = conflict.copies.filter((c) => c.filePath !== winnerPath);
    if (losers.length === 0) {
      ctx.ui.notify(`Nothing to resolve for "${name}".`, "info");
      return;
    }
    const winnerLabel =
      conflict.copies.find((c) => c.filePath === winnerPath)?.sourceLabel ?? "selected copy";
    const OPTIONS: Array<{ label: string; op: FileActionOp | "cancel" }> = [
      { label: "Disable in place (rename SKILL.md → .disabled, reversible)", op: "disable" },
      { label: "Move to quarantine (reversible)", op: "quarantine" },
      { label: "Delete permanently", op: "delete" },
      { label: "Cancel", op: "cancel" },
    ];
    const picked = await ctx.ui.select(
      `Resolve "${name}" — keep ${winnerLabel}. What about the other ${losers.length} cop${losers.length === 1 ? "y" : "ies"}?`,
      OPTIONS.map((o) => o.label),
    );
    const choice = OPTIONS.find((o) => o.label === picked)?.op;
    if (!choice || choice === "cancel") return;

    if (choice === "delete") {
      const confirmed = await ctx.ui.confirm(
        "Delete skill folders?",
        `Permanently delete ${losers.length} skill folder(s) for "${name}". This cannot be undone (unless under git).`,
      );
      if (!confirmed) return;
    }

    const results = applyFileAction(
      choice,
      losers.map((l) => l.filePath),
    );
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const lines = [
      `${choice} ${ok.length}/${results.length} copy(ies) for "${name}".`,
      ...ok.map((r) => `  ✓ ${r.from}${r.to ? ` → ${r.to}` : ""}`),
      ...failed.map((r) => `  ⚠ ${r.from}: ${r.error}`),
    ];
    ctx.ui.notify(
      `${lines.join("\n")}${ok.length > 0 ? "\nReloading…" : ""}`,
      failed.length > 0 ? "warning" : "info",
    );
    if (ok.length > 0) await ctx.reload();
  }

  /**
   * Compile staged funnel actions through the Resolution Policy into native
   * settings.skills[] ops + Source Registry writes (Compiled Skill
   * Resolution), apply them, then reload so Pi re-runs its loader.
   */
  async function applyFunnelResult(
    ctx: ExtensionCommandContext,
    catalog: SkillCatalog,
    actions: FunnelAction[],
  ): Promise<void> {
    const buckets: Record<"global" | "project", { add: string[]; remove: string[] }> = {
      global: { add: [], remove: [] },
      project: { add: [], remove: [] },
    };
    const skipped: string[] = [];
    const expansions: string[] = [];
    const pushOps = (ops: ScopeOps[]) => {
      for (const op of ops) {
        buckets[op.scope].add.push(...op.add);
        buckets[op.scope].remove.push(...op.remove);
      }
    };

    for (const action of actions) {
      if (action.kind === "skill-gate") {
        const skill = catalog.skills.find((s) => s.filePath === action.skillPath);
        if (!skill) {
          skipped.push(`${action.name}: no longer in catalog`);
          continue;
        }
        const plan = planSkillGate({
          skill,
          enable: action.enable,
          scope: action.scope,
          cwd: ctx.cwd,
        });
        if (plan.blocked) {
          skipped.push(`${action.name} → ${action.scope}: ${plan.note ?? plan.blocked}`);
          continue;
        }
        pushOps(plan.ops);
        if (plan.expandedFrom) expansions.push(...plan.expandedFrom);
      } else if (action.kind === "conflict-winner") {
        const conflict = catalog.conflicts.find((c) => c.name === action.name);
        if (!conflict) {
          skipped.push(`${action.name}: conflict no longer present`);
          continue;
        }
        const plan = planConflictWinner({ conflict, winnerPath: action.winnerPath, cwd: ctx.cwd });
        if (plan.blocked) {
          skipped.push(`${action.name}: ${plan.note ?? plan.blocked}`);
          continue;
        }
        pushOps(plan.ops);
        if (plan.expandedFrom) expansions.push(...plan.expandedFrom);
      } else if (action.kind === "source-gate") {
        const source = catalog.sources.find((s) => s.id === action.sourceId);
        if (action.seen) buckets[action.scope].add.push(action.value);
        else buckets[action.scope].remove.push(action.value);
        // Persist the gate only for custom/managed roots so a seen-but-empty
        // source survives reload. Harness/default gate is reconstructable
        // from settings wiring alone.
        if (source && (source.kind === "custom" || source.kind === "managed")) {
          setSourceGate(action.scope, action.sourceId, action.seen ? "seen" : "off", ctx.cwd);
        }
      } else if (action.kind === "add-source") {
        buckets[action.scope].add.push(action.value);
        upsertSource(action.scope, { value: action.value, kind: "custom", gate: "seen" }, ctx.cwd);
      }
    }

    const summary: string[] = [];
    try {
      for (const scope of ["global", "project"] as const) {
        const b = buckets[scope];
        if (b.add.length === 0 && b.remove.length === 0) continue;
        const updated = updateSkillSources({ add: b.add, remove: b.remove, scope, cwd: ctx.cwd });
        summary.push(`${scope} skills[] (${updated.skills.length})`);
      }
    } catch (error) {
      ctx.ui.notify(
        `Failed to apply funnel changes: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
      return;
    }

    const lines: string[] = [];
    if (summary.length > 0) lines.push(`Applied: ${summary.join(", ")}`);
    for (const e of expansions) lines.push(`Expanded ${e} (minus-one to exclude a skill)`);
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
