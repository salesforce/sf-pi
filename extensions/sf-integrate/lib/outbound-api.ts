/* SPDX-License-Identifier: Apache-2.0 */
/** Connect REST and data-API adapter for outbound credential lifecycle operations. */

import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { defaultIntegrationAdapter } from "./metadata.ts";
import type { OutboundInspection, OutboundIntegrationPlan, PrincipalType } from "./types.ts";

export interface OutboundApplyEvidence {
  check_only?: unknown;
  identity_provider?: unknown;
  external_credential?: unknown;
  named_credential?: unknown;
  permission_set?: unknown;
  principal_access?: unknown;
  permission_assignment?: unknown;
  verification: OutboundInspection;
}

export async function signingCertificateExists(
  session: SalesforceSession,
  developerName: string,
): Promise<boolean> {
  const result = await session.query<Record<string, unknown>>({
    soql: `SELECT Id FROM Certificate WHERE DeveloperName = '${developerName}' LIMIT 1`,
    api: "tooling",
    maxRows: 1,
  });
  return result.records.length === 1;
}

export async function inspectOutbound(
  session: SalesforceSession,
  input: {
    externalCredentialName: string;
    namedCredentialName: string;
    permissionSetName: string;
    identityProviderName?: string;
    principalName?: string;
    principalType?: PrincipalType;
  },
): Promise<OutboundInspection> {
  const [externalCredential, namedCredential, identityProvider, permissionSet] = await Promise.all([
    getResource(
      session,
      `/named-credentials/external-credentials/${encodeURIComponent(input.externalCredentialName)}`,
    ),
    getResource(
      session,
      `/named-credentials/named-credential-setup/${encodeURIComponent(input.namedCredentialName)}`,
    ),
    input.identityProviderName
      ? getResource(
          session,
          `/named-credentials/external-auth-identity-providers/${encodeURIComponent(input.identityProviderName)}`,
        )
      : Promise.resolve(undefined),
    findPermissionSet(session, input.permissionSetName),
  ]);
  const principalId = principalIdFrom(externalCredential, input.principalName);
  const permissionSetId = stringValue(permissionSet?.Id);
  const [credential, principalAccess, permissionAssignment] = await Promise.all([
    externalCredential && input.principalName && input.principalType
      ? getCredential(
          session,
          input.externalCredentialName,
          input.principalName,
          input.principalType,
        )
      : Promise.resolve(undefined),
    permissionSetId && principalId
      ? findSetupEntityAccess(session, permissionSetId, principalId)
      : Promise.resolve(undefined),
    permissionSetId
      ? findCurrentUserAssignment(session, permissionSetId)
      : Promise.resolve(undefined),
  ]);
  return {
    external_credential_name: input.externalCredentialName,
    named_credential_name: input.namedCredentialName,
    permission_set_name: input.permissionSetName,
    identity_provider_name: input.identityProviderName,
    external_credential: externalCredential,
    named_credential: namedCredential,
    identity_provider: identityProvider,
    credential,
    permission_set_id: permissionSetId,
    principal_id: principalId,
    principal_access_id: stringValue(principalAccess?.Id),
    permission_assignment_id: stringValue(permissionAssignment?.Id),
  };
}

export async function applyOutboundPlan(
  session: SalesforceSession,
  plan: OutboundIntegrationPlan,
  signal?: AbortSignal,
): Promise<OutboundApplyEvidence> {
  const before = await inspectOutbound(session, inspectionInput(plan));
  assertCreateOnly(before, plan);
  const evidence: Omit<OutboundApplyEvidence, "verification"> = {};

  if (plan.external_auth_identity_provider) {
    evidence.identity_provider = await post(
      session,
      "/named-credentials/external-auth-identity-providers",
      plan.external_auth_identity_provider,
      signal,
    );
  }

  if (plan.external_credential_source) {
    const check = await defaultIntegrationAdapter.deploy({
      session,
      sources: [plan.external_credential_source],
      checkOnly: true,
      signal,
    });
    evidence.check_only = check.raw;
    if (!check.success) {
      throw new Error(
        `External Credential check-only failed: ${check.component_failures.map((failure) => failure.problem).join("; ")}`,
      );
    }
    const deployed = await defaultIntegrationAdapter.deploy({
      session,
      sources: [plan.external_credential_source],
      checkOnly: false,
      signal,
    });
    if (!deployed.success) {
      throw new Error(
        `External Credential deployment failed: ${deployed.component_failures.map((failure) => failure.problem).join("; ")}`,
      );
    }
    evidence.external_credential = deployed.raw;
  } else if (plan.external_credential) {
    evidence.external_credential = await post(
      session,
      "/named-credentials/external-credentials",
      plan.external_credential,
      signal,
    );
  }

  evidence.named_credential = await post(
    session,
    "/named-credentials/named-credential-setup",
    plan.named_credential,
    signal,
  );

  evidence.permission_set = await post(
    session,
    "/sobjects/PermissionSet",
    {
      Name: plan.permission_set_name,
      Label: `${plan.permission_set_name} Access`,
      Description: `Principal access for ${plan.named_credential_name}.`,
    },
    signal,
  );

  const afterParents = await inspectOutbound(session, inspectionInput(plan));
  if (!afterParents.permission_set_id || !afterParents.principal_id) {
    throw new Error("Created credential stack did not return permission set and principal IDs.");
  }
  evidence.principal_access = await post(
    session,
    "/sobjects/SetupEntityAccess",
    {
      ParentId: afterParents.permission_set_id,
      SetupEntityId: afterParents.principal_id,
    },
    signal,
  );

  if (plan.assign_to_current_user) {
    const identity = await session.identity({ signal });
    evidence.permission_assignment = await post(
      session,
      "/sobjects/PermissionSetAssignment",
      {
        AssigneeId: identity.user_id,
        PermissionSetId: afterParents.permission_set_id,
      },
      signal,
    );
  }

  return {
    ...evidence,
    verification: await inspectOutbound(session, inspectionInput(plan)),
  };
}

export async function populateOutboundSecret(
  session: SalesforceSession,
  plan: OutboundIntegrationPlan,
  input: { clientId?: string; secret: string; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  if (plan.auth_type === "oauth_jwt_bearer") {
    throw new Error(
      "oauth_jwt_bearer uses the configured signing certificate and has no secret.populate step.",
    );
  }
  if (plan.auth_type === "oauth_browser") {
    if (!plan.identity_provider_name)
      throw new Error("The browser-flow plan has no identity provider.");
    const clientId = requireClientId(input.clientId);
    return post(
      session,
      `/named-credentials/external-auth-identity-provider-credentials/${encodeURIComponent(plan.identity_provider_name)}`,
      {
        credentials: [
          { credentialName: "clientId", credentialValue: clientId },
          { credentialName: "clientSecret", credentialValue: input.secret },
        ],
      },
      input.signal,
    );
  }
  if (plan.auth_type === "oauth_client_credentials") {
    const clientId = requireClientId(input.clientId);
    return post(
      session,
      "/named-credentials/credential",
      {
        externalCredential: plan.external_credential_name,
        principalName: plan.principal_name,
        principalType: plan.principal_type,
        authenticationProtocol: "OAuth",
        authenticationProtocolVariant: "ClientCredentialsClientSecret",
        credentials: {
          clientId: { value: clientId, encrypted: false },
          clientSecret: { value: input.secret, encrypted: true },
        },
      },
      input.signal,
    );
  }
  return post(
    session,
    "/named-credentials/credential",
    {
      externalCredential: plan.external_credential_name,
      principalName: plan.principal_name,
      principalType: plan.principal_type,
      authenticationProtocol: "Custom",
      credentials: {
        ApiKey: { value: input.secret, encrypted: true },
      },
    },
    input.signal,
  );
}

export async function getOutboundAuthorizationUrl(
  session: SalesforceSession,
  plan: OutboundIntegrationPlan,
  signal?: AbortSignal,
): Promise<string> {
  if (plan.auth_type !== "oauth_browser") {
    throw new Error("oauth.authorize is available only for auth_type=oauth_browser.");
  }
  const response = await post(
    session,
    "/named-credentials/credential/auth-url/o-auth",
    {
      externalCredential: plan.external_credential_name,
      principalName: plan.principal_name,
      principalType: plan.principal_type,
    },
    signal,
  );
  const url = findHttpsUrl(response);
  if (!url) throw new Error("Salesforce returned no OAuth authorization URL.");
  return url;
}

/** E2E-only cleanup for disposable outbound stacks. */
export async function deleteOutboundStack(
  session: SalesforceSession,
  plan: OutboundIntegrationPlan,
): Promise<void> {
  assertNonProduction(session);
  const inspection = await inspectOutbound(session, inspectionInput(plan));
  for (const [objectName, id] of [
    ["PermissionSetAssignment", inspection.permission_assignment_id],
    ["SetupEntityAccess", inspection.principal_access_id],
    ["PermissionSet", inspection.permission_set_id],
  ] as const) {
    if (!id) continue;
    await remove(session, `/sobjects/${objectName}/${id}`);
  }
  if (inspection.named_credential) {
    await remove(
      session,
      `/named-credentials/named-credential-setup/${encodeURIComponent(plan.named_credential_name)}`,
    );
  }
  if (inspection.external_credential) {
    await remove(
      session,
      `/named-credentials/external-credentials/${encodeURIComponent(plan.external_credential_name)}`,
    );
  }
  if (inspection.identity_provider && plan.identity_provider_name) {
    await remove(
      session,
      `/named-credentials/external-auth-identity-providers/${encodeURIComponent(plan.identity_provider_name)}`,
    );
  }
}

export function outboundVerificationFindings(
  plan: OutboundIntegrationPlan,
  inspection: OutboundInspection,
  options: { requireConfigured?: boolean } = {},
): string[] {
  const findings: string[] = [];
  if (!inspection.external_credential) findings.push("external credential missing");
  if (!inspection.named_credential) findings.push("named credential missing");
  if (plan.identity_provider_name && !inspection.identity_provider) {
    findings.push("external auth identity provider missing");
  }
  if (!inspection.permission_set_id) findings.push("permission set missing");
  if (!inspection.principal_id) findings.push("external credential principal missing");
  if (!inspection.principal_access_id) findings.push("principal access missing");
  if (plan.assign_to_current_user && !inspection.permission_assignment_id) {
    findings.push("current-user permission assignment missing");
  }
  if (options.requireConfigured && plan.credential_shape.length > 0) {
    const status = stringValue(inspection.credential?.authenticationStatus);
    if (status !== "Configured" && !(plan.auth_type === "api_key" && status === "Unknown")) {
      findings.push("principal credentials are not configured");
    }
  }
  if (plan.auth_type === "oauth_jwt_bearer") {
    const status = externalAuthenticationStatus(
      inspection.external_credential,
      plan.principal_name,
    );
    if (status !== "Configured") {
      findings.push("JWT principal is not configured by the signing certificate");
    }
  }
  return findings;
}

function inspectionInput(plan: OutboundIntegrationPlan) {
  return {
    externalCredentialName: plan.external_credential_name,
    namedCredentialName: plan.named_credential_name,
    permissionSetName: plan.permission_set_name,
    identityProviderName: plan.identity_provider_name,
    principalName: plan.principal_name,
    principalType: plan.principal_type,
  };
}

function assertCreateOnly(inspection: OutboundInspection, plan: OutboundIntegrationPlan): void {
  const existing = [
    inspection.identity_provider ? plan.identity_provider_name : undefined,
    inspection.external_credential ? plan.external_credential_name : undefined,
    inspection.named_credential ? plan.named_credential_name : undefined,
    inspection.permission_set_id ? plan.permission_set_name : undefined,
  ].filter(Boolean);
  if (existing.length) {
    throw new Error(`Outbound setup is create-only; existing resources: ${existing.join(", ")}.`);
  }
}

async function getCredential(
  session: SalesforceSession,
  externalCredential: string,
  principalName: string,
  principalType: PrincipalType,
): Promise<Record<string, unknown> | undefined> {
  const response = await session.request<Record<string, unknown>>({
    method: "GET",
    path: "/named-credentials/credential",
    query: { externalCredential, principalName, principalType },
  });
  if (response.status === 404) return undefined;
  assertSuccess(response.status, response.body, "read principal credential");
  return recordValue(response.body);
}

async function getResource(
  session: SalesforceSession,
  resource: string,
): Promise<Record<string, unknown> | undefined> {
  const response = await session.request<Record<string, unknown>>({
    method: "GET",
    path: resource,
  });
  if (response.status === 404) return undefined;
  assertSuccess(response.status, response.body, `read ${resource}`);
  return recordValue(response.body);
}

async function post(
  session: SalesforceSession,
  resource: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await session.request<Record<string, unknown>>({
    method: "POST",
    path: resource,
    body,
    signal,
  });
  assertSuccess(response.status, response.body, `POST ${resource}`);
  return recordValue(response.body) ?? {};
}

async function remove(session: SalesforceSession, resource: string): Promise<void> {
  const response = await session.request<unknown>({ method: "DELETE", path: resource });
  if (response.status !== 404) assertSuccess(response.status, response.body, `DELETE ${resource}`);
}

async function findPermissionSet(
  session: SalesforceSession,
  name: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await session.query<Record<string, unknown>>({
    soql: `SELECT Id, Name FROM PermissionSet WHERE Name = '${name}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  return result.records[0];
}

async function findSetupEntityAccess(
  session: SalesforceSession,
  permissionSetId: string,
  principalId: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await session.query<Record<string, unknown>>({
    soql: `SELECT Id FROM SetupEntityAccess WHERE ParentId = '${permissionSetId}' AND SetupEntityId = '${principalId}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  return result.records[0];
}

async function findCurrentUserAssignment(
  session: SalesforceSession,
  permissionSetId: string,
): Promise<Record<string, unknown> | undefined> {
  const identity = await session.identity();
  const result = await session.query<Record<string, unknown>>({
    soql: `SELECT Id FROM PermissionSetAssignment WHERE PermissionSetId = '${permissionSetId}' AND AssigneeId = '${identity.user_id}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  return result.records[0];
}

function principalIdFrom(
  externalCredential: Record<string, unknown> | undefined,
  principalName: string | undefined,
): string | undefined {
  const principals = externalCredential?.principals;
  if (!Array.isArray(principals)) return undefined;
  const principal = principals.find(
    (item) =>
      item &&
      typeof item === "object" &&
      (!principalName || (item as { principalName?: unknown }).principalName === principalName),
  ) as Record<string, unknown> | undefined;
  return stringValue(principal?.id);
}

function externalAuthenticationStatus(
  externalCredential: Record<string, unknown> | undefined,
  principalName: string,
): string | undefined {
  const principals = externalCredential?.principals;
  if (Array.isArray(principals)) {
    const principal = principals.find(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as { principalName?: unknown }).principalName === principalName,
    ) as Record<string, unknown> | undefined;
    const principalStatus = stringValue(principal?.authenticationStatus);
    if (principalStatus) return principalStatus;
  }
  return stringValue(externalCredential?.authenticationStatus);
}

function findHttpsUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value.startsWith("https://") ? value : undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findHttpsUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findHttpsUrl(child);
    if (found) return found;
  }
  return undefined;
}

function assertSuccess(status: number, body: unknown, action: string): void {
  if (status < 400) return;
  throw new Error(`${action} failed with HTTP ${status}: ${errorMessage(body)}`);
}

function errorMessage(body: unknown): string {
  const candidate = Array.isArray(body) ? body[0] : body;
  if (candidate && typeof candidate === "object") {
    const message = (candidate as { message?: unknown }).message;
    const code = (candidate as { errorCode?: unknown }).errorCode;
    if (typeof message === "string") {
      return `${typeof code === "string" ? `${code}: ` : ""}${message}`.slice(0, 1_000);
    }
  }
  return "Salesforce returned an unrecognized error response.";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireClientId(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 2_000 || /[\r\n]/u.test(normalized)) {
    throw new Error("client_id must contain 1 to 2,000 characters on one line.");
  }
  return normalized;
}

function assertNonProduction(session: SalesforceSession): void {
  if (!["sandbox", "scratch", "developer", "trial"].includes(session.target.orgType)) {
    throw new Error("Disposable outbound cleanup refuses production or unknown orgs.");
  }
}
