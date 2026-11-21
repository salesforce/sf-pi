/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the forcedotcom/sf-skills defaults installer (no real git, no real network).
 *
 * We inject a fake spawn impl so install/update can simulate clone/pull
 * outcomes deterministically. Only the ManagedClone state machine and
 * the post-install settings.skills[] wiring are exercised here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectLegacyDefaultLibrary,
  formatLegacyDefaultLibraryWarning,
  inspectManagedClone,
  installDefaults,
  managedClonePath,
  unlinkCheckout,
  updateDefaults,
  rewireCloneToEffective,
} from "../lib/defaults.ts";
import { handleDefaults, parseDefaultsArgs } from "../lib/skills-command.ts";

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
      path.join(cwd, ".pi", "sf-skills", "forcedotcom"),
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
    expect(settings.skills).toContain("~/.pi/agent/sf-skills/effective/skills");
    expect(settings.skills).not.toContain("~/.pi/agent/sf-skills/forcedotcom/skills");
  });

  it("is idempotent on second invocation", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await installDefaults({ scope: "global", spawn: fakeGit });
    const second = await installDefaults({ scope: "global", spawn: fakeGit });
    expect(second.ok).toBe(true);
    expect(second.message).toMatch(/Already cloned/);
  });

  it("stamps the effective tree and leaves the clone SKILL.md clean", async () => {
    const home = makeHome();
    process.env.HOME = home;
    await installDefaults({ scope: "global", spawn: fakeGit });
    const cloneFile = path.join(
      home,
      ".pi",
      "agent",
      "sf-skills",
      "forcedotcom",
      "skills",
      "demo-skill",
      "SKILL.md",
    );
    const effectiveFile = path.join(
      home,
      ".pi",
      "agent",
      "sf-skills",
      "effective",
      "skills",
      "demo-skill",
      "SKILL.md",
    );
    const cloneRaw = readFileSync(cloneFile, "utf8");
    const effectiveRaw = readFileSync(effectiveFile, "utf8");
    expect(cloneRaw).not.toMatch(/disable-model-invocation/);
    expect(effectiveRaw).toMatch(/disable-model-invocation: true/);
  });

  it("scope='project' clones ONCE globally and wires the global path into project settings", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    const result = await installDefaults({ scope: "project", cwd, spawn: fakeGit });
    expect(result.ok).toBe(true);
    // Content is the single global clone — never a per-project clone.
    expect(result.clone.rootPath).toBe(path.join(home, ".pi", "agent", "sf-skills", "forcedotcom"));
    expect(result.clone.scope).toBe("project");
    expect(result.clone.wired).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs");
    // Project settings reference the GLOBAL clone path (local-first enablement).
    const settings = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"));
    expect(settings.skills).toContain("~/.pi/agent/sf-skills/effective/skills");
    expect(settings.skills).not.toContain("~/.pi/agent/sf-skills/forcedotcom/skills");
    // No per-project clone was created.
    expect(fs.existsSync(path.join(cwd, ".pi", "sf-skills", "forcedotcom"))).toBe(false);
    // Global settings were not written (only project scope was wired).
    expect(fs.existsSync(path.join(home, ".pi", "agent", "settings.json"))).toBe(false);
  });
});

describe("rewireCloneToEffective", () => {
  it("replaces a project clone wire with the effective tree", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "settings.json"),
      `${JSON.stringify({ skills: ["~/.pi/agent/sf-skills/forcedotcom/skills"] })}\n`,
    );
    rewireCloneToEffective(cwd);
    const settings = JSON.parse(readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"));
    expect(settings.skills).toContain("~/.pi/agent/sf-skills/effective/skills");
    expect(settings.skills).not.toContain("~/.pi/agent/sf-skills/forcedotcom/skills");
  });
});

describe("updateDefaults", () => {
  it("refuses to pull when no managed clone exists", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const result = await updateDefaults({ scope: "global", spawn: fakeGit });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No managed forcedotcom\/sf-skills/);
  });

  it("refuses to pull a checkout missing the sentinel", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = path.join(home, ".pi", "agent", "sf-skills", "forcedotcom");
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
      target: "~/.pi/agent/sf-skills/effective/skills",
      scope: "global",
    });
    expect(result.ok).toBe(true);
    expect(result.settingsChanged).toBe(true);
    expect(result.removedEntries).toBe(1);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs");
    const settings = JSON.parse(
      fs.readFileSync(path.join(home, ".pi", "agent", "settings.json"), "utf8"),
    );
    expect(settings.skills).not.toContain("~/.pi/agent/sf-skills/effective/skills");
  });

  it("removes descendant per-skill wiring under a checkout root", () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = path.join(home, ".pi", "agent", "sf-skills", "afv-library");
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      path.join(home, ".pi", "agent", "settings.json"),
      `${JSON.stringify({
        skills: [
          "~/.pi/agent/sf-skills/afv-library/skills/one/SKILL.md",
          "~/.pi/agent/sf-skills/afv-library/skills/two/SKILL.md",
        ],
      })}\n`,
    );

    const result = unlinkCheckout({ target: root, scope: "global" });

    expect(result.ok).toBe(true);
    expect(result.settingsChanged).toBe(true);
    expect(result.removedEntries).toBe(2);
    const settings = JSON.parse(
      readFileSync(path.join(home, ".pi", "agent", "settings.json"), "utf8"),
    );
    expect(settings.skills).toEqual([]);
  });

  it("treats an already-absent managed directory as an idempotent delete", () => {
    const home = makeHome();
    process.env.HOME = home;
    const missing = path.join(home, "missing-checkout");

    const result = unlinkCheckout({
      target: missing,
      scope: "global",
      deleteOnDisk: true,
    });

    expect(result.ok).toBe(true);
    expect(result.settingsChanged).toBe(false);
    expect(result.diskOutcome).toBe("absent");
    expect(result.message).toMatch(/nothing to delete/i);
  });

  it("reports partial success when wiring is removed but an unmanaged directory is retained", () => {
    const home = makeHome();
    process.env.HOME = home;
    const fake = path.join(home, "fake-checkout");
    mkdirSync(path.join(fake, "skills"), { recursive: true });
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      path.join(home, ".pi", "agent", "settings.json"),
      `${JSON.stringify({ skills: [path.join(fake, "skills")] })}\n`,
    );

    const result = unlinkCheckout({
      target: fake,
      scope: "global",
      deleteOnDisk: true,
    });

    expect(result.ok).toBe(false);
    expect(result.settingsChanged).toBe(true);
    expect(result.removedEntries).toBe(1);
    expect(result.diskOutcome).toBe("retained-unmanaged");
    expect(result.message).toMatch(/Removed 1 matching settings entry/);
    expect(result.message).toMatch(/\.sf-skills-managed/);
  });
});

describe("handleDefaults unlink", () => {
  it("reloads when wiring changed even if unmanaged directory deletion is refused", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    const fake = path.join(home, "fake-checkout");
    mkdirSync(path.join(fake, "skills"), { recursive: true });
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      path.join(home, ".pi", "agent", "settings.json"),
      `${JSON.stringify({ skills: [path.join(fake, "skills")] })}\n`,
    );
    let reloads = 0;

    await handleDefaults(
      {
        cwd,
        isProjectTrusted: () => true,
        ui: { notify: () => undefined },
        reload: async () => {
          reloads += 1;
        },
      } as never,
      { action: "unlink", scope: "global", target: fake, deleteOnDisk: true },
      async () => undefined,
    );

    expect(reloads).toBe(1);
  });
});

describe("handleDefaults status", () => {
  it("reports the shared global clone as wired in the project it is enabled in", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    await installDefaults({ scope: "project", cwd, spawn: fakeGit });
    let body = "";

    await handleDefaults(
      { cwd, isProjectTrusted: () => true, ui: { notify: () => undefined } } as never,
      { action: "status", scope: "project", target: undefined, deleteOnDisk: false },
      async (_title, text) => {
        body = text;
      },
    );

    const project = body.slice(body.indexOf("PROJECT"), body.indexOf("Commands:"));
    expect(project).not.toContain("not installed");
    expect(project).toContain("managed · wired");
    expect(project).toContain(path.join(home, ".pi", "agent", "sf-skills", "forcedotcom"));
  });
});

describe("legacy afv-library detection", () => {
  it("warns with explicit settings scope and does not recommend deleting an absent clone", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      path.join(home, ".pi", "agent", "settings.json"),
      `${JSON.stringify({ skills: ["~/.pi/agent/sf-skills/afv-library/skills"] })}\n`,
    );

    const detection = detectLegacyDefaultLibrary();
    const warning = formatLegacyDefaultLibraryWarning(detection);
    expect(detection.present).toBe(true);
    expect(detection.wired).toBe(true);
    expect(warning).toMatch(/still wired/);
    expect(warning).toContain("/sf-skills defaults install global");
    expect(warning).not.toContain("defaults unlink");
  });

  it("uses project settings scope for stale per-skill wiring instead of inventing a clone path", () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "settings.json"),
      `${JSON.stringify({
        skills: ["~/.pi/agent/sf-skills/afv-library/skills/example/SKILL.md"],
      })}\n`,
    );

    const warning = formatLegacyDefaultLibraryWarning(detectLegacyDefaultLibrary(cwd), {
      sessionStart: true,
    });

    expect(warning).toContain("/sf-skills defaults install project");
    expect(warning).not.toContain(path.join(cwd, ".pi", "sf-skills", "afv-library"));
  });

  it("clears stale per-skill project wiring with the recommended scoped install", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "settings.json"),
      `${JSON.stringify({
        skills: ["~/.pi/agent/sf-skills/afv-library/skills/example/SKILL.md"],
      })}\n`,
    );

    const result = await installDefaults({ scope: "project", cwd, spawn: fakeGit });

    expect(result.ok).toBe(true);
    expect(detectLegacyDefaultLibrary(cwd).wired).toBe(false);
    const settings = JSON.parse(readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"));
    expect(settings.skills).toContain("~/.pi/agent/sf-skills/effective/skills");
    expect(settings.skills).not.toContain(
      "~/.pi/agent/sf-skills/afv-library/skills/example/SKILL.md",
    );
  });

  it("recommends deletion only for a sentinel-managed clone that exists", () => {
    const home = makeHome();
    process.env.HOME = home;
    const root = path.join(home, ".pi", "agent", "sf-skills", "afv-library");
    mkdirSync(path.join(root, "skills"), { recursive: true });
    writeFileSync(path.join(root, ".sf-skills-managed"), "managed\n");

    const warning = formatLegacyDefaultLibraryWarning(detectLegacyDefaultLibrary());

    expect(warning).toContain(
      "/sf-skills defaults unlink ~/.pi/agent/sf-skills/afv-library global --delete",
    );
  });

  it("unwires the retired library when installing the new default", async () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(path.join(home, ".pi", "agent", "sf-skills", "afv-library", "skills"), {
      recursive: true,
    });
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      path.join(home, ".pi", "agent", "settings.json"),
      `${JSON.stringify({ skills: ["~/.pi/agent/sf-skills/afv-library/skills"] })}\n`,
    );

    const result = await installDefaults({ scope: "global", spawn: fakeGit });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Removed retired forcedotcom\/afv-library/);

    const settings = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").readFileSync(path.join(home, ".pi", "agent", "settings.json"), "utf8"),
    );
    expect(settings.skills).toContain("~/.pi/agent/sf-skills/effective/skills");
    expect(settings.skills).not.toContain("~/.pi/agent/sf-skills/afv-library/skills");
    expect(result.message).toMatch(/will not be deleted automatically/);
    expect(result.message).not.toContain("defaults unlink");
  });

  it("does not session-warn when the retired clone is only leftover on disk", () => {
    const home = makeHome();
    process.env.HOME = home;
    mkdirSync(path.join(home, ".pi", "agent", "sf-skills", "afv-library", "skills"), {
      recursive: true,
    });

    const detection = detectLegacyDefaultLibrary();
    expect(detection.present).toBe(true);
    expect(detection.wired).toBe(false);
    expect(formatLegacyDefaultLibraryWarning(detection, { sessionStart: true })).toBeUndefined();
    expect(formatLegacyDefaultLibraryWarning(detection)).toMatch(
      /will not be deleted automatically/,
    );
    expect(formatLegacyDefaultLibraryWarning(detection)).not.toContain("defaults unlink");
  });
});
