/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";

import { createConfigPanel } from "../lib/config-panel.ts";
import { captureObservedMcpTools } from "../lib/observed-tools.ts";
import { SALESFORCE_MCP_PRESETS, getPreset, type McpPresetId } from "../lib/presets.ts";
import { installPreset } from "../lib/service.ts";
import { inspectPresetTools } from "../lib/tool-catalog.ts";
import { renderToolPolicyPage } from "../lib/tool-policy-pages.ts";
import { buildToolExposurePolicy } from "../lib/tool-policy.ts";

const tempDirs: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  captureObservedMcpTools([]);
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
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

function fixture(mcpRoot?: unknown, panelTheme = theme) {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-panel-"));
  tempDirs.push(cwd);
  process.env.PI_CODING_AGENT_DIR = path.join(cwd, "agent");
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
    panelTheme,
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

function moveToPreset(panel: TestPanel, presetId: McpPresetId): void {
  const index = SALESFORCE_MCP_PRESETS.findIndex((preset) => preset.id === presetId);
  if (index < 0) throw new Error(`Unknown test preset: ${presetId}`);
  moveDown(panel, index);
}

function typeText(panel: TestPanel, value: string): void {
  for (const character of value) panel.handleInput(character);
}

describe("SF MCP Manager catalog", () => {
  it("renders a colorful category-grouped catalog without internal box borders", () => {
    const { panel } = fixture();

    moveToPreset(panel, "headless-360");
    const output = panel.renderContent(110).join("\n");

    expect(output).toContain("☁  Salesforce MCPs");
    expect(output).toContain("SALESFORCE CORE");
    expect(output).toContain("DATA CLOUD");
    expect(output).toContain("TABLEAU");
    expect(output).toContain("MULESOFT");
    expect(output).toContain("TRAILHEAD");
    expect(output).toContain("◎  Headless 360");
    expect(output).toContain("overlap with sf-soql");
    expect(output.indexOf("SALESFORCE CORE")).toBeLessThan(output.indexOf("DATA CLOUD"));
    expect(output.indexOf("DATA CLOUD")).toBeLessThan(output.indexOf("TABLEAU"));
    expect(output.indexOf("TABLEAU")).toBeLessThan(output.indexOf("MULESOFT"));
    expect(output.indexOf("MULESOFT")).toBeLessThan(output.indexOf("TRAILHEAD"));
    expect(output).toContain("────────");
    expect(output).not.toContain("╭");
    expect(output).not.toContain("╰");
  });

  it("reserves a right gutter for the Manager scrollbar", () => {
    const { panel } = fixture();
    const lines = panel.renderContent(70);
    const categoryLine = lines.find((line) => line.includes("SALESFORCE CORE"));
    const presetLine = lines.find((line) => line.includes("Data 360"));

    expect(categoryLine).toBeDefined();
    expect(presetLine).toBeDefined();
    expect(visibleWidth((categoryLine ?? "").trimEnd())).toBeLessThanOrEqual(67);
    expect(visibleWidth((presetLine ?? "").trimEnd())).toBeLessThanOrEqual(67);
  });

  it("renders category dividers in the accent color", () => {
    const accentTheme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => text,
    } as never;
    const { panel } = fixture(undefined, accentTheme);

    const output = panel.renderContent(110).join("\n");

    expect(output).toContain("<accent>◆ SALESFORCE CORE ────");
    expect(output).toContain("<accent>◆ TABLEAU ────");
    expect(output).not.toContain("<muted>SALESFORCE CORE</muted>");
  });

  it("opens a non-mutating overview before configuring a preset", () => {
    const { panel, ui } = fixture();

    moveToPreset(panel, "headless-360");
    panel.handleInput("\r");
    const overview = panel.renderContent(110).join("\n");

    expect(overview).toContain("SF MCP › Headless 360 › Overview");
    expect(overview).toContain("4 documented");
    expect(overview).toContain("Operation discovery");
    expect(overview).toContain("Configure MCP");
    expect(overview).toContain("Browse tool details");
    expect(overview).not.toContain("Capability Review");
    expect(overview).not.toContain("External Client App consumer key");

    panel.handleInput("\u001b[B");
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

  it("renders prominent color-coded exposure badges and guidance", () => {
    const contrastTheme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => text,
    } as never;
    const preset = getPreset("data360");
    const policy = buildToolExposurePolicy(preset, "quarantine");
    policy.exposures = {
      search: "codemode",
      payload_examples: "deferred",
      execute: "direct",
    };
    const output = renderToolPolicyPage({
      theme: contrastTheme,
      width: 110,
      preset,
      policy,
      tools: inspectPresetTools(preset),
      cursor: 0,
    }).join("\n");

    expect(output).toContain("<accent>[ CODE MODE ]</accent>");
    expect(output).toContain("<warning>[ DEFERRED ]</warning>");
    expect(output).toContain("<error>[ DIRECT ]</error>");
    expect(output).toContain("TOOL ACCESS MODES");
    expect(output).toContain("Off; the model cannot call this tool");
    expect(output).toContain("S Review & Save");
  });

  it("combines connection, conflict, and exposure configuration in one editor", () => {
    const { panel } = fixture();

    moveToPreset(panel, "headless-360");
    panel.handleInput("\r");
    let output = panel.renderContent(110).join("\n");

    expect(output).toContain("Configure MCP");
    expect(output).not.toContain("Configure tool exposure");
    expect(output).not.toContain("Review tool conflicts");
    expect(output).not.toContain("Review current configuration");

    panel.handleInput("\r");
    output = panel.renderContent(110).join("\n");
    expect(output).toContain("SF MCP › Headless 360 › Configure MCP");
    expect(output).toContain("CONNECTION");
    expect(output).toContain("NOT CONFIGURED");
    expect(output).toContain("4 reviewed · 4 available");
    expect(output).toContain("1. discover");
    expect(output).toContain("Purpose: Operation discovery");
    expect(output).toContain("[ CODE MODE ]");
    expect(output).toContain("CONFLICT");
    expect(output).toContain("Recommended Hidden");
    expect(output).toContain("TOOL ACCESS MODES");
    expect(output).toContain("S Review & Save");
  });

  it("configures a read-only profile and supports custom per-tool exposure without writing", () => {
    const { cwd, panel } = fixture();

    moveToPreset(panel, "headless-360");
    panel.handleInput("\r"); // Overview.
    panel.handleInput("\r"); // Unified editor.
    panel.handleInput("P");
    expect(panel.renderContent(110).join("\n")).toContain("Tool Exposure Profiles");

    panel.handleInput("\u001b[B"); // Read-only.
    panel.handleInput("\r");
    let output = panel.renderContent(110).join("\n");
    expect(output).toContain("Configure MCP");
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
    expect(output).toContain("[ DIRECT ]");
    expect(output).toContain("Direct exposure with Mixed risk");
    expect(existsSync(path.join(cwd, ".pi", "mcp.json"))).toBe(false);
  });

  it("carries a selected tool profile through conflict, setup, review, and apply", () => {
    const { cwd, panel } = fixture();

    moveToPreset(panel, "headless-360");
    panel.handleInput("\r"); // Overview.
    panel.handleInput("\r"); // Unified editor.
    panel.handleInput("P");
    panel.handleInput("\u001b[B"); // Read-only.
    panel.handleInput("\r");
    panel.handleInput("S"); // Review and save.
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

    moveToPreset(panel, "data360");
    panel.handleInput("\r"); // Overview.
    panel.handleInput("\r"); // Unified editor.
    panel.handleInput("P");
    moveDown(panel, 4); // Quarantine.
    panel.handleInput("\r");
    panel.handleInput("S");
    const review = panel.renderContent(110).join("\n");
    expect(review).toContain("Review & Save");
    expect(review).toContain("Save configuration");
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

  it("shows exact tool conflicts and recommendations inline", () => {
    const { panel } = fixture();

    moveToPreset(panel, "headless-360");
    panel.handleInput("\r"); // Overview.
    panel.handleInput("\r"); // Unified editor.
    moveDown(panel, 2); // dispatch.
    const conflictLines = panel.renderContent(70);
    const conflicts = conflictLines.join("\n");

    expect(conflictLines.every((line) => visibleWidth(line) <= 70)).toBe(true);
    expect(conflicts).toContain("3. dispatch");
    expect(conflicts).toContain("sf-soql · sf-apex · sf-flow");
    expect(conflicts).toMatch(/Recommended\s+Hidden/);
    expect(conflicts).toContain("broad meta-tool");
    expect(conflicts).toContain("[ HIDDEN ]");
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

    moveToPreset(panel, "data360");
    panel.handleInput("\r"); // Overview.
    moveDown(panel, 2); // Review contract drift.
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
    expect(panel.renderContent(110).join("\n")).toContain("Review & Save");
    panel.handleInput("\r"); // Apply.

    const config = JSON.parse(readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"));
    expect(config.mcpServers["salesforce-data360"].toolExposure).toEqual({
      search: "codemode",
      payload_examples: "hidden",
      execute: "hidden",
    });
    expect(config.mcpServers["salesforce-data360"].toolExposure.unexpected_write).toBeUndefined();
  });

  it("keeps overview, unified editor, and tool detail width-safe at the Manager minimum", () => {
    const { panel } = fixture();

    moveToPreset(panel, "headless-360");
    panel.handleInput("\r");
    expect(panel.renderContent(70).every((line) => visibleWidth(line) <= 70)).toBe(true);

    panel.handleInput("\r");
    expect(panel.renderContent(70).every((line) => visibleWidth(line) <= 70)).toBe(true);

    panel.handleInput("\r");
    expect(panel.renderContent(70).every((line) => visibleWidth(line) <= 70)).toBe(true);
  });

  it("keeps profile and tool policy pages width-safe at the Manager minimum", () => {
    const { panel } = fixture();

    moveToPreset(panel, "headless-360");
    panel.handleInput("\r");
    panel.handleInput("\r");
    panel.handleInput("P");
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

    moveDown(panel, 2);
    panel.handleInput("\r");
    const detail = panel.renderContent(110).join("\n");
    expect(detail).toContain("Lists every Salesforce org authorized in this environment.");
    expect(detail).toContain("includeExpired");
    expect(detail).toContain("read-only");
    expect(detail).toContain("Code Mode");
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

    moveToPreset(panel, "data360");
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\r"); // Unified configure action opens reconciliation.
    expect(panel.renderContent(110).join("\n")).toContain("Configuration Review");
    expect(panel.renderContent(110).join("\n")).toContain("Adopt existing entry");

    panel.handleInput("\r");
    expect(panel.renderContent(110).join("\n")).toContain("Adopted");
    expect(JSON.parse(readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"))).toEqual(config);
  });

  it("opens Marketing Cloud setup inside the Manager panel without secondary dialogs", () => {
    const { panel, ui } = fixture();

    moveToPreset(panel, "marketing-cloud");
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\r"); // Unified editor.
    panel.handleInput("S"); // Continue to setup.
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

  it("opens experimental Agentforce Sales sandbox setup with environment-only secret guidance", () => {
    const { panel } = fixture();

    moveToPreset(panel, "agentforce-sales");
    panel.handleInput("\r"); // Overview.
    panel.handleInput("\r"); // Configure MCP opens capability review.
    panel.handleInput("\u001b[B"); // Experimental side-by-side.
    panel.handleInput("\r"); // Agentforce Sales setup.
    const output = panel.renderContent(110).join("\n");

    expect(output).toContain("SF MCP › Agentforce Sales › Setup");
    expect(output).toContain("External Client App consumer key");
    expect(output).toContain("AGENTFORCE_SALES_CLIENT_SECRET");
    expect(output).toContain("generic-client interoperability is experimental");
  });

  it("keeps Headless 360 conflict resolution and hosted setup in the same panel", () => {
    const { panel, ui } = fixture();

    moveToPreset(panel, "headless-360");
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\r"); // Unified editor.
    panel.handleInput("S"); // Review and save.
    expect(panel.renderContent(110).join("\n")).toContain("Capability Review");

    panel.handleInput("\u001b[B");
    panel.handleInput("\r");
    const output = panel.renderContent(110).join("\n");
    expect(output).toContain("SF MCP › Headless 360 › Setup");
    expect(output).toContain("External Client App consumer key");
    expect(output).toContain("http://localhost:8765/callback");
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it("completes setup, review, apply, and result without leaving the panel", () => {
    const { cwd, panel, done, ui } = fixture();

    moveToPreset(panel, "marketing-cloud");
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\r"); // Unified editor.
    panel.handleInput("S"); // Open setup.
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

    moveToPreset(panel, "marketing-cloud");
    panel.handleInput("\r"); // Open overview.
    panel.handleInput("\r"); // Unified editor.
    panel.handleInput("S"); // Configure connection.
    const lines = panel.renderContent(70);

    expect(lines.every((line) => visibleWidth(line) <= 70)).toBe(true);
  });

  it("uses Escape as an in-panel back action before closing the Manager page", () => {
    const { panel, done } = fixture();

    moveToPreset(panel, "marketing-cloud");
    panel.handleInput("\r");
    panel.handleInput("\u001b");

    expect(panel.renderContent(110).join("\n")).toContain("☁  Salesforce MCPs");
    expect(done).not.toHaveBeenCalled();
  });
});
