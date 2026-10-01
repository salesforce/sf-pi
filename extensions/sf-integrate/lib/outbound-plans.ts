/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic outbound Named Credential plan construction. */

import { createHash } from "node:crypto";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { writeIntegrationArtifact } from "./artifacts.ts";
import type {
  OutboundAuthType,
  OutboundIntegrationPlan,
  PrincipalType,
  SfIntegrateParams,
} from "./types.ts";

const DEFAULT_NAMED_CREDENTIAL = "SfPiOutbound";
const DEFAULT_EXTERNAL_CREDENTIAL = "SfPiOutboundEC";
const DEFAULT_PERMISSION_SET = "SfPiOutboundAccess";
const DEFAULT_IDENTITY_PROVIDER = "SfPiOutboundIdp";

export async function buildOutboundPlan(
  params: SfIntegrateParams,
  session: SalesforceSession,
): Promise<OutboundIntegrationPlan> {
  const authType = requireAuthType(params.auth_type);
  const endpointUrl = requireHttpsUrl(params.endpoint_url, "endpoint_url");
  const namedCredentialName = requireApiName(
    params.named_credential_name ?? DEFAULT_NAMED_CREDENTIAL,
    "named_credential_name",
  );
  const externalCredentialName = requireApiName(
    params.external_credential_name ?? DEFAULT_EXTERNAL_CREDENTIAL,
    "external_credential_name",
  );
  const permissionSetName = requireApiName(
    params.permission_set_name ?? DEFAULT_PERMISSION_SET,
    "permission_set_name",
  );
  const principalType = resolvePrincipalType(authType, params.principal_type);
  const principalName = requireApiName(
    params.principal_name ?? defaultPrincipalName(authType, principalType),
    "principal_name",
  );
  const identityProviderName =
    authType === "oauth_browser"
      ? requireApiName(
          params.identity_provider_name ?? DEFAULT_IDENTITY_PROVIDER,
          "identity_provider_name",
        )
      : undefined;
  const target = planTarget(session);
  const externalAuthIdentityProvider = buildIdentityProvider(
    authType,
    identityProviderName,
    params,
  );
  const externalCredential = buildExternalCredential(
    authType,
    externalCredentialName,
    principalName,
    principalType,
    identityProviderName,
    params,
  );
  const externalCredentialSource =
    authType === "api_key"
      ? buildCustomExternalCredentialSource(
          externalCredentialName,
          principalName,
          params.api_key_header,
        )
      : undefined;
  const namedCredential = buildNamedCredential(
    authType,
    namedCredentialName,
    externalCredentialName,
    principalName,
    endpointUrl,
    params.api_key_header,
  );
  const material = {
    schema_version: 1 as const,
    direction: "outbound" as const,
    auth_type: authType,
    target,
    endpoint_url: endpointUrl,
    external_credential_name: externalCredentialName,
    named_credential_name: namedCredentialName,
    principal_name: principalName,
    principal_type: principalType,
    permission_set_name: permissionSetName,
    assign_to_current_user: params.assign_to_current_user !== false,
    identity_provider_name: identityProviderName,
    external_auth_identity_provider: externalAuthIdentityProvider,
    external_credential: externalCredential,
    external_credential_source: externalCredentialSource,
    named_credential: namedCredential,
    credential_shape: credentialShape(authType),
  };
  const planHash = `sha256:${createHash("sha256").update(stableJson(material)).digest("hex")}`;
  const planId = `plan_${planHash.slice("sha256:".length, "sha256:".length + 16)}`;
  const createdAt = new Date().toISOString();
  const plan: OutboundIntegrationPlan = {
    ...material,
    plan_id: planId,
    plan_hash: planHash,
    created_at: createdAt,
  };
  const artifact = await writeIntegrationArtifact(
    "plans",
    `${artifactTime(createdAt)}-${namedCredentialName}-${planId}.json`,
    plan,
  );
  return { ...plan, artifact_path: artifact.path };
}

export function assertOutboundPlanMatches(
  plan: OutboundIntegrationPlan | undefined,
  input: {
    planId?: string;
    planHash?: string;
    namedCredentialName?: string;
  },
): OutboundIntegrationPlan {
  if (!plan) {
    throw new Error(
      "The outbound integration plan isn't available in this session. Run design.plan again.",
    );
  }
  if (!input.planId || plan.plan_id !== input.planId) {
    throw new Error("plan_id does not match the current outbound integration plan.");
  }
  if (!input.planHash || plan.plan_hash !== input.planHash) {
    throw new Error("plan_hash does not match the current outbound integration plan.");
  }
  if (!input.namedCredentialName || plan.named_credential_name !== input.namedCredentialName) {
    throw new Error("named_credential_name does not match the current outbound plan.");
  }
  return plan;
}

export function assertOutboundPlanTarget(
  plan: OutboundIntegrationPlan,
  session: SalesforceSession,
): void {
  if (!session.target.orgId || plan.target.org_id !== session.target.orgId) {
    throw new Error("The outbound plan belongs to a different org. Run design.plan again.");
  }
  if (plan.target.api_version !== session.target.apiVersion) {
    throw new Error("The target org API version changed after planning. Run design.plan again.");
  }
}

function buildIdentityProvider(
  authType: OutboundAuthType,
  name: string | undefined,
  params: SfIntegrateParams,
): Record<string, unknown> | undefined {
  if (authType !== "oauth_browser" || !name) return undefined;
  return {
    fullName: name,
    label: `${name} OAuth Provider`,
    authenticationProtocol: "OAuth",
    authenticationFlow: "AuthorizationCode",
    tokenUrl: requireHttpsUrl(params.token_url, "token_url"),
    authorizeUrl: requireHttpsUrl(params.authorize_url, "authorize_url"),
    clientAuthentication: "ClientSecretPost",
  };
}

function buildExternalCredential(
  authType: OutboundAuthType,
  externalCredentialName: string,
  principalName: string,
  principalType: PrincipalType,
  identityProviderName: string | undefined,
  params: SfIntegrateParams,
): Record<string, unknown> | undefined {
  if (authType === "api_key") return undefined;

  const parameters: Array<Record<string, unknown>> = [];
  let authenticationProtocolVariant: string | undefined;
  if (authType === "oauth_client_credentials") {
    authenticationProtocolVariant = "ClientCredentialsClientSecret";
    parameters.push(
      parameter(
        "Identity Provider URL",
        "AuthProviderUrl",
        requireHttpsUrl(params.token_url, "token_url"),
      ),
    );
  } else if (authType === "oauth_jwt_bearer") {
    authenticationProtocolVariant = "JwtBearer";
    parameters.push(
      parameter(
        "SigningCertificate",
        "SigningCertificate",
        requireApiName(params.signing_certificate, "signing_certificate"),
      ),
      parameter(
        "iss",
        "JwtBodyClaim",
        JSON.stringify(requireText(params.jwt_issuer, "jwt_issuer")),
      ),
      parameter(
        "sub",
        "JwtBodyClaim",
        JSON.stringify(requireText(params.jwt_subject, "jwt_subject")),
      ),
      parameter(
        "aud",
        "JwtBodyClaim",
        JSON.stringify(requireText(params.jwt_audience, "jwt_audience")),
      ),
      parameter(
        "Identity Provider URL",
        "AuthProviderUrl",
        requireHttpsUrl(params.token_url, "token_url"),
      ),
    );
  } else if (authType === "oauth_browser" && identityProviderName) {
    parameters.push(
      parameter(
        "ExternalAuthIdentityProvider",
        "ExternalAuthIdentityProvider",
        identityProviderName,
      ),
    );
  }
  if (params.scope?.trim()) {
    parameters.push(parameter("Scope", "AuthParameter", params.scope.trim()));
  }

  return {
    developerName: externalCredentialName,
    masterLabel: `${externalCredentialName} External Credential`,
    authenticationProtocol: "OAuth",
    ...(authenticationProtocolVariant ? { authenticationProtocolVariant } : {}),
    parameters,
    principals: [
      {
        principalName,
        principalType,
        sequenceNumber: 1,
      },
    ],
  };
}

function buildCustomExternalCredentialSource(
  externalCredentialName: string,
  principalName: string,
  headerName: string | undefined,
) {
  requireHeaderName(headerName);
  return {
    directory: "externalCredentials",
    filename: `${externalCredentialName}.externalCredential-meta.xml`,
    source: `<?xml version="1.0" encoding="UTF-8"?>
<ExternalCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <authenticationProtocol>Custom</authenticationProtocol>
    <externalCredentialParameters>
        <parameterGroup>${escapeXml(principalName)}</parameterGroup>
        <parameterName>ApiKey</parameterName>
        <parameterType>NamedPrincipal</parameterType>
        <sequenceNumber>1</sequenceNumber>
    </externalCredentialParameters>
    <label>${escapeXml(externalCredentialName)} External Credential</label>
</ExternalCredential>
`,
  };
}

function buildNamedCredential(
  authType: OutboundAuthType,
  namedCredentialName: string,
  externalCredentialName: string,
  principalName: string,
  endpointUrl: string,
  apiKeyHeader: string | undefined,
): Record<string, unknown> {
  const custom = authType === "api_key";
  return {
    developerName: namedCredentialName,
    masterLabel: `${namedCredentialName} Named Credential`,
    type: "SecuredEndpoint",
    calloutUrl: endpointUrl,
    externalCredentials: [{ developerName: externalCredentialName }],
    calloutOptions: {
      generateAuthorizationHeader: !custom,
      allowMergeFieldsInHeader: custom,
      allowMergeFieldsInBody: false,
    },
    ...(custom
      ? {
          customHeaders: [
            {
              headerName: requireHeaderName(apiKeyHeader),
              headerValue: `{!$Credential.${externalCredentialName}.ApiKey}`,
              sequenceNumber: 1,
            },
          ],
        }
      : {}),
  };
}

function credentialShape(authType: OutboundAuthType): string[] {
  if (authType === "oauth_client_credentials") return ["clientId", "clientSecret"];
  if (authType === "oauth_browser") return ["clientId", "clientSecret"];
  if (authType === "api_key") return ["ApiKey"];
  return [];
}

function resolvePrincipalType(
  authType: OutboundAuthType,
  value: PrincipalType | undefined,
): PrincipalType {
  const resolved = value ?? (authType === "oauth_browser" ? "PerUserPrincipal" : "NamedPrincipal");
  if (authType !== "oauth_browser" && resolved !== "NamedPrincipal") {
    throw new Error(`${authType} supports only principal_type=NamedPrincipal in Phase 2.`);
  }
  return resolved;
}

function defaultPrincipalName(authType: OutboundAuthType, principalType: PrincipalType): string {
  if (authType === "api_key") return "ApiKey";
  return principalType;
}

function requireAuthType(value: OutboundAuthType | undefined): OutboundAuthType {
  if (!value) throw new Error("auth_type is required for direction=outbound.");
  return value;
}

export function requireApiName(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(normalized)) {
    throw new Error(
      `${field} must start with a letter and contain at most 80 letters, numbers, or underscores.`,
    );
  }
  return normalized;
}

function requireHttpsUrl(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${field} must be an HTTPS URL without embedded credentials.`);
  }
  return url.toString().replace(/\/$/u, "");
}

function requireHeaderName(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/u.test(normalized)) {
    throw new Error(
      "api_key_header must be an HTTP header name containing letters, numbers, or hyphens.",
    );
  }
  return normalized;
}

function requireText(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 500 || /[\r\n]/u.test(normalized)) {
    throw new Error(`${field} must contain 1 to 500 characters on one line.`);
  }
  return normalized;
}

function parameter(
  parameterName: string,
  parameterType: string,
  parameterValue: string,
): Record<string, unknown> {
  return { parameterName, parameterType, parameterValue };
}

function planTarget(session: SalesforceSession) {
  const orgId = session.target.orgId;
  if (!orgId) throw new Error("The target org did not provide an org identity for plan binding.");
  return {
    target_org: session.target.targetOrg,
    alias: session.target.alias,
    org_id: orgId,
    org_type: session.target.orgType,
    api_version: session.target.apiVersion,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}

function artifactTime(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
