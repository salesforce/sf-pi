/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runGatewayCompactionSetup } from "../lib/compaction-setup-command.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[PI_AGENT_ENV];
let agentDir: string;
let cwd: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-compaction-command-agent-"));
  cwd = mkdtempSync(path.join(os.tmpdir(), "sf-pi-compaction-command-project-"));
  process.env[PI_AGENT_ENV] = agentDir;
});

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function context(options: { hasUI: boolean; trusted: boolean }): ExtensionCommandContext {
  return {
    cwd,
    hasUI: options.hasUI,
    isProjectTrusted: () => options.trusted,
    modelRegistry: { getAvailable: () => [] },
    ui: {},
  } as unknown as ExtensionCommandContext;
}

describe("dedicated compaction setup command", () => {
  it("returns bounded interactive guidance without mutating settings in headless mode", async () => {
    const output = await runGatewayCompactionSetup(
      context({ hasUI: false, trusted: true }),
      "global",
    );

    expect(output).toEqual({
      summary: "Dedicated compaction setup needs Pi UI.",
      details: "Current status: default\nRun /sf-llm-gateway compaction global in interactive Pi.",
      level: "warning",
    });
  });

  it("rejects untrusted project scope before reading cached models", async () => {
    const output = await runGatewayCompactionSetup(
      context({ hasUI: true, trusted: false }),
      "project",
    );

    expect(output).toEqual({
      summary: "Project compaction settings require a trusted project.",
      details: "Trust this project or run /sf-llm-gateway compaction global.",
      level: "warning",
    });
  });
});
