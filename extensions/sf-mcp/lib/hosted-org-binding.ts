/* SPDX-License-Identifier: Apache-2.0 */
/** Exact Salesforce-org binding and OAuth-discovery proof for hosted MCP connections. */

import { connectSalesforce } from "../../../lib/common/sf-conn/index.ts";
import { sfMcpHeadlessConnectionName } from "../../../lib/common/sf-mcp-oauth-requirements.ts";
import { salesforceOrgHostKey } from "../../../lib/common/sf-environment/org-type.ts";

const DISCOVERY_TIMEOUT_MS = 15_000;

export interface HostedMcpOrgBinding {
  targetOrg: string;
  alias?: string;
  orgId: string;
  orgType: string;
  hostKey: string;
  serverUrl: string;
  authorizationIssuer: string;
}

export interface ResolveHostedOrgBindingInput {
  cwd: string;
  targetOrg: string;
  serverPath: string;
  signal?: AbortSignal;
}

export interface HostedMcpTargetIdentity {
  targetOrg: string;
  alias?: string;
  orgId: string;
  orgType: string;
  instanceUrl: string;
}

export type HostedOrgBindingResolver = (
  input: ResolveHostedOrgBindingInput,
) => Promise<HostedMcpOrgBinding>;

export const resolveHostedOrgBinding: HostedOrgBindingResolver = async (input) => {
  const session = await connectSalesforce({
    cwd: input.cwd,
    targetOrg: input.targetOrg,
    signal: input.signal,
  });
  const orgId = session.target.orgId;
  if (!orgId) throw new Error("The target org did not provide an org identity for MCP binding.");
  return resolveHostedEndpointProof(
    {
      targetOrg: session.target.targetOrg,
      ...(session.target.alias ? { alias: session.target.alias } : {}),
      orgId,
      orgType: session.target.orgType,
      instanceUrl: session.target.instanceUrl,
    },
    input.serverPath,
    input.signal,
  );
};

export async function resolveHostedEndpointProof(
  target: HostedMcpTargetIdentity,
  serverPath: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<HostedMcpOrgBinding> {
  const hostKey = salesforceOrgHostKey(target.instanceUrl);
  if (!hostKey) throw new Error("The target org has no trusted Salesforce My Domain host.");

  const serverUrl = `https://api.salesforce.com/platform/mcp/v1/d/${hostKey}/${serverPath}`;
  const resourceMetadataUrl = new URL(serverUrl);
  resourceMetadataUrl.pathname = `/.well-known/oauth-protected-resource${resourceMetadataUrl.pathname}`;
  const resource = await fetchJson(resourceMetadataUrl.toString(), signal, fetchImpl);
  const issuers = stringArray(resource.authorization_servers);
  if (issuers.length !== 1) {
    throw new Error("Hosted MCP discovery must advertise exactly one authorization issuer.");
  }

  const expectedIssuer = new URL(target.instanceUrl).origin;
  const authorizationIssuer = normalizeOrigin(issuers[0]);
  if (authorizationIssuer !== expectedIssuer) {
    throw new Error("Hosted MCP discovery did not resolve to the explicit target org's My Domain.");
  }

  const openid = await fetchJson(
    `${authorizationIssuer}/.well-known/openid-configuration`,
    signal,
    fetchImpl,
  );
  if (normalizeOrigin(textValue(openid.issuer)) !== authorizationIssuer) {
    throw new Error("The target org's OpenID metadata issuer did not match its My Domain.");
  }
  assertTrustedHttpsUrl(openid.authorization_endpoint, "authorization endpoint");
  assertTrustedHttpsUrl(openid.token_endpoint, "token endpoint");

  return {
    targetOrg: target.targetOrg,
    ...(target.alias ? { alias: target.alias } : {}),
    orgId: target.orgId,
    orgType: target.orgType,
    hostKey,
    serverUrl,
    authorizationIssuer,
  };
}

export function hostedConnectionName(_baseName: string, binding: HostedMcpOrgBinding): string {
  return sfMcpHeadlessConnectionName(binding);
}

async function fetchJson(
  url: string,
  parentSignal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  const abort = () => controller.abort();
  parentSignal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Hosted MCP discovery returned HTTP ${response.status}.`);
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Hosted MCP discovery did not return a JSON object.");
    }
    return value as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abort);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function textValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("OpenID metadata is missing its issuer.");
  }
  return value;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Hosted MCP authorization issuer must be an HTTPS origin.");
  }
  if (!isTrustedSalesforceHost(url.hostname)) {
    throw new Error("Hosted MCP authorization issuer is not a trusted Salesforce host.");
  }
  return url.origin;
}

function assertTrustedHttpsUrl(value: unknown, label: string): void {
  if (typeof value !== "string") throw new Error(`OpenID metadata is missing its ${label}.`);
  const url = new URL(value);
  if (url.protocol !== "https:" || !isTrustedSalesforceHost(url.hostname)) {
    throw new Error(`OpenID ${label} is not a trusted Salesforce HTTPS URL.`);
  }
}

function isTrustedSalesforceHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized.endsWith(".salesforce.com") ||
    normalized.endsWith(".salesforce-setup.com") ||
    normalized === "login.salesforce.com" ||
    normalized === "test.salesforce.com"
  );
}
