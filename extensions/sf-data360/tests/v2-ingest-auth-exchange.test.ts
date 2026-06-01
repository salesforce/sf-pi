/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, describe, expect, it, vi } from "vitest";

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
    instanceUrl: "https://agentforce.example.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "67.0",
  },
  detectedAt: 1,
};

const ctx = { hasUI: false } as never;

describe("Data 360 v2 PKCE ingest auth exchange", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a PKCE authorization flow without returning the code verifier", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.pkce_start",
        target_org: "AgentforceSTDM",
        params: {
          loginUrl: "https://test.salesforce.com",
          clientId: "public-client-id",
          redirectUri: "http://localhost:1717/OauthRedirect",
          scopes: ["api", "cdp_ingest_api", "refresh_token"],
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_connect",
      action: "auth.pkce_start",
      targetOrg: "AgentforceSTDM",
      authorization: {
        url: expect.stringContaining("https://test.salesforce.com/services/oauth2/authorize"),
        state: expect.any(String),
        codeChallengeMethod: "S256",
        redirectUri: "http://localhost:1717/OauthRedirect",
        scopes: ["api", "cdp_ingest_api", "refresh_token"],
      },
      storesSecrets: false,
      secretStorage: "memory_only",
      next_actions: [
        expect.objectContaining({
          tool: "data360_connect",
          action: "auth.exchange",
        }),
      ],
    });
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain("codeverifier");
    expect(text).not.toContain("code_verifier");
  });

  it("dry-runs the two-step PKCE exchange without secrets", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.exchange",
        target_org: "AgentforceSTDM",
        dry_run: true,
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

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_connect",
      action: "auth.exchange",
      dryRun: true,
      targetOrg: "AgentforceSTDM",
      steps: [
        expect.objectContaining({
          method: "POST",
          url: "https://test.salesforce.com/services/oauth2/token",
        }),
        expect.objectContaining({
          method: "POST",
          path: "/services/a360/token",
        }),
      ],
      storesSecrets: false,
    });
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain("secret-auth-code");
    expect(text).not.toContain("secret-code-verifier");
  });

  it("exchanges a started PKCE flow by state without the caller passing a code verifier", async () => {
    const start = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.pkce_start",
        target_org: "AgentforceSTDM",
        params: {
          loginUrl: "https://test.salesforce.com",
          clientId: "public-client-id",
          redirectUri: "http://localhost:1717/OauthRedirect",
        },
      },
      env,
      ctx,
      undefined,
    );
    const state = (start.authorization as { state: string }).state;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/services/oauth2/token")) {
        expect(String(init?.body)).toContain("grant_type=authorization_code");
        expect(String(init?.body)).toContain("code_verifier=");
        return jsonResponse({
          access_token: "secret-salesforce-token",
          instance_url: "https://agentforce.example.my.salesforce.com",
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

    const result = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.exchange",
        target_org: "AgentforceSTDM",
        params: {
          strategy: "pkce",
          authorizationCode: "secret-auth-code",
          pkceState: state,
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      auth: { status: "ready", tenantHost: "tenant.example.c360a.salesforce.com" },
      storesSecrets: false,
    });
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain("secret-salesforce-token");
    expect(text).not.toContain("secret-data-cloud-token");
    expect(text).not.toContain("secret-auth-code");
  });

  it("exchanges a PKCE auth code for Data Cloud tenant metadata without returning tokens", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/services/oauth2/token")) {
        expect(String(init?.body)).toContain("grant_type=authorization_code");
        expect(String(init?.body)).toContain("code_verifier=secret-code-verifier");
        return jsonResponse({
          access_token: "secret-salesforce-token",
          instance_url: "https://agentforce.example.my.salesforce.com",
          token_type: "Bearer",
          issued_at: "1710000000000",
        });
      }
      if (url.endsWith("/services/a360/token")) {
        expect(String(init?.body)).toContain(
          "grant_type=urn%3Asalesforce%3Agrant-type%3Aexternal%3Acdp",
        );
        expect(String(init?.body)).toContain("subject_token=secret-salesforce-token");
        return jsonResponse({
          access_token: "secret-data-cloud-token",
          instance_url: "https://tenant.example.c360a.salesforce.com",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.exchange",
        target_org: "AgentforceSTDM",
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

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_connect",
      action: "auth.exchange",
      targetOrg: "AgentforceSTDM",
      auth: {
        required: true,
        status: "ready",
        tenantHost: "tenant.example.c360a.salesforce.com",
      },
      token: {
        tokenType: "Bearer",
        expiresIn: 3600,
      },
      storesSecrets: false,
    });
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain("secret-salesforce-token");
    expect(text).not.toContain("secret-data-cloud-token");
    expect(text).not.toContain("secret-auth-code");
    expect(text).not.toContain("secret-code-verifier");
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
