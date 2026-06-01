/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

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

describe("Data 360 v2 segment and activation planning", () => {
  it("plans segment creation and publishing without mutation", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "build_segment.plan",
        target_org: "AgentforceSTDM",
        params: { profileDmo: "ssot__Individual__dlm", segmentDefinition: "high value customers" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "build_segment.plan",
      journey: "build_segment",
      phases: ["segment", "retrieve"],
      summary: expect.stringContaining("build_segment plan resolved"),
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_harmonize", action: "dmo.get" }),
        expect.objectContaining({ tool: "data360_segment", action: "ci.validate" }),
        expect.objectContaining({ tool: "data360_segment", action: "ci.create" }),
        expect.objectContaining({ tool: "data360_segment", action: "ci.run" }),
        expect.objectContaining({ tool: "data360_segment", action: "ci.run.status" }),
        expect.objectContaining({ tool: "data360_segment", action: "segment.create" }),
        expect.objectContaining({ tool: "data360_segment", action: "segment.publish" }),
        expect.objectContaining({ tool: "data360_segment", action: "segment.get" }),
      ]),
    );
  });

  it("plans segment activation without mutation", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "activate_segment.plan",
        target_org: "AgentforceSTDM",
        params: { segment: "High_Value_Customers", target: "Marketing Destination" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "activate_segment.plan",
      journey: "activate_segment",
      phases: ["act", "segment"],
      summary: expect.stringContaining("activate_segment plan resolved"),
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_segment", action: "segment.get" }),
        expect.objectContaining({ tool: "data360_activate", action: "activation_target.list" }),
        expect.objectContaining({ tool: "data360_activate", action: "activation_target.create" }),
        expect.objectContaining({ tool: "data360_activate", action: "activation.create" }),
        expect.objectContaining({ tool: "data360_activate", action: "activation.get" }),
      ]),
    );
  });
});
