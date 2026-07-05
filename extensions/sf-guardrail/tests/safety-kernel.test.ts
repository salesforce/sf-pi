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
  it("returns a confirmable Guardrail Decision for protected file writes", async () => {
    const decision = await evaluateSafety({
      toolName: "write",
      input: { path: "force-app/main/default/destructiveChanges.xml" },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
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
    expect(decision?.approvalScope?.persistedGrant).toBeUndefined();
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

  it("confirms mutating sf_apex anon.run as a native tool safety subject", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const decision = await evaluateSafety({
      toolName: "sf_apex",
      input: {
        action: "anon.run",
        body: "Account a = new Account(Name = 'Acme'); insert a;",
        allow_mutation: true,
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "nativeToolGate",
      ruleId: "native-sf-apex-anon-mutating",
      orgAlias: "DevInt",
      orgType: "sandbox",
    });
    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "anonymous apex",
      riskTier: "org_mutation_exact",
      label: "this exact Anonymous Apex body",
    });
    expect(decision?.approvalScope?.fingerprint).toContain("org=00DDevInt");
    expect(decision?.approvalScope?.fingerprint).toContain("family=anonymous apex");
  });

  it("does not mediate sf_apex anon.run when the mutating intent flag is absent", async () => {
    const decision = await evaluateSafety({
      toolName: "sf_apex",
      input: {
        action: "anon.run",
        body: "Account a = new Account(Name = 'Acme'); insert a;",
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toBeUndefined();
  });

  it("confirms slack_canvas create/edit as native external content writes", async () => {
    const decision = await evaluateSafety({
      toolName: "slack_canvas",
      input: {
        action: "create",
        title: "Release checklist",
        markdown: "# Checklist\n- Review\n- Ship",
        channel_id: "C01ABCEXAMPLE",
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "nativeToolGate",
      ruleId: "native-slack-canvas-write",
      subject: "slack_canvas create Release checklist",
    });
    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "slack canvas write",
      riskTier: "external_content_write_exact",
    });
  });

  it("does not mediate slack_canvas reads", async () => {
    const decision = await evaluateSafety({
      toolName: "slack_canvas",
      input: { action: "read", canvas_id: "F0123456789" },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toBeUndefined();
  });

  it("confirms Salesforce browser committing gestures", async () => {
    const decision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "@e12", reason: "Click Save", mutation: true },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "nativeToolGate",
      ruleId: "native-sf-browser-commit",
      subject: "sf_browser_click @e12",
    });
    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "browser commit",
      riskTier: "browser_commit_exact",
    });
  });

  it("infers Salesforce browser commits from the reason without prompting all clicks", async () => {
    const saveDecision = await evaluateSafety({
      toolName: "sf_browser_press",
      input: { key: "Enter", reason: "submit form" },
      cwd: "/project",
      config: readBundledConfig(),
    });
    expect(saveDecision?.ruleId).toBe("native-sf-browser-commit");

    const navigateDecision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "@e2", reason: "open Details tab" },
      cwd: "/project",
      config: readBundledConfig(),
    });
    expect(navigateDecision).toBeUndefined();
  });
});
