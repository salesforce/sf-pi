/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { buildEcaProfileSources } from "../lib/eca-profiles.ts";

const base = {
  appName: "ExampleEca",
  appLabel: "Example ECA",
  contactEmail: "admin@example.invalid",
};

function globalSource(flow: Parameters<typeof buildEcaProfileSources>[0]["flow"]): string {
  const built = buildEcaProfileSources({
    ...base,
    flow,
    ...(flow === "client_credentials"
      ? { clientCredentialsUser: "integration@example.invalid" }
      : {}),
    ...(flow === "jwt_bearer"
      ? {
          permissionSet: "ExampleJwtAccess",
          certificatePem:
            "-----BEGIN CERTIFICATE-----\nU0YgUGkgcHVibGljIHRlc3QgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
        }
      : {}),
  });
  return (
    built.sources.find((source) => source.type === "ExtlClntAppGlobalOauthSettings")?.source ?? ""
  );
}

describe("External Client App OAuth profiles", () => {
  it("distinguishes confidential Authorization Code from public PKCE", () => {
    const confidential = buildEcaProfileSources({ ...base, flow: "authorization_code" });
    const pkce = buildEcaProfileSources({ ...base, flow: "authorization_code_pkce" });

    expect(confidential.expected).toMatchObject({
      consumer_secret_optional: false,
      pkce_required: true,
      secret_required_for_refresh_token: true,
    });
    expect(pkce.expected).toMatchObject({
      consumer_secret_optional: true,
      pkce_required: true,
      secret_required_for_refresh_token: false,
    });
  });

  it("enables Client Credentials in settings and policy with an execution user", () => {
    const built = buildEcaProfileSources({
      ...base,
      flow: "client_credentials",
      clientCredentialsUser: "integration@example.invalid",
    });
    const policy = built.sources.find(
      (source) => source.type === "ExtlClntAppOauthConfigurablePolicies",
    )?.source;

    expect(globalSource("client_credentials")).toContain(
      "<isClientCredentialsFlowEnabled>true</isClientCredentialsFlowEnabled>",
    );
    expect(policy).toContain(
      "<clientCredentialsFlowUser>integration@example.invalid</clientCredentialsFlowUser>",
    );
    expect(policy).toContain(
      "<isClientCredentialsFlowEnabled>true</isClientCredentialsFlowEnabled>",
    );
  });

  it("enables Device and Token Exchange independently", () => {
    expect(globalSource("device")).toContain("<isDeviceFlowEnabled>true</isDeviceFlowEnabled>");
    const token = buildEcaProfileSources({
      ...base,
      flow: "token_exchange",
      tokenExchangeRequireSecret: true,
      permissionSet: "ExampleTokenAccess",
      tokenExchangeHandler: "ExampleTokenHandler",
      tokenExchangeApex: "ExampleTokenHandlerApex",
      tokenExchangeUser: "integration@example.invalid",
    });
    const global = token.sources.find(
      (source) => source.type === "ExtlClntAppGlobalOauthSettings",
    )?.source;
    const policy = token.sources.find(
      (source) => source.type === "ExtlClntAppOauthConfigurablePolicies",
    )?.source;

    expect(global).toContain("<isTokenExchangeEnabled>true</isTokenExchangeEnabled>");
    expect(global).toContain(
      "<isSecretRequiredForTokenExchange>true</isSecretRequiredForTokenExchange>",
    );
    expect(policy).toContain("<isTokenExchangeFlowEnabled>true</isTokenExchangeFlowEnabled>");
    expect(policy).toContain(
      "<permittedUsersPolicyType>AdminApprovedPreAuthorized</permittedUsersPolicyType>",
    );
    expect(policy).toContain(
      "<commaSeparatedPermissionSet>ExampleTokenAccess</commaSeparatedPermissionSet>",
    );
    expect(policy).not.toContain("<apexHandler>");
    const handler = token.sources.find(
      (source) => source.type === "OauthTokenExchangeHandler",
    )?.source;
    expect(handler).toContain("<tokenHandlerApex>ExampleTokenHandlerApex</tokenHandlerApex>");
    expect(handler).toContain("<isContactCreationAllowed>false</isContactCreationAllowed>");
    expect(handler).toContain("<externalClientApp>ExampleEca</externalClientApp>");
  });

  it("embeds only a public JWT certificate and pre-authorized policy", () => {
    const built = buildEcaProfileSources({
      ...base,
      flow: "jwt_bearer",
      permissionSet: "ExampleJwtAccess",
      certificatePem:
        "-----BEGIN CERTIFICATE-----\nU0YgUGkgcHVibGljIHRlc3QgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
    });
    const global = built.sources.find(
      (source) => source.type === "ExtlClntAppGlobalOauthSettings",
    )?.source;
    const policy = built.sources.find(
      (source) => source.type === "ExtlClntAppOauthConfigurablePolicies",
    )?.source;

    expect(global).toContain("<certificate>-----BEGIN CERTIFICATE-----");
    expect(policy).toContain(
      "<permittedUsersPolicyType>AdminApprovedPreAuthorized</permittedUsersPolicyType>",
    );
    expect(policy).toContain(
      "<commaSeparatedPermissionSet>ExampleJwtAccess</commaSeparatedPermissionSet>",
    );
    expect(JSON.stringify(built)).not.toContain("PRIVATE KEY");
  });

  it("returns the exact deployable component set for every core flow", () => {
    for (const flow of [
      "authorization_code",
      "authorization_code_pkce",
      "client_credentials",
      "device",
      "jwt_bearer",
      "token_exchange",
    ] as const) {
      const built = buildEcaProfileSources({
        ...base,
        flow,
        ...(flow === "client_credentials"
          ? { clientCredentialsUser: "integration@example.invalid" }
          : {}),
        ...(flow === "jwt_bearer"
          ? {
              permissionSet: "ExampleJwtAccess",
              certificatePem:
                "-----BEGIN CERTIFICATE-----\nU0YgUGkgcHVibGljIHRlc3QgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
            }
          : {}),
        ...(flow === "token_exchange"
          ? {
              permissionSet: "ExampleTokenAccess",
              tokenExchangeHandler: "ExampleTokenHandler",
              tokenExchangeApex: "ExampleTokenHandlerApex",
              tokenExchangeUser: "integration@example.invalid",
            }
          : {}),
      });
      expect(built.sources.map((source) => source.type)).toEqual([
        "ExternalClientApplication",
        "ExtlClntAppGlobalOauthSettings",
        "ExtlClntAppOauthSettings",
        "ExtlClntAppOauthConfigurablePolicies",
        ...(flow === "token_exchange" ? (["OauthTokenExchangeHandler"] as const) : []),
      ]);
    }
  });

  it("rejects private keys and unsupported scope names", () => {
    expect(() =>
      buildEcaProfileSources({
        ...base,
        flow: "jwt_bearer",
        permissionSet: "ExampleJwtAccess",
        certificatePem: "-----BEGIN PRIVATE KEY-----\nnot-allowed\n-----END PRIVATE KEY-----",
      }),
    ).toThrow("public certificate");
    expect(() =>
      buildEcaProfileSources({
        ...base,
        flow: "device",
        oauthScopes: ["NotARealScope"],
      }),
    ).toThrow("Unsupported OAuth metadata scopes");
  });
});
