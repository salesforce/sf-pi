/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Command handlers for `/sf-pi skills`.
 *
 * Split out of index.ts to keep the main entry point readable. This
 * module glues together:
 *
 *   - skill-sources.ts         (disk scan + settings writer)
 *   - skill-sources-overlay.ts (interactive checklist)
 *
 * Each handler is async and self-contained; they never throw out of the
 * manager extension — errors are surfaced via ctx.ui.notify so a bad
 * settings file can never crash a pi session.
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  detectSkillSources,
  updateSkillSources,
  type SkillSourceCandidate,
} from "../../../lib/common/skill-sources/skill-sources.ts";
import {
  SkillSourcesOverlayComponent,
  type SkillSourcesOverlayResult,
  type SkillSourceRow,
} from "./skill-sources-overlay.ts";

export type SkillsSubcommand = "overlay" | "list" | "link" | "unlink" | "status";

export interface SkillsArgs {
  subcommand: SkillsSubcommand;
  target?: string;
}

const PREFIX = "/sf-pi skills";

// -------------------------------------------------------------------------------------------------
// Argument parsing
// -------------------------------------------------------------------------------------------------

/**
 * Parse the tail after `/sf-pi skills`.
 *
 * Accepted forms:
 *   ""                              → overlay
 *   "list"                          → list
 *   "link <path|label>"             → link
 *   "unlink <path|label>"           → unlink
 *   "status"                        → status
 *
 * `target` is accepted verbatim — the helper already supports both the
 * short label (e.g. "Claude Code") and the literal settings path
 * (e.g. "~/.claude/skills"), so we don't normalize here.
 */
export function parseSkillsArgs(raw: string): SkillsArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const sub = (tokens[0] ?? "").toLowerCase();
  const target = tokens.slice(1).join(" ").trim() || undefined;

  if (!sub) return { subcommand: "overlay" };
  if (sub === "list" || sub === "ls") return { subcommand: "list" };
  if (sub === "status") return { subcommand: "status" };
  if (sub === "link" || sub === "add") return { subcommand: "link", target };
  if (sub === "unlink" || sub === "remove" || sub === "rm") {
    return { subcommand: "unlink", target };
  }
  return { subcommand: "overlay" };
}

// -------------------------------------------------------------------------------------------------
// Dispatcher
// -------------------------------------------------------------------------------------------------

export async function handleSkills(
  ctx: ExtensionCommandContext,
  packageVersion: string,
  args: SkillsArgs,
): Promise<void> {
  switch (args.subcommand) {
    case "overlay":
      await handleOverlay(ctx, packageVersion);
      break;
    case "list":
      handleList(ctx);
      break;
    case "status":
      handleStatus(ctx);
      break;
    case "link":
      await handleLink(ctx, args.target);
      break;
    case "unlink":
      await handleUnlink(ctx, args.target);
      break;
  }
}

// -------------------------------------------------------------------------------------------------
// Overlay
// -------------------------------------------------------------------------------------------------

async function handleOverlay(ctx: ExtensionCommandContext, packageVersion: string): Promise<void> {
  if (!ctx.hasUI) {
    handleList(ctx);
    return;
  }

  const detection = detectSkillSources({ cwd: ctx.cwd });
  const rows: SkillSourceRow[] = detection.candidates.map((candidate) => ({
    candidate,
    // Pre-check any currently-wired root so Enter is a no-op by default.
    // Available-but-not-wired roots start unchecked so the user opts in
    // deliberately — a quiet opt-in here would surprise people.
    selected: candidate.wired,
    previouslyWired: candidate.wired,
  }));

  if (rows.length === 0 && detection.staleWired.length === 0) {
    ctx.ui.notify(
      [
        "No external skill directories detected.",
        "",
        "sf-pi looks for (global):",
        "  ~/.claude/skills   (Claude Code)",
        "  ~/.codex/skills    (OpenAI Codex)",
        "  ~/.cursor/skills   (Cursor)",
        "",
        "And these inside your current project:",
        "  ./.claude/skills   ./.codex/skills   ./.cursor/skills",
        "",
        "Create one of these directories (or add your own path via settings.json → skills[])",
        "and re-run /sf-pi skills.",
      ].join("\n"),
      "info",
    );
    return;
  }

  ctx.ui.setWorkingVisible(false);
  let result: SkillSourcesOverlayResult | undefined;
  try {
    result = await ctx.ui.custom<SkillSourcesOverlayResult | undefined>(
      (_tui, theme, _keybindings, done) =>
        new SkillSourcesOverlayComponent(
          theme,
          packageVersion,
          detection.settingsPath,
          rows,
          detection.staleWired,
          done,
        ),
      {
        overlay: true,
        overlayOptions: () => ({
          anchor: "center" as const,
          width: "78%",
          minWidth: 70,
        }),
      },
    );
  } finally {
    ctx.ui.setWorkingVisible(true);
  }

  if (!result || result.kind === "cancel") return;
  await applyOverlayResult(ctx, result);
}

async function applyOverlayResult(
  ctx: ExtensionCommandContext,
  result: Extract<SkillSourcesOverlayResult, { kind: "apply" }>,
): Promise<void> {
  // Group adds/removes per scope so each settings file is written exactly
  // once with only the entries it should own.
  const globalAdd: string[] = [];
  const globalRemove: string[] = [];
  const projectAdd: string[] = [];
  const projectRemove: string[] = [];

  for (const row of result.rows) {
    const bucketAdd = row.candidate.scope === "project" ? projectAdd : globalAdd;
    const bucketRemove = row.candidate.scope === "project" ? projectRemove : globalRemove;
    if (row.selected && !row.previouslyWired) bucketAdd.push(row.candidate.settingsPath);
    if (!row.selected && row.previouslyWired) bucketRemove.push(row.candidate.settingsPath);
  }
  // Stale wired pruning is global-only — the existing overlay only
  // surfaces stale entries from the global file, so this preserves
  // its current contract.
  if (result.pruneStale) globalRemove.push(...result.staleWired);

  const hasChanges =
    globalAdd.length > 0 ||
    globalRemove.length > 0 ||
    projectAdd.length > 0 ||
    projectRemove.length > 0;
  if (!hasChanges) {
    ctx.ui.notify("No changes — skill sources already match your selection.", "info");
    return;
  }

  const summary: string[] = [];
  try {
    if (globalAdd.length > 0 || globalRemove.length > 0) {
      const updated = updateSkillSources({
        add: globalAdd,
        remove: globalRemove,
        scope: "global",
      });
      summary.push(`global skills[] (${updated.skills.length})`);
    }
    if (projectAdd.length > 0 || projectRemove.length > 0) {
      const updated = updateSkillSources({
        add: projectAdd,
        remove: projectRemove,
        scope: "project",
        cwd: ctx.cwd,
      });
      summary.push(`project skills[] (${updated.skills.length})`);
    }
  } catch (error) {
    ctx.ui.notify(
      `Failed to update skill sources: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
    return;
  }

  const totalAdd = globalAdd.length + projectAdd.length;
  const totalRemove = globalRemove.length + projectRemove.length;
  const parts: string[] = [];
  if (totalAdd > 0) parts.push(`+${totalAdd} added`);
  if (totalRemove > 0) parts.push(`-${totalRemove} removed`);
  ctx.ui.notify(`${parts.join(", ")}. ${summary.join(", ")}. Reloading…`, "info");
  await ctx.reload();
}

// -------------------------------------------------------------------------------------------------
// Non-interactive handlers
// -------------------------------------------------------------------------------------------------

function handleList(ctx: ExtensionCommandContext): void {
  const detection = detectSkillSources({ cwd: ctx.cwd });
  if (detection.candidates.length === 0 && detection.staleWired.length === 0) {
    ctx.ui.notify(
      "No external skill directories detected under ~/.claude, ~/.codex, ~/.cursor, or this project.",
      "info",
    );
    return;
  }

  const lines = [
    `sf-pi external skill sources:`,
    `  global settings:  ${detection.settingsPath}`,
    detection.projectSettingsPath
      ? `  project settings: ${detection.projectSettingsPath}`
      : `  project settings: (not in a project root)`,
    "",
    ...detection.candidates.map(renderCandidateLine),
  ];
  if (detection.staleWired.length > 0) {
    lines.push("", "Stale entries in settings.skills[] (path no longer exists):");
    for (const raw of detection.staleWired) lines.push(`  ○ ${raw}`);
  }
  lines.push(
    "",
    `Run: ${PREFIX} link <path|label>  |  ${PREFIX} unlink <path|label>  |  ${PREFIX}`,
  );
  ctx.ui.notify(lines.join("\n"), "info");
}

function handleStatus(ctx: ExtensionCommandContext): void {
  const detection = detectSkillSources({ cwd: ctx.cwd });
  const globalRoots = detection.candidates.filter((c) => c.scope === "global");
  const projectRoots = detection.candidates.filter((c) => c.scope === "project");
  const globalWired = globalRoots.filter((c) => c.wired).length;
  const projectWired = projectRoots.filter((c) => c.wired).length;
  const lines = [
    "sf-pi external skill sources status",
    "",
    `Global settings:      ${detection.settingsPath}`,
    `  detected:           ${globalRoots.length}`,
    `  wired:              ${globalWired}`,
    `  available (opt in): ${globalRoots.length - globalWired}`,
    "",
    `Project settings:     ${detection.projectSettingsPath ?? "(not in a project root)"}`,
    `  detected:           ${projectRoots.length}`,
    `  wired:              ${projectWired}`,
    `  available (opt in): ${projectRoots.length - projectWired}`,
    "",
    `Stale wired entries:  ${detection.staleWired.length}`,
    "",
    `Open the checklist: ${PREFIX}`,
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

async function handleLink(ctx: ExtensionCommandContext, target: string | undefined): Promise<void> {
  if (!target) {
    ctx.ui.notify(
      `Usage: ${PREFIX} link <path|label>\nExamples:\n  ${PREFIX} link ~/.claude/skills\n  ${PREFIX} link Claude Code`,
      "warning",
    );
    return;
  }
  const detection = detectSkillSources({ cwd: ctx.cwd });
  const resolved = resolveTarget(detection.candidates, target);
  if (!resolved) {
    ctx.ui.notify(
      `Could not resolve "${target}" to a known root. Run '${PREFIX} list' to see detected labels/paths.`,
      "warning",
    );
    return;
  }
  if (resolved.wired) {
    ctx.ui.notify(`${resolved.label} is already wired in settings.`, "info");
    return;
  }
  try {
    updateSkillSources({
      add: [resolved.settingsPath],
      remove: [],
      scope: resolved.scope,
      cwd: ctx.cwd,
    });
  } catch (error) {
    ctx.ui.notify(
      `Failed to link ${resolved.label}: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
    return;
  }
  ctx.ui.notify(`Linked ${resolved.label} (${resolved.settingsPath}). Reloading…`, "info");
  await ctx.reload();
}

async function handleUnlink(
  ctx: ExtensionCommandContext,
  target: string | undefined,
): Promise<void> {
  if (!target) {
    ctx.ui.notify(`Usage: ${PREFIX} unlink <path|label>`, "warning");
    return;
  }
  const detection = detectSkillSources({ cwd: ctx.cwd });
  const resolved = resolveTarget(detection.candidates, target);
  // Fall back to removing the raw user input — lets users unlink entries
  // we don't recognize (e.g. arbitrary paths they added manually).
  const removeValue = resolved ? resolved.settingsPath : target;
  try {
    updateSkillSources({
      add: [],
      remove: [removeValue],
      // Default to global when we can't infer scope (raw input case);
      // for resolved candidates honor their scope.
      scope: resolved?.scope ?? "global",
      cwd: ctx.cwd,
    });
  } catch (error) {
    ctx.ui.notify(
      `Failed to unlink ${removeValue}: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
    return;
  }
  ctx.ui.notify(`Unlinked ${removeValue}. Reloading…`, "info");
  await ctx.reload();
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function renderCandidateLine(candidate: SkillSourceCandidate): string {
  const badge = candidate.wired ? "●" : "○";
  const status = candidate.wired ? "wired" : "available";
  const count = `${candidate.skillCount} skill${candidate.skillCount === 1 ? "" : "s"}`;
  return (
    `  ${badge} ${candidate.label} — ${status}, ${count}\n` +
    `      path:     ${candidate.displayPath}\n` +
    `      settings: ${candidate.settingsPath}`
  );
}

function resolveTarget(
  candidates: SkillSourceCandidate[],
  target: string,
): SkillSourceCandidate | undefined {
  const lower = target.toLowerCase();
  return candidates.find(
    (c) =>
      c.label.toLowerCase() === lower ||
      c.settingsPath.toLowerCase() === lower ||
      c.absolutePath.toLowerCase() === lower ||
      c.displayPath.toLowerCase() === lower,
  );
}
