/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Skills Manager settings panel. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { createConfigPanel } from "../lib/config-panel.ts";
import { readEffectiveSfSkillsSettings } from "../lib/settings.ts";

const tempDirs = new Set<string>();
const theme = {
  fg: (_c: string, s: string) => s,
  bg: (_c: string, s: string) => s,
  bold: (s: string) => s,
} as Theme;
type TestPanel = Focusable & {
  handleInput(data: string): void;
  renderContent(width: number): string[];
};
function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-skills-config-"));
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

describe("SF Skills config panel", () => {
  it("saves HUD visibility in place", () => {
    const cwd = tempCwd();
    const done = vi.fn();
    const panel = makePanel(cwd, done);
    panel.handleInput("\x1b[C");
    panel.handleInput("s");
    expect(done).not.toHaveBeenCalled();
    expect(readEffectiveSfSkillsSettings(cwd).hudVisibility).toBe("hidden");
    expect(panel.renderContent(100).join("\n")).toContain("Saved SF Skills settings.");
  });
});
