/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Consented file-level conflict resolution tests (ADR-0018).
 *
 * Disable / quarantine / delete operate on the "skill unit" (the dir for a
 * SKILL.md, the file for a loose .md) and stop Pi from discovering the loser.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyFileAction,
  deleteSkill,
  disableInPlace,
  quarantine,
  skillUnit,
} from "../lib/conflict-actions.ts";

const tempDirs: string[] = [];
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[AGENT_DIR_ENV];

function makeRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-ca-"));
  tempDirs.push(dir);
  process.env[AGENT_DIR_ENV] = path.join(dir, ".pi", "agent");
  return dir;
}

function writeSkillDir(root: string, name: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  writeFileSync(file, `---\nname: ${name}\ndescription: ${name}\n---\n`);
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (originalAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
  else process.env[AGENT_DIR_ENV] = originalAgentDir;
});

describe("skillUnit", () => {
  it("maps a SKILL.md to its directory and a loose .md to the file", () => {
    expect(skillUnit("/x/foo/SKILL.md")).toEqual({ unitPath: "/x/foo", isDir: true });
    expect(skillUnit("/x/bar.md")).toEqual({ unitPath: "/x/bar.md", isDir: false });
  });
});

describe("disableInPlace", () => {
  it("renames SKILL.md so Pi no longer discovers the skill, reversibly", () => {
    const root = makeRoot();
    const file = writeSkillDir(root, "dup");
    const result = disableInPlace(file);
    expect(result.ok).toBe(true);
    expect(existsSync(file)).toBe(false); // SKILL.md gone
    expect(existsSync(`${file}.disabled`)).toBe(true); // preserved, undiscoverable
    expect(existsSync(path.join(root, "dup"))).toBe(true); // dir still there
  });
});

describe("quarantine", () => {
  it("moves the skill dir out to the quarantine location", () => {
    const root = makeRoot();
    const file = writeSkillDir(root, "dup");
    const result = quarantine(file);
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(root, "dup"))).toBe(false); // moved out of discovery
    expect(result.to).toBeDefined();
    expect(existsSync(path.join(result.to!, "SKILL.md"))).toBe(true); // preserved
  });
});

describe("deleteSkill", () => {
  it("removes the skill dir entirely", () => {
    const root = makeRoot();
    const file = writeSkillDir(root, "dup");
    const result = deleteSkill(file);
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(root, "dup"))).toBe(false);
  });
});

describe("applyFileAction", () => {
  it("applies one op across multiple losers and groups quarantine under one stamp", () => {
    const root = makeRoot();
    const a = writeSkillDir(root, "a");
    const b = writeSkillDir(root, "b");
    const results = applyFileAction("quarantine", [a, b]);
    expect(results.every((r) => r.ok)).toBe(true);
    // Both moved into the same timestamped quarantine dir.
    const dests = results.map((r) => path.dirname(r.to!));
    expect(new Set(dests).size).toBe(1);
    expect(readdirSync(dests[0]).sort()).toEqual(["a", "b"]);
  });

  it("reports a failure for a missing path without throwing", () => {
    const results = applyFileAction("disable", ["/no/such/skill/SKILL.md"]);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toBeTruthy();
  });
});
