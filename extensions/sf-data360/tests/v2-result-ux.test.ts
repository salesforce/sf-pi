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

describe("Data 360 v2 result UX", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("renders intent.plan as a compact journey recommendation", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "intent.plan",
        params: { utterance: "load CSV data and make it usable" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result.report).toContain("Recommended journey");
    expect(result.report).toContain("make_data_usable");
    expect(result.report).toContain("Missing inputs");
  });

  it("renders journey.describe with phases and available actions", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "journey.describe",
        params: { journey: "semantic_retrieval" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result.report).toContain("semantic_retrieval");
    expect(result.report).toContain("Phases");
    expect(result.report).toContain("data360_semantic retriever.create");
  });

  it("renders catalog.search as a compact action table", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_discover",
        action: "catalog.search",
        params: { query: "semantic retriever" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result.report).toContain("Data 360 action search");
    expect(result.report).toContain("data360_semantic");
    expect(result.report).toContain("retriever");
  });

  it("renders sql.verify_rows row count summaries", async () => {
    requestMock.mockResolvedValue({
      data: [[42]],
      metadata: [{ name: "row_count" }],
      returnedRows: 1,
    });

    const result = await runData360V2Action(
      {
        tool: "data360_query",
        action: "sql.verify_rows",
        target_org: "AgentforceSTDM",
        params: { dloName: "Example__dll" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result.report).toContain("Example__dll");
    expect(result.report).toContain("42");
  });
});
