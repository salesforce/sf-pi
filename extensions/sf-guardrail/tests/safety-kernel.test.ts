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
import {
  markLatestBrowserSnapshotStale,
  writeLatestBrowserSnapshotRefs,
} from "../../../lib/common/sf-browser-snapshot-state.ts";
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
      ruleId: "native-sf-apex-anon-run",
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

  it("mediates sf_apex anon.run even when direct mutation signals are absent", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const decision = await evaluateSafety({
      toolName: "sf_apex",
      input: {
        action: "anon.run",
        body: "SomeExistingMutator.run();",
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "nativeToolGate",
      ruleId: "native-sf-apex-anon-run",
      orgAlias: "DevInt",
      orgType: "sandbox",
    });
    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "anonymous apex",
      riskTier: "apex_execution_exact",
      label: "this exact Anonymous Apex body",
    });
    expect(decision?.approvalScope?.detail).toContain("mutation signals: none detected");
  });

  it("confirms AgentScript lifecycle publish+activate as a distinct native operation family", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const decision = await evaluateSafety({
      toolName: "agentscript_lifecycle",
      input: {
        action: "publish",
        agent_file: "agents/MyAgent/MyAgent.agent",
        agent_api_name: "MyAgent",
        activate: true,
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "nativeToolGate",
      ruleId: "native-agentscript-lifecycle",
      subject: "agentscript_lifecycle publish MyAgent",
      orgAlias: "DevInt",
      orgType: "sandbox",
    });
    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "agent publish+activate",
      riskTier: "agent_lifecycle_mutation",
      label: "publish and activate agent MyAgent",
      allowSession: true,
    });
  });

  it("keeps AgentScript publish and publish+activate Safety Envelopes separate", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const baseInput = {
      action: "publish",
      agent_file: "agents/MyAgent/MyAgent.agent",
      agent_api_name: "MyAgent",
    };
    const publish = await evaluateSafety({
      toolName: "agentscript_lifecycle",
      input: baseInput,
      cwd: "/project",
      config: readBundledConfig(),
    });
    const publishActivate = await evaluateSafety({
      toolName: "agentscript_lifecycle",
      input: { ...baseInput, activate: true },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(publish?.approvalScope?.operationFamily).toBe("agent publish");
    expect(publishActivate?.approvalScope?.operationFamily).toBe("agent publish+activate");
    expect(publish?.fingerprint).not.toBe(publishActivate?.fingerprint);
  });

  it("confirms AgentScript activate/deactivate with action-specific fingerprints", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const activate = await evaluateSafety({
      toolName: "agentscript_lifecycle",
      input: { action: "activate", agent_api_name: "MyAgent", version: 3 },
      cwd: "/project",
      config: readBundledConfig(),
    });
    const deactivate = await evaluateSafety({
      toolName: "agentscript_lifecycle",
      input: { action: "deactivate", agent_api_name: "MyAgent", version: 3 },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(activate?.approvalScope).toMatchObject({ operationFamily: "agent activation" });
    expect(deactivate?.approvalScope).toMatchObject({ operationFamily: "agent activation" });
    expect(activate?.fingerprint).not.toBe(deactivate?.fingerprint);
  });

  it("confirms live AgentScript Service Agent provisioning as allow-once when permission impact is unresolved", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const decision = await evaluateSafety({
      toolName: "agentscript_lifecycle",
      input: {
        action: "provision_agent_user",
        agent_file: "agents/MyAgent/MyAgent.agent",
        username_override: "agent.user@example.test",
        dry_run: false,
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "nativeToolGate",
      ruleId: "native-agentscript-lifecycle",
    });
    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "agent user provisioning",
      riskTier: "agent_user_provisioning_exact",
      allowSession: false,
    });
    expect(decision?.approvalScope?.detail).toContain("permission-impact fingerprint unavailable");
  });

  it("does not mediate AgentScript read-only or dry-run lifecycle actions", async () => {
    await expect(
      evaluateSafety({
        toolName: "agentscript_lifecycle",
        input: { action: "list_versions", agent_api_name: "MyAgent" },
        cwd: "/project",
        config: readBundledConfig(),
      }),
    ).resolves.toBeUndefined();
    await expect(
      evaluateSafety({
        toolName: "agentscript_lifecycle",
        input: {
          action: "provision_agent_user",
          agent_file: "agents/MyAgent/MyAgent.agent",
          dry_run: true,
        },
        cwd: "/project",
        config: readBundledConfig(),
      }),
    ).resolves.toBeUndefined();
  });

  it("confirms Data 360 allow_confirmed execution paths without mediating dry-runs", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const decision = await evaluateSafety({
      toolName: "data360_orchestrate",
      input: {
        action: "manifest.run",
        allow_confirmed: true,
        params: { manifestPath: "data/manifest.json" },
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "nativeToolGate",
      ruleId: "native-data360-confirmed-execute",
      subject: "data360_orchestrate manifest.run",
      orgAlias: "DevInt",
      orgType: "sandbox",
    });
    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "data360 manifest",
      riskTier: "data360_confirmed_execution_exact",
    });
    expect(decision?.approvalScope?.detail).toContain("journey_fingerprint=");
    expect(decision?.approvalScope?.detail).toContain("ingest_job.upload_csv");
    expect(decision?.approvalScope?.detail).toContain("read/validation/status steps may also run");

    await expect(
      evaluateSafety({
        toolName: "data360_orchestrate",
        input: {
          action: "manifest.run",
          allow_confirmed: true,
          dry_run: true,
          params: { manifestPath: "data/manifest.json" },
        },
        cwd: "/project",
        config: readBundledConfig(),
      }),
    ).resolves.toBeUndefined();
  });

  it("lists declared child mutations for segment publishing journeys", async () => {
    const decision = await evaluateSafety({
      toolName: "data360_orchestrate",
      input: {
        action: "build_segment.run",
        allow_confirmed: true,
        params: { segmentId: "Segment_A" },
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision?.approvalScope?.detail).toContain("segment.publish");
    expect(decision?.approvalScope?.detail).toContain("ci.create");
  });

  it("does not mediate Data 360 read-like actions even when allow_confirmed is present", async () => {
    const decision = await evaluateSafety({
      toolName: "data360_discover",
      input: { action: "actions.search", allow_confirmed: true, params: { query: "stream" } },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toBeUndefined();
  });

  it("confirms Data 360 raw REST escape hatch execution", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const decision = await evaluateSafety({
      toolName: "data360_api",
      input: {
        action: "rest.request",
        allow_confirmed: true,
        params: { method: "DELETE", path: "/ssot/data-lake-objects/Test__dlm" },
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "data360 raw rest",
      riskTier: "data360_confirmed_execution_exact",
    });
  });

  it("confirms SOQL artifact exports as disclosure-sensitive native actions", async () => {
    const decision = await evaluateSafety({
      toolName: "sf_soql",
      input: { action: "query.export", output_file: "reports/accounts.csv", format: "csv" },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision).toMatchObject({
      action: "confirm",
      feature: "nativeToolGate",
      ruleId: "native-sf-soql-disclosure",
      subject: "sf_soql query.export reports/accounts.csv",
    });
    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "soql artifact export",
      riskTier: "soql_artifact_export_exact",
      allowSession: false,
    });
  });

  it("confirms SOQL QueryAll and unbounded reads without prompting bounded reads", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const queryAll = await evaluateSafety({
      toolName: "sf_soql",
      input: { action: "query.queryAll", target_org: "DevInt", query: "SELECT Id FROM Account" },
      cwd: "/project",
      config: readBundledConfig(),
    });
    expect(queryAll?.approvalScope).toMatchObject({
      operationFamily: "soql queryAll",
      riskTier: "soql_deleted_row_read_exact",
      allowSession: false,
    });

    const unbounded = await evaluateSafety({
      toolName: "sf_soql",
      input: {
        action: "query.run",
        target_org: "DevInt",
        query: "SELECT Id, Email FROM Contact",
        allow_unbounded: true,
      },
      cwd: "/project",
      config: readBundledConfig(),
    });
    expect(unbounded?.approvalScope).toMatchObject({
      operationFamily: "soql broad read",
      riskTier: "soql_unbounded_read_exact",
      allowSession: false,
    });

    const bounded = await evaluateSafety({
      toolName: "sf_soql",
      input: { action: "query.run", target_org: "DevInt", query: "SELECT Id FROM Account LIMIT 5" },
      cwd: "/project",
      config: readBundledConfig(),
    });
    expect(bounded).toBeUndefined();
  });

  it("confirms query.run with ALL ROWS as QueryAll-style disclosure", async () => {
    mockedEnv = env("DevInt", "sandbox");

    const decision = await evaluateSafety({
      toolName: "sf_soql",
      input: {
        action: "query.run",
        target_org: "DevInt",
        query: "SELECT Id FROM Account ALL ROWS",
      },
      cwd: "/project",
      config: readBundledConfig(),
    });

    expect(decision?.approvalScope).toMatchObject({
      operationFamily: "soql queryAll",
      riskTier: "soql_deleted_row_read_exact",
    });
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

  it("confirms Salesforce browser clicks using latest snapshot labels", async () => {
    writeLatestBrowserSnapshotRefs({
      sessionId: "guardrail-browser-snapshot-test",
      snapshot: [
        '- button "Save" [ref=e12]',
        '- button "Cancel" [ref=e13]',
        '- button "Delete" [ref=e14]',
        '- button "New" [ref=e15]',
        "- button [ref=e16]",
        '- link "Details" [ref=e17]',
        '- button "Continue" [ref=e18]',
      ].join("\n"),
      url: "https://example.my.salesforce.com/lightning/setup/Test/home",
    });

    const saveDecision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "@e12", reason: "click primary button" },
      cwd: "/project",
      config: readBundledConfig(),
      sessionId: "guardrail-browser-snapshot-test",
    });
    expect(saveDecision).toMatchObject({
      action: "confirm",
      feature: "nativeToolGate",
      ruleId: "native-sf-browser-commit",
      subject: "sf_browser_click @e12",
    });
    expect(saveDecision?.approvalScope?.detail).toContain("snapshot_label=Save");
    expect(saveDecision?.approvalScope?.detail).toContain("source=snapshot label");

    const deleteDecision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "e14", reason: "open row action" },
      cwd: "/project",
      config: readBundledConfig(),
      sessionId: "guardrail-browser-snapshot-test",
    });
    expect(deleteDecision?.ruleId).toBe("native-sf-browser-commit");

    const newDecision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "@e15", reason: "open dialog" },
      cwd: "/project",
      config: readBundledConfig(),
      sessionId: "guardrail-browser-snapshot-test",
    });
    expect(newDecision).toBeUndefined();

    const unlabeledButtonDecision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "@e16", reason: "click unlabeled button" },
      cwd: "/project",
      config: readBundledConfig(),
      sessionId: "guardrail-browser-snapshot-test",
    });
    expect(unlabeledButtonDecision?.ruleId).toBe("native-sf-browser-commit");
    expect(unlabeledButtonDecision?.approvalScope?.detail).toContain(
      "source=button-like snapshot ref",
    );

    const detailsDecision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "@e17", reason: "open Details tab" },
      cwd: "/project",
      config: readBundledConfig(),
      sessionId: "guardrail-browser-snapshot-test",
    });
    expect(detailsDecision).toBeUndefined();

    const continueDecision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "@e18", reason: "move through wizard" },
      cwd: "/project",
      config: readBundledConfig(),
      sessionId: "guardrail-browser-snapshot-test",
    });
    expect(continueDecision?.ruleId).toBe("native-sf-browser-commit");
  });

  it("fails closed for stale or missing Salesforce browser snapshots", async () => {
    writeLatestBrowserSnapshotRefs({
      sessionId: "guardrail-browser-stale-snapshot-test",
      snapshot: ['- link "Details" [ref=e21]'].join("\n"),
    });
    markLatestBrowserSnapshotStale("guardrail-browser-stale-snapshot-test", "test page change");

    const staleDecision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "@e21", reason: "open Details tab" },
      cwd: "/project",
      config: readBundledConfig(),
      sessionId: "guardrail-browser-stale-snapshot-test",
    });
    expect(staleDecision?.ruleId).toBe("native-sf-browser-commit");
    expect(staleDecision?.approvalScope?.detail).toContain("snapshot_status=stale");

    const missingDecision = await evaluateSafety({
      toolName: "sf_browser_click",
      input: { ref: "@e99", reason: "click old ref" },
      cwd: "/project",
      config: readBundledConfig(),
      sessionId: "guardrail-browser-missing-snapshot-test",
    });
    expect(missingDecision?.ruleId).toBe("native-sf-browser-commit");
    expect(missingDecision?.approvalScope?.detail).toContain("snapshot_status=missing-session");
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
      allowSession: false,
    });
  });

  it("infers Salesforce browser commits from commit-like keys and reasons", async () => {
    const enterDecision = await evaluateSafety({
      toolName: "sf_browser_press",
      input: { key: "Enter", reason: "keyboard" },
      cwd: "/project",
      config: readBundledConfig(),
    });
    expect(enterDecision?.ruleId).toBe("native-sf-browser-commit");
    expect(enterDecision?.approvalScope?.detail).toContain("source=commit-like key");

    const ctrlEnterDecision = await evaluateSafety({
      toolName: "sf_browser_press",
      input: { key: "Control+Enter", reason: "keyboard" },
      cwd: "/project",
      config: readBundledConfig(),
    });
    expect(ctrlEnterDecision?.ruleId).toBe("native-sf-browser-commit");

    const escapeDecision = await evaluateSafety({
      toolName: "sf_browser_press",
      input: { key: "Escape", reason: "close modal" },
      cwd: "/project",
      config: readBundledConfig(),
    });
    expect(escapeDecision).toBeUndefined();

    const reasonDecision = await evaluateSafety({
      toolName: "sf_browser_press",
      input: { key: "Escape", reason: "submit form" },
      cwd: "/project",
      config: readBundledConfig(),
    });
    expect(reasonDecision?.ruleId).toBe("native-sf-browser-commit");
  });
});
