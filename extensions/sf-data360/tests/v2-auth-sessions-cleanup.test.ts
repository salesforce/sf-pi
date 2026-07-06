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
const uiCtx = {
  hasUI: true,
  signal: undefined,
  ui: { select: vi.fn(async () => "Allow once") },
} as never;

describe("Data 360 v2 auth sessions and cleanup", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("lists and clears in-memory ingest auth sessions without exposing tokens", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/services/oauth2/token")) {
        return jsonResponse({
          access_token: "secret-salesforce-token",
          instance_url: "https://example.my.salesforce.com",
        });
      }
      if (url.endsWith("/services/a360/token")) {
        return jsonResponse({
          access_token: "secret-data-cloud-token",
          instance_url: "tenant.example.c360a.salesforce.com",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const exchange = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.exchange",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
        params: {
          strategy: "pkce",
          loginUrl: "https://test.salesforce.com",
          clientId: "public-client-id",
          redirectUri: "http://localhost:1717/OauthRedirect",
          authorizationCode: "secret-auth-code",
          codeVerifier: "secret-code-verifier",
        },
      },
      env,
      ctx,
      undefined,
    );
    const id = (exchange.authSession as { id: string }).id;

    const list = await runData360V2Action(
      { tool: "data360_connect", action: "auth.sessions", target_org: "AgentforceSTDM" },
      env,
      ctx,
      undefined,
    );
    expect(list).toMatchObject({
      ok: true,
      sessions: expect.arrayContaining([
        expect.objectContaining({ id, tenantHost: "tenant.example.c360a.salesforce.com" }),
      ]),
    });
    expect(JSON.stringify(list).toLowerCase()).not.toContain("secret-data-cloud-token");

    await expect(
      runData360V2Action(
        {
          tool: "data360_connect",
          action: "auth.clear",
          target_org: "AgentforceSTDM",
          params: { authSessionId: id },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({ ok: true, cleared: 1 });
  });

  it("plans and gates cleanup for explicit owned resources", async () => {
    const plan = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "cleanup.plan",
        target_org: "AgentforceSTDM",
        params: { dataStreamIds: ["1ds000000000001AAA"], shouldDeleteDataLakeObject: true },
      },
      env,
      ctx,
      undefined,
    );
    expect(plan).toMatchObject({
      ok: true,
      action: "cleanup.plan",
      resources: [{ type: "data_stream", id: "1ds000000000001AAA" }],
    });

    await expect(
      runData360V2Action(
        {
          tool: "data360_orchestrate",
          action: "cleanup.run",
          target_org: "AgentforceSTDM",
          params: { dataStreamIds: ["1ds000000000001AAA"], shouldDeleteDataLakeObject: true },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({ ok: false, error: "CONFIRMATION_REQUIRED" });
  });

  it("executes cleanup for explicitly provided data stream ids after confirmation", async () => {
    requestMock.mockResolvedValue({ deleted: true });

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "cleanup.run",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
        params: { dataStreamIds: ["1ds000000000001AAA"], shouldDeleteDataLakeObject: true },
      },
      env,
      uiCtx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "cleanup.run",
      results: [expect.objectContaining({ id: "1ds000000000001AAA", ok: true })],
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "/services/data/v67.0/ssot/data-streams/1ds000000000001AAA?shouldDeleteDataLakeObject=true",
      }),
    );
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}
