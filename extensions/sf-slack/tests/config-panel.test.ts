/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the SF Slack Manager settings panel. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { createConfigPanel } from "../lib/config-panel.ts";
import { readScopedSlackPreferences } from "../lib/preferences.ts";

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
  const dir = mkdtempSync(path.join(tmpdir(), "sf-slack-config-panel-"));
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

describe("sf-slack config panel", () => {
  it("edits preferences and saves them in place", () => {
    const cwd = tempCwd();
    const done = vi.fn();
    const panel = makePanel(cwd, done);

    panel.handleInput("\x1b[C"); // defaultFields: auto -> summary
    expect(panel.renderContent(100).join("\n")).toContain("unsaved changes");

    panel.handleInput("s");

    expect(done).not.toHaveBeenCalled();
    expect(readScopedSlackPreferences(cwd, "project").preferences.defaultFields).toBe("summary");
    expect(panel.renderContent(100).join("\n")).toContain("Saved Slack preferences.");

    panel.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith(undefined);
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
