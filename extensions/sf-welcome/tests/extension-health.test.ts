/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Targeted tests for registry-driven extension health.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverExtensionHealth } from "../lib/extension-health.ts";
import { TEST_PACKAGE_SOURCE } from "../../../lib/common/test-fixtures.ts";

const originalHome = process.env.HOME;
const tempDirs: string[] = [];

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

describe("discoverExtensionHealth", () => {
  it("includes registry entries with display-name overrides", () => {
    const homeDir = makeTempDir("sf-welcome-home-");
    const projectDir = makeTempDir("sf-welcome-project-");
    process.env.HOME = homeDir;

    const health = discoverExtensionHealth(projectDir);
    expect(health.some((item) => item.name === "LLM Gateway")).toBe(true);
    expect(health.some((item) => item.name === "Pi Manager" && item.status === "locked")).toBe(
      true,
    );
  });

  it("prefers project filter state over global when a project package entry exists", () => {
    const homeDir = makeTempDir("sf-welcome-home-");
    const projectDir = makeTempDir("sf-welcome-project-");
    process.env.HOME = homeDir;

    writeSettings(path.join(homeDir, ".pi", "agent", "settings.json"), {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts", "!extensions/sf-welcome/index.ts"],
        },
      ],
    });

    writeSettings(path.join(projectDir, ".pi", "settings.json"), {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts", "!extensions/sf-ohana-spinner/index.ts"],
        },
      ],
    });

    const health = discoverExtensionHealth(projectDir);
    const spinner = health.find((item) => item.name === "Ohana Spinner");
    const welcome = health.find((item) => item.name === "Welcome");

    expect(spinner?.status).toBe("disabled");
    expect(welcome?.status).toBe("active");
  });
});
