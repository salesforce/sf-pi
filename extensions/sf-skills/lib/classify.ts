/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Skill classification helpers.
 *
 * Two cheap, deterministic rules — no SKILL.md frontmatter reads on
 * panel open:
 *
 *   isSalesforce(skill) = name starts with `sf-` OR path is under our
 *                          managed afv-library clone.
 *
 *   sourceCategory(skill) = "afv-library" | "bundled" | "wired" | "auto"
 *
 * "wired" means pi loaded the skill via a `settings.skills[]` entry the
 * user added (Claude / Codex / Cursor / a linked checkout). "auto" means
 * pi auto-discovered it (`~/.pi/agent/skills/...`, `<cwd>/.pi/skills/...`,
 * `<cwd>/.agents/skills/...`).
 */
import path from "node:path";
import { managedClonePath } from "./defaults.ts";

export type SourceCategory = "afv-library" | "bundled" | "wired" | "auto";

export interface ClassifyContext {
  /** Resolved SKILL.md path or skill directory path. */
  skillPath: string;
  /** Optional skill name (for the sf-* prefix check). */
  name?: string;
  /** Working directory used to resolve project-managed clone paths. */
  cwd: string;
  /** Settings-wired skill roots (already resolved to absolute paths). */
  wiredAbsolutePaths?: ReadonlySet<string>;
}

/** True when a skill is part of the Salesforce-curated set. */
export function isSalesforceSkill(input: {
  name?: string;
  skillPath: string;
  cwd: string;
}): boolean {
  if (input.name && input.name.startsWith("sf-")) return true;
  const managedRoots = [managedClonePath("global"), safeProjectManagedClonePath(input.cwd)].filter(
    (p): p is string => typeof p === "string",
  );
  const normalized = path.normalize(input.skillPath);
  return managedRoots.some((root) => normalized.startsWith(`${path.normalize(root)}${path.sep}`));
}

/**
 * Decide where the skill came from. Cheap and deterministic — no I/O.
 *
 * Order matters:
 *   1. afv-library managed clone (global or project)
 *   2. Bundled (under any extensions/sf-<id>/skills/ shipped with sf-pi)
 *   3. Settings-wired (path resolved from settings.skills[])
 *   4. Auto-discovered (default)
 */
export function sourceCategory(ctx: ClassifyContext): SourceCategory {
  const normalized = path.normalize(ctx.skillPath);

  for (const scope of ["global", "project"] as const) {
    const root =
      scope === "project" ? safeProjectManagedClonePath(ctx.cwd) : managedClonePath("global");
    if (root && normalized.startsWith(`${path.normalize(root)}${path.sep}`)) {
      return "afv-library";
    }
  }

  if (isBundledSkillPath(normalized)) return "bundled";

  if (ctx.wiredAbsolutePaths) {
    for (const wired of ctx.wiredAbsolutePaths) {
      const resolvedWired = path.normalize(wired);
      if (normalized === resolvedWired || normalized.startsWith(`${resolvedWired}${path.sep}`)) {
        return "wired";
      }
    }
  }

  return "auto";
}

/**
 * Build the wired absolute-path set from the live settings files.
 * Cheap to call once per panel open.
 */
export function readWiredAbsolutePaths(args: {
  globalSettings: Record<string, unknown>;
  projectSettings: Record<string, unknown> | null;
  homeDir: string;
  cwd: string;
}): Set<string> {
  const result = new Set<string>();
  collectInto(result, args.globalSettings, args.homeDir, args.homeDir);
  if (args.projectSettings) collectInto(result, args.projectSettings, args.cwd, args.homeDir);
  return result;
}

// -------------------------------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------------------------------

function collectInto(
  out: Set<string>,
  settings: Record<string, unknown>,
  baseDir: string,
  homeDir: string,
): void {
  const skills = Array.isArray(settings.skills) ? settings.skills : [];
  for (const value of skills) {
    if (typeof value !== "string") continue;
    const expanded = expandSkillsValue(value, baseDir, homeDir);
    if (!expanded) continue;
    out.add(path.normalize(expanded));
  }
}

function expandSkillsValue(value: string, baseDir: string, homeDir: string): string | null {
  if (!value) return null;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  if (value === "~") return homeDir;
  if (path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

/**
 * Detect skills that ship with an sf-pi extension package.
 *
 * Heuristic: the path includes a segment matching `extensions/<id>/skills/`
 * where `<id>` is anything starting with `sf-`. This intentionally does
 * not enumerate the package layout — sf-pi may add or rename extensions
 * over time and the heuristic stays correct.
 */
function isBundledSkillPath(normalized: string): boolean {
  return /[\\/]extensions[\\/]sf-[^\\/]+[\\/]skills[\\/]/.test(normalized);
}

function safeProjectManagedClonePath(cwd: string): string | undefined {
  try {
    return managedClonePath("project", cwd);
  } catch {
    return undefined;
  }
}
