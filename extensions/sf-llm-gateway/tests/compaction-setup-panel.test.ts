/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { readEffectiveCompactionSettings } from "../lib/compaction-settings.ts";
import {
  GatewayCompactionSetupComponent,
  recommendGatewayCompactionModel,
} from "../lib/compaction-setup-panel.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[PI_AGENT_ENV];
let agentDir: string;
let cwd: string;

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-compaction-setup-agent-"));
  cwd = mkdtempSync(path.join(os.tmpdir(), "sf-pi-compaction-setup-project-"));
  process.env[PI_AGENT_ENV] = agentDir;
});

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("Gateway compaction setup panel", () => {
  it("does not guess between multiple large-context models", () => {
    expect(
      recommendGatewayCompactionModel([
        {
          value: "sf-llm-gateway/model-a",
          label: "Model A",
          description: "1M context · 16K output",
          contextWindow: 1_000_000,
          maxTokens: 16_384,
        },
        {
          value: "sf-llm-gateway/model-b",
          label: "Model B",
          description: "2M context · 32K output",
          contextWindow: 2_000_000,
          maxTokens: 32_768,
        },
      ]),
    ).toBeUndefined();
  });

  it("refuses project persistence until Pi trusts the project", () => {
    const done = vi.fn();
    const panel = new GatewayCompactionSetupComponent(
      theme,
      "project",
      cwd,
      done,
      [
        {
          value: "sf-llm-gateway/claude-sonnet-5",
          label: "Claude Sonnet 5",
          description: "1M context · 128K output",
          contextWindow: 1_000_000,
          maxTokens: 128_000,
        },
      ],
      undefined,
      false,
    );

    panel.handleInput("\x1b[B");
    panel.handleInput("\r");

    expect(panel.renderContent(90).join("\n")).toContain(
      "Project compaction settings require a trusted project.",
    );
    expect(readEffectiveCompactionSettings(cwd)).toMatchObject({
      model: "active",
      source: "default",
    });
    expect(done).not.toHaveBeenCalled();
  });

  it("preselects one large-context model and saves an enabled dedicated setup", () => {
    const done = vi.fn();
    const panel = new GatewayCompactionSetupComponent(theme, "global", cwd, done, [
      {
        value: "sf-llm-gateway/claude-sonnet-5",
        label: "Claude Sonnet 5",
        description: "1M context · 128K output",
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
    ]);

    expect(panel.renderContent(90).join("\n")).toContain("Claude Sonnet 5");
    panel.handleInput("\x1b[B"); // model -> Save
    panel.handleInput("\r");

    expect(readEffectiveCompactionSettings(cwd)).toMatchObject({
      enabled: true,
      model: "sf-llm-gateway/claude-sonnet-5",
      source: "global",
    });
    expect(done).toHaveBeenCalledWith({
      configuredModel: "sf-llm-gateway/claude-sonnet-5",
    });
  });
});
