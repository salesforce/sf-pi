/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Consented file-level conflict resolution.
 *
 * Compiled Skill Resolution (resolution.ts) clears conflicts by rewiring
 * `settings.skills[]` and never touches files. But a Report-Only Conflict —
 * where a colliding copy lives in an auto-discovered default root that always
 * wins — cannot be fixed that way. The only lever is to stop Pi from
 * *discovering* the losing copy, which means a filesystem action.
 *
 * This module performs those actions, but ONLY on an explicit, per-conflict
 * user choice surfaced through the funnel (never automatically). See ADR-0018.
 *
 * "Skill unit" rule: a skill is either a directory containing `SKILL.md` or a
 * loose root-level `<name>.md`. Disable/move/delete operate on the *unit*:
 *   - `<dir>/SKILL.md`  → act on `<dir>`
 *   - `<root>/<name>.md` → act on the `.md` file only (never the root)
 */
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

export type FileActionOp = "disable" | "quarantine" | "delete";

export interface FileActionResult {
  op: FileActionOp;
  /** The skill unit that was acted on (dir or loose .md). */
  from: string;
  /** Where it went (disable/quarantine); undefined for delete. */
  to?: string;
  ok: boolean;
  error?: string;
}

/** Resolve a skill's SKILL.md (or loose .md) path to the unit we act on. */
export function skillUnit(filePath: string): { unitPath: string; isDir: boolean } {
  const base = path.basename(filePath).toLowerCase();
  if (base === "skill.md") {
    return { unitPath: path.dirname(filePath), isDir: true };
  }
  return { unitPath: filePath, isDir: false };
}

/**
 * Disable a copy in place by renaming it out of Pi's discovery:
 *   - dir unit  → `<dir>` stays, `<dir>/SKILL.md` → `<dir>/SKILL.md.disabled`
 *   - file unit → `<name>.md` → `<name>.md.disabled`
 * Reversible: rename back. Returns the new path in `to`.
 */
export function disableInPlace(filePath: string): FileActionResult {
  const unit = skillUnit(filePath);
  try {
    if (unit.isDir) {
      const target = `${filePath}.disabled`;
      renameSync(filePath, uniquePath(target));
      return { op: "disable", from: filePath, to: target, ok: true };
    }
    const target = `${unit.unitPath}.disabled`;
    renameSync(unit.unitPath, uniquePath(target));
    return { op: "disable", from: unit.unitPath, to: target, ok: true };
  } catch (error) {
    return { op: "disable", from: unit.unitPath, ok: false, error: errMsg(error) };
  }
}

/**
 * Move the skill unit into a timestamped quarantine dir outside any discovery
 * root. Reversible by moving it back. Reuses the doctor's quarantine location.
 */
export function quarantine(filePath: string, stamp = timestamp()): FileActionResult {
  const unit = skillUnit(filePath);
  const dir = globalAgentPath("skills-quarantine", stamp);
  try {
    mkdirSync(dir, { recursive: true });
    const dest = uniquePath(path.join(dir, path.basename(unit.unitPath)));
    renameSync(unit.unitPath, dest);
    return { op: "quarantine", from: unit.unitPath, to: dest, ok: true };
  } catch (error) {
    return { op: "quarantine", from: unit.unitPath, ok: false, error: errMsg(error) };
  }
}

/** Permanently delete the skill unit. Irreversible — callers must double-confirm. */
export function deleteSkill(filePath: string): FileActionResult {
  const unit = skillUnit(filePath);
  try {
    rmSync(unit.unitPath, { recursive: true, force: true });
    return { op: "delete", from: unit.unitPath, ok: true };
  } catch (error) {
    return { op: "delete", from: unit.unitPath, ok: false, error: errMsg(error) };
  }
}

/** Apply one op to a set of loser paths. Pure dispatch over the three ops. */
export function applyFileAction(op: FileActionOp, loserPaths: string[]): FileActionResult[] {
  const stamp = timestamp();
  return loserPaths.map((p) => {
    switch (op) {
      case "disable":
        return disableInPlace(p);
      case "quarantine":
        return quarantine(p, stamp);
      case "delete":
        return deleteSkill(p);
    }
  });
}

// -------------------------------------------------------------------------------------------------
// Internal
// -------------------------------------------------------------------------------------------------

function uniquePath(target: string): string {
  if (!existsSync(target)) return target;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${target}.${i}`;
    if (!existsSync(candidate)) return candidate;
  }
  return `${target}.${Date.now()}`;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Re-exported for symmetry / tests. */
export function isExistingPath(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
