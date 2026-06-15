/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import {
  runInteractivePkceAuth,
  validateSalesforceAuthorizationUrl,
} from "../lib/v2/ingest/interactive-auth.ts";
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

describe("Data 360 interactive PKCE auth orchestration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dry-runs data360_orchestrate ingest_auth.pkce_interactive without opening a listener", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "ingest_auth.pkce_interactive",
        target_org: "AgentforceSTDM",
        dry_run: true,
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

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_orchestrate",
      action: "ingest_auth.pkce_interactive",
      dryRun: true,
      targetOrg: "AgentforceSTDM",
      opensBrowser: true,
      listensOn: "http://localhost:1717/OauthRedirect",
      storesSecrets: false,
    });
  });

  it("captures the callback, exchanges tokens, and returns only sanitized auth session metadata", async () => {
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

    const result = await runInteractivePkceAuth(
      {
        loginUrl: "https://test.salesforce.com",
        clientId: "public-client-id",
        redirectUri: "http://127.0.0.1:0/OauthRedirect",
      },
      {
        authorizationOpener: () => undefined,
        fetchFn: fetchMock as typeof fetch,
        onReady: async ({ callbackUrl, state }) => {
          await fetch(`${callbackUrl}?code=secret-auth-code&state=${state}`);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      auth: { required: true, status: "ready", tenantHost: "tenant.example.c360a.salesforce.com" },
      token: { tokenType: "Bearer", expiresIn: 3600 },
      storesSecrets: false,
      secretStorage: "memory_only",
    });
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain("secret-salesforce-token");
    expect(text).not.toContain("secret-data-cloud-token");
    expect(text).not.toContain("secret-auth-code");
    expect(text).not.toContain("code_verifier");
  });

  it("allows only Salesforce HTTPS authorization URLs for browser opening", () => {
    expect(
      validateSalesforceAuthorizationUrl("https://test.salesforce.com/services/oauth2/authorize"),
    ).toBe("https://test.salesforce.com/services/oauth2/authorize");
    expect(
      validateSalesforceAuthorizationUrl(
        "https://example--sandbox.sandbox.my.salesforce.com/services/oauth2/authorize",
      ),
    ).toContain("sandbox.my.salesforce.com");
    expect(() => validateSalesforceAuthorizationUrl("http://test.salesforce.com/auth")).toThrow(
      "https",
    );
    expect(() => validateSalesforceAuthorizationUrl("https://example.invalid/auth")).toThrow(
      "Salesforce host",
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
