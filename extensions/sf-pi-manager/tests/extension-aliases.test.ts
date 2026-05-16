/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the silent extension-rename migration.
 *
 * Covers:
 * - clean settings (no alias entry) → no-op
 * - explicit disable of old name → rewritten to new name
 * - explicit enable (enabledExtensions) → rewritten too
 * - non-aliased entries left alone
 * - idempotence on a second run
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EXTENSION_ALIASES, migrateExtensionAliases } from "../lib/extension-aliases.ts";
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

function readSettings(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8"));
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

describe("extension-aliases", () => {
  it("declares the sf-skills-hud → sf-skills migration", () => {
    expect(EXTENSION_ALIASES["sf-skills-hud"]).toBe("sf-skills");
  });

  it("rewrites a disabled old-name entry in global settings", () => {
    const home = makeTempDir("home-");
    process.env.HOME = home;
    const settingsPath = path.join(home, ".pi", "agent", "settings.json");
    writeSettings(settingsPath, {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts", "!extensions/sf-skills-hud/index.ts"],
        },
      ],
    });

    const result = migrateExtensionAliases(makeTempDir("cwd-"));
    expect(result.migrated).toEqual([settingsPath]);

    const next = readSettings(settingsPath);
    const pkg = (next.packages as Array<Record<string, unknown>>)[0];
    expect(pkg.extensions).toEqual(["extensions/*/index.ts", "!extensions/sf-skills/index.ts"]);
  });

  it("rewrites enabledExtensions entries too", () => {
    const home = makeTempDir("home-");
    process.env.HOME = home;
    const settingsPath = path.join(home, ".pi", "agent", "settings.json");
    writeSettings(settingsPath, {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts"],
          enabledExtensions: ["extensions/sf-skills-hud/index.ts"],
        },
      ],
    });

    migrateExtensionAliases(makeTempDir("cwd-"));

    const next = readSettings(settingsPath);
    const pkg = (next.packages as Array<Record<string, unknown>>)[0];
    expect(pkg.enabledExtensions).toEqual(["extensions/sf-skills/index.ts"]);
  });

  it("leaves unrelated filter entries alone", () => {
    const home = makeTempDir("home-");
    process.env.HOME = home;
    const settingsPath = path.join(home, ".pi", "agent", "settings.json");
    writeSettings(settingsPath, {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts", "!extensions/sf-ohana-spinner/index.ts"],
        },
      ],
    });

    const result = migrateExtensionAliases(makeTempDir("cwd-"));
    expect(result.migrated).toEqual([]);

    const next = readSettings(settingsPath);
    const pkg = (next.packages as Array<Record<string, unknown>>)[0];
    expect(pkg.extensions).toEqual([
      "extensions/*/index.ts",
      "!extensions/sf-ohana-spinner/index.ts",
    ]);
  });

  it("is idempotent (a second run is a no-op)", () => {
    const home = makeTempDir("home-");
    process.env.HOME = home;
    const settingsPath = path.join(home, ".pi", "agent", "settings.json");
    writeSettings(settingsPath, {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts", "!extensions/sf-skills-hud/index.ts"],
        },
      ],
    });
    const cwd = makeTempDir("cwd-");

    expect(migrateExtensionAliases(cwd).migrated).toEqual([settingsPath]);
    expect(migrateExtensionAliases(cwd).migrated).toEqual([]);
  });

  it("dedupes when both old and new entries are already present", () => {
    const home = makeTempDir("home-");
    process.env.HOME = home;
    const settingsPath = path.join(home, ".pi", "agent", "settings.json");
    writeSettings(settingsPath, {
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: [
            "extensions/*/index.ts",
            "!extensions/sf-skills-hud/index.ts",
            "!extensions/sf-skills/index.ts",
          ],
        },
      ],
    });

    migrateExtensionAliases(makeTempDir("cwd-"));

    const next = readSettings(settingsPath);
    const pkg = (next.packages as Array<Record<string, unknown>>)[0];
    expect(pkg.extensions).toEqual(["extensions/*/index.ts", "!extensions/sf-skills/index.ts"]);
  });

  it("is a no-op when settings.json does not exist", () => {
    const home = makeTempDir("home-");
    process.env.HOME = home;
    const result = migrateExtensionAliases(makeTempDir("cwd-"));
    expect(result.migrated).toEqual([]);
  });
});
