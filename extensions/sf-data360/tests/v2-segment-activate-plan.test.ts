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

describe("Data 360 v2 segment and activation planning", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("plans segment creation and publishing with DMO/CI/segment readiness", async () => {
    requestMock.mockImplementation(async (request: { url: string }) => {
      if (request.url.includes("/data-model-objects/"))
        return { name: "ssot__Individual__dlm", fields: [] };
      if (request.url.includes("/calculated-insights"))
        return { calculatedInsights: [{ name: "Existing__cio" }] };
      if (request.url.includes("/segments")) return { segments: [] };
      return {};
    });

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
      readiness: "ready_with_warnings",
      availableCalculatedInsights: 1,
      availableSegments: 0,
      preflight: {
        profileDmo: { ok: true },
        calculatedInsights: { count: 1, ok: true },
        segments: { count: 0, ok: true },
      },
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

  it("plans segment activation with activation target readiness", async () => {
    requestMock.mockImplementation(async (request: { url: string }) => {
      if (request.url.includes("/segments/")) return { id: "seg-1", status: "ACTIVE" };
      if (request.url.includes("/activation-targets")) return { activationTargets: [] };
      if (request.url.includes("/activations")) return { activations: [] };
      return {};
    });

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "activate_segment.plan",
        target_org: "AgentforceSTDM",
        params: { segmentId: "seg-1", target: "Marketing Destination" },
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
      readiness: "blocked",
      blockers: expect.arrayContaining([expect.stringContaining("activation target")]),
      recommendedFirstAction: { tool: "data360_activate", action: "activation_target.create" },
      preflight: {
        segment: { ok: true },
        activationTargets: { count: 0, ok: true },
        activations: { count: 0, ok: true },
      },
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
