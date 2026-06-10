/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Cleanup helpers for `/sf-skills prune`.
 *
 * Two categories of cruft we surface:
 *
 *   stale wired entries — paths in settings.skills[] that no longer
 *                          exist on disk (renamed dir, deleted clone,
 *                          checkout moved, etc.). Already reported by
 *                          detectSkillSources(); this module just
 *                          formats + applies removals.
 *
 *   orphan managed clones — directories under the managed clone root
 *                          (`<globalAgentDir>/sf-skills/` or
 *                          `<cwd>/.pi/sf-skills/`) that are no longer
 *                          referenced from any settings.skills[] entry.
 *                          We only delete dirs that carry our sentinel
 *                          file — never user-owned trees.
 *
 * Dry-run is the default; --apply actually mutates. Each side is
 * independently optional so the caller can preview both, apply both,
 * or one at a time.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import {
  detectSkillSources,
  updateSkillSources,
  type SkillSourceScope,
} from "../../../lib/common/skill-sources/skill-sources.ts";
import { managedClonePath } from "./defaults.ts";

const SENTINEL_FILE = ".sf-skills-managed";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export interface PrunePlan {
  staleWired: string[];
  orphanManagedDirs: Array<{ scope: SkillSourceScope; absolutePath: string }>;
}

export interface PruneOutcome {
  staleRemoved: number;
  dirsDeleted: number;
  errors: string[];
}

// -------------------------------------------------------------------------------------------------
// Read-side: build the plan
// -------------------------------------------------------------------------------------------------

export function buildPrunePlan(cwd: string, options: { includeProject?: boolean } = {}): PrunePlan {
  const includeProject = options.includeProject !== false;
  const detection = detectSkillSources({ cwd, includeProject });
  const staleWired = detection.staleWired;
  const orphanManagedDirs: PrunePlan["orphanManagedDirs"] = [];

  const scopes: SkillSourceScope[] = includeProject ? ["global", "project"] : ["global"];
  for (const scope of scopes) {
    const root = safeManagedRoot(scope, cwd);
    if (!root) continue;
    const parent = path.dirname(root); // <agentDir>/sf-skills/  or  <cwd>/.pi/sf-skills/
    if (!isDirectory(parent)) continue;
    for (const entry of readdirSafe(parent)) {
      const dirPath = path.join(parent, entry);
      if (!isDirectory(dirPath)) continue;
      if (!existsSync(path.join(dirPath, SENTINEL_FILE))) continue;
      // Sentinel-marked dir. Orphan iff the corresponding skills/ subdir
      // is NOT referenced by any included settings entry (verbatim or by absolute path).
      const skillsDir = path.join(dirPath, "skills");
      const referenced = isReferencedInSettings(skillsDir, cwd, { includeProject });
      if (!referenced) {
        orphanManagedDirs.push({ scope, absolutePath: dirPath });
      }
    }
  }

  return { staleWired, orphanManagedDirs };
}

// -------------------------------------------------------------------------------------------------
// Write-side: apply the plan
// -------------------------------------------------------------------------------------------------

export function applyPrunePlan(
  plan: PrunePlan,
  cwd: string,
  options: { removeStale: boolean; deleteOrphans: boolean; includeProject?: boolean },
): PruneOutcome {
  const includeProject = options.includeProject !== false;
  const outcome: PruneOutcome = { staleRemoved: 0, dirsDeleted: 0, errors: [] };

  if (options.removeStale && plan.staleWired.length > 0) {
    // Stale entries can live in either included settings file. Remove from
    // global and, when trusted, project; updateSkillSources is idempotent so
    // calling on a settings file that doesn't contain the value is harmless.
    const scopes: SkillSourceScope[] = includeProject ? ["global", "project"] : ["global"];
    for (const scope of scopes) {
      try {
        updateSkillSources({
          add: [],
          remove: plan.staleWired,
          scope,
          cwd,
        });
      } catch (err) {
        outcome.errors.push(
          `remove-stale (${scope}) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    outcome.staleRemoved = plan.staleWired.length;
  }

  if (options.deleteOrphans) {
    for (const orphan of plan.orphanManagedDirs) {
      if (orphan.scope === "project" && !includeProject) continue;
      try {
        rmSync(orphan.absolutePath, { recursive: true, force: true });
        outcome.dirsDeleted += 1;
      } catch (err) {
        outcome.errors.push(
          `delete ${orphan.absolutePath} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return outcome;
}

// -------------------------------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------------------------------

function safeManagedRoot(scope: SkillSourceScope, cwd: string): string | undefined {
  try {
    return managedClonePath(scope, cwd);
  } catch {
    return undefined;
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readdirSafe(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

function isReferencedInSettings(
  absolutePath: string,
  cwd: string,
  options: { includeProject: boolean },
): boolean {
  // detectSkillSources only looks at known external roots (Claude/Codex/Cursor).
  // For managed clones we want to check the raw settings.skills[] arrays
  // ourselves so we catch absolute, ~/, and ./-prefixed forms uniformly.
  const detection = detectSkillSources({ cwd, includeProject: options.includeProject });
  const normalizedTarget = path.normalize(absolutePath);
  for (const settingsPath of [detection.settingsPath, detection.projectSettingsPath]) {
    if (!settingsPath) continue;
    const skills = readSkillsArray(settingsPath);
    for (const value of skills) {
      const expanded = expandSkillsValue(value, settingsPath, cwd);
      if (!expanded) continue;
      const normalized = path.normalize(expanded);
      if (normalized === normalizedTarget) return true;
      if (normalized.startsWith(`${normalizedTarget}${path.sep}`)) return true;
      if (normalizedTarget.startsWith(`${normalized}${path.sep}`)) return true;
    }
  }
  return false;
}

function readSkillsArray(settingsPath: string): string[] {
  if (!existsSync(settingsPath)) return [];
  try {
    // Avoid pulling in the skill-sources internal helpers — just read
    // the file directly. Reads are cheap and only happen on prune.
    const raw = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").readFileSync(settingsPath, "utf8"),
    );
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const skills = (raw as Record<string, unknown>).skills;
    return Array.isArray(skills) ? skills.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function expandSkillsValue(value: string, settingsPath: string, cwd: string): string | null {
  if (!value) return null;
  if (value.startsWith("~/")) return path.join(process.env.HOME ?? "", value.slice(2));
  if (value === "~") return process.env.HOME ?? null;
  if (path.isAbsolute(value)) return value;
  // Project settings live at <cwd>/.pi/settings.json — relative entries resolve against cwd.
  // Global settings resolve against $HOME.
  const isProjectSettings = settingsPath.includes(`${path.sep}.pi${path.sep}settings.json`);
  return path.resolve(isProjectSettings ? cwd : (process.env.HOME ?? ""), value);
}

// Touched only to keep `globalAgentPath` import live for future reference;
// the helper itself is used by callers via state-store / pi-paths.
void globalAgentPath;
