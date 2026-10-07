/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { runData360Action } from "../lib/actions/dispatcher.ts";

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

const ctx = { hasUI: false } as never;

describe("Data 360 tenant ingest auth actions", () => {
  it("reports ingest auth status without exposing or requiring secrets", async () => {
    const result = await runData360Action(
      {
        tool: "connect",
        action: "auth.status",
        target_org: "ExampleData360Org",
        params: { tenantHost: "tenant.example.invalid" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "connect",
      action: "auth.status",
      targetOrg: "ExampleData360Org",
      apiVersion: "not-required",
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

  it("keeps auth-session clearing side-effect free until explicitly allowed", async () => {
    const planned = await runData360Action(
      {
        tool: "connect",
        action: "auth.clear",
        target_org: "ExampleData360Org",
        dry_run: true,
      },
      env,
      ctx,
      undefined,
    );
    expect(planned).toMatchObject({
      ok: true,
      dryRun: true,
      cleared: 0,
      summary: "Would clear 0 in-memory Data Cloud ingest auth session(s)",
    });

    const blocked = await runData360Action(
      { tool: "connect", action: "auth.clear", target_org: "ExampleData360Org" },
      env,
      ctx,
      undefined,
    );
    expect(blocked).toMatchObject({ ok: false, error: "CONFIRMATION_REQUIRED" });
  });

  it("plans PKCE start without storing verifier state and gates execution", async () => {
    const params = {
      loginUrl: "https://test.salesforce.com",
      clientId: "public-client-id",
      redirectUri: "http://localhost:1717/OauthRedirect",
    };
    const before = await runData360Action(
      { tool: "connect", action: "auth.sessions", target_org: "ExampleData360Org" },
      env,
      ctx,
      undefined,
    );
    const planned = await runData360Action(
      {
        tool: "connect",
        action: "auth.pkce_start",
        target_org: "ExampleData360Org",
        dry_run: true,
        params,
      },
      env,
      ctx,
      undefined,
    );
    const after = await runData360Action(
      { tool: "connect", action: "auth.sessions", target_org: "ExampleData360Org" },
      env,
      ctx,
      undefined,
    );
    expect(planned).toMatchObject({
      ok: true,
      dryRun: true,
      storesSecrets: false,
      executesNetworkCalls: false,
      summary: "Data Cloud ingest PKCE start dry-run",
    });
    expect(after.sessions).toEqual(before.sessions);

    const blocked = await runData360Action(
      {
        tool: "connect",
        action: "auth.pkce_start",
        target_org: "ExampleData360Org",
        params,
      },
      env,
      ctx,
      undefined,
    );
    expect(blocked).toMatchObject({ ok: false, error: "CONFIRMATION_REQUIRED" });
  });

  it("does not combine an explicit target with the default org instance context", async () => {
    const result = await runData360Action(
      {
        tool: "connect",
        action: "auth.plan",
        target_org: "OtherData360Org",
        dry_run: true,
        params: { strategy: "pkce" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      targetOrg: "OtherData360Org",
      apiVersion: "not-required",
    });
    expect(result.instanceUrl).toBeUndefined();
  });

  it("plans Data Cloud ingest auth without mutating or persisting credentials", async () => {
    const result = await runData360Action(
      {
        tool: "connect",
        action: "auth.plan",
        target_org: "ExampleData360Org",
        dry_run: true,
        params: { strategy: "pkce" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "connect",
      action: "auth.plan",
      dryRun: true,
      targetOrg: "ExampleData360Org",
      strategy: "pkce",
      summary: expect.stringContaining("Data Cloud ingest auth plan"),
    });
    expect(result.steps).toEqual([
      expect.objectContaining({ label: expect.stringContaining("OAuth client") }),
      expect.objectContaining({
        label: expect.stringContaining("API scopes"),
        detail: expect.stringContaining("cdp_query_api"),
      }),
      expect.objectContaining({ label: expect.stringContaining("/services/a360/token") }),
      expect.objectContaining({ label: expect.stringContaining("tenant host") }),
    ]);
    expect(result).toMatchObject({
      storesSecrets: false,
      executesNetworkCalls: false,
    });
  });
});
