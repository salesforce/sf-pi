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
      classifyNativeToolRisk("mcp__salesforce-sobject-reads__soqlQuery", {
        query: "SELECT Id FROM Account LIMIT 1",
      }),
    ).toBeUndefined();
  });

  it("blocks record mutations until the hosted MCP target is verified", () => {
    const subject = classifyNativeToolRisk(
      "mcp__salesforce-sobject-mutations__updateSobjectRecord",
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

  it("uses a managed sandbox endpoint as bounded environment evidence", () => {
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
      "mcp__salesforce-sobject-mutations__createSobjectRecord",
      { "sobject-name": "Task", body: { Subject: "Follow up" } },
      { cwd, projectTrusted: true },
    ) as NativeToolSafetySubject;

    expect(subject).toMatchObject({ targetOrgType: "sandbox", targetOrgUnverified: false });
    expect(evaluateNativeToolRisk(subject!, cwd, config)).toMatchObject({
      action: "confirm",
      orgType: "sandbox",
      orgResolutionSource: "mcpConfig",
    });
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
      "mcp__salesforce-sobject-mutations__createSobjectRecord",
      { "sobject-name": "Task", body: { Subject: "Follow up" } },
      { cwd, projectTrusted: false },
    ) as NativeToolSafetySubject;

    expect(subject).toMatchObject({ targetOrgUnverified: true });
    expect(evaluateNativeToolRisk(subject, cwd, config).action).toBe("block");
  });

  it("classifies Data 360 execute meta-tool calls for Guardrail mediation", () => {
    const subject = classifyNativeToolRisk("mcp__salesforce-data360__execute", {
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

  it("classifies mutation-like Salesforce DX MCP tools", () => {
    const subject = classifyNativeToolRisk("mcp__salesforce-dx__deploy_metadata", {
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
    const subject = classifyNativeToolRisk("mcp__salesforce-marketing-cloud__updateCampaign", {
      campaignId: "example-campaign",
    });

    expect(subject).toMatchObject({
      ruleId: "native-sf-mcp-external-operation",
      operationFamily: "mcp external operation",
      allowSession: false,
    });
  });

  it("classifies delete tools separately from create and update", () => {
    const subject = classifyNativeToolRisk("mcp__salesforce-sobject-deletes__deleteSobjectRecord", {
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
