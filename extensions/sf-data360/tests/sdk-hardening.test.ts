/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { runSfData360Action } from "../lib/sdk.ts";

const env: SfEnvironment = {
  cli: { installed: true, version: "2.136.8" },
  project: { detected: true, sourceApiVersion: "67.0" },
  config: { hasTargetOrg: true, targetOrg: "ExampleData360Org", location: "Global" },
  org: {
    detected: true,
    alias: "ExampleData360Org",
    username: "agentforce@example.invalid",
    instanceUrl: "https://example.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "67.0",
  },
  detectedAt: 1,
};

const ctx = { cwd: process.cwd(), hasUI: false } as never;

describe("sf_data360 post-release hardening", () => {
  it.each([
    ["run SQL to count rows in a DMO", "query.sql.run"],
    ["call an exact unsupported Data 360 REST endpoint", "api.request"],
    [
      "plan an end to end ingestion harmonization segmentation activation pipeline",
      "orchestrate.intent.plan",
    ],
  ])("routes explicit intent %s to %s", async (intent, expectedAction) => {
    const result = await runSfData360Action(
      { action: "discover.route", params: { intent } },
      env,
      ctx,
    );
    expect(result).toMatchObject({
      recommendedAction: expect.objectContaining({ action: expectedAction }),
    });
  });

  it("rejects selector-dependent reads before the network call", async () => {
    const result = await runSfData360Action(
      { action: "harmonize.dmo_mapping.list", params: {} },
      env,
      ctx,
    );
    expect(result).toMatchObject({
      ok: false,
      error: "MISSING_REQUIRED_SELECTOR",
      requiredAnyOf: [["dmoDeveloperName"], ["dloDeveloperName"], ["sourceObjectName"]],
      recover_via: {
        tool: "sf_data360",
        action: "discover.action.describe",
      },
    });
  });

  it("normalizes recovery links onto the single tool", async () => {
    const result = await runSfData360Action({ action: "prepare.dlo.get", params: {} }, env, ctx);
    expect(result).toMatchObject({
      ok: false,
      recover_via: {
        tool: "sf_data360",
        action: "discover.action.describe",
      },
    });
  });

  it("returns only canonical single-tool references from intent planning", async () => {
    const result = await runSfData360Action(
      {
        action: "orchestrate.intent.plan",
        target_org: "ExampleData360Org",
        params: { utterance: "investigate a slow Agentforce session" },
      },
      env,
      ctx,
    );

    expect(result).toMatchObject({
      ok: true,
      targetTool: "sf_data360",
      targetAction: "orchestrate.agent_behavior_investigation.plan",
      next_actions: [
        expect.objectContaining({
          tool: "sf_data360",
          action: "orchestrate.agent_behavior_investigation.plan",
        }),
      ],
    });
    const journey = result.journey as { availableActions: Array<Record<string, unknown>> };
    expect(journey.availableActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "sf_data360",
          action: "observe.trace.operation_latency_summary",
        }),
      ]),
    );
  });

  it("identifies local and tenant-ingestion transports without inventing Connect calls", async () => {
    const auth = await runSfData360Action(
      { action: "connect.auth.status", target_org: "ExampleData360Org", params: {} },
      env,
      ctx,
    );
    const ingest = await runSfData360Action(
      {
        action: "prepare.ingest_job.create",
        target_org: "ExampleData360Org",
        dry_run: true,
        params: { sourceName: "ExampleSource", object: "ExampleObject" },
      },
      env,
      ctx,
    );

    expect(auth).toMatchObject({ transport: "local" });
    expect(ingest).toMatchObject({ transport: "ingestion" });
  });

  it("returns canonical single-tool references from journey plans", async () => {
    const result = await runSfData360Action(
      {
        action: "orchestrate.agent_behavior_investigation.plan",
        target_org: "ExampleData360Org",
        params: { timeRange: "last 24 hours" },
      },
      env,
      ctx,
    );

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "sf_data360",
          action: "observe.stdm.session_timeline",
        }),
        expect.objectContaining({
          tool: "sf_data360",
          action: "observe.trace.error_traces",
        }),
      ]),
    );
  });
});
