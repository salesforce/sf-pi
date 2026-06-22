/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the Manager-hosted SF LLM Gateway config panel contract. */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { GatewayConfigPanelComponent } from "../lib/config-panel.ts";
import { projectGatewayConfigPath, readGatewaySavedConfig } from "../lib/config.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[PI_AGENT_ENV];
let tempAgentDir: string;
let tempProjectDir: string;

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-gateway-panel-agent-"));
  tempProjectDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-gateway-panel-project-"));
  process.env[PI_AGENT_ENV] = tempAgentDir;
});

afterEach(() => {
  if (originalAgentDir === undefined) {
    delete process.env[PI_AGENT_ENV];
  } else {
    process.env[PI_AGENT_ENV] = originalAgentDir;
  }
  rmSync(tempAgentDir, { recursive: true, force: true });
  rmSync(tempProjectDir, { recursive: true, force: true });
});

describe("GatewayConfigPanelComponent Manager contract", () => {
  it("hides lifecycle actions in the Manager settings page", () => {
    const panel = new GatewayConfigPanelComponent(theme, "project", tempProjectDir, vi.fn());

    const text = panel.renderContent(100).join("\n");

    expect(text).toContain("[ Save ]");
    expect(text).toContain("[ Cancel ]");
    expect(text).not.toContain("Save + enable default model");
    expect(text).not.toContain("[ Disable ]");
    expect(text).not.toContain("Open token page");
    expect(text).not.toContain("Import from Claude Code");
  });

  it("saves in place and reports reload when the user backs out", () => {
    const done = vi.fn();
    const panel = new GatewayConfigPanelComponent(theme, "project", tempProjectDir, done);

    panel.handleInput("https://gateway.example.com/v1");
    panel.handleInput("\r"); // base URL -> API key
    panel.handleInput("test-api-key");
    panel.handleInput("\r"); // API key -> scoped model mode
    panel.handleInput("\x1b[B"); // scoped model mode -> Save
    panel.handleInput("\r"); // Save in place

    expect(done).not.toHaveBeenCalled();
    expect(readGatewaySavedConfig(projectGatewayConfigPath(tempProjectDir))).toMatchObject({
      baseUrl: "https://gateway.example.com",
      apiKey: "test-api-key",
    });
    expect(panel.renderContent(100).join("\n")).toContain("Reload required");

    panel.handleInput("\x1b");

    expect(done).toHaveBeenCalledWith({ needsReload: true });
  });

  it("does not require reload when Save is pressed without changes", () => {
    const done = vi.fn();
    const panel = new GatewayConfigPanelComponent(theme, "project", tempProjectDir, done);

    panel.handleInput("\x1b[B"); // base URL -> API key
    panel.handleInput("\x1b[B"); // API key -> scoped model mode
    panel.handleInput("\x1b[B"); // scoped model mode -> Save
    panel.handleInput("\r"); // Save in place
    panel.handleInput("\x1b");

    expect(panel.renderContent(100).join("\n")).not.toContain("Reload required");
    expect(done).toHaveBeenCalledWith(undefined);
  });
});
