/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the skill-sources detector + settings writer.
 *
 * Covers disk detection across ~/.claude, ~/.codex, ~/.cursor, the
 * wired-vs-available cross-reference with ~/.pi/agent/settings.json,
 * and the idempotent add/remove semantics of updateSkillSources().
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectSkillSources,
  updateSkillSources,
} from "../../../lib/common/skill-sources/skill-sources.ts";
import { parseSkillsArgs } from "../lib/skill-sources-command.ts";

const originalHome = process.env.HOME;
const tempDirs: string[] = [];

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skill-sources-home-"));
  tempDirs.push(dir);
  return dir;
}

function writeSettings(home: string, body: Record<string, unknown>): string {
  const filePath = path.join(home, ".pi", "agent", "settings.json");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return filePath;
}

function readSettings(home: string): Record<string, unknown> {
  const filePath = path.join(home, ".pi", "agent", "settings.json");
  return JSON.parse(readFileSync(filePath, "utf8"));
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("detectSkillSources", () => {
  it("returns no candidates when no external roots exist", () => {
    const home = makeHome();
    process.env.HOME = home;

    const result = detectSkillSources(home);
    expect(result.candidates).toEqual([]);
    expect(result.staleWired).toEqual([]);
  });

  it("detects Claude, Codex, and Cursor roots with skill counts", () => {
    const home = makeHome();
    process.env.HOME = home;

    // Claude: two dir-based skills, one loose .md
    mkdirSync(path.join(home, ".claude", "skills", "skill-one"), { recursive: true });
    writeFileSync(path.join(home, ".claude", "skills", "skill-one", "SKILL.md"), "---\n");
    mkdirSync(path.join(home, ".claude", "skills", "skill-two"), { recursive: true });
    writeFileSync(path.join(home, ".claude", "skills", "skill-two", "SKILL.md"), "---\n");
    writeFileSync(path.join(home, ".claude", "skills", "loose.md"), "# loose skill\n");

    // Codex: empty dir (still counts as a candidate, zero skills)
    mkdirSync(path.join(home, ".codex", "skills"), { recursive: true });

    // No Cursor dir on purpose

    const result = detectSkillSources(home);
    const labels = result.candidates.map((c) => c.label);
    expect(labels).toEqual(["Claude Code", "OpenAI Codex"]);

    const claude = result.candidates.find((c) => c.label === "Claude Code")!;
    expect(claude.skillCount).toBe(3);
    expect(claude.settingsPath).toBe("~/.claude/skills");
    expect(claude.wired).toBe(false);
  });

  it("flags a root as wired when settings.skills contains the ~-prefixed path", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(path.join(home, ".claude", "skills"), { recursive: true });
    writeSettings(home, { skills: ["~/.claude/skills"] });

    const result = detectSkillSources(home);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.wired).toBe(true);
  });

  it("matches wired entries across path shapes (absolute vs ~)", () => {
    // User wrote the absolute form in settings but we detect via ~
    // conventions. The cross-form comparison must still flag this as wired.
    const home = makeHome();
    process.env.HOME = home;
    const absoluteClaude = path.join(home, ".claude", "skills");
    mkdirSync(absoluteClaude, { recursive: true });
    writeSettings(home, { skills: [absoluteClaude] });

    const result = detectSkillSources(home);
    expect(result.candidates[0]!.wired).toBe(true);
  });

  it("reports stale wired entries whose paths no longer exist", () => {
    const home = makeHome();
    process.env.HOME = home;
    writeSettings(home, { skills: ["~/.claude/skills", "~/some/missing/dir"] });

    const result = detectSkillSources(home);
    expect(result.staleWired).toContain("~/.claude/skills");
    expect(result.staleWired).toContain("~/some/missing/dir");
  });
});

describe("updateSkillSources", () => {
  it("appends new skills paths to an existing settings file", () => {
    const home = makeHome();
    process.env.HOME = home;
    writeSettings(home, { packages: ["npm:pi-web-access"], skills: ["~/.existing/skills"] });

    const updated = updateSkillSources({ add: ["~/.claude/skills"], remove: [], home });
    expect(updated.skills).toEqual(["~/.existing/skills", "~/.claude/skills"]);

    const disk = readSettings(home);
    expect(disk.skills).toEqual(["~/.existing/skills", "~/.claude/skills"]);
    expect(disk.packages).toEqual(["npm:pi-web-access"]);
  });

  it("creates the settings file when none exists", () => {
    const home = makeHome();
    process.env.HOME = home;

    const updated = updateSkillSources({ add: ["~/.claude/skills"], remove: [], home });
    expect(updated.skills).toEqual(["~/.claude/skills"]);

    const disk = readSettings(home);
    expect(disk).toEqual({ skills: ["~/.claude/skills"] });
  });

  it("is idempotent when adding a path already present", () => {
    const home = makeHome();
    process.env.HOME = home;
    const filePath = writeSettings(home, { skills: ["~/.claude/skills"] });
    const mtimeBefore = readFileSync(filePath, "utf8");

    updateSkillSources({ add: ["~/.claude/skills"], remove: [], home });

    const mtimeAfter = readFileSync(filePath, "utf8");
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it("removes an entry matched by its raw value", () => {
    const home = makeHome();
    process.env.HOME = home;
    writeSettings(home, { skills: ["~/.claude/skills", "~/.codex/skills"] });

    updateSkillSources({ add: [], remove: ["~/.claude/skills"], home });

    const disk = readSettings(home);
    expect(disk.skills).toEqual(["~/.codex/skills"]);
  });

  it("removes an entry matched by resolved absolute path", () => {
    // Users can pass the absolute form; we should still drop the ~ variant
    // from settings to avoid leaving a duplicate behind.
    const home = makeHome();
    process.env.HOME = home;
    writeSettings(home, { skills: ["~/.claude/skills"] });

    const absolute = path.join(home, ".claude", "skills");
    updateSkillSources({ add: [], remove: [absolute], home });

    const disk = readSettings(home);
    expect(disk.skills).toEqual([]);
  });
});

describe("parseSkillsArgs", () => {
  it("maps empty input to overlay", () => {
    expect(parseSkillsArgs("")).toEqual({ subcommand: "overlay" });
  });

  it("recognizes list / status / link / unlink", () => {
    expect(parseSkillsArgs("list").subcommand).toBe("list");
    expect(parseSkillsArgs("ls").subcommand).toBe("list");
    expect(parseSkillsArgs("status").subcommand).toBe("status");
    expect(parseSkillsArgs("link ~/.claude/skills")).toEqual({
      subcommand: "link",
      target: "~/.claude/skills",
    });
    expect(parseSkillsArgs("unlink Claude Code")).toEqual({
      subcommand: "unlink",
      target: "Claude Code",
    });
    expect(parseSkillsArgs("rm ~/.codex/skills")).toEqual({
      subcommand: "unlink",
      target: "~/.codex/skills",
    });
  });

  it("falls back to overlay for unknown subcommands", () => {
    expect(parseSkillsArgs("frobnicate")).toEqual({ subcommand: "overlay" });
  });
});
