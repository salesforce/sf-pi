/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for sf-guardrail status/audit rendering. */
import { describe, expect, it } from "vitest";

import { renderAudit, renderStatus } from "../lib/status.ts";
import { readBundledConfig } from "../lib/config.ts";
import type { Data360ExecutionChainEntryData } from "../lib/approval-ledger.ts";

const chain: Data360ExecutionChainEntryData = {
  timestamp: Date.UTC(2026, 6, 6, 20, 0, 0),
  sessionId: "session-1",
  parentTool: "data360_orchestrate",
  parentAction: "manifest.run",
  targetOrg: "AgentforceSTDM",
  journey_fingerprint: "abc123def4567890",
  ok: true,
  executionChain: [
    {
      tool: "data360_connect",
      action: "source_schema.put",
      ok: true,
      summary: "schema uploaded",
    },
    {
      tool: "data360_prepare",
      action: "ingest_job.upload_csv",
      ok: true,
      summary: "uploaded csv",
    },
  ],
};

describe("sf-guardrail status rendering", () => {
  it("surfaces Data 360 execution chains separately from guardrail decisions", () => {
    const text = renderAudit([], [chain]);

    expect(text).toContain("No guardrail decisions recorded this session.");
    expect(text).toContain("related Data 360 execution chains (1)");
    expect(text).toContain("data360_orchestrate manifest.run");
    expect(text).toContain("data360_connect source_schema.put");
    expect(text).toContain("data360_prepare ingest_job.upload_csv");
  });

  it("includes recent Data 360 execution chains in status output", () => {
    const text = renderStatus({
      config: readBundledConfig(),
      configSource: "bundled",
      recent: [],
      data360ExecutionChains: [chain],
      hasUI: false,
      headlessEnabled: false,
      operatorAutoApproveEnabled: false,
    });

    expect(text).toContain("no guardrail decisions this session");
    expect(text).toContain("related Data 360 execution chains (1)");
    expect(text).toContain("org=AgentforceSTDM");
  });
});
