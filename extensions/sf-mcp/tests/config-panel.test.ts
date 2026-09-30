/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";

import { createConfigPanel } from "../lib/config-panel.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

type TestPanel = {
  handleInput(data: string): void;
  renderContent(width: number): string[];
};

function fixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-panel-"));
  tempDirs.push(cwd);
  const done = vi.fn();
  const ui = {
    select: vi.fn().mockResolvedValue(undefined),
    input: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(false),
    notify: vi.fn(),
  };
  const ctx = {
    isProjectTrusted: () => true,
    ui,
  };
  const panel = createConfigPanel(
    theme,
    cwd,
    "project",
    done,
    undefined,
    ctx as never,
  ) as unknown as TestPanel;
  return { cwd, done, ui, panel };
}

function moveDown(panel: TestPanel, count: number): void {
  for (let index = 0; index < count; index++) panel.handleInput("\u001b[B");
}

function typeText(panel: TestPanel, value: string): void {
  for (const character of value) panel.handleInput(character);
}

describe("SF MCP Manager catalog", () => {
  it("renders a colorful whitespace-first catalog without internal box borders", () => {
    const { panel } = fixture();

    moveDown(panel, 4);
    const output = panel.renderContent(110).join("\n");

    expect(output).toContain("☁  Salesforce MCPs");
    expect(output).toContain("◆  SObject All");
    expect(output).toContain("overlap with sf-soql");
    expect(output).not.toContain("╭");
    expect(output).not.toContain("╰");
  });

  it("opens Marketing Cloud setup inside the Manager panel without secondary dialogs", () => {
    const { panel, ui } = fixture();

    moveDown(panel, 6);
    panel.handleInput("\r");
    const output = panel.renderContent(110).join("\n");

    expect(output).toContain("SF MCP › Marketing Cloud › Setup");
    expect(output).toContain("Region");
    expect(output).toContain("Tenant ID");
    expect(output).toContain("Public app client ID");
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(ui.notify).not.toHaveBeenCalled();
  });

  it("keeps SObject All conflict resolution and hosted setup in the same panel", () => {
    const { panel, ui } = fixture();

    moveDown(panel, 4);
    panel.handleInput("\r");
    expect(panel.renderContent(110).join("\n")).toContain("Capability Review");

    panel.handleInput("\r");
    const output = panel.renderContent(110).join("\n");
    expect(output).toContain("SF MCP › SObject Mutations › Setup");
    expect(output).toContain("External Client App consumer key");
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it("completes setup, review, apply, and result without leaving the panel", () => {
    const { cwd, panel, done, ui } = fixture();

    moveDown(panel, 6);
    panel.handleInput("\r"); // Open setup.
    panel.handleInput("\r"); // Accept US and move to Tenant ID.
    typeText(panel, "tenant-example");
    panel.handleInput("\r"); // Move to client id.
    typeText(panel, "client-example");
    panel.handleInput("\r"); // Move to Review.
    panel.handleInput("\r"); // Open Review.

    const reviewLines = panel.renderContent(70);
    const review = reviewLines.join("\n");
    expect(review).toContain("SF MCP › Marketing Cloud › Review");
    expect(review).toContain("salesforce-marketing-cloud");
    expect(reviewLines.filter((line) => visibleWidth(line) > 70)).toEqual([]);

    panel.handleInput("\r"); // Apply.
    expect(panel.renderContent(110).join("\n")).toContain("Marketing Cloud saved");
    const config = JSON.parse(readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"));
    expect(config.mcpServers["salesforce-marketing-cloud"].url).toContain("tenant-example");
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
    expect(ui.confirm).not.toHaveBeenCalled();

    panel.handleInput("\r"); // Return to Manager detail with reload pending.
    expect(done).toHaveBeenCalledWith({ needsReload: true });
  });

  it("keeps the embedded setup page width-safe at the Manager minimum", () => {
    const { panel } = fixture();

    moveDown(panel, 6);
    panel.handleInput("\r");
    const lines = panel.renderContent(70);

    expect(lines.every((line) => visibleWidth(line) <= 70)).toBe(true);
  });

  it("uses Escape as an in-panel back action before closing the Manager page", () => {
    const { panel, done } = fixture();

    moveDown(panel, 6);
    panel.handleInput("\r");
    panel.handleInput("\u001b");

    expect(panel.renderContent(110).join("\n")).toContain("☁  Salesforce MCPs");
    expect(done).not.toHaveBeenCalled();
  });
});
