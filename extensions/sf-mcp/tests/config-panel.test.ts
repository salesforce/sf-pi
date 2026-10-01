/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";

import { createConfigPanel } from "../lib/config-panel.ts";
import { captureObservedMcpTools } from "../lib/observed-tools.ts";
import { installPreset } from "../lib/service.ts";

const tempDirs: string[] = [];

afterEach(() => {
  captureObservedMcpTools([]);
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

function fixture(mcpRoot?: unknown) {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-panel-"));
  tempDirs.push(cwd);
  if (mcpRoot) {
    const configDir = path.join(cwd, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, "mcp.json"), `${JSON.stringify(mcpRoot, null, 2)}\n`);
  }
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

    moveDown(panel, 5);
    const output = panel.renderContent(110).join("\n");

    expect(output).toContain("☁  Salesforce MCPs");
    expect(output).toContain("◎  Headless 360");
    expect(output).toContain("overlap with sf-soql");
    expect(output).not.toContain("╭");
    expect(output).not.toContain("╰");
  });

  it("opens a non-mutating overview before configuring a preset", () => {
    const { panel, ui } = fixture();

    moveDown(panel, 5);
    panel.handleInput("\r");
    const overview = panel.renderContent(110).join("\n");

    expect(overview).toContain("SF MCP › Headless 360 › Overview");
    expect(overview).toContain("4 documented");
    expect(overview).toContain("Operation discovery");
    expect(overview).toContain("Review tools");
    expect(overview).not.toContain("Capability Review");
    expect(overview).not.toContain("External Client App consumer key");

    panel.handleInput("\r");
    const tools = panel.renderContent(110).join("\n");
    expect(tools).toContain("SF MCP › Headless 360 › Tools");
    expect(tools).toContain("discover");
    expect(tools).toContain("dispatch_readonly");

    panel.handleInput("\r");
    const detail = panel.renderContent(110).join("\n");
    expect(detail).toContain("SF MCP › Headless 360 › discover");
    expect(detail).toContain("Find Salesforce operations by natural-language intent");
    expect(detail).toContain("Risk");
    expect(detail).toContain("DOCUMENTATION");
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it("configures a read-only profile and supports custom per-tool exposure without writing", () => {
    const { cwd, panel } = fixture();

    moveDown(panel, 5);
    panel.handleInput("\r"); // Overview.
    panel.handleInput("\u001b[B"); // Configure tools.
    panel.handleInput("\r");
    expect(panel.renderContent(110).join("\n")).toContain("Tool Exposure Profiles");

    panel.handleInput("\u001b[B"); // Read-only.
    panel.handleInput("\r");
    let output = panel.renderContent(110).join("\n");
    expect(output).toContain("Tool Exposure Policy");
    expect(output).toContain("READ-ONLY");
    expect(output).toContain("dispatch");
    expect(output).toContain("Hidden");

    panel.handleInput("\u001b[B");
    panel.handleInput("\u001b[B"); // dispatch.
    panel.handleInput("\u001b[C");
    panel.handleInput("\u001b[C");
    panel.handleInput("\u001b[C"); // Hidden → Direct.
    output = panel.renderContent(110).join("\n");
    expect(output).toContain("CUSTOM");
    expect(output).toContain("Direct exposure with Mixed risk");
    expect(existsSync(path.join(cwd, ".pi", "mcp.json"))).toBe(false);
  });

  it("carries a selected tool profile through conflict, setup, review, and apply", () => {
    const { cwd, panel } = fixture();

    moveDown(panel, 5);
    panel.handleInput("\r"); // Overview.
    panel.handleInput("\u001b[B"); // Configure tools.
    panel.handleInput("\r");
    panel.handleInput("\u001b[B"); // Read-only.
    panel.handleInput("\r");
    panel.handleInput("A"); // Continue to conflict review.
    expect(panel.renderContent(110).join("\n")).toContain("Capability Review");

    panel.handleInput("\u001b[B"); // Enable side-by-side.
    panel.handleInput("\r");
    panel.handleInput("\r"); // Accept sandbox and focus client id.
    typeText(panel, "consumer-key");
    panel.handleInput("\r"); // Review action.
    panel.handleInput("\r"); // Open review.
    const reviewLines = panel.renderContent(70);
    const review = reviewLines.join("\n");
    expect(review).toContain("TOOL EXPOSURE");
    expect(review).toContain("Read-only");
    expect(reviewLines.every((line) => visibleWidth(line) <= 70)).toBe(true);

    panel.handleInput("\r"); // Apply.
    const config = JSON.parse(readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"));
    expect(config.mcpServers["salesforce-headless-360"].toolExposure).toEqual({
      discover: "codemode",
      describe: "codemode",
      dispatch: "hidden",
      dispatch_readonly: "codemode",
    });
  });

  it("diff-reviews and updates tool exposure on an existing managed preset", () => {
    const { cwd, panel } = fixture();
    expect(
      installPreset({
        cwd,
        scope: "project",
        presetId: "data360",
        resolution: "side-by-side",
        setup: { environment: "sandbox", oauthClientId: "consumer-key" },
      }).ok,
    ).toBe(true);

    moveDown(panel, 1);
    panel.handleInput("\r"); // Overview.
    panel.handleInput("\u001b[B"); // Configure tools.
    panel.handleInput("\r");
    moveDown(panel, 4); // Quarantine.
    panel.handleInput("\r");
    panel.handleInput("A");
    const review = panel.renderContent(110).join("\n");
    expect(review).toContain("Tool Policy Review");
    expect(review).toContain("Quarantine");
    expect(review).toContain("execute:hidden");

    panel.handleInput("\r"); // Apply.
    const config = JSON.parse(readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"));
    expect(Object.values(config.mcpServers["salesforce-data360"].toolExposure)).toEqual([
      "hidden",
      "hidden",
      "hidden",
    ]);
  });

  it("reviews exact tool conflicts and opens the native-preferred recommendation", () => {
    const { panel } = fixture();

    moveDown(panel, 5);
    panel.handleInput("\r"); // Overview.
    moveDown(panel, 2); // Review tool conflicts.
    panel.handleInput("\r");
    const conflictLines = panel.renderContent(70);
    const conflicts = conflictLines.join("\n");
    expect(conflicts).toContain("Tool Conflict Review");
    expect(conflictLines.every((line) => visibleWidth(line) <= 70)).toBe(true);
    expect(conflicts).toContain("dispatch");
    expect(conflicts).toContain("sf-soql · sf-apex · sf-flow");
    expect(conflicts).toContain("Broad meta-tool");

    panel.handleInput("\r"); // Inspect dispatch.
    const detail = panel.renderContent(110).join("\n");
    expect(detail).toContain("dispatch Conflict");
    expect(detail).toContain("Pi can expose or hide the MCP tool");
    panel.handleInput("\u001b");

    panel.handleInput("N"); // Prefer SF Pi owners.
    const policy = panel.renderContent(110).join("\n");
    expect(policy).toContain("Tool Exposure Policy");
    expect(policy).toContain("RECOMMENDED");
    expect(policy).toContain("dispatch_readonly");
    expect(policy).toContain("Deferred");
  });

  it("reviews runtime drift and repairs removed tools without approving additions", () => {
    const { cwd, panel } = fixture();
    expect(
      installPreset({
        cwd,
        scope: "project",
        presetId: "data360",
        resolution: "side-by-side",
        setup: { environment: "sandbox", oauthClientId: "consumer-key" },
      }).ok,
    ).toBe(true);
    captureObservedMcpTools([
      { name: "mcp__salesforce_data360__search", exposure: "codemode" },
      { name: "mcp__salesforce_data360__unexpected_write", exposure: "hidden" },
    ]);

    moveDown(panel, 1);
    panel.handleInput("\r"); // Overview.
    moveDown(panel, 3); // Review contract drift.
    panel.handleInput("\r");
    const driftLines = panel.renderContent(70);
    const drift = driftLines.join("\n");
    expect(drift).toContain("Contract Drift Review");
    expect(driftLines.every((line) => visibleWidth(line) <= 70)).toBe(true);
    expect(drift).toContain("unexpected_write");
    expect(drift).toContain("locked hidden");
    expect(drift).toContain("payload_examples");
    expect(drift).toContain("unavailable");
    expect(drift).toContain("preset revision");

    panel.handleInput("R"); // Repair removed exposure.
    expect(panel.renderContent(110).join("\n")).toContain("Tool Policy Review");
    panel.handleInput("\r"); // Apply.

    const config = JSON.parse(readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"));
    expect(config.mcpServers["salesforce-data360"].toolExposure).toEqual({
      search: "codemode",
      payload_examples: "hidden",
      execute: "hidden",
    });
    expect(config.mcpServers["salesforce-data360"].toolExposure.unexpected_write).toBeUndefined();
  });

  it("keeps overview, tool list, and tool detail width-safe at the Manager minimum", () => {
    const { panel } = fixture();

    moveDown(panel, 5);
    panel.handleInput("\r");
    expect(panel.renderContent(70).every((line) => visibleWidth(line) <= 70)).toBe(true);

    panel.handleInput("\r");
    expect(panel.renderContent(70).every((line) => visibleWidth(line) <= 70)).toBe(true);

    panel.handleInput("\r");
    expect(panel.renderContent(70).every((line) => visibleWidth(line) <= 70)).toBe(true);
  });

  it("keeps profile and tool policy pages width-safe at the Manager minimum", () => {
    const { panel } = fixture();

    moveDown(panel, 5);
    panel.handleInput("\r");
    panel.handleInput("\u001b[B");
    panel.handleInput("\r");
    expect(panel.renderContent(70).every((line) => visibleWidth(line) <= 70)).toBe(true);

    panel.handleInput("\u001b[B");
    panel.handleInput("\r");
    expect(panel.renderContent(70).every((line) => visibleWidth(line) <= 70)).toBe(true);
  });

  it("shows live descriptions, schemas, annotations, and exposure for observed tools", () => {
    captureObservedMcpTools([
      {
        name: "mcp__salesforce_dx__list_all_orgs",
        description: "Lists every Salesforce org authorized in this environment.",
        parameters: {
          type: "object",
          properties: { includeExpired: { type: "boolean" } },
          required: ["includeExpired"],
        },
        exposure: "codemode",
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
    ]);
    const { panel } = fixture();

    panel.handleInput("\r");
    panel.handleInput("\r");
    expect(panel.renderContent(110).join("\n")).toContain("list_all_orgs");

    panel.handleInput("\r");
    const detail = panel.renderContent(110).join("\n");
    expect(detail).toContain("Lists every Salesforce org authorized in this environment.");
    expect(detail).toContain("includeExpired");
    expect(detail).toContain("read-only");
    expect(detail).toContain("codemode");
    expect(detail).toContain("Observed live");
  });

  it("shows support maturity for experimental hosted presets", () => {
    const { panel } = fixture();

    const output = panel.renderContent(110).join("\n");

    expect(output).toContain("Content Read-Only");
    expect(output).toContain("ALPHA");
    expect(output).toContain("CRM Analytics");
    expect(output).toContain("BETA");
  });

  it("adopts a compatible manual entry without replacing it", () => {
    const config = {
      mcpServers: {
        "salesforce-data360": {
          url: "https://api.salesforce.com/platform/mcp/v1/data/sandbox/data360",
          oauth: { clientId: "existing-client" },
          exposure: "hidden",
          toolExposure: {
            search: "codemode",
            payload_examples: "codemode",
            execute: "codemode",
          },
        },
      },
    };
    const { cwd, panel } = fixture(config);

    moveDown(panel, 1);
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\u001b[B"); // Review tool conflicts.
    panel.handleInput("\u001b[B"); // Review configuration.
    panel.handleInput("\r");
    expect(panel.renderContent(110).join("\n")).toContain("Configuration Review");
    expect(panel.renderContent(110).join("\n")).toContain("Adopt existing entry");

    panel.handleInput("\r");
    expect(panel.renderContent(110).join("\n")).toContain("Adopted");
    expect(JSON.parse(readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"))).toEqual(config);
  });

  it("opens Marketing Cloud setup inside the Manager panel without secondary dialogs", () => {
    const { panel, ui } = fixture();

    moveDown(panel, 8);
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\u001b[B"); // Configure.
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

  it("keeps Headless 360 conflict resolution and hosted setup in the same panel", () => {
    const { panel, ui } = fixture();

    moveDown(panel, 5);
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\u001b[B"); // Configure tools.
    panel.handleInput("\u001b[B"); // Review tool conflicts.
    panel.handleInput("\u001b[B"); // Configure connection.
    panel.handleInput("\r");
    expect(panel.renderContent(110).join("\n")).toContain("Capability Review");

    panel.handleInput("\u001b[B");
    panel.handleInput("\r");
    const output = panel.renderContent(110).join("\n");
    expect(output).toContain("SF MCP › Headless 360 › Setup");
    expect(output).toContain("External Client App consumer key");
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it("completes setup, review, apply, and result without leaving the panel", () => {
    const { cwd, panel, done, ui } = fixture();

    moveDown(panel, 8);
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\u001b[B"); // Configure.
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

    moveDown(panel, 8);
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\u001b[B"); // Configure.
    panel.handleInput("\r");
    const lines = panel.renderContent(70);

    expect(lines.every((line) => visibleWidth(line) <= 70)).toBe(true);
  });

  it("uses Escape as an in-panel back action before closing the Manager page", () => {
    const { panel, done } = fixture();

    moveDown(panel, 8);
    panel.handleInput("\r");
    panel.handleInput("\u001b");

    expect(panel.renderContent(110).join("\n")).toContain("☁  Salesforce MCPs");
    expect(done).not.toHaveBeenCalled();
  });
});
