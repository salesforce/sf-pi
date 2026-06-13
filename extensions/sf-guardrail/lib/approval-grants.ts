/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Short-lived persisted approval grants.
 *
 * These are per-user sf-pi state, not project files. Grants are keyed by the
 * current Salesforce project root (or cwd when no project is detected) plus the
 * decision's safety-envelope fingerprint.
 */
import path from "node:path";
import { createStateStore } from "../../../lib/common/state-store.ts";
import { detectProject } from "../../../lib/common/sf-environment/detect.ts";
import type { ClassifiedDecision } from "./types.ts";

interface ApprovalGrantState {
  grants: PersistedApprovalGrant[];
}

export interface PersistedApprovalGrant {
  id: string;
  projectKey: string;
  ruleId: string;
  feature: ClassifiedDecision["feature"];
  fingerprint: string;
  label: string;
  subject: string;
  orgAlias?: string;
  orgType?: string;
  orgId?: string;
  orgUsername?: string;
  operationFamily?: string;
  riskTier?: string;
  grantedAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  useCount: number;
}

const store = createStateStore<ApprovalGrantState>({
  namespace: "sf-guardrail",
  filename: "approval-grants.json",
  schemaVersion: 1,
  defaults: { grants: [] },
});

export function projectKeyForCwd(cwd: string): string {
  const project = detectProject(cwd);
  return path.resolve(project.projectRoot ?? cwd);
}

export function findValidGrant(
  cwd: string,
  decision: ClassifiedDecision,
): PersistedApprovalGrant | undefined {
  if (!decision.approvalScope?.persistedGrant) return undefined;
  const projectKey = projectKeyForCwd(cwd);
  const now = Date.now();
  const state = pruneExpired(now);
  const grant = state.grants.find(
    (item) =>
      item.projectKey === projectKey &&
      item.ruleId === decision.ruleId &&
      item.fingerprint === decision.fingerprint &&
      item.expiresAt > now,
  );
  if (!grant) return undefined;

  store.update((current) => ({
    grants: current.grants
      .filter((item) => item.expiresAt > now)
      .map((item) =>
        item.id === grant.id ? { ...item, lastUsedAt: now, useCount: item.useCount + 1 } : item,
      ),
  }));
  return grant;
}

export function createGrant(
  cwd: string,
  decision: ClassifiedDecision,
): PersistedApprovalGrant | undefined {
  const persisted = decision.approvalScope?.persistedGrant;
  if (!persisted) return undefined;

  const now = Date.now();
  const projectKey = projectKeyForCwd(cwd);
  const grant: PersistedApprovalGrant = {
    id: `${decision.ruleId}:${decision.fingerprint}`,
    projectKey,
    ruleId: decision.ruleId,
    feature: decision.feature,
    fingerprint: decision.fingerprint,
    label: decision.approvalScope.label,
    subject: decision.subject,
    orgAlias: decision.orgAlias,
    orgType: decision.orgType,
    orgId: decision.orgId,
    orgUsername: decision.orgUsername,
    operationFamily: decision.approvalScope.operationFamily,
    riskTier: decision.approvalScope.riskTier,
    grantedAt: now,
    expiresAt: now + persisted.ttlMs,
    useCount: 0,
  };

  store.update((current) => ({
    grants: [
      ...current.grants.filter(
        (item) =>
          item.expiresAt > now &&
          !(
            item.projectKey === projectKey &&
            item.ruleId === grant.ruleId &&
            item.fingerprint === grant.fingerprint
          ),
      ),
      grant,
    ],
  }));
  return grant;
}

export function listProjectGrants(cwd: string): PersistedApprovalGrant[] {
  const projectKey = projectKeyForCwd(cwd);
  return pruneExpired(Date.now())
    .grants.filter((item) => item.projectKey === projectKey)
    .sort((a, b) => a.expiresAt - b.expiresAt);
}

export function clearProjectGrants(cwd: string): number {
  const projectKey = projectKeyForCwd(cwd);
  const now = Date.now();
  let removed = 0;
  store.update((current) => {
    const kept = current.grants.filter((item) => {
      const remove = item.projectKey === projectKey || item.expiresAt <= now;
      if (remove && item.projectKey === projectKey && item.expiresAt > now) removed += 1;
      return !remove;
    });
    return { grants: kept };
  });
  return removed;
}

export function renderProjectGrants(cwd: string): string {
  const grants = listProjectGrants(cwd);
  if (grants.length === 0) return "No active sf-guardrail approval grants for this project.";

  const lines = [`Active sf-guardrail approval grants (${grants.length}):`];
  for (const grant of grants) {
    const expires = new Date(grant.expiresAt).toISOString();
    const org = grant.orgAlias ? ` org=${grant.orgAlias}(${grant.orgType ?? "?"})` : "";
    const uses = grant.useCount > 0 ? ` used=${grant.useCount}` : "";
    lines.push(`  - ${grant.label}${org} expires=${expires}${uses}`);
  }
  return lines.join("\n");
}

function pruneExpired(now: number): ApprovalGrantState {
  return store.update((current) => ({
    grants: current.grants.filter((item) => item.expiresAt > now),
  }));
}
