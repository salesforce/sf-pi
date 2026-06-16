/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_DEVBAR_COLORS } from "../lib/colors.ts";
import {
  clearScopedDevbarColorOverride,
  readEffectiveDevbarSettings,
  readScopedDevbarSettings,
  resetScopedDevbarColors,
  writeScopedDevbarColorOverrides,
} from "../lib/settings.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeScopes(options: {
  project?: Record<string, unknown>;
  global?: Record<string, unknown>;
}): { cwd: string; globalSettingsFile: string } {
  const cwd = makeTempDir("devbar-settings-cwd-");
  const homeDir = makeTempDir("devbar-settings-home-");
  const globalSettingsFile = join(homeDir, ".pi", "agent", "settings.json");

  if (options.project !== undefined) {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(options.project), "utf-8");
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

describe("readEffectiveDevbarSettings", () => {
  it("resolves project colors over global colors per field", () => {
    const { cwd, globalSettingsFile } = makeScopes({
      global: { sfPi: { devbar: { colors: { folderPath: "#111", modelName: "#222" } } } },
      project: { sfPi: { devbar: { colors: { modelName: "#333" } } } },
    });

    const settings = readEffectiveDevbarSettings(cwd, globalSettingsFile);

    expect(settings.colors.folderPath).toBe("#111111");
    expect(settings.colors.modelName).toBe("#333333");
    expect(settings.colors.orgWarning).toBe(DEFAULT_DEVBAR_COLORS.orgWarning);
    expect(settings.sources.folderPath).toBe("global");
    expect(settings.sources.modelName).toBe("project");
    expect(settings.sources.orgWarning).toBe("default");
  });

  it("falls through invalid project values to valid global values", () => {
    const { cwd, globalSettingsFile } = makeScopes({
      global: { sfPi: { devbar: { colors: { modelName: "#222" } } } },
      project: { sfPi: { devbar: { colors: { modelName: "not-a-color" } } } },
    });

    const settings = readEffectiveDevbarSettings(cwd, globalSettingsFile);

    expect(settings.colors.modelName).toBe("#222222");
    expect(settings.sources.modelName).toBe("global");
  });
});

describe("scoped DevBar settings", () => {
  it("stores only explicit scoped overrides", () => {
    const { cwd, globalSettingsFile } = makeScopes({});

    const written = writeScopedDevbarColorOverrides(
      cwd,
      "project",
      { folderPath: "#ABC" },
      globalSettingsFile,
    );

    expect(written.colors).toEqual({ folderPath: "#aabbcc" });
    expect(readScopedDevbarSettings(cwd, "project", globalSettingsFile).colors).toEqual({
      folderPath: "#aabbcc",
    });
    expect(readScopedDevbarSettings(cwd, "global", globalSettingsFile).colors).toEqual({});
  });

  it("preserves unrelated settings when writing and clearing colors", () => {
    const { cwd, globalSettingsFile } = makeScopes({
      project: { theme: "dark", sfPi: { guardrail: { confirmTimeoutMs: 5000 } } },
    });

    writeScopedDevbarColorOverrides(cwd, "project", { modelName: "#123456" }, globalSettingsFile);
    clearScopedDevbarColorOverride(cwd, "project", "modelName", globalSettingsFile);

    const scoped = readScopedDevbarSettings(cwd, "project", globalSettingsFile);
    expect(scoped.colors).toEqual({});
    const raw = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
    expect(raw.theme).toBe("dark");
    expect(raw.sfPi.guardrail.confirmTimeoutMs).toBe(5000);
    expect(raw.sfPi.devbar).toBeUndefined();
  });

  it("reset removes selected-scope colors and prunes empty parents", () => {
    const { cwd, globalSettingsFile } = makeScopes({
      project: { sfPi: { devbar: { colors: { folderPath: "#111111" } } } },
    });

    resetScopedDevbarColors(cwd, "project", globalSettingsFile);

    const raw = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
    expect(raw).toEqual({});
  });
});
