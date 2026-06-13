/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Approval scope / safety-envelope helpers.
 *
 * A scope answers two questions in one place:
 *   1. What does an "allow" cover?
 *   2. Is that scope eligible for a short persisted grant?
 */
import { fingerprintCommand } from "./fingerprint.ts";
import type { OrgContext } from "./org-context.ts";
import type { ApprovalScope } from "./types.ts";

const PROD_DEPLOY_TTL_MS = 60 * 60 * 1000;
const NONPROD_ORG_DELETE_TTL_MS = 30 * 60 * 1000;

export function approvalScopeForOrgAware(
  ruleId: string,
  command: string,
  org: OrgContext,
): ApprovalScope {
  const orgKey = org.orgId ?? org.username ?? org.alias ?? "<unknown>";

  if (ruleId === "sf-deploy-prod") {
    const label = `production deploys to ${org.alias ?? orgKey}`;
    const scope: ApprovalScope = {
      fingerprint: `org=${orgKey}|type=${org.type}|family=sf project deploy`,
      label,
      detail: `Same project, same resolved org, production deploy command family.`,
      riskTier: "production_deploy",
      operationFamily: "sf project deploy",
    };
    if (!org.guessed && org.type === "production") {
      scope.persistedGrant = {
        label: `Allow ${label} in this project for 60 minutes`,
        ttlMs: PROD_DEPLOY_TTL_MS,
      };
    }
    return scope;
  }

  return {
    fingerprint: `org=${orgKey}|type=${org.type}|command=${fingerprintCommand(command)}`,
    label: "this exact org-aware command",
    riskTier: "org_sensitive_exact",
    operationFamily: fingerprintCommand(command),
  };
}

export function approvalScopeForCommand(
  ruleId: string,
  command: string,
  org?: OrgContext,
): ApprovalScope {
  if (ruleId === "sf-org-delete" && org) {
    const orgKey = org.orgId ?? org.username ?? org.alias ?? "<unknown>";
    const label = `deleting ${org.alias ?? orgKey}`;
    const scope: ApprovalScope = {
      fingerprint: `org=${orgKey}|type=${org.type}|family=sf org delete`,
      label,
      detail: `Same project and same verified non-production org delete target.`,
      riskTier: "nonprod_org_delete",
      operationFamily: "sf org delete",
    };
    if (!org.guessed && isNonProduction(org.type)) {
      scope.persistedGrant = {
        label: `Allow ${label} in this project for 30 minutes`,
        ttlMs: NONPROD_ORG_DELETE_TTL_MS,
      };
    }
    return scope;
  }

  return {
    fingerprint: fingerprintCommand(command),
    label: "this exact command",
    riskTier: "local_dangerous_exact",
    operationFamily: fingerprintCommand(command),
  };
}

function isNonProduction(type: OrgContext["type"]): boolean {
  return type === "sandbox" || type === "scratch" || type === "developer" || type === "trial";
}
