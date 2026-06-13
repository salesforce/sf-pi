/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Safety Kernel characterization tests.
 *
 * These lock current sf-guardrail behavior through the new decision seam before
 * internals are refactored behind it. The tests intentionally assert domain
 * concepts — Guardrail Decisions and Safety Envelopes — instead of helper
 * module behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: () => true,
  };
});

import { readBundledConfig } from "../lib/config.ts";
import { evaluateSafety } from "../lib/safety-kernel.ts";

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

afterEach(() => {
  mockedEnv = null;
  mockedLookup = {};
});

describe("Safety Kernel", () => {
  it("returns a hard-block Guardrail Decision for protected file writes", async () => {
    const decision = await evaluateSafety({
      toolName: "write",
      input: { path: "force-app/main/default/destructiveChanges.xml" },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "block",
      feature: "policies",
      ruleId: "sf-destructive-changes-xml",
      subject: "force-app/main/default/destructiveChanges.xml",
    });
  });

  it("returns no decision for allowed protected-file carve-outs", async () => {
    const decision = await evaluateSafety({
      toolName: "write",
      input: { path: ".sfdx/agents/MyAgent/sessions/session.json" },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toBeUndefined();
  });

  it("returns a production deploy decision with an envelope-style approval scope", async () => {
    mockedEnv = env("Prod", "production");

    const decision = await evaluateSafety({
      toolName: "bash",
      input: { command: "sf project deploy start -o Prod" },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "orgAwareGate",
      ruleId: "sf-deploy-prod",
      orgAlias: "Prod",
      orgType: "production",
    });
    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "sf project deploy",
      riskTier: "production_deploy",
    });
    expect(decision?.approvalScope?.fingerprint).toContain("family=sf project deploy");
    expect(decision?.approvalScope?.persistedGrant?.label).toContain("60 minutes");
  });

  it("returns no decision for verified non-production deploys", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const decision = await evaluateSafety({
      toolName: "bash",
      input: { command: "sf project deploy start -o DevInt" },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toBeUndefined();
  });

  it("refines explicit non-default orgs before deciding", async () => {
    mockedEnv = env("DevInt", "sandbox");
    lookupOrg("Scratch", "scratch");

    const decision = await evaluateSafety({
      toolName: "bash",
      input: { command: "sf project deploy start -o Scratch" },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toBeUndefined();
  });

  it("mediates Herdr run commands through the same command gate", async () => {
    const decision = await evaluateSafety({
      toolName: "herdr",
      input: { action: "run", pane: "tests", command: "rm -rf tmp/" },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "commandGate",
      ruleId: "rm-rf",
      subject: "rm -rf tmp/",
    });
  });

  it("auto-allows strictly validated operating-system temp cleanup", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "tmp.sf-guardrail-"));
    try {
      const decision = await evaluateSafety({
        toolName: "bash",
        input: { command: `rm -rf ${tempDir}` },
        cwd: "/project",
        config: readBundledConfig(),
      });

      expect(decision).toMatchObject({
        action: "allow",
        feature: "commandGate",
        ruleId: "safe-temp-cleanup",
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
