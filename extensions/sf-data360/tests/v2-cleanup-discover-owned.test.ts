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

describe("Data 360 v2 cleanup owned discovery", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("discovers owned stream candidates by prefix and builds cleanup plan params", async () => {
    requestMock.mockResolvedValue({
      dataStreams: [
        {
          id: "1dsGPS000000001AAA",
          name: "GPSProvidersStream_ABC",
          label: "GPS Providers",
          status: "ACTIVE",
          dataLakeObjectInfo: { name: "GPSProvidersStream_ABC__dll" },
        },
        {
          id: "1dsSfPi00000002AAA",
          name: "SfPiSmokeStream_DEF",
          label: "SF Pi Smoke",
          status: "ACTIVE",
          dataLakeObjectName: "SfPiSmokeStream_DEF__dll",
        },
        {
          id: "1dsOther0000003AAA",
          name: "ProductionStream",
          label: "Production",
          status: "ACTIVE",
        },
      ],
    });

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "cleanup.discover_owned",
        target_org: "AgentforceSTDM",
        params: { prefixes: ["GPS", "SfPi"], maxResults: 50, shouldDeleteDataLakeObject: true },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "cleanup.discover_owned",
      candidateCount: 2,
      cleanupPlan: {
        tool: "data360_orchestrate",
        action: "cleanup.plan",
        params: {
          dataStreamIds: ["1dsGPS000000001AAA", "1dsSfPi00000002AAA"],
          shouldDeleteDataLakeObject: true,
        },
      },
    });
    expect(result.candidates).toEqual([
      expect.objectContaining({
        name: "GPSProvidersStream_ABC",
        dloName: "GPSProvidersStream_ABC__dll",
      }),
      expect.objectContaining({ name: "SfPiSmokeStream_DEF", dloName: "SfPiSmokeStream_DEF__dll" }),
    ]);
  });

  it("requires explicit prefixes to avoid broad accidental cleanup discovery", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "cleanup.discover_owned",
        target_org: "AgentforceSTDM",
        params: {},
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: false,
      error: "MISSING_CLEANUP_PREFIXES",
    });
    expect(orgCreateMock).not.toHaveBeenCalled();
  });
});
