/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pure funnel-view model tests: the narrowing strip counts, per-tab folds,
 * staging keys (toggle = cancel), and the pending summary.
 */
import { describe, expect, it } from "vitest";
import type { SkillCatalog, CatalogSkill } from "../lib/catalog.ts";
import {
  conflictRows,
  describePending,
  funnelCounts,
  skillGateRows,
  stageKey,
  tabCount,
} from "../lib/funnel-view/model.ts";
import type { FunnelAction } from "../lib/funnel-view/types.ts";

function skill(over: Partial<CatalogSkill> & { name: string; filePath: string }): CatalogSkill {
  return {
    description: undefined,
    sourceId: "s",
    sourceLabel: "s",
    sourceKind: "harness",
    autoDefault: false,
    seen: true,
    enabledGlobal: false,
    enabledProject: false,
    effective: "gated-out",
    conflictRole: "none",
    loadedByPi: false,
    ...over,
  };
}

const catalog: SkillCatalog = {
  skills: [
    skill({ name: "a", filePath: "/x/a", seen: true, enabledGlobal: true, effective: "loaded" }),
    skill({ name: "b", filePath: "/x/b", seen: true, enabledProject: true, effective: "loaded" }),
    skill({ name: "c", filePath: "/x/c", seen: true, effective: "gated-out" }),
    skill({ name: "d", filePath: "/y/d", seen: false, effective: "gated-out" }),
  ],
  conflicts: [{ name: "dup", kind: "resolvable", winner: undefined, losers: [], copies: [] }],
  sources: [
    {
      id: "s1",
      label: "s1",
      rootPath: "/x",
      kind: "harness",
      gate: "seen",
      autoDefault: false,
      counts: {
        total: 3,
        loaded: 2,
        shadowed: 0,
        gatedOut: 1,
        conflictWinners: 0,
        conflictLosers: 0,
      },
    },
  ],
};

describe("funnelCounts", () => {
  it("computes the narrowing strip", () => {
    expect(funnelCounts(catalog)).toEqual({
      catalog: 4,
      seen: 3,
      global: 1,
      project: 1,
      effective: 2,
      conflicts: 1,
    });
  });
});

describe("per-tab folds", () => {
  it("skill-gate tabs only show seen skills; catalog shows all", () => {
    expect(skillGateRows(catalog).map((s) => s.name)).toEqual(["a", "b", "c"]);
    expect(tabCount(catalog, "catalog")).toBe(4);
    expect(tabCount(catalog, "global")).toBe(3);
    expect(tabCount(catalog, "conflicts")).toBe(1);
    expect(conflictRows(catalog)).toHaveLength(1);
  });
});

describe("staging", () => {
  it("derives stable keys so toggling twice cancels", () => {
    const enable: FunnelAction = {
      kind: "skill-gate",
      name: "a",
      skillPath: "/x/a",
      scope: "global",
      enable: true,
    };
    const disable: FunnelAction = {
      kind: "skill-gate",
      name: "a",
      skillPath: "/x/a",
      scope: "global",
      enable: false,
    };
    // Same scope+path → same key regardless of enable direction (re-press cancels).
    expect(stageKey(enable)).toBe(stageKey(disable));
    // Different scope → different key.
    expect(stageKey({ ...enable, scope: "project" })).not.toBe(stageKey(enable));
  });

  it("summarizes pending actions", () => {
    const actions: FunnelAction[] = [
      { kind: "skill-gate", name: "a", skillPath: "/x/a", scope: "global", enable: true },
      { kind: "skill-gate", name: "b", skillPath: "/x/b", scope: "global", enable: true },
      { kind: "skill-gate", name: "c", skillPath: "/x/c", scope: "global", enable: false },
      { kind: "conflict-winner", name: "dup", winnerPath: "/x/dup" },
      { kind: "add-source", value: "~/work/s", scope: "global" },
    ];
    expect(describePending(actions)).toBe("+2 enable · 1 disable · 1 winner · 1 add");
    expect(describePending([])).toBe("no pending changes");
  });
});
