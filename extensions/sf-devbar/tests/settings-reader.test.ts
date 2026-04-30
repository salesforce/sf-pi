/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the sf-devbar Pi settings reader.
 *
 * Covers:
 * - Project scope overrides global scope
 * - Nested and flat "terminal.imageWidthCells" forms
 * - Missing, corrupt, or non-numeric values degrade to undefined
 * - formatImageWidthPill hides the default and renders everything else
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_WIDTH_CELLS,
  formatImageWidthPill,
  readTerminalDevbarSettings,
} from "../lib/settings-reader.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Create a project cwd + a global settings file path with optional settings
 * files, and return the pair in a shape ready for `readTerminalDevbarSettings()`.
 */
function makeScopes(options: {
  project?: Record<string, unknown>;
  global?: Record<string, unknown>;
}): { cwd: string; globalSettingsFile: string } {
  const cwd = makeTempDir("devbar-cwd-");
  const homeDir = makeTempDir("devbar-home-");
  const globalSettingsFile = join(homeDir, ".pi", "agent", "settings.json");

  if (options.project !== undefined) {
    const projectDir = join(cwd, ".pi");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "settings.json"), JSON.stringify(options.project), "utf-8");
  }

  if (options.global !== undefined) {
    mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
    writeFileSync(globalSettingsFile, JSON.stringify(options.global), "utf-8");
  }

  return { cwd, globalSettingsFile };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readTerminalDevbarSettings", () => {
  it("returns no pill data when both settings files are missing", () => {
    const { cwd, globalSettingsFile } = makeScopes({});
    expect(readTerminalDevbarSettings(cwd, globalSettingsFile)).toEqual({});
  });

  it("reads nested { terminal: { imageWidthCells } } from global scope", () => {
    const { cwd, globalSettingsFile } = makeScopes({
      global: { terminal: { imageWidthCells: 96 } },
    });
    expect(readTerminalDevbarSettings(cwd, globalSettingsFile)).toEqual({ imageWidthCells: 96 });
  });

  it("reads flat 'terminal.imageWidthCells' key", () => {
    const { cwd, globalSettingsFile } = makeScopes({
      global: { "terminal.imageWidthCells": 120 },
    });
    expect(readTerminalDevbarSettings(cwd, globalSettingsFile)).toEqual({ imageWidthCells: 120 });
  });

  it("prefers project scope over global scope", () => {
    const { cwd, globalSettingsFile } = makeScopes({
      project: { terminal: { imageWidthCells: 200 } },
      global: { terminal: { imageWidthCells: 60 } },
    });
    expect(readTerminalDevbarSettings(cwd, globalSettingsFile)).toEqual({ imageWidthCells: 200 });
  });

  it("falls back to global when project scope lacks the key", () => {
    const { cwd, globalSettingsFile } = makeScopes({
      project: { theme: "dark" },
      global: { terminal: { imageWidthCells: 72 } },
    });
    expect(readTerminalDevbarSettings(cwd, globalSettingsFile)).toEqual({ imageWidthCells: 72 });
  });

  it("rejects non-integer or non-positive values", () => {
    const { cwd, globalSettingsFile } = makeScopes({
      global: { terminal: { imageWidthCells: -5 } },
    });
    expect(readTerminalDevbarSettings(cwd, globalSettingsFile)).toEqual({});

    const { cwd: cwd2, globalSettingsFile: globalSettingsFile2 } = makeScopes({
      global: { terminal: { imageWidthCells: 1.5 } },
    });
    expect(readTerminalDevbarSettings(cwd2, globalSettingsFile2)).toEqual({});
  });

  it("returns no pill data when settings files are corrupt", () => {
    const cwd = makeTempDir("devbar-cwd-");
    const homeDir = makeTempDir("devbar-home-");
    const globalSettingsFile = join(homeDir, ".pi", "agent", "settings.json");
    mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
    writeFileSync(globalSettingsFile, "{not json", "utf-8");
    expect(readTerminalDevbarSettings(cwd, globalSettingsFile)).toEqual({});
  });
});

describe("formatImageWidthPill", () => {
  it("hides the pill when the value matches the default", () => {
    expect(formatImageWidthPill(DEFAULT_IMAGE_WIDTH_CELLS)).toBe("");
  });

  it("hides the pill when the value is undefined", () => {
    expect(formatImageWidthPill(undefined)).toBe("");
  });

  it("renders a compact pill for non-default values", () => {
    expect(formatImageWidthPill(120)).toBe("img:120c");
    expect(formatImageWidthPill(24)).toBe("img:24c");
  });
});
