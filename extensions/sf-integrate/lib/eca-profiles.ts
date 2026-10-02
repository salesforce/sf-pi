/* SPDX-License-Identifier: Apache-2.0 */
/** Grounded External Client App OAuth flow profiles. */

import type { EcaOauthFlow, InboundIntegrationPlan, IntegrationMetadataSource } from "./types.ts";

const DEFAULT_CALLBACK = "https://login.salesforce.com/services/oauth2/success";
const OAUTH_SCOPES = new Set([
  "Address",
  "Api",
  "Basic",
  "CDP",
  "CDPCalculatedInsight",
  "CDPIdentityResolution",
  "CDPIngest",
  "CDPProfile",
  "CDPQuery",
  "CDPSegment",
  "Chatbot",
  "Chatter",
  "Content",
  "CustomApplications",
  "CustomPermissions",
  "Eclair",
  "EinsteinGPT",
  "Email",
  "ForgotPassword",
  "Full",
  "Interaction",
  "Lightning",
  "MCP",
  "OfflineAccess",
  "OpenID",
  "Pardot",
  "Phone",
  "Profile",
  "PwdlessLogin",
  "RefreshToken",
  "SCRT",
  "SFApiPlatform",
  "UserRegistration",
  "Wave",
  "Web",
]);

export interface BuildEcaProfileInput {
  flow: EcaOauthFlow;
  appName: string;
  appLabel: string;
  contactEmail: string;
  callbackUrl?: string;
  oauthScopes?: string[];
  clientCredentialsUser?: string;
  certificatePem?: string;
  permissionSet?: string;
  tokenExchangeRequireSecret?: boolean;
  tokenExchangeHandler?: string;
  tokenExchangeApex?: string;
  tokenExchangeUser?: string;
}

export interface BuiltEcaProfile {
  callbackUrl: string;
  metadataScopes: string[];
  expected: InboundIntegrationPlan["expected"];
  sources: IntegrationMetadataSource[];
}

export function buildEcaProfileSources(input: BuildEcaProfileInput): BuiltEcaProfile {
  const profile = profileSettings(input);
  const appName = escapeXml(input.appName);
  const appLabel = escapeXml(input.appLabel);
  const contactEmail = escapeXml(input.contactEmail);
  const callbackUrl = escapeXml(profile.callbackUrl);
  const scopes = profile.metadataScopes.join(", ");
  const globalFields = [
    xmlField("callbackUrl", callbackUrl),
    ...(profile.certificatePem ? [xmlField("certificate", escapeXml(profile.certificatePem))] : []),
    xmlField("externalClientApplication", appName),
    xmlField("isClientCredentialsFlowEnabled", profile.clientCredentialsEnabled),
    xmlField("isCodeCredFlowEnabled", false),
    xmlField("isCodeCredPostOnly", false),
    xmlField("isConsumerSecretOptional", profile.consumerSecretOptional),
    xmlField("isDeviceFlowEnabled", profile.deviceFlowEnabled),
    xmlField("isIntrospectAllTokens", false),
    xmlField("isNamedUserJwtEnabled", true),
    xmlField("isPkceRequired", profile.pkceRequired),
    xmlField("isRefreshTokenRotationEnabled", true),
    xmlField("isSecretRequiredForRefreshToken", profile.secretRequiredForRefreshToken),
    xmlField("isSecretRequiredForTokenExchange", profile.tokenExchangeSecretRequired),
    xmlField("isTokenExchangeEnabled", profile.tokenExchangeEnabled),
    xmlField("label", `${appLabel} OAuth`),
    xmlField("shouldRotateConsumerKey", false),
    xmlField("shouldRotateConsumerSecret", false),
  ].join("\n");
  const policyFields = [
    ...(profile.clientCredentialsUser
      ? [xmlField("clientCredentialsFlowUser", escapeXml(profile.clientCredentialsUser))]
      : []),
    ...(profile.permissionSet
      ? [xmlField("commaSeparatedPermissionSet", escapeXml(profile.permissionSet))]
      : []),
    xmlField("externalClientApplication", appName),
    xmlField("ipRelaxationPolicyType", "Enforce"),
    xmlField("isClientCredentialsFlowEnabled", profile.clientCredentialsEnabled),
    xmlField("isTokenExchangeFlowEnabled", profile.tokenExchangeEnabled),
    xmlField("label", `${appLabel} OAuth Policy`),
    xmlField("namedUserJwtSessionTimeoutType", "Custom"),
    xmlField("namedUserJwtTimeout", 30),
    xmlField("permittedUsersPolicyType", profile.permittedUsersPolicy),
    xmlField("refreshTokenPolicyType", profile.refreshTokenPolicy),
    ...(profile.refreshTokenPolicy === "SpecificLifetime"
      ? [xmlField("refreshTokenValidityPeriod", 30), xmlField("refreshTokenValidityUnit", "Days")]
      : []),
  ].join("\n");

  return {
    callbackUrl: profile.callbackUrl,
    metadataScopes: profile.metadataScopes,
    expected: {
      consumer_secret_optional: profile.consumerSecretOptional,
      pkce_required: profile.pkceRequired,
      secret_required_for_refresh_token: profile.secretRequiredForRefreshToken,
      client_credentials_enabled: profile.clientCredentialsEnabled,
      device_flow_enabled: profile.deviceFlowEnabled,
      token_exchange_enabled: profile.tokenExchangeEnabled,
      token_exchange_secret_required: profile.tokenExchangeSecretRequired,
      certificate_present: Boolean(profile.certificatePem),
      client_credentials_user: profile.clientCredentialsUser,
      permitted_users_policy: profile.permittedUsersPolicy,
      token_exchange_handler: profile.tokenExchangeHandler,
      token_exchange_apex: profile.tokenExchangeApex,
      token_exchange_user: profile.tokenExchangeUser,
    },
    sources: [
      {
        type: "ExternalClientApplication",
        directory: "externalClientApps",
        filename: `${input.appName}.eca-meta.xml`,
        source: `<?xml version="1.0" encoding="UTF-8"?>
<ExternalClientApplication xmlns="http://soap.sforce.com/2006/04/metadata">
    <contactEmail>${contactEmail}</contactEmail>
    <description>Disposable or managed OAuth client created by SF Integrate.</description>
    <distributionState>Local</distributionState>
    <isProtected>false</isProtected>
    <label>${appLabel}</label>
</ExternalClientApplication>
`,
      },
      {
        type: "ExtlClntAppGlobalOauthSettings",
        directory: "extlClntAppGlobalOauthSets",
        filename: `${input.appName}.ecaGlblOauth-meta.xml`,
        source: `<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppGlobalOauthSettings xmlns="http://soap.sforce.com/2006/04/metadata">
${globalFields}
</ExtlClntAppGlobalOauthSettings>
`,
      },
      {
        type: "ExtlClntAppOauthSettings",
        directory: "extlClntAppOauthSettings",
        filename: `${input.appName}.ecaOauth-meta.xml`,
        source: `<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppOauthSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <commaSeparatedOauthScopes>${escapeXml(scopes)}</commaSeparatedOauthScopes>
    <externalClientApplication>${appName}</externalClientApplication>
    <label>${appLabel} OAuth</label>
</ExtlClntAppOauthSettings>
`,
      },
      {
        type: "ExtlClntAppOauthConfigurablePolicies",
        directory: "extlClntAppOauthPolicies",
        filename: `${input.appName}.ecaOauthPlcy-meta.xml`,
        source: `<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppOauthConfigurablePolicies xmlns="http://soap.sforce.com/2006/04/metadata">
${policyFields}
</ExtlClntAppOauthConfigurablePolicies>
`,
      },
      ...(profile.tokenExchangeHandler
        ? [
            {
              type: "OauthTokenExchangeHandler" as const,
              directory: "oauthtokenexchangehandlers",
              filename: `${profile.tokenExchangeHandler}.oauthtokenexchangehandler-meta.xml`,
              source: `<?xml version="1.0" encoding="UTF-8"?>
<OauthTokenExchangeHandler xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Token exchange handler binding managed by SF Integrate.</description>
    <developerName>${escapeXml(profile.tokenExchangeHandler)}</developerName>
    <enablements>
        <apexExecutionUser>${escapeXml(profile.tokenExchangeUser)}</apexExecutionUser>
        <externalClientApp>${appName}</externalClientApp>
        <isDefault>true</isDefault>
    </enablements>
    <isAccessTokenSupported>false</isAccessTokenSupported>
    <isContactCreationAllowed>false</isContactCreationAllowed>
    <isEnabled>true</isEnabled>
    <isIdTokenSupported>false</isIdTokenSupported>
    <isJwtSupported>true</isJwtSupported>
    <isProtected>false</isProtected>
    <isRefreshTokenSupported>false</isRefreshTokenSupported>
    <isSaml2Supported>false</isSaml2Supported>
    <isUserCreationAllowed>false</isUserCreationAllowed>
    <masterLabel>${escapeXml(profile.tokenExchangeHandler)}</masterLabel>
    <tokenHandlerApex>${escapeXml(profile.tokenExchangeApex)}</tokenHandlerApex>
</OauthTokenExchangeHandler>
`,
            },
          ]
        : []),
    ],
  };
}

function profileSettings(input: BuildEcaProfileInput) {
  const callbackUrl = validateCallback(input.callbackUrl ?? defaultCallback(input.flow));
  const metadataScopes = validateScopes(input.oauthScopes ?? defaultScopes(input.flow));
  const tokenExchangeSecretRequired =
    input.flow === "token_exchange" ? input.tokenExchangeRequireSecret !== false : false;
  const certificatePem =
    input.flow === "jwt_bearer" ? validateCertificate(input.certificatePem) : undefined;
  const clientCredentialsUser =
    input.flow === "client_credentials"
      ? requireOneLine(input.clientCredentialsUser, "client_credentials_user")
      : undefined;
  const permissionSet =
    input.flow === "jwt_bearer" || input.flow === "token_exchange"
      ? requireApiName(input.permissionSet, "eca_permission_set")
      : undefined;
  const tokenExchangeHandler =
    input.flow === "token_exchange"
      ? requireApiName(input.tokenExchangeHandler, "token_exchange_handler")
      : undefined;
  const tokenExchangeApex =
    input.flow === "token_exchange"
      ? requireApiName(input.tokenExchangeApex, "token_exchange_apex")
      : undefined;
  const tokenExchangeUser =
    input.flow === "token_exchange"
      ? requireOneLine(input.tokenExchangeUser, "token_exchange_user")
      : undefined;
  return {
    callbackUrl,
    metadataScopes,
    certificatePem,
    clientCredentialsUser,
    permissionSet,
    tokenExchangeHandler,
    tokenExchangeApex,
    tokenExchangeUser,
    clientCredentialsEnabled: input.flow === "client_credentials",
    deviceFlowEnabled: input.flow === "device",
    tokenExchangeEnabled: input.flow === "token_exchange",
    tokenExchangeSecretRequired,
    consumerSecretOptional:
      input.flow === "authorization_code_pkce" ||
      input.flow === "device" ||
      input.flow === "jwt_bearer",
    // Current ECA security enforcement normalizes PKCE to required for supported authorization flows.
    pkceRequired: true,
    secretRequiredForRefreshToken:
      input.flow === "authorization_code" || input.flow === "client_credentials",
    permittedUsersPolicy:
      input.flow === "jwt_bearer" || input.flow === "token_exchange"
        ? "AdminApprovedPreAuthorized"
        : "AllSelfAuthorized",
    refreshTokenPolicy:
      input.flow === "authorization_code" ||
      input.flow === "authorization_code_pkce" ||
      input.flow === "device"
        ? "SpecificLifetime"
        : "Zero",
  };
}

function defaultCallback(flow: EcaOauthFlow): string {
  return flow === "device" ? "http://localhost:1717/OauthRedirect" : DEFAULT_CALLBACK;
}

function defaultScopes(flow: EcaOauthFlow): string[] {
  if (flow === "authorization_code" || flow === "authorization_code_pkce") {
    return ["Api", "RefreshToken", "OpenID"];
  }
  if (flow === "device") return ["Api", "RefreshToken"];
  if (flow === "jwt_bearer") return ["Web", "RefreshToken"];
  return ["Api"];
}

function validateScopes(scopes: string[]): string[] {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
  if (!normalized.length) throw new Error("oauth_scopes must include at least one scope.");
  const unsupported = normalized.filter((scope) => !OAUTH_SCOPES.has(scope));
  if (unsupported.length) {
    throw new Error(`Unsupported OAuth metadata scopes: ${unsupported.join(", ")}.`);
  }
  return normalized;
}

function validateCallback(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_000 || /[\r\n]/u.test(normalized)) {
    throw new Error("callback_url must contain 1 to 2,000 characters on one line.");
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("callback_url must be an absolute callback URI.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("callback_url must not contain embedded credentials.");
  }
  return normalized;
}

function validateCertificate(value: string | undefined): string {
  const certificate = value?.trim() ?? "";
  if (
    !certificate.startsWith("-----BEGIN CERTIFICATE-----") ||
    !certificate.endsWith("-----END CERTIFICATE-----") ||
    certificate.includes("PRIVATE KEY") ||
    certificate.length > 16_384
  ) {
    throw new Error("certificate_file must contain one PEM-encoded public certificate.");
  }
  return `${certificate}\n`;
}

function requireOneLine(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 500 || /[\r\n]/u.test(normalized)) {
    throw new Error(`${field} must contain 1 to 500 characters on one line.`);
  }
  return normalized;
}

function requireApiName(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(normalized)) {
    throw new Error(`${field} must be a Salesforce API name.`);
  }
  return normalized;
}

function xmlField(name: string, value: string | number | boolean): string {
  return `    <${name}>${String(value)}</${name}>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
