/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Command risk gate tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

import { evaluateCommandRisk, evaluateCommandRiskWithOrgLookup } from "../lib/command-risk-gate.ts";
import { readBundledConfig } from "../lib/config.ts";

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

describe("evaluateCommandRisk", () => {
  it("returns confirm decisions for dangerous commands", () => {
    const result = evaluateCommandRisk(
      { kind: "shellCommand", toolName: "bash", command: "rm -rf tmp/" },
      "/project",
      readBundledConfig(),
    );

    expect(result).toMatchObject({
      kind: "decision",
      decision: {
        action: "confirm",
        feature: "commandGate",
        ruleId: "rm-rf",
        subject: "rm -rf tmp/",
      },
    });
  });

  it("returns audited allow decisions for strict OS temp cleanup", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "tmp.sf-guardrail-"));
    try {
      const result = evaluateCommandRisk(
        { kind: "shellCommand", toolName: "bash", command: `rm -rf ${tempDir}` },
        "/project",
        readBundledConfig(),
      );

      expect(result).toMatchObject({
        kind: "decision",
        decision: { action: "allow", ruleId: "safe-temp-cleanup" },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns block decisions when command pattern behavior is hard block", () => {
    const config = readBundledConfig();
    const pattern = config.commandGate.patterns.find((candidate) => candidate.id === "rm-rf");
    if (pattern) pattern.behavior = "block";

    const result = evaluateCommandRisk(
      { kind: "shellCommand", toolName: "bash", command: "rm -rf tmp/" },
      "/project",
      config,
    );

    expect(result).toMatchObject({
      kind: "decision",
      decision: { action: "block", ruleId: "rm-rf" },
    });
  });

  it("returns allowListed when configured allowedPatterns match", () => {
    const config = readBundledConfig();
    config.commandGate.allowedPatterns = [
      { id: "allow-deploy", pattern: "sf project deploy start", description: "test allow" },
    ];

    const result = evaluateCommandRisk(
      { kind: "shellCommand", toolName: "bash", command: "sf project deploy start -o Prod" },
      "/project",
      config,
    );

    expect(result).toEqual({ kind: "allowListed" });
  });

  it("refines verified non-production org delete targets before returning", async () => {
    lookupOrg("Scratch", "scratch");

    const result = await evaluateCommandRiskWithOrgLookup(
      { kind: "shellCommand", toolName: "bash", command: "sf org delete scratch -o Scratch" },
      "/project",
      readBundledConfig(),
    );

    expect(result).toMatchObject({
      kind: "decision",
      decision: {
        ruleId: "sf-org-delete",
        orgType: "scratch",
        orgResolutionSource: "lookup",
      },
    });
    if (result?.kind === "decision") {
      expect(result.decision.approvalScope?.operationFamily).toBe("sf org delete");
      expect(result.decision.approvalScope?.persistedGrant).toBeUndefined();
    }
  });
});
