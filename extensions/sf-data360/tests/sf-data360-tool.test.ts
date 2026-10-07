/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import {
  DATA360_EXECUTION_CHAIN_ENTRY_TYPE,
  appendExecutionChainAudit,
  registerSfData360Tool,
} from "../lib/sf-data360-tool.ts";

type RegisteredTool = {
  outputSchema?: unknown;
  renderCall?: (...args: unknown[]) => unknown;
  renderResult?: (...args: unknown[]) => unknown;
  execute: (...args: unknown[]) => Promise<{
    details: Record<string, unknown>;
    structuredContent?: Record<string, unknown>;
  }>;
};

describe("single sf_data360 tool registration", () => {
  it("registers exactly one custom system tool with render hooks", () => {
    const registered: Record<string, RegisteredTool> = {};
    const pi = {
      exec: vi.fn(),
      registerTool: vi.fn((tool: { name: string } & RegisteredTool) => {
        registered[tool.name] = tool;
      }),
    };
    registerSfData360Tool(pi as never);
    expect(Object.keys(registered)).toEqual(["sf_data360"]);
    expect(registered.sf_data360.outputSchema).toBeDefined();
    expect(registered.sf_data360.renderCall).toEqual(expect.any(Function));
    expect(registered.sf_data360.renderResult).toEqual(expect.any(Function));
  });

  it("appends public execution-chain audit entries", () => {
    const appendEntry = vi.fn();
    appendExecutionChainAudit(
      { appendEntry } as never,
      { sessionManager: { getSessionId: () => "session-123" } } as never,
      {
        action: "orchestrate.manifest.run",
        target_org: "ExampleSandbox",
        params: { manifestPath: "manifest.json" },
      },
      {
        ok: true,
        journey_fingerprint: "abc123",
        executionChain: [{ tool: "sf_data360", action: "prepare.ingest_job.close", ok: true }],
      },
    );
    expect(appendEntry).toHaveBeenCalledWith(
      DATA360_EXECUTION_CHAIN_ENTRY_TYPE,
      expect.objectContaining({
        parentTool: "sf_data360",
        parentAction: "orchestrate.manifest.run",
        targetOrg: "ExampleSandbox",
      }),
    );
  });

  it("runs local discovery without resolving a Salesforce environment", async () => {
    const registered: Record<string, RegisteredTool> = {};
    const exec = vi.fn();
    const pi = {
      exec,
      registerTool: vi.fn((tool: { name: string } & RegisteredTool) => {
        registered[tool.name] = tool;
      }),
    };
    registerSfData360Tool(pi as never);
    const result = await registered.sf_data360.execute(
      "tool-call-1",
      { action: "discover.action.describe", params: { action: "observe.trace.error_traces" } },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    expect(result.details).toMatchObject({
      ok: true,
      tool: "sf_data360",
      action: "discover.action.describe",
      requestedAction: "observe.trace.error_traces",
      digest: expect.objectContaining({ namespace: "discover" }),
    });
    expect(result.structuredContent).toMatchObject({
      outcome: { action: "discover.action.describe", status: "pass" },
    });
    expect(exec).not.toHaveBeenCalled();
  });
});
