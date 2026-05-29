/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Skill Catalog derivation tests.
 *
 * buildSkillCatalog is pure — these feed plain fixture inputs (no fs, no
 * mocks) and assert the five funnel tags plus conflict classification.
 * This is where the funnel's *meaning* is pinned.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  buildSkillCatalog,
  type CatalogSourceInput,
  type ResolvedSettingsEntry,
  type SkillCatalogInput,
} from "../lib/catalog.ts";

const ROOT = path.sep === "\\" ? "C:\\sk" : "/sk";
const p = (...parts: string[]) => path.join(ROOT, ...parts);

function source(
  over: Partial<CatalogSourceInput> & { id: string; rootPath: string },
): CatalogSourceInput {
  return {
    kind: "custom",
    label: over.id,
    gate: "seen",
    autoDefault: false,
    skills: [],
    ...over,
  };
}

function dirEntry(absPath: string): ResolvedSettingsEntry {
  return { raw: absPath, absPath, isDir: true };
}
function fileEntry(absPath: string): ResolvedSettingsEntry {
  return { raw: absPath, absPath, isDir: false };
}

function baseInput(over: Partial<SkillCatalogInput>): SkillCatalogInput {
  return {
    cwd: ROOT,
    sources: [],
    loadedPaths: [],
    winners: [],
    collisions: [],
    settingsGlobal: [],
    settingsProject: [],
    ...over,
  };
}

describe("funnel tags", () => {
  it("tags a wired, loaded skill as seen + enabledGlobal + effective:loaded", () => {
    const file = p("claude", "skills", "alpha", "SKILL.md");
    const catalog = buildSkillCatalog(
      baseInput({
        sources: [
          source({
            id: "~/.claude/skills",
            rootPath: p("claude", "skills"),
            kind: "harness",
            skills: [{ name: "alpha", filePath: file }],
          }),
        ],
        loadedPaths: [file],
        winners: [{ name: "alpha", filePath: file }],
        settingsGlobal: [dirEntry(p("claude", "skills"))],
      }),
    );
    const alpha = catalog.skills.find((s) => s.name === "alpha")!;
    expect(alpha).toMatchObject({
      seen: true,
      enabledGlobal: true,
      enabledProject: false,
      effective: "loaded",
      conflictRole: "none",
      loadedByPi: true,
    });
    expect(catalog.conflicts).toHaveLength(0);
  });

  it("project-scope coverage tags enabledProject independently of global", () => {
    const file = p("team", "skills", "beta", "SKILL.md");
    const catalog = buildSkillCatalog(
      baseInput({
        sources: [
          source({
            id: "./team",
            rootPath: p("team", "skills"),
            skills: [{ name: "beta", filePath: file }],
          }),
        ],
        loadedPaths: [file],
        settingsProject: [fileEntry(file)],
      }),
    );
    const beta = catalog.skills.find((s) => s.name === "beta")!;
    expect(beta.enabledGlobal).toBe(false);
    expect(beta.enabledProject).toBe(true);
    expect(beta.effective).toBe("loaded");
  });

  it("a seen but unwired skill is gated-out (not loaded, no sibling loaded)", () => {
    const file = p("claude", "skills", "gamma", "SKILL.md");
    const catalog = buildSkillCatalog(
      baseInput({
        sources: [
          source({
            id: "~/.claude/skills",
            rootPath: p("claude", "skills"),
            skills: [{ name: "gamma", filePath: file }],
          }),
        ],
        // not wired, not loaded
      }),
    );
    const gamma = catalog.skills.find((s) => s.name === "gamma")!;
    expect(gamma).toMatchObject({ seen: true, enabledGlobal: false, effective: "gated-out" });
  });

  it("a gated-off source still appears in the catalog as seen:false / gated-out", () => {
    const file = p("claude", "skills", "delta", "SKILL.md");
    const catalog = buildSkillCatalog(
      baseInput({
        sources: [
          source({
            id: "~/.claude/skills",
            rootPath: p("claude", "skills"),
            gate: "off",
            skills: [{ name: "delta", filePath: file }],
          }),
        ],
      }),
    );
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0]).toMatchObject({
      seen: false,
      effective: "gated-out",
      conflictRole: "none",
    });
  });
});

describe("conflict classification", () => {
  it("resolvable conflict: two wired copies, winner loaded, loser shadowed", () => {
    const claude = p("claude", "skills", "dup", "SKILL.md");
    const afv = p("afv", "skills", "dup", "SKILL.md");
    const catalog = buildSkillCatalog(
      baseInput({
        sources: [
          source({
            id: "~/.claude/skills",
            rootPath: p("claude", "skills"),
            kind: "harness",
            skills: [{ name: "dup", filePath: claude }],
          }),
          source({
            id: "afv",
            rootPath: p("afv", "skills"),
            kind: "managed",
            skills: [{ name: "dup", filePath: afv }],
          }),
        ],
        loadedPaths: [claude],
        winners: [{ name: "dup", filePath: claude }],
        collisions: [{ name: "dup", winnerPath: claude, loserPath: afv }],
      }),
    );
    expect(catalog.conflicts).toHaveLength(1);
    const conflict = catalog.conflicts[0];
    expect(conflict.kind).toBe("resolvable");
    expect(conflict.winner?.filePath).toBe(claude);
    expect(conflict.losers.map((l) => l.filePath)).toEqual([afv]);

    const claudeRow = catalog.skills.find((s) => s.filePath === claude)!;
    const afvRow = catalog.skills.find((s) => s.filePath === afv)!;
    expect(claudeRow.conflictRole).toBe("winner");
    expect(claudeRow.effective).toBe("loaded");
    expect(afvRow.conflictRole).toBe("loser");
    expect(afvRow.effective).toBe("shadowed");
  });

  it("report-only conflict: a copy under an auto-default root makes it report-only", () => {
    const def = p("pi", "agent", "skills", "dup", "SKILL.md");
    const claude = p("claude", "skills", "dup", "SKILL.md");
    const catalog = buildSkillCatalog(
      baseInput({
        sources: [
          source({
            id: "default",
            rootPath: p("pi", "agent", "skills"),
            kind: "auto-default",
            autoDefault: true,
            skills: [{ name: "dup", filePath: def }],
          }),
          source({
            id: "~/.claude/skills",
            rootPath: p("claude", "skills"),
            kind: "harness",
            skills: [{ name: "dup", filePath: claude }],
          }),
        ],
        loadedPaths: [def],
        winners: [{ name: "dup", filePath: def }],
        collisions: [{ name: "dup", winnerPath: def, loserPath: claude }],
      }),
    );
    expect(catalog.conflicts[0].kind).toBe("report-only");
    const claudeRow = catalog.skills.find((s) => s.filePath === claude)!;
    expect(claudeRow.conflictRole).toBe("report-only-loser");
    expect(claudeRow.effective).toBe("shadowed");
  });

  it("counts a collision as a conflict even when the loser's source is gate-off", () => {
    // Mirrors the real bug: afv (seen) vs ~/.claude (gate-off in our model)
    // but pi loaded both and reported the collision. Must still be a conflict.
    const afv = p("afv", "skills", "dup", "SKILL.md");
    const claude = p("claude", "skills", "dup", "SKILL.md");
    const catalog = buildSkillCatalog(
      baseInput({
        sources: [
          source({
            id: "afv",
            rootPath: p("afv", "skills"),
            kind: "managed",
            skills: [{ name: "dup", filePath: afv }],
          }),
          source({
            id: "~/.claude/skills",
            rootPath: p("claude", "skills"),
            kind: "harness",
            gate: "off",
            skills: [{ name: "dup", filePath: claude }],
          }),
        ],
        loadedPaths: [afv],
        winners: [{ name: "dup", filePath: afv }],
        collisions: [{ name: "dup", winnerPath: afv, loserPath: claude }],
      }),
    );
    expect(catalog.conflicts).toHaveLength(1);
    expect(catalog.conflicts[0].kind).toBe("resolvable");
    const claudeRow = catalog.skills.find((s) => s.filePath === claude)!;
    expect(claudeRow.conflictRole).toBe("loser");
    expect(claudeRow.effective).toBe("shadowed");
  });

  it("surfaces a collision loser even when its root was not scanned", () => {
    const claude = p("claude", "skills", "dup", "SKILL.md");
    const ghost = p("somewhere", "else", "dup", "SKILL.md");
    const catalog = buildSkillCatalog(
      baseInput({
        sources: [
          source({
            id: "~/.claude/skills",
            rootPath: p("claude", "skills"),
            skills: [{ name: "dup", filePath: claude }],
          }),
        ],
        loadedPaths: [claude],
        winners: [{ name: "dup", filePath: claude }],
        collisions: [{ name: "dup", winnerPath: claude, loserPath: ghost }],
      }),
    );
    expect(catalog.skills.some((s) => s.filePath === ghost)).toBe(true);
    expect(catalog.conflicts).toHaveLength(1);
  });
});

describe("source rollups + usage", () => {
  it("counts loaded/shadowed per source and attaches usage by name", () => {
    const a = p("claude", "skills", "a", "SKILL.md");
    const b = p("claude", "skills", "b", "SKILL.md");
    const catalog = buildSkillCatalog(
      baseInput({
        sources: [
          source({
            id: "~/.claude/skills",
            rootPath: p("claude", "skills"),
            kind: "harness",
            skills: [
              { name: "a", filePath: a },
              { name: "b", filePath: b },
            ],
          }),
        ],
        loadedPaths: [a],
        settingsGlobal: [dirEntry(p("claude", "skills"))],
        usage: { a: { count: 5, lastUsedAt: "2026-01-01" } },
      }),
    );
    const src = catalog.sources[0];
    expect(src.counts.total).toBe(2);
    expect(src.counts.loaded).toBe(1);
    expect(catalog.skills.find((s) => s.name === "a")!.usage).toEqual({
      count: 5,
      lastUsedAt: "2026-01-01",
    });
  });
});
