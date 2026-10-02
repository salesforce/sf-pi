/* SPDX-License-Identifier: Apache-2.0 */
/** Source-bound generic External Client App OAuth plans. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { writeIntegrationArtifact } from "./artifacts.ts";
import { buildEcaProfileSources } from "./eca-profiles.ts";
import type { InboundIntegrationPlan, SfIntegrateParams } from "./types.ts";

const DEFAULT_APP_NAME = "SfPiExternalClientApp";
const DEFAULT_APP_LABEL = "SF Pi External Client App";

export async function buildInboundPlan(
  params: SfIntegrateParams,
  session: SalesforceSession,
  cwd: string,
  contactEmail: string,
): Promise<InboundIntegrationPlan> {
  const flow = params.eca_flow;
  if (!flow) throw new Error("eca_flow is required for direction=inbound.");
  const appName = requireApiName(params.app_name ?? DEFAULT_APP_NAME, "app_name");
  const appLabel = requireLabel(params.app_label ?? DEFAULT_APP_LABEL);
  const certificatePem =
    flow === "jwt_bearer" ? await readPublicCertificate(cwd, params.certificate_file) : undefined;
  const clientCredentialsUser =
    flow === "client_credentials"
      ? params.client_credentials_user?.trim() || session.target.username
      : undefined;
  const built = buildEcaProfileSources({
    flow,
    appName,
    appLabel,
    contactEmail,
    callbackUrl: params.callback_url,
    oauthScopes: params.oauth_scopes,
    clientCredentialsUser,
    certificatePem,
    permissionSet: params.eca_permission_set,
    tokenExchangeRequireSecret: params.token_exchange_require_secret,
    tokenExchangeHandler: params.token_exchange_handler,
    tokenExchangeApex: params.token_exchange_apex,
    tokenExchangeUser: params.token_exchange_user,
  });
  const orgId = session.target.orgId;
  if (!orgId) throw new Error("The target org did not provide an org identity for plan binding.");
  const material = {
    schema_version: 1 as const,
    direction: "inbound" as const,
    eca_flow: flow,
    app_name: appName,
    app_label: appLabel,
    contact_email: contactEmail,
    target: {
      target_org: session.target.targetOrg,
      alias: session.target.alias,
      org_id: orgId,
      org_type: session.target.orgType,
      api_version: session.target.apiVersion,
    },
    callback_url: built.callbackUrl,
    metadata_scopes: built.metadataScopes,
    sources: built.sources,
    expected: built.expected,
  };
  const planHash = `sha256:${createHash("sha256").update(stableJson(material)).digest("hex")}`;
  const planId = `plan_${planHash.slice("sha256:".length, "sha256:".length + 16)}`;
  const createdAt = new Date().toISOString();
  const plan: InboundIntegrationPlan = {
    ...material,
    plan_id: planId,
    plan_hash: planHash,
    created_at: createdAt,
  };
  const artifact = await writeIntegrationArtifact(
    "plans",
    `${createdAt.replace(/[:.]/gu, "-")}-${appName}-${flow}-${planId}.json`,
    plan,
  );
  return { ...plan, artifact_path: artifact.path };
}

export function assertInboundPlanMatches(
  plan: InboundIntegrationPlan | undefined,
  input: { planId?: string; planHash?: string; appName?: string },
): InboundIntegrationPlan {
  if (!plan) {
    throw new Error("The inbound ECA plan isn't available in this session. Run design.plan again.");
  }
  if (!input.planId || input.planId !== plan.plan_id) {
    throw new Error("plan_id does not match the current inbound ECA plan.");
  }
  if (!input.planHash || input.planHash !== plan.plan_hash) {
    throw new Error("plan_hash does not match the current inbound ECA plan.");
  }
  if (plan.plan_hash !== hashPlanMaterial(inboundPlanMaterial(plan))) {
    throw new Error("The inbound ECA plan contents changed after planning. Run design.plan again.");
  }
  if (!input.appName || input.appName !== plan.app_name) {
    throw new Error("app_name does not match the current inbound ECA plan.");
  }
  return plan;
}

export function assertInboundPlanTarget(
  plan: InboundIntegrationPlan,
  session: SalesforceSession,
): void {
  if (!session.target.orgId || plan.target.org_id !== session.target.orgId) {
    throw new Error("The inbound ECA plan belongs to a different org. Run design.plan again.");
  }
  if (plan.target.api_version !== session.target.apiVersion) {
    throw new Error("The target org API version changed after planning. Run design.plan again.");
  }
}

async function readPublicCertificate(cwd: string, value: string | undefined): Promise<string> {
  if (!value?.trim()) throw new Error("certificate_file is required for eca_flow=jwt_bearer.");
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("certificate_file must be contained by the current workspace.");
  }
  const certificate = await readFile(resolved, "utf8");
  if (certificate.includes("PRIVATE KEY")) {
    throw new Error(
      "certificate_file must contain only a public certificate, never a private key.",
    );
  }
  return certificate;
}

function requireApiName(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(normalized)) {
    throw new Error(`${field} must be a Salesforce API name.`);
  }
  return normalized;
}

function requireLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || /[\r\n]/u.test(normalized)) {
    throw new Error("app_label must contain 1 to 80 characters on one line.");
  }
  return normalized;
}

function inboundPlanMaterial(plan: InboundIntegrationPlan) {
  const material: Partial<InboundIntegrationPlan> = { ...plan };
  delete material.plan_id;
  delete material.plan_hash;
  delete material.created_at;
  delete material.artifact_path;
  return material;
}

function hashPlanMaterial(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
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
