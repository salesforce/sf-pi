/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the SF Welcome Manager settings panel. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
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
  it("saves startup surface mode in place", () => {
    const cwd = tempCwd();
    const done = vi.fn();
    const panel = makePanel(cwd, done);

    panel.handleInput("\x1b[C");
    expect(panel.renderContent(100).join("\n")).toContain("unsaved changes");
    panel.handleInput("s");

    expect(done).not.toHaveBeenCalled();
    expect(readEffectiveWelcomeSettings(cwd).startupMode).toBe("overlay");
    expect(panel.renderContent(100).join("\n")).toContain("Saved Welcome settings.");
  });
});
