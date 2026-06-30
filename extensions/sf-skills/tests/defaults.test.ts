/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the afv-library defaults installer (no real git, no real network).
 *
 * We inject a fake spawn impl so install/update can simulate clone/pull
 * outcomes deterministically. Only the ManagedClone state machine and
 * the post-install settings.skills[] wiring are exercised here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  inspectManagedClone,
  installDefaults,
  managedClonePath,
  unlinkCheckout,
  updateDefaults,
} from "../lib/defaults.ts";
import { parseDefaultsArgs } from "../lib/skills-command.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-home-"));
  tempDirs.push(dir);
  return dir;
}

function makeCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-cwd-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Stub spawn that pretends `git clone <url> <target>` succeeded by creating
 * the target dir + a skills/ subdir. Other commands resolve as success
 * with empty output.
 */
function fakeGit(_command: string, args: readonly string[], opts: { cwd: string }) {
  const handlers: Record<string, ((data: string | Buffer) => void)[]> = {};
  const child = {
    stdout: {
      on(event: string, cb: (data: string | Buffer) => void) {
        (handlers[`stdout:${event}`] ??= []).push(cb);
      },
    },
    stderr: {
      on(event: string, cb: (data: string | Buffer) => void) {
        (handlers[`stderr:${event}`] ??= []).push(cb);
      },
    },
    on(event: string, cb: (...rest: unknown[]) => void) {
      (handlers[event] ??= []).push(cb as (data: string | Buffer) => void);
    },
  };
  queueMicrotask(() => {
    if (args[0] === "clone") {
      const target = args[args.length - 1];
      if (typeof target === "string") {
        mkdirSync(path.join(target, "skills", "demo-skill"), { recursive: true });
        writeFileSync(
          path.join(target, "skills", "demo-skill", "SKILL.md"),
          "---\nname: demo-skill\ndescription: demo\n---\n",
          "utf8",
        );
      }
    }
    void opts;
    const closeHandlers = handlers["close"] as unknown as
      Array<(code: number | null) => void> | undefined;
    closeHandlers?.forEach((cb) => cb(0));
  });
  return child as unknown as ReturnType<Parameters<typeof installDefaults>[0]["spawn"] & object>;
}

describe("parseDefaultsArgs", () => {
  it("defaults to status when no args, project scope (local-first)", () => {
    expect(parseDefaultsArgs("")).toEqual({
      action: "status",
      scope: "project",
      target: undefined,
      deleteOnDisk: false,
    });
  });

  it("recognizes install/update with optional scope; defaults to project", () => {
    expect(parseDefaultsArgs(" install ").action).toBe("install");
    expect(parseDefaultsArgs(" install ").scope).toBe("project"); // local-first default
    expect(parseDefaultsArgs(" install project ").scope).toBe("project");
    expect(parseDefaultsArgs(" install global ").scope).toBe("global"); // explicit opt-in
    expect(parseDefaultsArgs(" update global ").scope).toBe("global");
  });

  it("captures target path for link/unlink", () => {
    const link = parseDefaultsArgs("link ~/work/afv-library project");
    expect(link.action).toBe("link");
    expect(link.target).toBe("~/work/afv-library");
    expect(link.scope).toBe("project");

    const unlink = parseDefaultsArgs("unlink ~/work/afv-library --delete");
    expect(unlink.action).toBe("unlink");
    expect(unlink.target).toBe("~/work/afv-library");
    expect(unlink.deleteOnDisk).toBe(true);
  });

  it("falls back to status for unknown actions", () => {
    expect(parseDefaultsArgs("frobnicate").action).toBe("status");
  });
});

describe("inspectManagedClone", () => {
  it("reports not-installed before install", () => {
    const home = makeHome();
    process.env.HOME = home;
    const clone = inspectManagedClone("global");
    expect(clone.exists).toBe(false);
    expect(clone.managed).toBe(false);
    expect(clone.wired).toBe(false);
  });

  it("computes the project clone path under cwd/.pi/sf-skills/", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    expect(managedClonePath("project", cwd)).toBe(
      path.join(cwd, ".pi", "sf-skills", "afv-library"),
    );
  });
});

describe("installDefaults (with fake git)", () => {
  it("clones into the managed dir and wires settings.skills[]", async () => {
    const home = makeHome();
    process.env.HOME = home;

    const result = await installDefaults({ scope: "global", spawn: fakeGit });
    expect(result.ok).toBe(true);
    expect(result.clone.exists).toBe(true);
    expect(result.clone.managed).toBe(true);
    expect(result.clone.wired).toBe(true);

    const settings = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").readFileSync(path.join(home, ".pi", "agent", "settings.json"), "utf8"),
    );
    expect(settings.skills).toContain("~/.pi/agent/sf-skills/afv-library/skills");
  });

  it("is idempotent on second invocation", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await installDefaults({ scope: "global", spawn: fakeGit });
    const second = await installDefaults({ scope: "global", spawn: fakeGit });
    expect(second.ok).toBe(true);
    expect(second.message).toMatch(/Already cloned/);
  });

  it("scope='project' clones ONCE globally and wires the global path into project settings", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    const result = await installDefaults({ scope: "project", cwd, spawn: fakeGit });
    expect(result.ok).toBe(true);
    // Content is the single global clone — never a per-project clone.
    expect(result.clone.rootPath).toBe(path.join(home, ".pi", "agent", "sf-skills", "afv-library"));
    expect(result.clone.scope).toBe("project");
    expect(result.clone.wired).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs");
    // Project settings reference the GLOBAL clone path (local-first enablement).
    const settings = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"));
    expect(settings.skills).toContain("~/.pi/agent/sf-skills/afv-library/skills");
    // No per-project clone was created.
    expect(fs.existsSync(path.join(cwd, ".pi", "sf-skills", "afv-library"))).toBe(false);
    // Global settings were not written (only project scope was wired).
    expect(fs.existsSync(path.join(home, ".pi", "agent", "settings.json"))).toBe(false);
  });
});

describe("updateDefaults", () => {
  it("refuses to pull when no managed clone exists", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const result = await updateDefaults({ scope: "global", spawn: fakeGit });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No managed afv-library/);
  });

  it("refuses to pull a checkout missing the sentinel", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = path.join(home, ".pi", "agent", "sf-skills", "afv-library");
    mkdirSync(path.join(root, "skills"), { recursive: true });
    // No sentinel file.
    const result = await updateDefaults({ scope: "global", spawn: fakeGit });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/sentinel/);
  });

  it("pulls successfully when the sentinel is present", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await installDefaults({ scope: "global", spawn: fakeGit });
    const result = await updateDefaults({ scope: "global", spawn: fakeGit });
    expect(result.ok).toBe(true);
  });
});

describe("unlinkCheckout", () => {
  it("removes the entry from settings.skills[]", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await installDefaults({ scope: "global", spawn: fakeGit });

    const result = unlinkCheckout({
      target: "~/.pi/agent/sf-skills/afv-library/skills",
      scope: "global",
    });
    expect(result.ok).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs");
    const settings = JSON.parse(
      fs.readFileSync(path.join(home, ".pi", "agent", "settings.json"), "utf8"),
    );
    expect(settings.skills).not.toContain("~/.pi/agent/sf-skills/afv-library/skills");
  });

  it("refuses to delete a path missing the sentinel", () => {
    const home = makeHome();
    process.env.HOME = home;
    const fake = path.join(home, "fake-checkout");
    mkdirSync(fake, { recursive: true });
    const result = unlinkCheckout({
      target: fake,
      scope: "global",
      deleteOnDisk: true,
    });
    expect(result.ok).toBe(false);
    // The defaults module names the sentinel file in the message rather than
    // the literal word “sentinel” — match on the filename so the test stays
    // honest about what the user actually sees.
    expect(result.message).toMatch(/\.sf-skills-managed/);
  });
});
