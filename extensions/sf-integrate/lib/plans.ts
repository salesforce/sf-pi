/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic, source-bound SF Integrate plan construction. */

import { createHash } from "node:crypto";
import {
  SF_MCP_HEADLESS_360_REQUIREMENT,
  type SfIntegrateMcpPresetId,
} from "../../../lib/common/sf-mcp-oauth-requirements.ts";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { writeIntegrationArtifact } from "./artifacts.ts";
import { buildHeadlessMcpSources } from "./metadata.ts";
import type { IntegrationPlan } from "./types.ts";

export interface BuildIntegrationPlanInput {
  preset: SfIntegrateMcpPresetId;
  appName: string;
  appLabel: string;
  contactEmail: string;
  session: SalesforceSession;
}

export async function buildIntegrationPlan(
  input: BuildIntegrationPlanInput,
): Promise<IntegrationPlan> {
  if (input.preset !== SF_MCP_HEADLESS_360_REQUIREMENT.presetId) {
    throw new Error(`Unsupported MCP preset: ${input.preset}`);
  }
  const orgId = input.session.target.orgId;
  if (!orgId) throw new Error("The target org did not provide an org identity for plan binding.");

  const createdAt = new Date().toISOString();
  const sources = buildHeadlessMcpSources({
    appName: input.appName,
    appLabel: input.appLabel,
    contactEmail: input.contactEmail,
  });
  const material = {
    schema_version: 1 as const,
    preset: input.preset,
    app_name: input.appName,
    app_label: input.appLabel,
    contact_email: input.contactEmail,
    target: {
      target_org: input.session.target.targetOrg,
      alias: input.session.target.alias,
      org_id: orgId,
      org_type: input.session.target.orgType,
      api_version: input.session.target.apiVersion,
    },
    callback_url: SF_MCP_HEADLESS_360_REQUIREMENT.callbackUrl,
    metadata_scopes: [...SF_MCP_HEADLESS_360_REQUIREMENT.metadataScopes],
    oauth_scopes: [...SF_MCP_HEADLESS_360_REQUIREMENT.oauthScopes],
    sources,
  };
  const planHash = `sha256:${createHash("sha256").update(stableJson(material)).digest("hex")}`;
  const planId = `plan_${planHash.slice("sha256:".length, "sha256:".length + 16)}`;
  const plan: IntegrationPlan = {
    ...material,
    plan_id: planId,
    plan_hash: planHash,
    created_at: createdAt,
  };
  const artifact = await writeIntegrationArtifact(
    "plans",
    `${artifactTime(createdAt)}-${input.appName}-${planId}.json`,
    plan,
  );
  return { ...plan, artifact_path: artifact.path };
}

export function assertPlanMatches(
  plan: IntegrationPlan | undefined,
  input: { planId?: string; planHash?: string; appName?: string },
): IntegrationPlan {
  if (!plan) {
    throw new Error(
      "The integration plan isn't available in this session. Run design.plan again before setup.apply.",
    );
  }
  if (!input.planId || plan.plan_id !== input.planId) {
    throw new Error("plan_id does not match the current integration plan.");
  }
  if (!input.planHash || plan.plan_hash !== input.planHash) {
    throw new Error(
      "plan_hash does not match the current integration plan. Run design.plan again.",
    );
  }
  if (!input.appName || plan.app_name !== input.appName) {
    throw new Error("app_name does not match the current integration plan.");
  }
  return plan;
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
