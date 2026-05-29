/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pure model for the Skill Funnel view.
 *
 * The component is a thin Focusable wrapper; everything testable lives here:
 *   - funnelCounts: the narrowing strip numbers
 *   - per-tab row folds over the SkillCatalog (no logic, just filtering)
 *   - the staging reducer (stable keys + a human summary)
 *
 * No I/O, no rendering — just data shaping over a SkillCatalog snapshot.
 */
import type { CatalogConflict, CatalogSkill, CatalogSource, SkillCatalog } from "../catalog.ts";
import type { FunnelAction, FunnelTab } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Funnel strip
// -------------------------------------------------------------------------------------------------

export interface FunnelCounts {
  catalog: number;
  seen: number;
  global: number;
  project: number;
  effective: number;
  conflicts: number;
}

export function funnelCounts(catalog: SkillCatalog): FunnelCounts {
  const skills = catalog.skills;
  return {
    catalog: skills.length,
    seen: skills.filter((s) => s.seen).length,
    global: skills.filter((s) => s.enabledGlobal).length,
    project: skills.filter((s) => s.enabledProject).length,
    effective: skills.filter((s) => s.effective === "loaded").length,
    conflicts: catalog.conflicts.length,
  };
}

// -------------------------------------------------------------------------------------------------
// Per-tab row folds
// -------------------------------------------------------------------------------------------------

/** Catalog tab: every copy, sorted by the catalog's deterministic order. */
export function catalogRows(catalog: SkillCatalog): CatalogSkill[] {
  return catalog.skills;
}

/** Sources tab: every known root. */
export function sourceRows(catalog: SkillCatalog): CatalogSource[] {
  return catalog.sources;
}

/**
 * Global/Project tab: the seen skills the per-scope Skill Gate governs.
 * Gated-off copies are excluded — you gate the source first on the Sources
 * tab, so the skill-gate tabs only show candidates Pi could actually load.
 */
export function skillGateRows(catalog: SkillCatalog): CatalogSkill[] {
  return catalog.skills.filter((s) => s.seen);
}

/** Conflicts tab. */
export function conflictRows(catalog: SkillCatalog): CatalogConflict[] {
  return catalog.conflicts;
}

// -------------------------------------------------------------------------------------------------
// Staging
// -------------------------------------------------------------------------------------------------

/**
 * Stable key for a staged action so toggling the same decision twice is a
 * cancel (remove from the staging map), not a duplicate.
 */
export function stageKey(action: FunnelAction): string {
  switch (action.kind) {
    case "skill-gate":
      return `skill|${action.scope}|${action.skillPath}`;
    case "source-gate":
      return `source|${action.scope}|${action.sourceId}`;
    case "conflict-winner":
      return `winner|${action.name}`;
    case "add-source":
      return `add|${action.scope}|${action.value}`;
  }
}

/** Human pending summary, e.g. "+2 enable · 1 disable · 1 winner · 1 source". */
export function describePending(actions: FunnelAction[]): string {
  let enable = 0;
  let disable = 0;
  let winner = 0;
  let source = 0;
  let add = 0;
  for (const a of actions) {
    if (a.kind === "skill-gate") {
      if (a.enable) enable++;
      else disable++;
    } else if (a.kind === "conflict-winner") winner++;
    else if (a.kind === "source-gate") source++;
    else if (a.kind === "add-source") add++;
  }
  const parts: string[] = [];
  if (enable) parts.push(`+${enable} enable`);
  if (disable) parts.push(`${disable} disable`);
  if (winner) parts.push(`${winner} winner`);
  if (source) parts.push(`${source} source`);
  if (add) parts.push(`${add} add`);
  return parts.length > 0 ? parts.join(" · ") : "no pending changes";
}

// -------------------------------------------------------------------------------------------------
// Tab metadata
// -------------------------------------------------------------------------------------------------

export const FUNNEL_TABS: Array<{ id: FunnelTab; label: string }> = [
  { id: "catalog", label: "Catalog" },
  { id: "sources", label: "Sources" },
  { id: "global", label: "Global" },
  { id: "project", label: "Project" },
  { id: "conflicts", label: "Conflicts" },
];

export function tabCount(catalog: SkillCatalog, tab: FunnelTab): number {
  switch (tab) {
    case "catalog":
      return catalog.skills.length;
    case "sources":
      return catalog.sources.length;
    case "global":
    case "project":
      return skillGateRows(catalog).length;
    case "conflicts":
      return catalog.conflicts.length;
  }
}
