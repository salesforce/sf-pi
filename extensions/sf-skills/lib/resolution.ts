/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolution Policy — compiles Skill Funnel decisions into native
 * `settings.skills[]` operations (Compiled Skill Resolution).
 *
 * This is the funnel-facing planner. It reuses the proven coverage math in
 * `settings-coverage.ts` (exact / parent-expand-minus-one / none) for the
 * mechanical add/remove, and layers the funnel's honest limits on top using
 * the catalog's tags:
 *
 *   - Disabling a skill at project scope while it is enabled globally is
 *     impossible natively (project settings only add) → `blocked:"locked-by-global"`
 *     (ADR-0017).
 *   - Disabling an auto-discovered default skill is impossible without moving
 *     files → `blocked:"auto-default"`.
 *   - Resolving a conflict where any copy lives in an auto-default root is a
 *     Report-Only Conflict → `blocked:"report-only-conflict"`.
 *
 * Every successful plan is a set of `settings.skills[]` add/remove ops the
 * caller applies via the shared `updateSkillSources` writer, then reloads.
 * This module never writes; it only plans.
 */
import { planDisable, planEnable } from "./settings-coverage.ts";
import type { CatalogConflict, CatalogSkill } from "./catalog.ts";
import type { SkillSourceScope } from "../../../lib/common/skill-sources/skill-sources.ts";

// -------------------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------------------

export type BlockedReason =
  | "locked-by-global"
  | "auto-default"
  | "report-only-conflict"
  | "not-wired"
  | "already-enabled";

export interface ScopeOps {
  scope: SkillSourceScope;
  add: string[];
  remove: string[];
}

export interface SettingsPlan {
  /** Per-scope add/remove. Empty when nothing to do or when blocked. */
  ops: ScopeOps[];
  /** Set when the funnel cannot express this decision natively. */
  blocked?: BlockedReason;
  /** Human note explaining a no-op or a block. */
  note?: string;
  /** Parent dir(s) expanded into per-file entries to exclude a skill. */
  expandedFrom?: string[];
}

export interface SkillGateInput {
  skill: CatalogSkill;
  enable: boolean;
  scope: SkillSourceScope;
  cwd: string;
  home?: string;
}

export interface ConflictWinnerInput {
  conflict: CatalogConflict;
  /** Absolute path of the copy to keep. */
  winnerPath: string;
  cwd: string;
  home?: string;
}

// -------------------------------------------------------------------------------------------------
// Skill Gate
// -------------------------------------------------------------------------------------------------

/**
 * Plan a per-skill enable/disable at one scope. Honors the ADR-0017 limits:
 * project scope is additive-only, and auto-discovered defaults cannot be
 * disabled through settings.
 */
export function planSkillGate(input: SkillGateInput): SettingsPlan {
  const { skill, enable, scope } = input;

  if (enable) {
    const plan = planEnable({ skillPath: skill.filePath, scope, cwd: input.cwd, home: input.home });
    if (plan.alreadyCovered) {
      return {
        ops: [],
        blocked: "already-enabled",
        note:
          plan.coveredInScope && plan.coveredInScope !== scope
            ? `Already loaded via ${plan.coveredInScope} settings.`
            : "Already enabled in this scope.",
      };
    }
    return { ops: [{ scope, add: plan.add, remove: [] }] };
  }

  // Disable path — the honest limits live here.
  if (skill.autoDefault) {
    return {
      ops: [],
      blocked: "auto-default",
      note: "Auto-discovered default skills always load. Move or remove the file to disable it.",
    };
  }
  if (scope === "project" && skill.enabledGlobal) {
    return {
      ops: [],
      blocked: "locked-by-global",
      note: "Enabled globally — project settings can only add. Disable it at global scope, or enable narrowly instead.",
    };
  }

  const plan = planDisable({ skillPath: skill.filePath, scope, cwd: input.cwd, home: input.home });
  if (plan.coverage === "none") {
    return {
      ops: [],
      blocked: "not-wired",
      note: "Not wired in this scope; nothing to disable.",
    };
  }
  return {
    ops: [{ scope, add: plan.add, remove: plan.remove }],
    expandedFrom: plan.expandedFrom ? [plan.expandedFrom] : undefined,
  };
}

// -------------------------------------------------------------------------------------------------
// Conflict winner
// -------------------------------------------------------------------------------------------------

/**
 * Plan a conflict resolution by exclusion: keep the winner wired and drop
 * every other copy so the collision disappears. Report-Only conflicts (a
 * copy in an auto-default root) cannot be resolved through settings.
 */
export function planConflictWinner(input: ConflictWinnerInput): SettingsPlan {
  const { conflict, winnerPath } = input;

  if (conflict.kind === "report-only") {
    return {
      ops: [],
      blocked: "report-only-conflict",
      note: "A copy lives in an auto-discovered default root, which always wins. Move or remove that file to change the winner.",
    };
  }

  const opsByScope = new Map<SkillSourceScope, ScopeOps>();
  const expandedFrom: string[] = [];
  const pushOp = (scope: SkillSourceScope, add: string[], remove: string[]) => {
    const existing = opsByScope.get(scope) ?? { scope, add: [], remove: [] };
    existing.add.push(...add);
    existing.remove.push(...remove);
    opsByScope.set(scope, existing);
  };

  // Exclude every non-winner copy from whichever scope currently covers it.
  const losers = conflict.copies.filter((c) => c.filePath !== winnerPath);
  for (const loser of losers) {
    for (const scope of ["global", "project"] as SkillSourceScope[]) {
      const plan = planDisable({
        skillPath: loser.filePath,
        scope,
        cwd: input.cwd,
        home: input.home,
      });
      if (plan.coverage === "none") continue;
      pushOp(scope, plan.add, plan.remove);
      if (plan.expandedFrom) expandedFrom.push(plan.expandedFrom);
    }
  }

  // Ensure the winner is wired somewhere. Prefer global; skip if already covered.
  const winnerEnable = planEnable({
    skillPath: winnerPath,
    scope: "global",
    cwd: input.cwd,
    home: input.home,
  });
  if (!winnerEnable.alreadyCovered) {
    pushOp("global", winnerEnable.add, []);
  }

  const ops = [...opsByScope.values()].filter((o) => o.add.length > 0 || o.remove.length > 0);
  if (ops.length === 0) {
    return { ops: [], note: "Winner already exclusive — nothing to change." };
  }
  return { ops, expandedFrom: expandedFrom.length > 0 ? expandedFrom : undefined };
}
