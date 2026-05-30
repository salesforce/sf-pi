/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Targeted tests for the welcome-screen sf-skills status helper.
 *
 * Covers the three layers of detection independently so a regression in any
 * one of them produces a precise failure message rather than a tangled
 * "everything broke" surface:
 *
 *   1. readLocalGitHead     — pure FS, supports loose + packed refs
 *   2. countSkillsInDir     — pure FS, counts SKILL.md-bearing dirs
 *   3. detectLinkedAfvCheckout / detectInstallStateLocal
 *                           — wires settings.json + sentinel into a single
 *                             status enum with documented precedence
 *   4. detectSfSkillsStatus — orchestrates a stubbed compare-API result
 *
 * The on-disk cache (read/writeCachedSfSkillsStatus) is exercised end-to-end
 * via PI_CODING_AGENT_DIR; the canonical state-store lives at
 *   <agentDir>/sf-pi/sf-welcome/sf-skills-status.json
 * which is exactly what the splash will read on the next launch.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countSkillsInDir,
  detectInstallStateLocal,
  detectLinkedAfvCheckout,
  detectManagedSourceAvailabilityLocal,
  detectSfSkillsStatus,
  readCachedSfSkillsStatus,
  reconcileCachedSfSkillsStatus,
  readLocalGitHead,
  writeCachedSfSkillsStatus,
} from "../lib/sf-skills-status.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let homeDir: string;
let prevAgent: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  // PI_CODING_AGENT_DIR sandboxes globalAgentPath() — the managed clone path
  // and the cache file both live under this dir. HOME sandboxes ~/... in
  // settings.json so the wired-path check resolves inside the tmp tree
  // instead of the developer's real home.
  homeDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-skills-home-"));
  tmpDir = path.join(homeDir, ".pi", "agent");
  mkdirSync(tmpDir, { recursive: true });
  prevAgent = process.env[PI_AGENT_ENV];
  prevHome = process.env.HOME;
  process.env[PI_AGENT_ENV] = tmpDir;
  process.env.HOME = homeDir;
});

afterEach(() => {
  if (prevAgent === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgent;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  try {
    rmSync(homeDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ---------------------------------------------------------------------------
// readLocalGitHead
// ---------------------------------------------------------------------------

describe("readLocalGitHead", () => {
  it("reads a directly-stored SHA from .git/HEAD (detached HEAD)", () => {
    const repo = path.join(tmpDir, "repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    writeFileSync(path.join(repo, ".git", "HEAD"), "abc1234def567890abc1234def567890abc12345\n");
    expect(readLocalGitHead(repo)).toBe("abc1234def567890abc1234def567890abc12345");
  });

  it("resolves a symbolic ref via .git/refs/heads/<branch>", () => {
    const repo = path.join(tmpDir, "repo");
    mkdirSync(path.join(repo, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(
      path.join(repo, ".git", "refs", "heads", "main"),
      "deadbeef1234567890deadbeef1234567890dead\n",
    );
    expect(readLocalGitHead(repo)).toBe("deadbeef1234567890deadbeef1234567890dead");
  });

  it("falls back to packed-refs when the loose ref file is missing", () => {
    const repo = path.join(tmpDir, "repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(
      path.join(repo, ".git", "packed-refs"),
      "# pack-refs with: peeled fully-peeled sorted\n" +
        "feedface1234567890feedface1234567890feed refs/heads/main\n" +
        "babecafe1234567890babecafe1234567890babe refs/tags/v1\n",
    );
    expect(readLocalGitHead(repo)).toBe("feedface1234567890feedface1234567890feed");
  });

  it("returns undefined when .git/HEAD is missing", () => {
    expect(readLocalGitHead(path.join(tmpDir, "no-such-repo"))).toBeUndefined();
  });

  it("returns undefined for a malformed HEAD", () => {
    const repo = path.join(tmpDir, "bad-repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    writeFileSync(path.join(repo, ".git", "HEAD"), "this is not a valid HEAD line\n");
    expect(readLocalGitHead(repo)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// countSkillsInDir
// ---------------------------------------------------------------------------

describe("countSkillsInDir", () => {
  it("counts only direct subdirs that contain SKILL.md", () => {
    const skillsDir = path.join(tmpDir, "skills");
    mkdirSync(path.join(skillsDir, "alpha"), { recursive: true });
    writeFileSync(path.join(skillsDir, "alpha", "SKILL.md"), "# alpha\n");
    mkdirSync(path.join(skillsDir, "beta"), { recursive: true });
    writeFileSync(path.join(skillsDir, "beta", "SKILL.md"), "# beta\n");
    // Subdir without a SKILL.md is ignored.
    mkdirSync(path.join(skillsDir, "not-a-skill"), { recursive: true });
    // Top-level file is ignored.
    writeFileSync(path.join(skillsDir, "README.md"), "");
    expect(countSkillsInDir(skillsDir)).toBe(2);
  });

  it("returns undefined when the directory does not exist", () => {
    expect(countSkillsInDir(path.join(tmpDir, "nope"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// detectLinkedAfvCheckout — picks up user-owned wired checkouts only
// ---------------------------------------------------------------------------

describe("detectLinkedAfvCheckout", () => {
  it("returns null when no settings file exists", () => {
    expect(detectLinkedAfvCheckout(homeDir)).toBeNull();
  });

  it("returns the linked checkout when wired in global settings", () => {
    const checkout = path.join(homeDir, "work", "afv-library");
    mkdirSync(path.join(checkout, ".git"), { recursive: true });
    mkdirSync(path.join(checkout, "skills"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ skills: [path.join(checkout, "skills")] }),
    );
    const result = detectLinkedAfvCheckout(homeDir);
    expect(result).toEqual({
      rootPath: checkout,
      skillsPath: path.join(checkout, "skills"),
      scope: "global",
    });
  });

  it("skips a checkout that carries the .sf-skills-managed sentinel", () => {
    const checkout = path.join(homeDir, "managed-clone");
    mkdirSync(path.join(checkout, ".git"), { recursive: true });
    mkdirSync(path.join(checkout, "skills"), { recursive: true });
    writeFileSync(path.join(checkout, ".sf-skills-managed"), "managed\n");
    writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ skills: [path.join(checkout, "skills")] }),
    );
    expect(detectLinkedAfvCheckout(homeDir)).toBeNull();
  });

  it("ignores entries that don't end in /skills", () => {
    const checkout = path.join(homeDir, "weird-checkout");
    mkdirSync(path.join(checkout, ".git"), { recursive: true });
    mkdirSync(path.join(checkout, "skills"), { recursive: true });
    writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ skills: [checkout] }));
    expect(detectLinkedAfvCheckout(homeDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectInstallStateLocal — precedence: managed-global > managed-project > linked > none
// ---------------------------------------------------------------------------

describe("detectInstallStateLocal", () => {
  function createManagedGlobal(): { rootPath: string; skillsPath: string } {
    const rootPath = path.join(tmpDir, "sf-skills", "afv-library");
    const skillsPath = path.join(rootPath, "skills");
    mkdirSync(skillsPath, { recursive: true });
    mkdirSync(path.join(rootPath, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(path.join(rootPath, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(
      path.join(rootPath, ".git", "refs", "heads", "main"),
      "1111111111111111111111111111111111111111\n",
    );
    writeFileSync(path.join(rootPath, ".sf-skills-managed"), "managed\n");
    // Wire it in the global settings (absolute path so HOME-expansion isn't required).
    writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ skills: [skillsPath] }));
    return { rootPath, skillsPath };
  }

  it("reports managed when the global clone exists, has the sentinel, and is wired", () => {
    const { rootPath, skillsPath } = createManagedGlobal();
    const status = detectInstallStateLocal(homeDir);
    expect(status.installKind).toBe("managed");
    expect(status.scope).toBe("global");
    expect(status.rootPath).toBe(rootPath);
    expect(status.skillsPath).toBe(skillsPath);
    expect(status.localSha).toBe("1111111111111111111111111111111111111111");
    expect(status.wired).toBe(true);
    expect(status.freshness).toBe("unknown");
  });

  it("reports managed available when the global clone exists but is not wired", () => {
    const { rootPath, skillsPath } = createManagedGlobal();
    writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ skills: [] }));
    const status = detectInstallStateLocal(homeDir);
    expect(status.installKind).toBe("managed");
    expect(status.scope).toBe("global");
    expect(status.rootPath).toBe(rootPath);
    expect(status.skillsPath).toBe(skillsPath);
    expect(status.wired).toBe(false);
  });

  it("reports project-wired when the shared global clone is wired in project settings", () => {
    const { skillsPath } = createManagedGlobal();
    writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ skills: [] }));
    mkdirSync(path.join(homeDir, ".pi"), { recursive: true });
    writeFileSync(
      path.join(homeDir, ".pi", "settings.json"),
      JSON.stringify({ skills: [skillsPath] }),
    );
    const status = detectInstallStateLocal(homeDir);
    expect(status.installKind).toBe("managed");
    expect(status.scope).toBe("project");
    expect(status.wired).toBe(true);
  });

  it("recognizes a legacy project-local managed clone as available", () => {
    const rootPath = path.join(homeDir, ".pi", "sf-skills", "afv-library");
    const skillsPath = path.join(rootPath, "skills");
    mkdirSync(skillsPath, { recursive: true });
    writeFileSync(path.join(rootPath, ".sf-skills-managed"), "managed\n");
    const status = detectInstallStateLocal(homeDir);
    expect(status.installKind).toBe("managed");
    expect(status.scope).toBe("project");
    expect(status.rootPath).toBe(rootPath);
    expect(status.skillsPath).toBe(skillsPath);
    expect(status.wired).toBe(false);
  });

  it("startup availability probe omits git and skill-count fields", () => {
    const { rootPath, skillsPath } = createManagedGlobal();
    writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ skills: [] }));
    expect(detectManagedSourceAvailabilityLocal(homeDir)).toEqual({
      installKind: "managed",
      scope: "global",
      wired: false,
      rootPath,
      skillsPath,
      freshness: "unknown",
      loading: false,
    });
  });

  it("reconciles a stale not-installed cache with live managed availability", () => {
    const { rootPath, skillsPath } = createManagedGlobal();
    writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ skills: [] }));
    expect(
      reconcileCachedSfSkillsStatus(homeDir, {
        installKind: "not-installed",
        freshness: "unknown",
        loading: false,
      }),
    ).toEqual({
      installKind: "managed",
      scope: "global",
      wired: false,
      rootPath,
      skillsPath,
      freshness: "unknown",
      loading: false,
    });
  });

  it("reports linked when only a user-owned checkout is wired", () => {
    const checkout = path.join(homeDir, "work", "afv-library");
    mkdirSync(path.join(checkout, ".git"), { recursive: true });
    mkdirSync(path.join(checkout, "skills", "demo"), { recursive: true });
    writeFileSync(path.join(checkout, "skills", "demo", "SKILL.md"), "# demo\n");
    writeFileSync(path.join(checkout, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ skills: [path.join(checkout, "skills")] }),
    );
    const status = detectInstallStateLocal(homeDir);
    expect(status.installKind).toBe("linked");
    expect(status.scope).toBe("global");
    expect(status.rootPath).toBe(checkout);
    expect(status.skillCount).toBe(1);
    // Linked never queries upstream — freshness stays unknown.
    expect(status.freshness).toBe("unknown");
  });

  it("reports not-installed when nothing is wired", () => {
    expect(detectInstallStateLocal(homeDir)).toEqual({
      installKind: "not-installed",
      freshness: "unknown",
      loading: false,
    });
  });
});

// ---------------------------------------------------------------------------
// detectSfSkillsStatus — wires localSha + fetchCompare
// ---------------------------------------------------------------------------

describe("detectSfSkillsStatus", () => {
  function setupManagedGlobal(localSha: string): void {
    const rootPath = path.join(tmpDir, "sf-skills", "afv-library");
    const skillsPath = path.join(rootPath, "skills");
    mkdirSync(skillsPath, { recursive: true });
    mkdirSync(path.join(rootPath, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(path.join(rootPath, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(path.join(rootPath, ".git", "refs", "heads", "main"), `${localSha}\n`);
    writeFileSync(path.join(rootPath, ".sf-skills-managed"), "managed\n");
    writeFileSync(path.join(tmpDir, "settings.json"), JSON.stringify({ skills: [skillsPath] }));
  }

  it("reports latest when the compare API returns behind_by=0", async () => {
    const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    setupManagedGlobal(sha);
    const status = await detectSfSkillsStatus(homeDir, async () => ({
      remoteSha: sha,
      behindBy: 0,
    }));
    expect(status.installKind).toBe("managed");
    expect(status.wired).toBe(true);
    expect(status.freshness).toBe("latest");
    expect(status.commitsBehind).toBe(0);
    expect(status.remoteSha).toBe(sha);
  });

  it("reports update-available with commit count when behind_by>0", async () => {
    setupManagedGlobal("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const status = await detectSfSkillsStatus(homeDir, async () => ({
      remoteSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      behindBy: 7,
    }));
    expect(status.freshness).toBe("update-available");
    expect(status.commitsBehind).toBe(7);
  });

  it("degrades to freshness=unknown when the compare API fails", async () => {
    setupManagedGlobal("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const status = await detectSfSkillsStatus(homeDir, async () => undefined);
    expect(status.installKind).toBe("managed");
    expect(status.freshness).toBe("unknown");
    expect(status.commitsBehind).toBeUndefined();
  });

  it("never calls the compare API for a linked checkout", async () => {
    const checkout = path.join(homeDir, "work", "afv-library");
    mkdirSync(path.join(checkout, ".git"), { recursive: true });
    mkdirSync(path.join(checkout, "skills"), { recursive: true });
    writeFileSync(path.join(checkout, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ skills: [path.join(checkout, "skills")] }),
    );
    let calls = 0;
    const status = await detectSfSkillsStatus(homeDir, async () => {
      calls++;
      return { remoteSha: "x", behindBy: 99 };
    });
    expect(status.installKind).toBe("linked");
    expect(calls).toBe(0);
  });

  it("never calls the compare API when not installed", async () => {
    let calls = 0;
    const status = await detectSfSkillsStatus(homeDir, async () => {
      calls++;
      return { remoteSha: "x", behindBy: 99 };
    });
    expect(status.installKind).toBe("not-installed");
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// On-disk cache round-trip
// ---------------------------------------------------------------------------

describe("readCachedSfSkillsStatus / writeCachedSfSkillsStatus", () => {
  it("round-trips a managed status through the canonical cache file", () => {
    expect(readCachedSfSkillsStatus()).toBeNull();
    writeCachedSfSkillsStatus({
      installKind: "managed",
      scope: "global",
      skillsPath: "/tmp/x/skills",
      rootPath: "/tmp/x",
      localSha: "abc1234abc1234abc1234abc1234abc1234abcd",
      remoteSha: "abc1234abc1234abc1234abc1234abc1234abcd",
      commitsBehind: 0,
      skillCount: 12,
      wired: false,
      freshness: "latest",
      loading: false,
    });
    const cached = readCachedSfSkillsStatus();
    expect(cached).toMatchObject({
      installKind: "managed",
      freshness: "latest",
      commitsBehind: 0,
      skillCount: 12,
      wired: false,
      loading: false,
    });
  });

  it("returns null when the cache is older than the requested TTL", () => {
    writeCachedSfSkillsStatus({
      installKind: "not-installed",
      freshness: "unknown",
      loading: false,
    });
    // Negative TTL forces every cached entry to look stale.
    expect(readCachedSfSkillsStatus(-1)).toBeNull();
  });
});
