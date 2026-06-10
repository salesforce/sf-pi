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

export async function handleSkills(ctx: ExtensionCommandContext, args: SkillsArgs): Promise<void> {
  switch (args.subcommand) {
    case "overlay":
      await handleOverlay(ctx);
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

async function handleOverlay(ctx: ExtensionCommandContext): Promise<void> {
  // Skill management moved to the SF Skills extension's Skill Funnel
  // (`/sf-skills`). `/sf-pi skills` is now a read-only pointer + summary; it no
  // longer owns the wiring UI. The list/link/unlink subcommands remain as
  // headless escape hatches.
  ctx.ui.notify(
    [
      "Skill management lives in the Skill Funnel now: run /sf-skills",
      "",
      "  /sf-skills            Catalog → Sources → Global → Project → Conflicts",
      "  /sf-skills funnel     gate sources, toggle skills per scope, resolve conflicts",
      "",
      "Read-only here: /sf-pi skills list · status. Headless wiring: link / unlink.",
    ].join("\n"),
    "info",
  );
  handleList(ctx);
}

// -------------------------------------------------------------------------------------------------
// Non-interactive handlers
// -------------------------------------------------------------------------------------------------

function handleList(ctx: ExtensionCommandContext): void {
  const projectTrusted = ctx.isProjectTrusted();
  const detection = detectSkillSources({ cwd: ctx.cwd, includeProject: projectTrusted });
  if (detection.candidates.length === 0 && detection.staleWired.length === 0) {
    ctx.ui.notify(
      projectTrusted
        ? "No external skill directories detected under ~/.claude, ~/.codex, ~/.cursor, or this project."
        : "No external global skill directories detected under ~/.claude, ~/.codex, or ~/.cursor. Project sources are hidden until Pi trusts this project.",
      "info",
    );
    return;
  }

  const lines = [
    `sf-pi external skill sources:`,
    `  global settings:  ${detection.settingsPath}`,
    projectTrusted && detection.projectSettingsPath
      ? `  project settings: ${detection.projectSettingsPath}`
      : projectTrusted
        ? `  project settings: (not in a project root)`
        : `  project settings: (unavailable until project is trusted)`,
    "",
    ...detection.candidates.map(renderCandidateLine),
  ];
  if (detection.staleWired.length > 0) {
    lines.push("", "Stale entries in settings.skills[] (path no longer exists):");
    for (const raw of detection.staleWired) lines.push(`  ○ ${raw}`);
  }
  if (!projectTrusted) {
    lines.push(
      "",
      "Project-scope sources are hidden until Pi trusts this project. Use /trust for future sessions, or restart with --approve to include them.",
    );
  }
  lines.push(
    "",
    `Run: ${PREFIX} link <path|label>  |  ${PREFIX} unlink <path|label>  |  ${PREFIX}`,
  );
  ctx.ui.notify(lines.join("\n"), "info");
}

function handleStatus(ctx: ExtensionCommandContext): void {
  const projectTrusted = ctx.isProjectTrusted();
  const detection = detectSkillSources({ cwd: ctx.cwd, includeProject: projectTrusted });
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
    `Project settings:     ${
      projectTrusted
        ? (detection.projectSettingsPath ?? "(not in a project root)")
        : "(unavailable until project is trusted)"
    }`,
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
  const detection = detectSkillSources({ cwd: ctx.cwd, includeProject: ctx.isProjectTrusted() });
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
  const detection = detectSkillSources({ cwd: ctx.cwd, includeProject: ctx.isProjectTrusted() });
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
