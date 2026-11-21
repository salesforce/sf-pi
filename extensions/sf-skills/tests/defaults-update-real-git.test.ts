/* SPDX-License-Identifier: Apache-2.0 */
/**
 * defaults update against real git repositories (no network).
 *
 * A fake spawn can't reproduce the failures that matter here: a shallow clone
 * whose upstream rewrote history, and a project-scope update looking for a
 * per-project clone that install never creates. Each test builds a local
 * "upstream" repo, clones it the way install does, and runs updateDefaults.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { updateDefaults } from "../lib/defaults.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();
}

function writeSkill(root: string, description: string): void {
  mkdirSync(path.join(root, "skills", "demo"), { recursive: true });
  writeFileSync(
    path.join(root, "skills", "demo", "SKILL.md"),
    `---\nname: demo\ndescription: ${description}\n---\n`,
  );
}

/** An upstream repo and a managed shallow clone of it, as install leaves them. */
function setup(): { home: string; upstream: string; clone: string } {
  const home = tempDir("sf-skills-home-");
  process.env.HOME = home;
  const upstream = tempDir("sf-skills-upstream-");
  git(upstream, "init", "-q", "-b", "main");
  writeSkill(upstream, "v1");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-qm", "v1");
  const clone = path.join(home, ".pi", "agent", "sf-skills", "forcedotcom");
  mkdirSync(path.dirname(clone), { recursive: true });
  git(path.dirname(clone), "clone", "-q", "--depth", "1", `file://${upstream}`, clone);
  writeFileSync(path.join(clone, ".sf-skills-managed"), "managed\n");
  return { home, upstream, clone };
}

function rewriteUpstreamHistory(upstream: string, description: string): void {
  git(upstream, "checkout", "-q", "--orphan", "rewrite");
  writeSkill(upstream, description);
  git(upstream, "add", "-A");
  git(upstream, "commit", "-qm", "squashed history");
  git(upstream, "branch", "-qM", "rewrite", "main");
}

const effectiveSkill = (home: string) =>
  readFileSync(
    path.join(home, ".pi", "agent", "sf-skills", "effective", "skills", "demo", "SKILL.md"),
    "utf8",
  );

describe("updateDefaults with real git", () => {
  it("project scope updates the shared global clone and wires the project (A)", async () => {
    const { home, upstream } = setup();
    const cwd = tempDir("sf-skills-cwd-");
    writeSkill(upstream, "v2");
    git(upstream, "commit", "-qam", "v2");

    const result = await updateDefaults({ scope: "project", cwd });

    expect(result.message).not.toMatch(/No managed forcedotcom\/sf-skills clone found/);
    expect(result.ok).toBe(true);
    expect(result.clone.rootPath).toBe(path.join(home, ".pi", "agent", "sf-skills", "forcedotcom"));
    expect(effectiveSkill(home)).toContain("description: v2");
    const projectSettings = JSON.parse(
      readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"),
    );
    expect(projectSettings.skills).toContain("~/.pi/agent/sf-skills/effective/skills");
    expect(existsSync(path.join(cwd, ".pi", "sf-skills", "forcedotcom"))).toBe(false);
  });

  it("moves a shallow clone to upstream after a history rewrite (B)", async () => {
    const { home, upstream, clone } = setup();
    rewriteUpstreamHistory(upstream, "v2 after rewrite");

    const result = await updateDefaults({ scope: "global" });

    expect(result.message).not.toMatch(/fast-forward/);
    expect(result.ok).toBe(true);
    expect(git(clone, "rev-parse", "HEAD")).toBe(git(upstream, "rev-parse", "HEAD"));
    expect(git(clone, "rev-parse", "--is-shallow-repository")).toBe("true");
    expect(existsSync(path.join(clone, ".sf-skills-managed"))).toBe(true);
    expect(effectiveSkill(home)).toContain("description: v2 after rewrite");
  });

  it("refuses to overwrite hand edits to tracked files in the managed clone (B)", async () => {
    const { upstream, clone } = setup();
    rewriteUpstreamHistory(upstream, "v2 after rewrite");
    writeFileSync(path.join(clone, "skills", "demo", "SKILL.md"), "edited by hand\n");

    const result = await updateDefaults({ scope: "global" });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/local changes/i);
    expect(result.message).toContain("skills/demo/SKILL.md");
    expect(readFileSync(path.join(clone, "skills", "demo", "SKILL.md"), "utf8")).toBe(
      "edited by hand\n",
    );
  });
});
