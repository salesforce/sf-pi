/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Direct tests for package-state helper modules.
 *
 * These focus on scope precedence and package discovery, which now live in
 * lib/package-state.ts instead of the main entry file.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findPackageInSettings,
  getDisabledExtensionsForCwd,
  resolveEffectiveScope,
} from "../lib/package-state.ts";
import { TEST_PACKAGE_SOURCE } from "../../../lib/common/test-fixtures.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSettings(filePath: string, settings: Record<string, unknown>): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("findPackageInSettings", () => {
  it("finds the package in project scope", () => {
    const homeDir = makeTempDir("sf-pi-home-");
    const projectDir = makeTempDir("sf-pi-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(projectDir, ".pi", "settings.json"), {
      packages: [TEST_PACKAGE_SOURCE],
    });

    const match = findPackageInSettings(projectDir, "project");
    expect(match).not.toBeNull();
    expect(match!.settingsPath).toBe(path.join(projectDir, ".pi", "settings.json"));
  });

  it("finds the package in global scope", () => {
    const homeDir = makeTempDir("sf-pi-home-");
    const projectDir = makeTempDir("sf-pi-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(homeDir, ".pi", "agent", "settings.json"), {
      packages: [TEST_PACKAGE_SOURCE],
    });

    const match = findPackageInSettings(projectDir, "global");
    expect(match).not.toBeNull();
    expect(match!.settingsPath).toBe(path.join(homeDir, ".pi", "agent", "settings.json"));
  });
});

describe("getDisabledExtensionsForCwd", () => {
  it("prefers project settings over global when the project has an sf-pi entry", () => {
    const homeDir = makeTempDir("sf-pi-home-");
    const projectDir = makeTempDir("sf-pi-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(homeDir, ".pi", "agent", "settings.json"), {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts", "!extensions/sf-ohana-spinner/index.ts"],
        },
      ],
    });

    writeSettings(path.join(projectDir, ".pi", "settings.json"), {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts", "!extensions/sf-slack/index.ts"],
        },
      ],
    });

    expect(getDisabledExtensionsForCwd(projectDir)).toEqual(
      new Set(["extensions/sf-slack/index.ts"]),
    );
  });

  it("falls back to global settings when the project has no sf-pi entry", () => {
    const homeDir = makeTempDir("sf-pi-home-");
    const projectDir = makeTempDir("sf-pi-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(homeDir, ".pi", "agent", "settings.json"), {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts", "!extensions/sf-ohana-spinner/index.ts"],
        },
      ],
    });

    writeSettings(path.join(projectDir, ".pi", "settings.json"), {
      packages: ["some-other-package"],
    });

    expect(getDisabledExtensionsForCwd(projectDir)).toEqual(
      new Set(["extensions/sf-ohana-spinner/index.ts"]),
    );
  });
});

// Auto-detect scope mirrors Pi's own settings precedence so the manager
// works regardless of whether the user installed sf-pi globally, in a
// project, or both. Issue #88.
describe("resolveEffectiveScope", () => {
  it("returns 'project' when sf-pi is installed in project settings", () => {
    const homeDir = makeTempDir("sf-pi-home-");
    const projectDir = makeTempDir("sf-pi-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(projectDir, ".pi", "settings.json"), {
      packages: [TEST_PACKAGE_SOURCE],
    });

    expect(resolveEffectiveScope(projectDir)).toBe("project");
  });

  it("returns 'global' when sf-pi is only in global settings", () => {
    const homeDir = makeTempDir("sf-pi-home-");
    const projectDir = makeTempDir("sf-pi-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(homeDir, ".pi", "agent", "settings.json"), {
      packages: [TEST_PACKAGE_SOURCE],
    });

    expect(resolveEffectiveScope(projectDir)).toBe("global");
  });

  it("prefers project over global when the package is in both scopes", () => {
    const homeDir = makeTempDir("sf-pi-home-");
    const projectDir = makeTempDir("sf-pi-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(homeDir, ".pi", "agent", "settings.json"), {
      packages: [TEST_PACKAGE_SOURCE],
    });
    writeSettings(path.join(projectDir, ".pi", "settings.json"), {
      packages: [TEST_PACKAGE_SOURCE],
    });

    expect(resolveEffectiveScope(projectDir)).toBe("project");
  });

  it("falls back to 'global' when sf-pi is installed nowhere", () => {
    // The fallback keeps the downstream "package not found" message
    // pointing at a real settings file rather than nothing.
    const homeDir = makeTempDir("sf-pi-home-");
    const projectDir = makeTempDir("sf-pi-project-");
    process.env.HOME = homeDir;

    expect(resolveEffectiveScope(projectDir)).toBe("global");
  });
});
