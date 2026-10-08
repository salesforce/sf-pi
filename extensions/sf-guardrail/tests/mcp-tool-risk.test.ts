/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { evaluateNativeToolRisk } from "../lib/native-tool-risk-gate.ts";
import { classifyNativeToolRisk } from "../lib/native-tool-risk-registry.ts";
import { normalizeSafetySubject } from "../lib/safety-subject.ts";
import type { GuardrailConfig, NativeToolSafetySubject } from "../lib/types.ts";

const config = { productionAliases: [] } as unknown as GuardrailConfig;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Salesforce MCP tool safety subjects", () => {
  it("leaves read-only SObject MCP helpers alone", () => {
    expect(
      classifyNativeToolRisk("mcp__salesforce_sobject_reads__soqlQuery", {
        query: "SELECT Id FROM Account LIMIT 1",
      }),
    ).toBeUndefined();
  });

  it("blocks record mutations until the hosted MCP target is verified", () => {
    const subject = classifyNativeToolRisk(
      "mcp__salesforce_sobject_mutations__updateSobjectRecord",
      {
        "sobject-name": "Account",
        id: "001000000000001AAA",
        body: { Name: "Updated" },
      },
    );

    expect(subject).toMatchObject({
      ruleId: "native-sf-mcp-record-write",
      operationFamily: "mcp record write",
      targetOrgUnverified: true,
      blockProductionOrUnknown: true,
    });
    expect(evaluateNativeToolRisk(subject!, process.cwd(), config)).toMatchObject({
      action: "block",
      orgType: "production",
      orgResolutionGuessed: true,
    });
  });

  it("classifies Pi 0.99.2 underscore-normalized MCP server names", () => {
    const subject = classifyNativeToolRisk(
      "mcp__salesforce_sobject_mutations__updateSobjectRecord",
      {
        "sobject-name": "Account",
        id: "001000000000001AAA",
        body: { Name: "Updated" },
      },
    );

    expect(subject).toMatchObject({
      ruleId: "native-sf-mcp-record-write",
      operationFamily: "mcp record write",
      targetOrgUnverified: true,
      blockProductionOrUnknown: true,
    });
  });

  it("blocks a managed sandbox endpoint until the exact OAuth org is attested", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-guardrail-"));
    tempDirs.push(cwd);
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "salesforce-sobject-mutations": {
            url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-mutations",
          },
        },
      }),
    );

    const subject = normalizeSafetySubject(
      "mcp__salesforce_sobject_mutations__createSobjectRecord",
      { "sobject-name": "Task", body: { Subject: "Follow up" } },
      { cwd, projectTrusted: true },
    ) as NativeToolSafetySubject;

    expect(subject).toMatchObject({ targetOrgType: "sandbox", targetOrgUnverified: true });
    expect(evaluateNativeToolRisk(subject!, cwd, config)).toMatchObject({
      action: "block",
      orgType: "production",
      orgResolutionGuessed: true,
    });
  });

  it("blocks a managed production endpoint without connecting to production", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-production-"));
    tempDirs.push(cwd);
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "salesforce-sobject-mutations": {
            url: "https://api.salesforce.com/platform/mcp/v1/platform/sobject-mutations",
          },
        },
      }),
    );

    const subject = normalizeSafetySubject(
      "mcp__salesforce_sobject_mutations__createSobjectRecord",
      { "sobject-name": "Task", body: { Subject: "Follow up" } },
      { cwd, projectTrusted: true },
    ) as NativeToolSafetySubject;

    expect(subject).toMatchObject({ targetOrgType: "production", targetOrgUnverified: true });
    expect(evaluateNativeToolRisk(subject, cwd, config).action).toBe("block");
  });

  it("fails closed when configured server names collide after Pi normalization", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-collision-"));
    tempDirs.push(cwd);
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "salesforce-sobject-mutations": {
            url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-mutations",
          },
          salesforce_sobject_mutations: {
            url: "https://api.salesforce.com/platform/mcp/v1/platform/sobject-mutations",
          },
        },
      }),
    );

    const subject = normalizeSafetySubject(
      "mcp__salesforce_sobject_mutations__createSobjectRecord",
      { "sobject-name": "Task", body: { Subject: "Follow up" } },
      { cwd, projectTrusted: true },
    ) as NativeToolSafetySubject;

    expect(subject).toMatchObject({ targetOrgUnverified: true });
    expect(evaluateNativeToolRisk(subject, cwd, config).action).toBe("block");
  });

  it("ignores an untrusted project MCP file when classifying target environment", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-untrusted-"));
    tempDirs.push(cwd);
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "salesforce-sobject-mutations": {
            url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-mutations",
          },
        },
      }),
    );

    const subject = normalizeSafetySubject(
      "mcp__salesforce_sobject_mutations__createSobjectRecord",
      { "sobject-name": "Task", body: { Subject: "Follow up" } },
      { cwd, projectTrusted: false },
    ) as NativeToolSafetySubject;

    expect(subject).toMatchObject({ targetOrgUnverified: true });
    expect(evaluateNativeToolRisk(subject, cwd, config).action).toBe("block");
  });

  it("classifies Data 360 execute meta-tool calls for Guardrail mediation", () => {
    const subject = classifyNativeToolRisk("mcp__salesforce_data360__execute", {
      toolName: "d360_segment_create",
      paramsJson: '{"name":"Example"}',
    });

    expect(subject).toMatchObject({
      ruleId: "native-sf-mcp-data360-execute",
      operationFamily: "mcp data360 execute",
      targetOrgUnverified: true,
      allowSession: false,
    });
  });

  it("fails closed for every experimental Agentforce Sales operation", () => {
    const subject = classifyNativeToolRisk("mcp__salesforce_agentforce_sales__update_opportunity", {
      opportunityId: "example-opportunity",
      stage: "Closed Won",
    });

    expect(subject).toMatchObject({
      ruleId: "native-sf-mcp-agentforce-sales-operation",
      operationFamily: "mcp Agentforce Sales operation",
      targetOrgUnverified: true,
      blockProductionOrUnknown: true,
      allowSession: false,
    });
  });

  it("recognizes the Agentforce Sales sandbox endpoint but still blocks unverified execution", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-agentforce-sales-"));
    tempDirs.push(cwd);
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "salesforce-agentforce-sales": {
            url: "https://api.salesforce.com/platform/mcp/v1-beta.2/sandbox/agentforce-sales",
          },
        },
      }),
    );

    const subject = normalizeSafetySubject(
      "mcp__salesforce_agentforce_sales__prioritize_leads",
      {},
      { cwd, projectTrusted: true },
    ) as NativeToolSafetySubject;

    expect(subject).toMatchObject({ targetOrgType: "sandbox", targetOrgUnverified: true });
    expect(evaluateNativeToolRisk(subject, cwd, config).action).toBe("block");
  });

  it("classifies mutation-like Salesforce DX MCP tools", () => {
    const subject = classifyNativeToolRisk("mcp__salesforce_dx__deploy_metadata", {
      usernameOrAlias: "DevSandbox",
      sourceDir: ["force-app"],
    });

    expect(subject).toMatchObject({
      ruleId: "native-sf-mcp-dx-mutation",
      operationFamily: "mcp dx mutation",
      targetOrg: "DevSandbox",
      blockProductionOrUnknown: true,
    });
  });

  it("confirms unclassified managed Marketing Cloud operations", () => {
    const subject = classifyNativeToolRisk("mcp__salesforce_marketing_cloud__updateCampaign", {
      campaignId: "example-campaign",
    });

    expect(subject).toMatchObject({
      ruleId: "native-sf-mcp-external-operation",
      operationFamily: "mcp external operation",
      allowSession: false,
    });
  });

  it("classifies Backup and Recover writes for exact confirmation", () => {
    for (const tool of ["enqueue_backup", "create_compare_activity", "update_selection_records"]) {
      expect(classifyNativeToolRisk(`mcp__salesforce_backup_recover__${tool}`, {})).toMatchObject({
        ruleId: "native-sf-mcp-backup-write",
        operationFamily: "mcp backup write",
        blockProductionOrUnknown: true,
      });
    }
    expect(
      classifyNativeToolRisk("mcp__salesforce_backup_recover__get_backups", {}),
    ).toBeUndefined();
  });

  it("classifies every Content Write operation conservatively", () => {
    expect(
      classifyNativeToolRisk("mcp__salesforce_content_write__publish_cms_content", {
        contentIds: ["example"],
      }),
    ).toMatchObject({
      ruleId: "native-sf-mcp-content-write",
      operationFamily: "mcp content write",
      blockProductionOrUnknown: true,
    });
  });

  it("requires confirmation for a Content write on a managed sandbox endpoint", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-content-write-"));
    tempDirs.push(cwd);
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "salesforce-content-write": {
            url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/content-write",
          },
        },
      }),
    );

    const subject = normalizeSafetySubject(
      "mcp__salesforce_content_write__publish_cms_content",
      { contentIds: ["example"] },
      { cwd, projectTrusted: true },
    ) as NativeToolSafetySubject;

    expect(subject).toMatchObject({ targetOrgType: "sandbox", targetOrgUnverified: true });
    expect(evaluateNativeToolRisk(subject, cwd, config).action).toBe("block");
  });

  it("classifies Headless 360 dispatch but leaves read-only dispatch alone", () => {
    expect(
      classifyNativeToolRisk("mcp__salesforce_headless_360__dispatch", {
        method: "POST",
        url: "https://api.example.com/v1/users",
      }),
    ).toMatchObject({
      ruleId: "native-sf-mcp-headless-dispatch",
      operationFamily: "mcp headless dispatch",
      blockProductionOrUnknown: true,
    });
    expect(
      classifyNativeToolRisk("mcp__salesforce_headless_360_demo_org__dispatch", {
        method: "POST",
      }),
    ).toMatchObject({
      ruleId: "native-sf-mcp-headless-dispatch",
      operationFamily: "mcp headless dispatch",
    });
    expect(
      classifyNativeToolRisk("mcp__salesforce_headless_360_demo_org__dispatch_readonly", {
        method: "GET",
      }),
    ).toBeUndefined();
  });

  it("classifies delete tools separately from create and update", () => {
    const subject = classifyNativeToolRisk("mcp__salesforce_sobject_deletes__deleteSobjectRecord", {
      "sobject-name": "Lead",
      id: "00Q000000000001AAA",
    });

    expect(subject).toMatchObject({
      ruleId: "native-sf-mcp-record-delete",
      operationFamily: "mcp record delete",
      allowSession: false,
    });
  });
});
