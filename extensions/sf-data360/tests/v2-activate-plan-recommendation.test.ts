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

describe("Data 360 v2 activation plan recommendations", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("recommends segment.get first when the provided segment is unreadable", async () => {
    requestMock.mockImplementation(async (request: { url: string }) => {
      if (request.url.includes("/segments/")) {
        throw Object.assign(new Error("missing segment"), {
          statusCode: 404,
          errorCode: "NOT_FOUND",
        });
      }
      if (request.url.includes("/activation-targets"))
        return { activationTargets: [{ id: "target-1" }] };
      if (request.url.includes("/activations")) return { activations: [] };
      return {};
    });

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "activate_segment.plan",
        target_org: "AgentforceSTDM",
        params: { segmentId: "missing-segment", target: "Example Target" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      readiness: "blocked",
      blockers: expect.arrayContaining([expect.stringContaining("missing-segment")]),
      recommendedFirstAction: { tool: "data360_segment", action: "segment.get" },
    });
  });
});
