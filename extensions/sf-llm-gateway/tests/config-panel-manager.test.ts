/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the Manager-hosted SF LLM Gateway config panel contract. */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { createConfigPanel, GatewayConfigPanelComponent } from "../lib/config-panel.ts";
import { BASE_URL_ENV, projectGatewayConfigPath, readGatewaySavedConfig } from "../lib/config.ts";
import { readEffectiveCompactionSettings } from "../lib/compaction-settings.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[PI_AGENT_ENV];
const originalBaseUrl = process.env[BASE_URL_ENV];
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
  if (originalBaseUrl === undefined) delete process.env[BASE_URL_ENV];
  else process.env[BASE_URL_ENV] = originalBaseUrl;
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
    expect(text).not.toContain("Saved API key");
  });

  it("offers available Gateway models as scoped compaction preferences", () => {
    const getAvailable = vi.fn(() => [
      {
        provider: "sf-llm-gateway",
        id: "claude-sonnet-5",
        name: "[SF LLM Gateway] Claude Sonnet 5",
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
    ]);
    const panel = createConfigPanel(theme, tempProjectDir, "project", vi.fn(), undefined, {
      modelRegistry: { getAvailable },
    } as unknown as ExtensionCommandContext) as GatewayConfigPanelComponent;

    panel.handleInput("\x1b[B"); // base URL -> scoped model mode
    panel.handleInput("\x1b[B"); // scoped model mode -> compaction model
    panel.handleInput("\x1b[C"); // inherit -> active
    panel.handleInput("\x1b[C"); // active -> Claude Sonnet 5
    const text = panel.renderContent(100).join("\n");

    expect(text).toContain("Compaction model");
    expect(text).toContain("Claude Sonnet 5");
    expect(text).toContain("1M context · 128K output");
  });

  it("saves a project compaction model without changing the active chat model", () => {
    const done = vi.fn();
    const panel = new GatewayConfigPanelComponent(theme, "project", tempProjectDir, done, {
      compactionModels: [
        {
          value: "sf-llm-gateway/claude-sonnet-5",
          label: "Claude Sonnet 5",
          description: "1M context · 128K output",
        },
      ],
    });

    panel.handleInput("\x1b[B"); // base URL -> scoped model mode
    panel.handleInput("\x1b[B"); // scoped model mode -> compaction model
    panel.handleInput("\x1b[C"); // inherit -> active
    panel.handleInput("\x1b[C"); // active -> Claude Sonnet 5
    panel.handleInput("\x1b[B"); // compaction model -> Save
    panel.handleInput("\r");

    expect(readEffectiveCompactionSettings(tempProjectDir)).toMatchObject({
      model: "sf-llm-gateway/claude-sonnet-5",
      source: "project",
    });
    expect(panel.renderContent(100).join("\n")).not.toContain("Reload required");
    panel.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("saves non-secret settings", () => {
    const done = vi.fn();
    const panel = new GatewayConfigPanelComponent(theme, "project", tempProjectDir, done);

    panel.handleInput("https://gateway.example.com/v1");
    panel.handleInput("\r"); // base URL -> scoped model mode
    panel.handleInput("\x1b[B"); // scoped model mode -> compaction model
    panel.handleInput("\x1b[B"); // compaction model -> Save
    panel.handleInput("\r"); // Save in place

    expect(done).not.toHaveBeenCalled();
    expect(readGatewaySavedConfig(projectGatewayConfigPath(tempProjectDir))).toMatchObject({
      baseUrl: "https://gateway.example.com",
    });
    expect(panel.renderContent(100).join("\n")).toContain("Reload required");

    panel.handleInput("\x1b");

    expect(done).toHaveBeenCalledWith({ needsReload: true });
  });

  it("does not pass an environment fallback as an explicit token-page override", () => {
    process.env[BASE_URL_ENV] = "https://environment.example.test";
    const done = vi.fn();
    const panel = new GatewayConfigPanelComponent(theme, "project", tempProjectDir, done, {
      externalActions: true,
      closeOnSave: true,
    });

    panel.handleInput("\x1b[B"); // base URL -> scoped model mode
    panel.handleInput("\x1b[B"); // scoped model mode -> compaction model
    panel.handleInput("\x1b[B"); // compaction model -> Open token page
    panel.handleInput("\r");

    expect(done).toHaveBeenCalledWith({
      gatewayAction: "open-token",
      baseUrl: undefined,
    });
  });

  it("does not require reload when Save is pressed without changes", () => {
    const done = vi.fn();
    const panel = new GatewayConfigPanelComponent(theme, "project", tempProjectDir, done);

    panel.handleInput("\x1b[B"); // base URL -> scoped model mode
    panel.handleInput("\x1b[B"); // scoped model mode -> compaction model
    panel.handleInput("\x1b[B"); // compaction model -> Save
    panel.handleInput("\r"); // Save in place
    panel.handleInput("\x1b");

    expect(panel.renderContent(100).join("\n")).not.toContain("Reload required");
    expect(done).toHaveBeenCalledWith(undefined);
  });
});
