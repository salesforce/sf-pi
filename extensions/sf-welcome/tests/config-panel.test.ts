/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the SF Welcome Manager settings panel. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { resolveConfiguredWelcomeMode } from "../../../lib/common/doctor/diagnostics.ts";
import { createConfigPanel } from "../lib/config-panel.ts";
import { readEffectiveWelcomeSettings } from "../lib/welcome-settings.ts";

const tempDirs = new Set<string>();
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

type TestPanel = Focusable & {
  handleInput(data: string): void;
  renderContent(width: number): string[];
};

function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-welcome-config-panel-"));
  tempDirs.add(dir);
  return dir;
}

function makePanel(cwd: string, done: (result: unknown) => void = vi.fn()): TestPanel {
  return createConfigPanel(theme, cwd, "project", done as never) as TestPanel;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe("sf-welcome config panel", () => {
  it("saves the SF Welcome mode without taking ownership of Pi quiet startup", () => {
    const cwd = tempCwd();
    const done = vi.fn();
    const panel = makePanel(cwd, done);

    panel.handleInput("\x1b[C");
    expect(panel.renderContent(100).join("\n")).toContain("unsaved changes");
    panel.handleInput("s");

    const settings = JSON.parse(readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"));
    expect(done).not.toHaveBeenCalled();
    expect(readEffectiveWelcomeSettings(cwd).startupMode).toBe("off");
    expect(settings.quietStartup).toBeUndefined();
    expect(settings.sfPi.welcome.mode).toBe("off");
    expect(resolveConfiguredWelcomeMode(cwd)).toBe("off");
    expect(panel.renderContent(100).join("\n")).toContain("Saved Welcome settings.");
  });

  it("preserves Pi's header-only startup setting while cycling through every Welcome mode", () => {
    const cwd = tempCwd();
    const settingsPath = path.join(cwd, ".pi", "settings.json");
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify({ quietStartup: "header" }, null, 2)}\n`);
    const panel = makePanel(cwd);

    panel.handleInput("\x1b[C");
    expect(panel.renderContent(100).join("\n")).toContain("off");
    panel.handleInput("s");

    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.quietStartup).toBe("header");
    expect(settings.sfPi.welcome.mode).toBe("off");
    expect(readEffectiveWelcomeSettings(cwd).startupMode).toBe("off");
    expect(resolveConfiguredWelcomeMode(cwd)).toBe("off");
  });

  it("migrates the removed legacy overlay preference to the non-blocking header", () => {
    const cwd = tempCwd();
    const settingsPath = path.join(cwd, ".pi", "settings.json");
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify({ quietStartup: false }, null, 2)}\n`);

    expect(readEffectiveWelcomeSettings(cwd).startupMode).toBe("header");
    expect(resolveConfiguredWelcomeMode(cwd)).toBe("header");
  });
});
