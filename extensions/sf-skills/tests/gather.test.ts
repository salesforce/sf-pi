/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gatherer assembly tests. The gatherer is the impure bridge; here we inject
 * fake loadSkills / loadSkillsFromDir / getCommands and use temp dirs so we
 * can assert it assembles a correct SkillCatalogInput (sources, gates,
 * loadedPaths, collisions) without a live Pi runtime.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gatherCatalogInput, type GatherDeps } from "../lib/gather.ts";
import { upsertSource } from "../../../lib/common/skill-sources/source-registry.ts";

const tempDirs: string[] = [];
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[AGENT_DIR_ENV];

function tmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(root: string, name: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  writeFileSync(file, `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`);
  return file;
}

/** Minimal fake loadSkillsFromDir that scans <dir>/<name>/SKILL.md fixtures. */
function fakeDeps(over: Partial<GatherDeps> = {}): GatherDeps {
  return {
    loadSkills: vi.fn(() => ({
      skills: [],
      diagnostics: [],
    })) as unknown as GatherDeps["loadSkills"],
    loadSkillsFromDir: (({ dir }: { dir: string }) => {
      const skills: Array<{ name: string; filePath: string; description?: string }> = [];
      try {
        for (const name of readdirSync(dir)) {
          const file = path.join(dir, name, "SKILL.md");
          if (existsSync(file)) {
            skills.push({ name, filePath: file, description: `${name} skill` });
          }
        }
      } catch {
        /* missing dir */
      }
      return { skills, diagnostics: [] };
    }) as unknown as GatherDeps["loadSkillsFromDir"],
    getCommands: () => [],
    loadUsage: () => new Map(),
    ...over,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (originalAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
  else process.env[AGENT_DIR_ENV] = originalAgentDir;
});

describe("gatherCatalogInput", () => {
  it("scans a wired custom dir and marks it seen + carries settings coverage", () => {
    const home = tmp("sf-gather-home-");
    const cwd = tmp("sf-gather-cwd-");
    const agentDir = path.join(home, ".pi", "agent");
    process.env[AGENT_DIR_ENV] = agentDir;

    // A custom skills root wired into global settings as a directory.
    const customRoot = path.join(home, "my-skills");
    writeSkill(customRoot, "alpha");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ skills: [customRoot] }));

    const alphaFile = path.join(customRoot, "alpha", "SKILL.md");
    const input = gatherCatalogInput({
      cwd,
      deps: fakeDeps({
        loadSkills: (() => ({
          skills: [{ name: "alpha", filePath: alphaFile }],
          diagnostics: [],
        })) as unknown as GatherDeps["loadSkills"],
        getCommands: () => [
          {
            name: "skill:alpha",
            description: "",
            source: "skill",
            sourceInfo: { path: alphaFile, source: "path", scope: "user", origin: "top-level" },
          },
        ],
      }),
    });

    const customSource = input.sources.find((s) => s.rootPath === path.normalize(customRoot));
    expect(customSource).toBeDefined();
    expect(customSource!.gate).toBe("seen");
    expect(customSource!.skills.map((s) => s.name)).toContain("alpha");
    expect(input.loadedPaths).toContain(path.normalize(alphaFile));
    expect(
      input.settingsGlobal.some((e) => e.absPath === path.normalize(customRoot) && e.isDir),
    ).toBe(true);
  });

  it("remembers a seen-but-empty registered custom source and gates it seen", () => {
    const home = tmp("sf-gather-home-");
    const cwd = tmp("sf-gather-cwd-");
    process.env[AGENT_DIR_ENV] = path.join(home, ".pi", "agent");

    const customRoot = path.join(home, "team-skills");
    writeSkill(customRoot, "beta");
    upsertSource("global", { value: customRoot, kind: "custom", gate: "seen", label: "Team" });

    const input = gatherCatalogInput({ cwd, deps: fakeDeps() });
    const src = input.sources.find((s) => s.rootPath === path.normalize(customRoot));
    expect(src).toBeDefined();
    expect(src!.gate).toBe("seen");
    expect(src!.kind).toBe("custom");
    expect(src!.skills.map((s) => s.name)).toContain("beta");
  });

  it("passes loadSkills collisions through verbatim", () => {
    const home = tmp("sf-gather-home-");
    const cwd = tmp("sf-gather-cwd-");
    process.env[AGENT_DIR_ENV] = path.join(home, ".pi", "agent");

    const input = gatherCatalogInput({
      cwd,
      deps: fakeDeps({
        loadSkills: (() => ({
          skills: [{ name: "dup", filePath: "/a/dup/SKILL.md" }],
          diagnostics: [
            {
              type: "collision",
              message: 'name "dup" collision',
              collision: {
                resourceType: "skill",
                name: "dup",
                winnerPath: "/a/dup/SKILL.md",
                loserPath: "/b/dup/SKILL.md",
              },
            },
          ],
        })) as unknown as GatherDeps["loadSkills"],
      }),
    });
    expect(input.collisions).toEqual([
      { name: "dup", winnerPath: "/a/dup/SKILL.md", loserPath: "/b/dup/SKILL.md" },
    ]);
  });
});
