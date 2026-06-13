/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Approval Ledger bridge tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClassifiedDecision } from "../lib/types.ts";

let tempAgentDir: string;
let cwd: string;

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempAgentDir,
}));

let ledger: typeof import("../lib/approval-ledger.ts");

type PiForRecord = Parameters<typeof import("../lib/approval-ledger.ts").recordDecision>[0];
type CtxForRead = Parameters<typeof import("../lib/approval-ledger.ts").readRecentDecisions>[0];

function pi(entries: unknown[]): PiForRecord {
  return {
    appendEntry: (customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data });
    },
  } as unknown as PiForRecord;
}

function ctx(entries: unknown[]): CtxForRead {
  return {
    sessionManager: {
      getEntries: () => entries,
    },
  } as unknown as CtxForRead;
}

function decision(): ClassifiedDecision {
  return {
    ruleId: "sf-deploy-prod",
    feature: "orgAwareGate",
    action: "confirm",
    reason: "Deploy to production",
    fingerprint: "org=00DPROD|type=production|family=sf project deploy",
    subject: "sf project deploy start -o Prod",
    orgAlias: "Prod",
    orgType: "production",
    orgId: "00DPROD",
    approvalScope: {
      fingerprint: "org=00DPROD|type=production|family=sf project deploy",
      label: "production deploys to Prod",
      riskTier: "production_deploy",
      operationFamily: "sf project deploy",
      persistedGrant: {
        label: "Allow production deploys to Prod in this project for 60 minutes",
        ttlMs: 60 * 60 * 1000,
      },
    },
  };
}

beforeEach(async () => {
  vi.resetModules();
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-guardrail-ledger-agent-"));
  cwd = mkdtempSync(path.join(tmpdir(), "sf-guardrail-ledger-cwd-"));
  writeFileSync(path.join(cwd, "sfdx-project.json"), JSON.stringify({ packageDirectories: [] }));
  ledger = await import("../lib/approval-ledger.ts");
});

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("Approval Ledger", () => {
  it("records and reads decision audit entries", () => {
    const entries: unknown[] = [];

    ledger.recordDecision(pi(entries), decision(), "allow_once", "bash");

    const recent = ledger.readRecentDecisions(ctx(entries), 5);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      ruleId: "sf-deploy-prod",
      outcome: "allow_once",
      toolName: "bash",
      approvalScopeLabel: "production deploys to Prod",
      approvalRiskTier: "production_deploy",
    });
  });

  it("restores and grants session approvals", () => {
    const entries: unknown[] = [];
    const d = decision();

    ledger.grantSessionApproval(pi(entries), d);
    ledger.restoreApprovalLedger(ctx(entries));

    expect(ledger.hasSessionApproval(d)).toBe(true);
  });

  it("forgets session approvals with a revocation marker", () => {
    const entries: unknown[] = [];
    const d = decision();

    ledger.grantSessionApproval(pi(entries), d);
    ledger.forgetSessionApprovals(pi(entries));
    ledger.restoreApprovalLedger(ctx(entries));

    expect(ledger.hasSessionApproval(d)).toBe(false);
  });

  it("creates, renders, and clears legacy persisted project approvals", () => {
    const d = decision();

    const created = ledger.createPersistedApproval(cwd, d);

    expect(created?.projectKey).toBe(path.resolve(cwd));
    expect(ledger.renderProjectApprovals(cwd)).toContain("production deploys to Prod");
    expect(ledger.clearProjectApprovals(cwd)).toBe(1);
    expect(ledger.renderProjectApprovals(cwd)).toContain("No active");
  });
});
