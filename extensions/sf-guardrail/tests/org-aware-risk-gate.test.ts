/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Org-aware risk gate tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgInfo, SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

let mockedEnv: SfEnvironment | null = null;
let mockedLookup: Record<string, OrgInfo> = {};

vi.mock("../../../lib/common/sf-environment/shared-runtime.ts", () => ({
  getCachedSfEnvironment: () => mockedEnv,
}));

vi.mock("../../../lib/common/sf-environment/detect.ts", () => ({
  detectOrg: async (targetOrg: string) =>
    mockedLookup[targetOrg] ?? { detected: false, orgType: "unknown" },
}));

import { readBundledConfig } from "../lib/config.ts";
import {
  evaluateOrgAwareRisk,
  evaluateOrgAwareRiskWithOrgLookup,
} from "../lib/org-aware-risk-gate.ts";

function env(orgAlias: string, orgType: SfEnvironment["org"]["orgType"]): SfEnvironment {
  return {
    cli: { installed: true, version: "2.0.0" },
    project: { detected: false },
    config: { hasTargetOrg: true, targetOrg: orgAlias, location: "Global" },
    org: {
      detected: true,
      alias: orgAlias,
      username: `${orgAlias}@example.test`,
      orgId: `00D${orgAlias}`,
      orgType,
    },
    detectedAt: Date.now(),
  };
}

function lookupOrg(alias: string, orgType: OrgInfo["orgType"]): void {
  mockedLookup[alias] = {
    detected: true,
    alias,
    username: `${alias}@example.test`,
    orgId: `00D${alias}`,
    orgType,
  };
}

beforeEach(() => {
  mockedEnv = null;
  mockedLookup = {};
});

describe("evaluateOrgAwareRisk", () => {
  it("returns production deploy decisions with Safety Envelopes", () => {
    mockedEnv = env("Prod", "production");

    const decision = evaluateOrgAwareRisk(
      { kind: "shellCommand", toolName: "bash", command: "sf project deploy start -o Prod" },
      "/project",
      readBundledConfig(),
    );

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "orgAwareGate",
      ruleId: "sf-deploy-prod",
      orgAlias: "Prod",
      orgType: "production",
    });
    expect(decision?.approvalScope?.operationFamily).toBe("sf project deploy");
  });

  it("returns block decisions when org-aware rule behavior is hard block", () => {
    mockedEnv = env("Prod", "production");
    const config = readBundledConfig();
    const rule = config.orgAwareGate.rules.find((candidate) => candidate.id === "sf-deploy-prod");
    if (rule) rule.behavior = "block";

    const decision = evaluateOrgAwareRisk(
      { kind: "shellCommand", toolName: "bash", command: "sf project deploy start -o Prod" },
      "/project",
      config,
    );

    expect(decision).toMatchObject({ action: "block", ruleId: "sf-deploy-prod" });
  });

  it("returns no decision for sandbox targets", () => {
    mockedEnv = env("DevInt", "sandbox");

    const decision = evaluateOrgAwareRisk(
      { kind: "shellCommand", toolName: "bash", command: "sf project deploy start -o DevInt" },
      "/project",
      readBundledConfig(),
    );

    expect(decision).toBeUndefined();
  });

  it("finds org-aware commands later in simple shell chains", () => {
    mockedEnv = env("Prod", "production");

    const decision = evaluateOrgAwareRisk(
      {
        kind: "shellCommand",
        toolName: "bash",
        command: "cd force-app && sf project deploy start -o Prod",
      },
      "/project",
      readBundledConfig(),
    );

    expect(decision?.orgCommand).toBe("sf project deploy start -o Prod");
    expect(decision?.subject).toBe("cd force-app && sf project deploy start -o Prod");
  });

  it("refines explicit non-default scratch aliases before deciding", async () => {
    mockedEnv = env("DevInt", "sandbox");
    lookupOrg("Scratch", "scratch");

    const decision = await evaluateOrgAwareRiskWithOrgLookup(
      { kind: "shellCommand", toolName: "bash", command: "sf project deploy start -o Scratch" },
      "/project",
      readBundledConfig(),
    );

    expect(decision).toBeUndefined();
  });
});
