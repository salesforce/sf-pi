/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const orgCreateMock = vi.fn();
const requestMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  Org: { create: (opts: unknown) => orgCreateMock(opts) },
}));

import { clearConnectionCache } from "../../../lib/common/sf-conn/connection.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { runData360V2Action } from "../lib/v2/dispatcher.ts";

const env: SfEnvironment = {
  cli: { installed: true, version: "2.136.8" },
  project: { detected: true, sourceApiVersion: "67.0" },
  config: { hasTargetOrg: true, targetOrg: "AgentforceSTDM", location: "Global" },
  org: {
    detected: true,
    alias: "AgentforceSTDM",
    username: "agentforce@example.invalid",
    instanceUrl: "https://example.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "67.0",
  },
  detectedAt: 1,
};

const ctx = { hasUI: false } as never;

describe("Data 360 v2 Agentforce behavior investigation run", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("orchestrates session timeline, error traces, latency, and trace tree when ids are provided", async () => {
    let queryIndex = 0;
    requestMock.mockImplementation(async () => {
      queryIndex += 1;
      if (queryIndex === 1) {
        return queryResponse(
          ["interaction_id", "topic", "trace_id", "turn_started", "who", "text", "sent_at"],
          [["interaction-1", "support", "trace-1", "start", "Input", "hello", "start"]],
        );
      }
      if (queryIndex === 2) {
        return queryResponse(
          ["trace_id", "span_id", "operation", "status_code", "duration_ms"],
          [["trace-1", "span-error", "FlowAction", "ERROR", 42]],
        );
      }
      if (queryIndex === 3) {
        return queryResponse(["operation", "count", "avg_duration_ms"], [["LLM", 3, 1200]]);
      }
      return queryResponse(
        ["trace_id", "span_id", "parent_span_id", "operation", "status_code", "duration_ms"],
        [["trace-1", "root", "", "Agent", "OK", 100]],
      );
    });

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "agent_behavior_investigation.run",
        target_org: "AgentforceSTDM",
        params: {
          session_id: "session-1",
          trace_id: "trace-1",
          since: "2026-06-01",
          limit: 5,
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_orchestrate",
      action: "agent_behavior_investigation.run",
      journey: "agent_behavior_investigation",
      summary: expect.stringContaining("Agent behavior investigation complete"),
    });
    expect(result.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "stdm.session_timeline", ok: true }),
        expect.objectContaining({ action: "trace.error_traces", ok: true }),
        expect.objectContaining({ action: "trace.operation_latency_summary", ok: true }),
        expect.objectContaining({ action: "trace.trace_tree", ok: true }),
      ]),
    );
    expect(result.report).toContain("Agent behavior investigation complete");
    expect(result.next_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_observe", action: "trace.trace_tree" }),
      ]),
    );
  });

  it("requires at least one investigation input", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "agent_behavior_investigation.run",
        target_org: "AgentforceSTDM",
        params: {},
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: false,
      error: "MISSING_INVESTIGATION_INPUT",
      recover_via: {
        tool: "data360_orchestrate",
        action: "agent_behavior_investigation.plan",
      },
    });
  });
});

function queryResponse(metadata: string[], data: unknown[][]): unknown {
  return {
    metadata: metadata.map((name) => ({ name })),
    data,
    returnedRows: data.length,
  };
}
