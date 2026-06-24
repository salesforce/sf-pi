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
  it("shows only split direction and workflow lane lifecycle controls", () => {
    const panel = makePanel();
    const rendered = panel.renderContent(100).join("\n");

    expect(rendered).toContain("Split direction");
    expect(rendered).toContain("Workflow");
    expect(rendered).toContain("Lane");
    expect(rendered).toContain("Lane lifecycle");
    expect(rendered).not.toContain("Workflow mode");
    expect(rendered).not.toContain("Lane style");
    expect(rendered).not.toContain("Preserve focus");
    expect(rendered).not.toContain("Lane enabled");
  });

  it("marks split-direction changes as unsaved, saves explicitly, and stays on settings", () => {
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
    expect(raw.state.defaults.splitDirection).toBe("down");
    expect(raw.state.workflowMode).toBeUndefined();
    expect(raw.state.defaults.laneStyle).toBeUndefined();
    expect(raw.state.defaults.preserveFocus).toBeUndefined();
  });

  it("edits workflow lane lifecycle", () => {
    const panel = makePanel();

    // Move to Lane lifecycle (default selected workflow=generic, lane=tests).
    for (let i = 0; i < 3; i++) panel.handleInput("\x1b[B");
    panel.handleInput(" ");
    panel.handleInput("s");

    const raw = JSON.parse(
      readFileSync(path.join(tmpDir, "sf-pi", "herdr", "preferences.json"), "utf-8"),
    );
    expect(raw.state.workflows.generic.lanes.tests.lifecycle).toBe("sticky");
    expect(raw.state.workflows.generic.lanes.tests.enabled).toBeUndefined();
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
