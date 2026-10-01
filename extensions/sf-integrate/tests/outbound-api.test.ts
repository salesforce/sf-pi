/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import {
  getOutboundAuthorizationUrl,
  outboundVerificationFindings,
  populateOutboundSecret,
  signingCertificateExists,
} from "../lib/outbound-api.ts";
import type { OutboundIntegrationPlan } from "../lib/types.ts";

function plan(authType: OutboundIntegrationPlan["auth_type"]): OutboundIntegrationPlan {
  return {
    schema_version: 1,
    plan_id: "plan_example",
    plan_hash: "sha256:example",
    created_at: "2026-01-01T00:00:00.000Z",
    direction: "outbound",
    auth_type: authType,
    target: {
      target_org: "IntegrationDev",
      org_id: "example-org-id",
      org_type: "developer",
      api_version: "67.0",
    },
    endpoint_url: "https://api.example.invalid",
    external_credential_name: "ExampleEC",
    named_credential_name: "ExampleNC",
    principal_name: authType === "api_key" ? "ApiKey" : "NamedPrincipal",
    principal_type: "NamedPrincipal",
    permission_set_name: "ExampleAccess",
    assign_to_current_user: true,
    named_credential: {},
    credential_shape:
      authType === "oauth_client_credentials"
        ? ["clientId", "clientSecret"]
        : authType === "api_key"
          ? ["ApiKey"]
          : [],
  };
}

function session(responseBody: Record<string, unknown>): {
  session: SalesforceSession;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async () => ({
    status: 201,
    body: responseBody,
    path: "/example",
    target: {},
    warnings: [],
  }));
  return {
    request,
    session: { request } as unknown as SalesforceSession,
  };
}

describe("outbound credential API", () => {
  it("marks the client secret encrypted in the Salesforce request", async () => {
    const fixture = session({ authenticationStatus: "Configured" });
    const result = await populateOutboundSecret(fixture.session, plan("oauth_client_credentials"), {
      clientId: "public-client",
      secret: "synthetic-secret",
    });

    expect(fixture.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/named-credentials/credential",
        body: expect.objectContaining({
          credentials: {
            clientId: { value: "public-client", encrypted: false },
            clientSecret: { value: "synthetic-secret", encrypted: true },
          },
        }),
      }),
    );
    expect(result).toEqual({ authenticationStatus: "Configured" });
  });

  it("posts custom API keys as encrypted arbitrary credential parameters", async () => {
    const fixture = session({ authenticationStatus: "Unknown" });
    await populateOutboundSecret(fixture.session, plan("api_key"), {
      secret: "synthetic-api-key",
    });

    expect(fixture.request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          authenticationProtocol: "Custom",
          credentials: { ApiKey: { value: "synthetic-api-key", encrypted: true } },
        }),
      }),
    );
  });

  it("extracts the provider authorization URL without returning tokens", async () => {
    const fixture = session({
      authenticationUrl: "https://auth.example.invalid/authorize?state=example",
    });
    const browserPlan = {
      ...plan("oauth_browser"),
      principal_name: "PerUserPrincipal",
      principal_type: "PerUserPrincipal" as const,
      identity_provider_name: "ExampleIdp",
      credential_shape: ["clientId", "clientSecret"],
    };

    await expect(getOutboundAuthorizationUrl(fixture.session, browserPlan)).resolves.toBe(
      "https://auth.example.invalid/authorize?state=example",
    );
    expect(fixture.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/named-credentials/credential/auth-url/o-auth",
        body: {
          externalCredential: "ExampleEC",
          principalName: "PerUserPrincipal",
          principalType: "PerUserPrincipal",
        },
      }),
    );
  });

  it("grounds JWT certificate names through Tooling API", async () => {
    const query = vi.fn(async () => ({ records: [{ Id: "certificate" }] }));
    const certificateSession = { query } as unknown as SalesforceSession;

    await expect(signingCertificateExists(certificateSession, "OutboundSigningCert")).resolves.toBe(
      true,
    );
    expect(query).toHaveBeenCalledWith({
      soql: "SELECT Id FROM Certificate WHERE DeveloperName = 'OutboundSigningCert' LIMIT 1",
      api: "tooling",
      maxRows: 1,
    });
  });

  it("requires the signing certificate to configure JWT principals", () => {
    const jwtPlan = plan("oauth_jwt_bearer");
    const inspection = {
      external_credential_name: "ExampleEC",
      named_credential_name: "ExampleNC",
      permission_set_name: "ExampleAccess",
      external_credential: {
        authenticationStatus: "NotConfigured",
        principals: [
          {
            principalName: "NamedPrincipal",
            authenticationStatus: "NotConfigured",
          },
        ],
      },
      named_credential: {},
      permission_set_id: "permission-set",
      principal_id: "principal",
      principal_access_id: "access",
      permission_assignment_id: "assignment",
    };

    expect(outboundVerificationFindings(jwtPlan, inspection)).toContain(
      "JWT principal is not configured by the signing certificate",
    );
  });

  it("distinguishes structural readiness from populated credentials", () => {
    const oauthPlan = plan("oauth_client_credentials");
    const structural = {
      external_credential_name: "ExampleEC",
      named_credential_name: "ExampleNC",
      permission_set_name: "ExampleAccess",
      external_credential: {},
      named_credential: {},
      permission_set_id: "permission-set",
      principal_id: "principal",
      principal_access_id: "access",
      permission_assignment_id: "assignment",
      credential: { authenticationStatus: "NotConfigured" },
    };

    expect(outboundVerificationFindings(oauthPlan, structural)).toEqual([]);
    expect(
      outboundVerificationFindings(oauthPlan, structural, { requireConfigured: true }),
    ).toContain("principal credentials are not configured");
  });
});
