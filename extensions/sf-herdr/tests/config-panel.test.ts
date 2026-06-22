/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Herdr settings panel save / dirty-state behavior. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createConfigPanel } from "../lib/config-panel.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

const stubTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

type TestPanel = { handleInput(data: string): void; renderContent(width: number): string[] };

let tmpDir: string;
let prevAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-herdr-config-"));
  prevAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

function makePanel(onDone: (value: unknown) => void = () => undefined): TestPanel {
  return createConfigPanel(stubTheme, "/tmp/project", "global", onDone) as unknown as TestPanel;
}

describe("SF Herdr config panel", () => {
  it("marks default changes as unsaved, saves explicitly, and stays on the settings page", () => {
    let result: unknown = "not-called";
    const panel = makePanel((value) => {
      result = value;
    });

    expect(panel.renderContent(100).join("\n")).toContain("Saved");

    panel.handleInput(" ");
    const dirty = panel.renderContent(100).join("\n");
    expect(dirty).toContain("Unsaved changes");
    expect(result).toBe("not-called");

    panel.handleInput("s");

    expect(result).toBe("not-called");
    expect(panel.renderContent(100).join("\n")).toContain("Saved");
    const raw = JSON.parse(
      readFileSync(path.join(tmpDir, "sf-pi", "herdr", "preferences.json"), "utf-8"),
    );
    expect(raw.state.workflowMode).toBe("off");
  });

  it("edits workflow lane enabled state and lifecycle", () => {
    const panel = makePanel();

    // Move to Lane enabled (default selected workflow=generic, lane=tests).
    for (let i = 0; i < 6; i++) panel.handleInput("\x1b[B");
    panel.handleInput(" ");
    panel.handleInput("\x1b[B");
    panel.handleInput(" ");
    panel.handleInput("s");

    const raw = JSON.parse(
      readFileSync(path.join(tmpDir, "sf-pi", "herdr", "preferences.json"), "utf-8"),
    );
    expect(raw.state.workflows.generic.lanes.tests.enabled).toBe(false);
    expect(raw.state.workflows.generic.lanes.tests.lifecycle).toBe("sticky");
  });

  it("leaves without writing when escape is pressed with unsaved changes", () => {
    let result: unknown = "not-called";
    const panel = makePanel((value) => {
      result = value;
    });

    panel.handleInput(" ");
    panel.handleInput("\u001b");

    expect(result).toBeUndefined();
  });
});
