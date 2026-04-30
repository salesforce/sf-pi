/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for extension state building and settings.json round-trips.
 *
 * Covers: buildExtensionStates, getDisabledExtensions, applyExtensionState
 *
 * These functions determine which extensions are shown as enabled/disabled in
 * the TUI overlay and list commands. The exclusion pattern parsing and write-
 * back logic must match Pi's native package filtering spec exactly.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyExtensionState, buildExtensionStates, getDisabledExtensions } from "../index.ts";
import { TEST_PACKAGE_SOURCE } from "../../../lib/common/test-fixtures.ts";

const tempDirs: string[] = [];

function createTempSettingsFile(settings: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-manager-test-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "settings.json");
  writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------------------------
// buildExtensionStates
// -------------------------------------------------------------------------------------------------

describe("buildExtensionStates", () => {
  it("marks all extensions enabled when disabledFiles is empty", () => {
    const states = buildExtensionStates(new Set());
    for (const state of states) {
      expect(state.enabled).toBe(true);
    }
  });

  it("marks specific extensions as disabled", () => {
    const disabled = new Set(["extensions/sf-ohana-spinner/index.ts"]);
    const states = buildExtensionStates(disabled);

    const spinner = states.find((s) => s.id === "sf-ohana-spinner");
    expect(spinner).toBeDefined();
    expect(spinner!.enabled).toBe(false);

    const gateway = states.find((s) => s.id === "sf-llm-gateway-internal");
    expect(gateway).toBeDefined();
    expect(gateway!.enabled).toBe(true);
  });

  it("always marks alwaysActive extensions as enabled even if in disabled set", () => {
    const disabled = new Set(["extensions/sf-pi-manager/index.ts"]);
    const states = buildExtensionStates(disabled);

    const manager = states.find((s) => s.id === "sf-pi-manager");
    expect(manager).toBeDefined();
    expect(manager!.enabled).toBe(true);
  });

  it("returns states for all registry entries", () => {
    const states = buildExtensionStates(new Set());
    expect(states.length).toBeGreaterThanOrEqual(3);
  });

  it("preserves extension metadata from registry", () => {
    const states = buildExtensionStates(new Set());
    const spinner = states.find((s) => s.id === "sf-ohana-spinner");
    expect(spinner).toBeDefined();
    expect(spinner!.name).toBe("SF Ohana Spinner");
    expect(spinner!.category).toBe("ui");
    expect(spinner!.file).toBe("extensions/sf-ohana-spinner/index.ts");
  });
});

// -------------------------------------------------------------------------------------------------
// getDisabledExtensions
// -------------------------------------------------------------------------------------------------

describe("getDisabledExtensions", () => {
  it("returns empty set for non-existent settings file", () => {
    const result = getDisabledExtensions("/tmp/does-not-exist-sf-pi-test.json");
    expect(result).toEqual(new Set());
  });

  it("returns empty set for string-form package entry", () => {
    const settingsPath = createTempSettingsFile({
      packages: [TEST_PACKAGE_SOURCE],
    });

    expect(getDisabledExtensions(settingsPath)).toEqual(new Set());
  });

  it("reads exclusion patterns from object-form package entry", () => {
    const settingsPath = createTempSettingsFile({
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: [
            "extensions/*/index.ts",
            "!extensions/sf-ohana-spinner/index.ts",
            "!extensions/sf-llm-gateway-internal/index.ts",
          ],
        },
      ],
    });

    expect(getDisabledExtensions(settingsPath)).toEqual(
      new Set([
        "extensions/sf-ohana-spinner/index.ts",
        "extensions/sf-llm-gateway-internal/index.ts",
      ]),
    );
  });

  it("ignores non-exclusion extension entries", () => {
    const settingsPath = createTempSettingsFile({
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: [
            "extensions/*/index.ts",
            "extensions/other/*.ts",
            "!extensions/sf-ohana-spinner/index.ts",
          ],
        },
      ],
    });

    expect(getDisabledExtensions(settingsPath)).toEqual(
      new Set(["extensions/sf-ohana-spinner/index.ts"]),
    );
  });
});

// -------------------------------------------------------------------------------------------------
// applyExtensionState
// -------------------------------------------------------------------------------------------------

describe("applyExtensionState", () => {
  it("writes object-form package entry with exclusion patterns when some extensions are disabled", () => {
    const settingsPath = createTempSettingsFile({
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          skills: ["skills/*.md"],
          themes: ["themes/*.json"],
        },
      ],
    });

    applyExtensionState(
      {
        index: 0,
        source: TEST_PACKAGE_SOURCE,
        isObject: true,
        settingsPath,
      },
      new Set(["extensions/sf-ohana-spinner/index.ts"]),
    );

    const updated = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      packages: Array<Record<string, unknown>>;
    };

    expect(updated.packages[0]).toEqual({
      source: TEST_PACKAGE_SOURCE,
      skills: ["skills/*.md"],
      themes: ["themes/*.json"],
      extensions: ["extensions/*/index.ts", "!extensions/sf-ohana-spinner/index.ts"],
    });
  });

  it("simplifies back to string-form package entry when all extensions are enabled", () => {
    const settingsPath = createTempSettingsFile({
      packages: [
        {
          source: TEST_PACKAGE_SOURCE,
          extensions: ["extensions/*/index.ts", "!extensions/sf-ohana-spinner/index.ts"],
          skills: ["skills/*.md"],
        },
      ],
    });

    applyExtensionState(
      {
        index: 0,
        source: TEST_PACKAGE_SOURCE,
        isObject: true,
        settingsPath,
      },
      new Set(),
    );

    const updated = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      packages: unknown[];
    };

    expect(updated.packages[0]).toBe(TEST_PACKAGE_SOURCE);
  });

  it("round-trips with getDisabledExtensions", () => {
    const settingsPath = createTempSettingsFile({
      packages: [TEST_PACKAGE_SOURCE],
    });

    const disabled = new Set([
      "extensions/sf-ohana-spinner/index.ts",
      "extensions/sf-llm-gateway-internal/index.ts",
    ]);

    applyExtensionState(
      {
        index: 0,
        source: TEST_PACKAGE_SOURCE,
        isObject: false,
        settingsPath,
      },
      disabled,
    );

    expect(getDisabledExtensions(settingsPath)).toEqual(disabled);
  });
});
