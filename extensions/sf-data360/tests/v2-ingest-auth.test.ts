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

describe("Data 360 v2 tenant ingest auth actions", () => {
  it("reports ingest auth status without exposing or requiring secrets", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.status",
        target_org: "AgentforceSTDM",
        params: { tenantHost: "tenant.example.invalid" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_connect",
      action: "auth.status",
      targetOrg: "AgentforceSTDM",
      apiVersion: "67.0",
      auth: {
        required: true,
        status: "not_configured",
        tenantHost: "tenant.example.invalid",
      },
      tokenExchange: {
        salesforcePath: "/services/a360/token",
        requiredScopes: expect.arrayContaining(["cdp_ingest_api"]),
      },
    });
    expect(JSON.stringify(result).toLowerCase()).not.toContain("access_token");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("refresh_token");
  });

  it("plans Data Cloud ingest auth without mutating or persisting credentials", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.plan",
        target_org: "AgentforceSTDM",
        dry_run: true,
        params: { strategy: "pkce" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_connect",
      action: "auth.plan",
      dryRun: true,
      targetOrg: "AgentforceSTDM",
      strategy: "pkce",
      summary: expect.stringContaining("Data Cloud ingest auth plan"),
    });
    expect(result.steps).toEqual([
      expect.objectContaining({ label: expect.stringContaining("OAuth client") }),
      expect.objectContaining({ label: expect.stringContaining("cdp_ingest_api") }),
      expect.objectContaining({ label: expect.stringContaining("/services/a360/token") }),
      expect.objectContaining({ label: expect.stringContaining("tenant host") }),
    ]);
    expect(result).toMatchObject({
      storesSecrets: false,
      executesNetworkCalls: false,
    });
  });
});
