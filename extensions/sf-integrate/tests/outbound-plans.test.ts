/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";

vi.mock("../lib/artifacts.ts", () => ({
  writeIntegrationArtifact: vi.fn(async (kind: string, filename: string) => ({
    path: `/tmp/sf-integrate/${kind}/${filename}`,
    kind,
  })),
}));

const { buildOutboundPlan } = await import("../lib/outbound-plans.ts");

const session = {
  target: {
    targetOrg: "IntegrationDev",
    alias: "IntegrationDev",
    orgId: "example-org-id",
    instanceUrl: "https://example.develop.my.salesforce.com",
    orgType: "developer",
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest",
  },
} as unknown as SalesforceSession;

describe("outbound integration plans", () => {
  it("builds OAuth client-credentials payloads without secrets", async () => {
    const plan = await buildOutboundPlan(
      {
        action: "design.plan",
        direction: "outbound",
        auth_type: "oauth_client_credentials",
        endpoint_url: "https://api.example.invalid/v1",
        token_url: "https://auth.example.invalid/oauth/token",
        scope: "read write",
      },
      session,
    );

    expect(plan.external_credential).toMatchObject({
      authenticationProtocol: "OAuth",
      authenticationProtocolVariant: "ClientCredentialsClientSecret",
      principals: [{ principalType: "NamedPrincipal" }],
    });
    expect(plan.named_credential).toMatchObject({
      type: "SecuredEndpoint",
      calloutOptions: {
        generateAuthorizationHeader: true,
        allowMergeFieldsInHeader: false,
        allowMergeFieldsInBody: false,
      },
    });
    expect(plan.credential_shape).toEqual(["clientId", "clientSecret"]);
    expect(JSON.stringify(plan)).not.toMatch(/secretValue|clientSecret"\s*:/u);
  });

  it("builds literal JSON JWT claims and requires an existing certificate", async () => {
    const plan = await buildOutboundPlan(
      {
        action: "design.plan",
        direction: "outbound",
        auth_type: "oauth_jwt_bearer",
        endpoint_url: "https://api.example.invalid",
        token_url: "https://auth.example.invalid/token",
        signing_certificate: "OutboundSigningCert",
        jwt_issuer: "issuer-value",
        jwt_subject: "subject-value",
        jwt_audience: "https://auth.example.invalid",
      },
      session,
    );

    expect(plan.external_credential).toMatchObject({
      authenticationProtocolVariant: "JwtBearer",
    });
    expect(plan.external_credential?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parameterName: "iss", parameterValue: '"issuer-value"' }),
        expect.objectContaining({ parameterName: "sub", parameterValue: '"subject-value"' }),
        expect.objectContaining({
          parameterName: "aud",
          parameterValue: '"https://auth.example.invalid"',
        }),
      ]),
    );
    expect(plan.credential_shape).toEqual([]);
  });

  it("builds an authorization-code identity provider and per-user principal", async () => {
    const plan = await buildOutboundPlan(
      {
        action: "design.plan",
        direction: "outbound",
        auth_type: "oauth_browser",
        endpoint_url: "https://api.example.invalid",
        token_url: "https://auth.example.invalid/token",
        authorize_url: "https://auth.example.invalid/authorize",
        scope: "read",
      },
      session,
    );

    expect(plan.external_auth_identity_provider).toMatchObject({
      authenticationFlow: "AuthorizationCode",
      clientAuthentication: "ClientSecretPost",
    });
    expect(plan.external_credential).toMatchObject({
      authenticationProtocol: "OAuth",
      principals: [{ principalType: "PerUserPrincipal" }],
    });
    expect(plan.credential_shape).toEqual(["clientId", "clientSecret"]);
  });

  it("builds a metadata-backed custom API-key parameter and merge header", async () => {
    const plan = await buildOutboundPlan(
      {
        action: "design.plan",
        direction: "outbound",
        auth_type: "api_key",
        endpoint_url: "https://api.example.invalid",
        api_key_header: "X-Api-Key",
      },
      session,
    );

    expect(plan.external_credential).toBeUndefined();
    expect(plan.external_credential_source?.source).toContain(
      "<parameterName>ApiKey</parameterName>",
    );
    expect(plan.named_credential).toMatchObject({
      calloutOptions: {
        generateAuthorizationHeader: false,
        allowMergeFieldsInHeader: true,
        allowMergeFieldsInBody: false,
      },
      customHeaders: [
        {
          headerName: "X-Api-Key",
          headerValue: "{!$Credential.SfPiOutboundEC.ApiKey}",
          sequenceNumber: 1,
        },
      ],
    });
    expect(plan.credential_shape).toEqual(["ApiKey"]);
  });

  it("rejects non-HTTPS endpoints and per-user service principals", async () => {
    await expect(
      buildOutboundPlan(
        {
          action: "design.plan",
          direction: "outbound",
          auth_type: "oauth_client_credentials",
          endpoint_url: "http://api.example.invalid",
          token_url: "https://auth.example.invalid/token",
        },
        session,
      ),
    ).rejects.toThrow("endpoint_url must be an HTTPS URL");

    await expect(
      buildOutboundPlan(
        {
          action: "design.plan",
          direction: "outbound",
          auth_type: "api_key",
          endpoint_url: "https://api.example.invalid",
          api_key_header: "X-Api-Key",
          principal_type: "PerUserPrincipal",
        },
        session,
      ),
    ).rejects.toThrow("supports only principal_type=NamedPrincipal");
  });
});
