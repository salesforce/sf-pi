/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Source Registry round-trip tests.
 *
 * The registry exists for exactly one reason: a source that is "seen" but
 * has zero enabled skills leaves no settings.skills[] trace and would be
 * forgotten on reload. These tests pin that durability across scopes plus
 * the small CRUD surface (upsert/remove/gate), and confirm the canonical
 * on-disk layout.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findSource,
  readSourceRegistry,
  removeSource,
  setSourceGate,
  sourceId,
  sourceRegistryStore,
  upsertSource,
} from "../../../lib/common/skill-sources/source-registry.ts";

const tempDirs: string[] = [];
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[AGENT_DIR_ENV];

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-reg-home-"));
  tempDirs.push(dir);
  // Pi's getAgentDir() honors PI_CODING_AGENT_DIR — point the global state
  // store at a throwaway dir so tests never touch the real agent dir.
  process.env[AGENT_DIR_ENV] = path.join(dir, ".pi", "agent");
  return dir;
}

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-reg-proj-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (originalAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
  else process.env[AGENT_DIR_ENV] = originalAgentDir;
});

describe("sourceId", () => {
  it("normalizes trailing slashes and whitespace into a stable id", () => {
    expect(sourceId("~/.claude/skills/")).toBe("~/.claude/skills");
    expect(sourceId("  ~/.claude/skills  ")).toBe("~/.claude/skills");
    expect(sourceId("~/.claude/skills")).toBe(sourceId("~/.claude/skills/"));
  });
});

describe("global scope", () => {
  it("remembers a seen-but-empty custom source across reads", () => {
    makeHome();
    upsertSource("global", {
      value: "~/work/my-skills",
      kind: "custom",
      gate: "seen",
      label: "My skills",
    });

    // Simulate a reload: a fresh read with no in-memory state.
    const reloaded = readSourceRegistry("global");
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({
      id: "~/work/my-skills",
      value: "~/work/my-skills",
      kind: "custom",
      gate: "seen",
      label: "My skills",
    });
  });

  it("upsert merges into an existing entry without losing the label", () => {
    makeHome();
    upsertSource("global", { value: "~/work/my-skills", kind: "custom", label: "My skills" });
    upsertSource("global", { value: "~/work/my-skills", gate: "off" });

    const sources = readSourceRegistry("global");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ gate: "off", label: "My skills", kind: "custom" });
  });

  it("setSourceGate flips only the gate and is a no-op for unknown ids", () => {
    makeHome();
    upsertSource("global", { value: "~/.claude/skills", kind: "harness", gate: "seen" });
    setSourceGate("global", "~/.claude/skills", "off");
    expect(findSource("global", "~/.claude/skills")?.gate).toBe("off");

    setSourceGate("global", "~/does/not/exist", "off");
    expect(readSourceRegistry("global")).toHaveLength(1);
  });

  it("removeSource drops the entry by value or id", () => {
    makeHome();
    upsertSource("global", { value: "~/work/a", kind: "custom" });
    upsertSource("global", { value: "~/work/b", kind: "custom" });
    removeSource("global", "~/work/a/");
    const remaining = readSourceRegistry("global");
    expect(remaining.map((s) => s.id)).toEqual(["~/work/b"]);
  });
});

describe("project scope", () => {
  it("keeps project sources isolated from global and writes under .pi/sf-skills", () => {
    makeHome();
    const project = makeProject();

    upsertSource("global", { value: "~/work/global-only", kind: "custom" });
    upsertSource("project", { value: "./.team/skills", kind: "custom" }, project);

    expect(readSourceRegistry("global").map((s) => s.id)).toEqual(["~/work/global-only"]);
    expect(readSourceRegistry("project", project).map((s) => s.id)).toEqual(["./.team/skills"]);

    // Canonical project layout.
    const store = sourceRegistryStore("project", project);
    expect(store.path).toBe(path.join(project, ".pi", "sf-skills", "sources.json"));
  });

  it("throws when project scope is used without cwd", () => {
    expect(() => sourceRegistryStore("project")).toThrow(/requires cwd/);
  });
});

describe("tolerant reads", () => {
  it("returns an empty list when nothing has been written yet", () => {
    makeHome();
    expect(readSourceRegistry("global")).toEqual([]);
  });
});
