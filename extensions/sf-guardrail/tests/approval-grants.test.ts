/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClassifiedDecision } from "../lib/types.ts";

let tempAgentDir: string;
let cwd: string;

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempAgentDir,
}));

let grants: typeof import("../lib/approval-grants.ts");

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
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-guardrail-grants-agent-"));
  cwd = mkdtempSync(path.join(tmpdir(), "sf-guardrail-grants-cwd-"));
  writeFileSync(path.join(cwd, "sfdx-project.json"), JSON.stringify({ packageDirectories: [] }));
  grants = await import("../lib/approval-grants.ts");
});

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("approval grants", () => {
  it("creates and finds valid project-scoped grants", () => {
    const created = grants.createGrant(cwd, decision());
    expect(created?.projectKey).toBe(path.resolve(cwd));
    expect(grants.findValidGrant(cwd, decision())?.id).toBe(created?.id);
  });

  it("does not create grants for ineligible decisions", () => {
    const ineligible = { ...decision(), approvalScope: undefined };
    expect(grants.createGrant(cwd, ineligible)).toBeUndefined();
  });

  it("clears only current project grants", () => {
    grants.createGrant(cwd, decision());
    const other = mkdtempSync(path.join(tmpdir(), "sf-guardrail-grants-other-"));
    try {
      mkdirSync(other, { recursive: true });
      grants.createGrant(other, decision());
      expect(grants.clearProjectGrants(cwd)).toBe(1);
      expect(grants.listProjectGrants(cwd)).toHaveLength(0);
      expect(grants.listProjectGrants(other)).toHaveLength(1);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
