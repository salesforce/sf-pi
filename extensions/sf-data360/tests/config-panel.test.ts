/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the SF Data 360 Manager settings panel. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { createConfigPanel } from "../lib/config-panel.ts";
import { readScopedData360Settings } from "../lib/settings.ts";

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
  const dir = mkdtempSync(path.join(tmpdir(), "sf-data360-config-panel-"));
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

describe("Data 360 config panel", () => {
  it("saves default output mode in place", () => {
    const cwd = tempCwd();
    const done = vi.fn();
    const panel = makePanel(cwd, done);

    panel.handleInput("\x1b[C"); // summary -> inline
    expect(panel.renderContent(100).join("\n")).toContain("unsaved");

    panel.handleInput("s");

    expect(done).not.toHaveBeenCalled();
    expect(readScopedData360Settings(cwd, "project").settings.defaultOutputMode).toBe("inline");
    expect(panel.renderContent(100).join("\n")).toContain("Saved Data 360 settings.");
  });

  it("stays open on no-op save", () => {
    const cwd = tempCwd();
    const done = vi.fn();
    const panel = makePanel(cwd, done);

    panel.handleInput("s");

    expect(done).not.toHaveBeenCalled();
    expect(panel.renderContent(100).join("\n")).toContain("No changes to save.");
  });
});
