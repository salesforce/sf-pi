/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the Ohana Spinner Manager settings panel. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { createConfigPanel } from "../lib/config-panel.ts";
import { readScopedOhanaSpinnerSettings } from "../lib/settings.ts";

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
  const dir = mkdtempSync(path.join(tmpdir(), "sf-ohana-spinner-config-panel-"));
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

describe("ohana spinner config panel", () => {
  it("saves mode in place and reports reload when leaving", () => {
    const cwd = tempCwd();
    const done = vi.fn();
    const panel = makePanel(cwd, done);

    panel.handleInput("\x1b[C"); // ohana -> calm
    expect(panel.renderContent(100).join("\n")).toContain("Unsaved change");

    panel.handleInput("\r");

    expect(done).not.toHaveBeenCalled();
    expect(readScopedOhanaSpinnerSettings(cwd, "project").settings.mode).toBe("calm");
    expect(panel.renderContent(100).join("\n")).toContain("Reload required");

    panel.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith({ needsReload: true });
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
