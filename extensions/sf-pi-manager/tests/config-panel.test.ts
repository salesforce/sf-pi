/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Pi Manager settings panel interaction. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { createConfigPanel } from "../lib/config-panel.ts";
import { readScopedSfPiDisplaySettings } from "../../../lib/common/display/settings.ts";

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
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-manager-config-panel-"));
  tempDirs.add(dir);
  return dir;
}

function makePanel(cwd: string, done: (result: unknown) => void = vi.fn()): TestPanel {
  return createConfigPanel(theme, cwd, "project", done as never) as TestPanel;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("sf-pi manager config panel", () => {
  it("saves the display profile in place", () => {
    const cwd = tempCwd();
    const done = vi.fn();
    const panel = makePanel(cwd, done);

    panel.handleInput("\x1b[C"); // balanced -> verbose
    expect(panel.renderContent(100).join("\n")).toContain("Unsaved change");

    panel.handleInput("\r");

    expect(done).not.toHaveBeenCalled();
    expect(readScopedSfPiDisplaySettings(cwd, "project").settings.profile).toBe("verbose");
    expect(panel.renderContent(100).join("\n")).toContain("Saved display profile.");

    panel.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("stays open on no-op save", () => {
    const cwd = tempCwd();
    const done = vi.fn();
    const panel = makePanel(cwd, done);

    panel.handleInput("\r");

    expect(done).not.toHaveBeenCalled();
    expect(panel.renderContent(100).join("\n")).toContain("No changes to save.");
  });
});
