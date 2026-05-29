/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolution Policy tests — funnel decisions compiled to settings.skills[]
 * ops, including the ADR-0017 blocked cases and conflict exclusion.
 *
 * These use real temp settings files (settings-coverage reads them) plus
 * synthetic CatalogSkill rows for the funnel flags.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planConflictWinner, planConsolidateScopes, planSkillGate } from "../lib/resolution.ts";
import type { CatalogConflict, CatalogSkill, SkillCatalog } from "../lib/catalog.ts";

const tempDirs: string[] = [];
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[AGENT_DIR_ENV];

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-res-home-"));
  tempDirs.push(dir);
  // settings-coverage reads global settings from getAgentDir() (env-backed),
  // not from the `home` param — point it at a throwaway agent dir.
  process.env[AGENT_DIR_ENV] = path.join(dir, ".pi", "agent");
  return dir;
}

/** Write a global settings.json under the active fake agent dir. */
function writeGlobalSettings(home: string, skills: string[]): void {
  const dir = path.join(home, ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ skills }, null, 2));
}

function writeProjectSettings(cwd: string, skills: string[]): void {
  const dir = path.join(cwd, ".pi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ skills }, null, 2));
}

function skillRow(over: Partial<CatalogSkill> & { filePath: string }): CatalogSkill {
  return {
    name: "x",
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

function makeProjectDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-res-proj-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (originalAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
  else process.env[AGENT_DIR_ENV] = originalAgentDir;
});

describe("planSkillGate enable", () => {
  it("plans an add when not yet wired", () => {
    const home = makeHome();
    writeGlobalSettings(home, []);
    const file = path.join(home, ".claude", "skills", "alpha", "SKILL.md");
    const plan = planSkillGate({
      skill: skillRow({ filePath: file }),
      enable: true,
      scope: "global",
      cwd: home,
      home,
    });
    expect(plan.blocked).toBeUndefined();
    expect(plan.ops).toEqual([{ scope: "global", add: [file], remove: [] }]);
  });

  it("is a no-op (already-enabled) when covered by a parent dir", () => {
    const home = makeHome();
    const root = path.join(home, ".claude", "skills");
    writeGlobalSettings(home, [root]);
    mkdirSync(path.join(root, "alpha"), { recursive: true });
    writeFileSync(path.join(root, "alpha", "SKILL.md"), "x");
    const file = path.join(root, "alpha", "SKILL.md");
    const plan = planSkillGate({
      skill: skillRow({ filePath: file }),
      enable: true,
      scope: "global",
      cwd: home,
      home,
    });
    expect(plan.blocked).toBe("already-enabled");
    expect(plan.ops).toEqual([]);
  });
});

describe("planSkillGate disable — ADR-0017 limits", () => {
  it("blocks disabling an auto-default skill", () => {
    const home = makeHome();
    writeGlobalSettings(home, []);
    const file = path.join(home, ".pi", "agent", "skills", "alpha", "SKILL.md");
    const plan = planSkillGate({
      skill: skillRow({ filePath: file, autoDefault: true, enabledGlobal: false }),
      enable: false,
      scope: "global",
      cwd: home,
      home,
    });
    expect(plan.blocked).toBe("auto-default");
  });

  it("blocks disabling at project scope when enabled globally (locked-by-global)", () => {
    const home = makeHome();
    const project = makeProjectDir();
    const root = path.join(home, ".claude", "skills");
    writeGlobalSettings(home, [root]);
    writeProjectSettings(project, []);
    const file = path.join(root, "alpha", "SKILL.md");
    const plan = planSkillGate({
      skill: skillRow({ filePath: file, enabledGlobal: true }),
      enable: false,
      scope: "project",
      cwd: project,
      home,
    });
    expect(plan.blocked).toBe("locked-by-global");
  });

  it("expands a parent dir minus-one when disabling a globally-wired skill", () => {
    const home = makeHome();
    const root = path.join(home, ".claude", "skills");
    writeGlobalSettings(home, [root]);
    for (const name of ["alpha", "beta", "gamma"]) {
      mkdirSync(path.join(root, name), { recursive: true });
      writeFileSync(path.join(root, name, "SKILL.md"), "x");
    }
    const file = path.join(root, "beta", "SKILL.md");
    const plan = planSkillGate({
      skill: skillRow({ filePath: file, enabledGlobal: true }),
      enable: false,
      scope: "global",
      cwd: home,
      home,
    });
    expect(plan.blocked).toBeUndefined();
    expect(plan.ops[0].remove).toEqual([root]);
    expect(plan.ops[0].add.sort()).toEqual(
      [path.join(root, "alpha", "SKILL.md"), path.join(root, "gamma", "SKILL.md")].sort(),
    );
    expect(plan.expandedFrom).toEqual([root]);
  });

  it("reports not-wired when the skill isn't covered in the scope", () => {
    const home = makeHome();
    writeGlobalSettings(home, []);
    const file = path.join(home, ".claude", "skills", "alpha", "SKILL.md");
    const plan = planSkillGate({
      skill: skillRow({ filePath: file }),
      enable: false,
      scope: "global",
      cwd: home,
      home,
    });
    expect(plan.blocked).toBe("not-wired");
  });
});

describe("planConflictWinner", () => {
  function conflict(over: Partial<CatalogConflict> & { copies: CatalogSkill[] }): CatalogConflict {
    return { name: "dup", kind: "resolvable", losers: [], winner: undefined, ...over };
  }

  it("blocks report-only conflicts", () => {
    const plan = planConflictWinner({
      conflict: conflict({ kind: "report-only", copies: [] }),
      winnerPath: "/whatever",
      cwd: "/tmp",
    });
    expect(plan.blocked).toBe("report-only-conflict");
  });

  it("excludes the losing copy by expanding its wired parent dir", () => {
    const home = makeHome();
    const claudeRoot = path.join(home, ".claude", "skills");
    const afvRoot = path.join(home, "afv", "skills");
    // Both roots wired as dirs; each has the dup plus a sibling so expansion has something to keep.
    writeGlobalSettings(home, [claudeRoot, afvRoot]);
    for (const [root, names] of [
      [claudeRoot, ["dup", "other"]],
      [afvRoot, ["dup", "extra"]],
    ] as const) {
      for (const n of names) {
        mkdirSync(path.join(root, n), { recursive: true });
        writeFileSync(path.join(root, n, "SKILL.md"), "x");
      }
    }
    const claudeDup = path.join(claudeRoot, "dup", "SKILL.md");
    const afvDup = path.join(afvRoot, "dup", "SKILL.md");
    const copies = [
      skillRow({ name: "dup", filePath: claudeDup, enabledGlobal: true, conflictRole: "winner" }),
      skillRow({ name: "dup", filePath: afvDup, enabledGlobal: true, conflictRole: "loser" }),
    ];
    const plan = planConflictWinner({
      conflict: conflict({ copies, winner: copies[0] }),
      winnerPath: claudeDup,
      cwd: home,
      home,
    });
    expect(plan.blocked).toBeUndefined();
    const globalOps = plan.ops.find((o) => o.scope === "global")!;
    // The afv parent dir is expanded; the afv dup copy is excluded.
    expect(globalOps.remove).toContain(afvRoot);
    expect(globalOps.add).toContain(path.join(afvRoot, "extra", "SKILL.md"));
    expect(globalOps.add).not.toContain(afvDup);
    // The claude (winner) root is untouched.
    expect(globalOps.remove).not.toContain(claudeRoot);
  });
});

describe("planConsolidateScopes", () => {
  function catalogOf(skills: CatalogSkill[]): SkillCatalog {
    return { skills, conflicts: [], sources: [] };
  }

  it("drops the non-kept scope for skills wired in both global and project", () => {
    const home = makeHome();
    const project = makeProjectDir();
    const globalAfv = path.join(home, "afv", "skills");
    const projectAfv = path.join(project, ".pi", "sf-skills", "afv-library", "skills");
    // afv wired as a dir in BOTH scopes; each has the dup skill + a sibling.
    writeGlobalSettings(home, [globalAfv]);
    writeProjectSettings(project, [projectAfv]);
    for (const [root, names] of [
      [globalAfv, ["dup", "g-extra"]],
      [projectAfv, ["dup", "p-extra"]],
    ] as const) {
      for (const n of names) {
        mkdirSync(path.join(root, n), { recursive: true });
        writeFileSync(path.join(root, n, "SKILL.md"), "x");
      }
    }
    const gDup = path.join(globalAfv, "dup", "SKILL.md");
    const pDup = path.join(projectAfv, "dup", "SKILL.md");
    const catalog = catalogOf([
      skillRow({ name: "dup", filePath: gDup, enabledGlobal: true }),
      skillRow({ name: "dup", filePath: pDup, enabledProject: true }),
    ]);

    const plan = planConsolidateScopes({ catalog, keepScope: "project", cwd: project, home });
    expect(plan.affected).toBe(1);
    // Only the global scope is touched; project wiring is kept.
    const globalOp = plan.ops.find((o) => o.scope === "global");
    expect(globalOp).toBeDefined();
    expect(globalOp!.remove).toContain(globalAfv); // expanded-minus-one
    expect(globalOp!.add).toContain(path.join(globalAfv, "g-extra", "SKILL.md"));
    expect(globalOp!.add).not.toContain(gDup);
    expect(plan.ops.find((o) => o.scope === "project")).toBeUndefined();
  });

  it("is a no-op when nothing is wired in both scopes", () => {
    const home = makeHome();
    const project = makeProjectDir();
    writeGlobalSettings(home, []);
    writeProjectSettings(project, []);
    const catalog = catalogOf([
      skillRow({ name: "a", filePath: path.join(home, "x", "a", "SKILL.md"), enabledGlobal: true }),
      skillRow({
        name: "b",
        filePath: path.join(project, "y", "b", "SKILL.md"),
        enabledProject: true,
      }),
    ]);
    const plan = planConsolidateScopes({ catalog, keepScope: "project", cwd: project, home });
    expect(plan.affected).toBe(0);
    expect(plan.ops).toEqual([]);
  });
});
