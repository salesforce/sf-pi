/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Pi Manager settings panel interaction. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { createConfigPanel } from "../lib/config-panel.ts";
import {
  readAutoUpdateEnabled,
  writeAutoUpdateEnabled,
} from "../../../lib/common/auto-update/store.ts";
import { readScopedSfPiDisplaySettings } from "../../../lib/common/display/settings.ts";

const tempDirs = new Set<string>();
const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
let prevAgentDir: string | undefined;

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

beforeEach(() => {
  prevAgentDir = process.env[PI_AGENT_ENV];
  const agentDir = mkdtempSync(path.join(tmpdir(), "sf-pi-manager-agent-"));
  tempDirs.add(agentDir);
  process.env[PI_AGENT_ENV] = agentDir;
});

afterEach(() => {
  if (prevAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgentDir;
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
    expect(panel.renderContent(100).join("\n")).toContain("Saved settings.");

    panel.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("saves the global auto-update toggle from the settings panel", () => {
    const cwd = tempCwd();
    writeAutoUpdateEnabled(false);
    const panel = makePanel(cwd);

    panel.handleInput("\x1b[A"); // select auto-update row
    panel.handleInput(" ");
    expect(panel.renderContent(100).join("\n")).toContain("Unsaved change");

    panel.handleInput("\r");

    expect(readAutoUpdateEnabled()).toBe(true);
    expect(panel.renderContent(100).join("\n")).toContain("Saved settings.");
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
