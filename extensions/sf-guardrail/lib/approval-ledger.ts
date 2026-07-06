/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Approval Ledger for sf-guardrail.
 *
 * Owns decision audit entries, session approval memory, revocation markers,
 * and legacy persisted approval cleanup/rendering. This is the single
 * caller-facing seam for approval memory.
 */
import path from "node:path";
import type { CustomEntry, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createStateStore } from "../../../lib/common/state-store.ts";
import { detectProject } from "../../../lib/common/sf-environment/detect.ts";
import {
  ALLOW_ENTRY_TYPE,
  ALLOW_REVOKE_ENTRY_TYPE,
  DECISION_ENTRY_TYPE,
  type AllowEntryData,
  type AllowRevokeEntryData,
  type ClassifiedDecision,
  type DecisionEntryData,
  type DecisionOutcome,
} from "./types.ts";

export const DATA360_EXECUTION_CHAIN_ENTRY_TYPE = "sf-data360-execution-chain";

export interface Data360ExecutionChainEntryData {
  timestamp: number;
  sessionId?: string;
  parentTool?: string;
  parentAction?: string;
  targetOrg?: string;
  journey_fingerprint?: unknown;
  ok?: boolean;
  executionChain: Array<Record<string, unknown>>;
}

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

const allowed = new Set<string>();

const grantStore = createStateStore<ApprovalGrantState>({
  namespace: "sf-guardrail",
  filename: "approval-grants.json",
  schemaVersion: 1,
  defaults: { grants: [] },
});

export function restoreApprovalLedger(ctx: ExtensionContext): void {
  allowed.clear();
  const entries = ctx.sessionManager.getEntries();
  const lastRevokeAt = entries.reduce(
    (latest, entry) =>
      isAllowRevokeEntry(entry) ? Math.max(latest, entry.data.revokedAt) : latest,
    0,
  );
  for (const entry of entries) {
    if (isAllowEntry(entry) && entry.data.grantedAt > lastRevokeAt) {
      allowed.add(approvalKey(entry.data.ruleId, entry.data.fingerprint));
    }
  }
}

export function recordDecision(
  pi: ExtensionAPI,
  decision: ClassifiedDecision,
  outcome: DecisionOutcome,
  toolName: string,
): void {
  const data: DecisionEntryData = {
    timestamp: Date.now(),
    ruleId: decision.ruleId,
    feature: decision.feature,
    outcome,
    toolName,
    subject: decision.subject,
    fingerprint: decision.fingerprint,
    orgAlias: decision.orgAlias,
    orgType: decision.orgType,
    orgId: decision.orgId,
    orgUsername: decision.orgUsername,
    orgResolutionGuessed: decision.orgResolutionGuessed,
    orgResolutionSource: decision.orgResolutionSource,
    approvalScopeLabel: decision.approvalScope?.label,
    approvalScopeDetail: decision.approvalScope?.detail,
    approvalRiskTier: decision.approvalScope?.riskTier,
    reason: decision.reason,
  };
  pi.appendEntry(DECISION_ENTRY_TYPE, data);
}

export function readRecentDecisions(ctx: ExtensionContext, limit = 50): DecisionEntryData[] {
  const out: DecisionEntryData[] = [];
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const entry = entries[i];
    if (isDecisionEntry(entry)) out.push(entry.data);
  }
  return out;
}

export function readRecentData360ExecutionChains(
  ctx: ExtensionContext,
  limit = 10,
): Data360ExecutionChainEntryData[] {
  const out: Data360ExecutionChainEntryData[] = [];
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const entry = entries[i];
    if (isData360ExecutionChainEntry(entry)) out.push(entry.data);
  }
  return out;
}

export function hasSessionApproval(decision: ClassifiedDecision): boolean {
  return allowed.has(approvalKey(decision.ruleId, decision.fingerprint));
}

export function grantSessionApproval(pi: ExtensionAPI, decision: ClassifiedDecision): void {
  allowed.add(approvalKey(decision.ruleId, decision.fingerprint));
  const data: AllowEntryData = {
    ruleId: decision.ruleId,
    fingerprint: decision.fingerprint,
    grantedAt: Date.now(),
  };
  pi.appendEntry(ALLOW_ENTRY_TYPE, data);
}

export function forgetSessionApprovals(pi?: ExtensionAPI): void {
  allowed.clear();
  if (pi) pi.appendEntry(ALLOW_REVOKE_ENTRY_TYPE, { revokedAt: Date.now() });
}

export function createPersistedApproval(
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

  grantStore.update((current) => ({
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

export function clearProjectApprovals(cwd: string): number {
  const projectKey = projectKeyForCwd(cwd);
  const now = Date.now();
  let removed = 0;
  grantStore.update((current) => {
    const kept = current.grants.filter((item) => {
      const remove = item.projectKey === projectKey || item.expiresAt <= now;
      if (remove && item.projectKey === projectKey && item.expiresAt > now) removed += 1;
      return !remove;
    });
    return { grants: kept };
  });
  return removed;
}

export function renderProjectApprovals(cwd: string): string {
  const grants = listProjectApprovals(cwd);
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

export function listProjectApprovals(cwd: string): PersistedApprovalGrant[] {
  const projectKey = projectKeyForCwd(cwd);
  return pruneExpired(Date.now())
    .grants.filter((item) => item.projectKey === projectKey)
    .sort((a, b) => a.expiresAt - b.expiresAt);
}

export function projectKeyForCwd(cwd: string): string {
  const project = detectProject(cwd);
  return path.resolve(project.projectRoot ?? cwd);
}

function pruneExpired(now: number): ApprovalGrantState {
  return grantStore.update((current) => ({
    grants: current.grants.filter((item) => item.expiresAt > now),
  }));
}

function approvalKey(ruleId: string, fingerprint: string): string {
  return `${ruleId}::${fingerprint}`;
}

function isDecisionEntry(entry: unknown): entry is CustomEntry<DecisionEntryData> {
  if (!entry || typeof entry !== "object") return false;
  const c = entry as { type?: string; customType?: string; data?: { ruleId?: unknown } };
  return c.type === "custom" && c.customType === DECISION_ENTRY_TYPE && !!c.data?.ruleId;
}

function isAllowEntry(entry: unknown): entry is CustomEntry<AllowEntryData> {
  if (!entry || typeof entry !== "object") return false;
  const c = entry as { type?: string; customType?: string; data?: { ruleId?: unknown } };
  return c.type === "custom" && c.customType === ALLOW_ENTRY_TYPE && !!c.data?.ruleId;
}

function isAllowRevokeEntry(entry: unknown): entry is CustomEntry<AllowRevokeEntryData> {
  if (!entry || typeof entry !== "object") return false;
  const c = entry as { type?: string; customType?: string; data?: { revokedAt?: unknown } };
  return (
    c.type === "custom" &&
    c.customType === ALLOW_REVOKE_ENTRY_TYPE &&
    typeof c.data?.revokedAt === "number"
  );
}

function isData360ExecutionChainEntry(
  entry: unknown,
): entry is CustomEntry<Data360ExecutionChainEntryData> {
  if (!entry || typeof entry !== "object") return false;
  const c = entry as { type?: string; customType?: string; data?: { executionChain?: unknown } };
  return (
    c.type === "custom" &&
    c.customType === DATA360_EXECUTION_CHAIN_ENTRY_TYPE &&
    Array.isArray(c.data?.executionChain)
  );
}
