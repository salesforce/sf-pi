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
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { setWorkingVisible } from "../../../lib/common/pi-compat.ts";
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

  const detection = detectSkillSources();
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
        "sf-pi looks for:",
        "  ~/.claude/skills   (Claude Code)",
        "  ~/.codex/skills    (OpenAI Codex)",
        "  ~/.cursor/skills   (Cursor)",
        "",
        "Create one of these directories (or add your own path via settings.json → skills[])",
        "and re-run /sf-pi skills.",
      ].join("\n"),
      "info",
    );
    return;
  }

  setWorkingVisible(ctx, false);
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
    setWorkingVisible(ctx, true);
  }

  if (!result || result.kind === "cancel") return;
  await applyOverlayResult(ctx, result);
}

async function applyOverlayResult(
  ctx: ExtensionCommandContext,
  result: Extract<SkillSourcesOverlayResult, { kind: "apply" }>,
): Promise<void> {
  const toAdd: string[] = [];
  const toRemove: string[] = [];

  for (const row of result.rows) {
    if (row.selected && !row.previouslyWired) toAdd.push(row.candidate.settingsPath);
    if (!row.selected && row.previouslyWired) toRemove.push(row.candidate.settingsPath);
  }
  if (result.pruneStale) toRemove.push(...result.staleWired);

  if (toAdd.length === 0 && toRemove.length === 0) {
    ctx.ui.notify("No changes — skill sources already match your selection.", "info");
    return;
  }

  let skillsCount: number;
  try {
    const updated = updateSkillSources({ add: toAdd, remove: toRemove });
    skillsCount = updated.skills.length;
  } catch (error) {
    ctx.ui.notify(
      `Failed to update skill sources: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
    return;
  }

  const parts: string[] = [];
  if (toAdd.length > 0) parts.push(`+${toAdd.length} added`);
  if (toRemove.length > 0) parts.push(`-${toRemove.length} removed`);
  ctx.ui.notify(
    `${parts.join(", ")}. skills[] now lists ${skillsCount} entr${skillsCount === 1 ? "y" : "ies"}. Reloading…`,
    "info",
  );
  await ctx.reload();
}

// -------------------------------------------------------------------------------------------------
// Non-interactive handlers
// -------------------------------------------------------------------------------------------------

function handleList(ctx: ExtensionCommandContext): void {
  const detection = detectSkillSources();
  if (detection.candidates.length === 0 && detection.staleWired.length === 0) {
    ctx.ui.notify(
      "No external skill directories detected under ~/.claude, ~/.codex, or ~/.cursor.",
      "info",
    );
    return;
  }

  const lines = [
    `sf-pi external skill sources (settings: ${detection.settingsPath}):`,
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
  const detection = detectSkillSources();
  const wired = detection.candidates.filter((c) => c.wired).length;
  const available = detection.candidates.length - wired;
  const lines = [
    "sf-pi external skill sources status",
    "",
    `Settings file:        ${detection.settingsPath}`,
    `Detected roots:       ${detection.candidates.length}`,
    `  wired:              ${wired}`,
    `  available (opt in): ${available}`,
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
  const detection = detectSkillSources();
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
    updateSkillSources({ add: [resolved.settingsPath], remove: [] });
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
  const detection = detectSkillSources();
  const resolved = resolveTarget(detection.candidates, target);
  // Fall back to removing the raw user input — lets users unlink entries
  // we don't recognize (e.g. arbitrary paths they added manually).
  const removeValue = resolved ? resolved.settingsPath : target;
  try {
    updateSkillSources({ add: [], remove: [removeValue] });
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
