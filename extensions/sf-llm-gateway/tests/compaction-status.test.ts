/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeScopedCompactionSetup } from "../lib/compaction-settings.ts";
import { resolveGatewayCompactionStatus } from "../lib/compaction-status.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[PI_AGENT_ENV];
let agentDir: string;
let cwd: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-compaction-status-agent-"));
  cwd = mkdtempSync(path.join(os.tmpdir(), "sf-pi-compaction-status-project-"));
  process.env[PI_AGENT_ENV] = agentDir;
});

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const availableModels = [
  {
    provider: "sf-llm-gateway",
    id: "claude-sonnet-5",
    name: "[SF LLM Gateway] Claude Sonnet 5",
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
] as never;

describe("Gateway compaction status", () => {
  it("treats missing native compaction settings as enabled Pi-default behavior", () => {
    expect(resolveGatewayCompactionStatus(cwd, [], true)).toEqual({
      kind: "default",
      source: "default",
    });
  });

  it("reports automatic compaction as disabled when the effective Pi setting is false", () => {
    writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ compaction: { enabled: false } }),
    );

    expect(resolveGatewayCompactionStatus(cwd, availableModels, true)).toEqual({
      kind: "disabled",
      source: "global",
    });
  });

  it("ignores project compaction settings until Pi trusts the project", () => {
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        compaction: { enabled: false },
        sfPi: { compaction: { model: "sf-llm-gateway/claude-sonnet-5" } },
      }),
    );

    expect(resolveGatewayCompactionStatus(cwd, availableModels, false)).toEqual({
      kind: "default",
      source: "default",
    });
  });

  it("reports a saved dedicated model as unavailable when it is absent from the cached catalog", () => {
    writeScopedCompactionSetup(cwd, "global", "sf-llm-gateway/claude-sonnet-5");

    expect(resolveGatewayCompactionStatus(cwd, [], true)).toEqual({
      kind: "unavailable",
      model: "sf-llm-gateway/claude-sonnet-5",
      source: "global",
    });
  });

  it("reports a configured cached model with its display label and context capacity", () => {
    writeScopedCompactionSetup(cwd, "global", "sf-llm-gateway/claude-sonnet-5");

    expect(resolveGatewayCompactionStatus(cwd, availableModels, true)).toEqual({
      kind: "dedicated",
      model: "sf-llm-gateway/claude-sonnet-5",
      modelLabel: "Claude Sonnet 5",
      contextWindow: 1_000_000,
      source: "global",
    });
  });
});
