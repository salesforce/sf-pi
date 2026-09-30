/* SPDX-License-Identifier: Apache-2.0 */
/** Normalize SF MCP managed tool calls into Guardrail native-tool subjects. */
import { fingerprintText } from "./fingerprint.ts";
import type { SafetySubjectContext } from "./safety-subject.ts";
import type { NativeToolSafetySubject } from "./types.ts";

const RECORD_WRITE_TOOLS = new Set([
  "createSobjectRecord",
  "updateSobjectRecord",
  "updateRelatedRecord",
]);
const RECORD_DELETE_TOOLS = new Set(["deleteSobjectRecord", "deleteRelatedRecord"]);
const RECORD_SERVERS = new Set([
  "salesforce-sobject-mutations",
  "salesforce-sobject-deletes",
  "salesforce-sobject-all",
]);
const EXTERNAL_SERVERS = new Set([
  "salesforce-marketing-cloud",
  "mulesoft-dx",
  "salesforce-custom",
]);
const DX_MUTATION_PATTERN =
  /^(deploy|create|delete|update|assign|unassign|publish|activate|deactivate|execute)[_-]/i;

export function classifySfMcpRisk(
  toolName: string,
  input: Record<string, unknown>,
  context: SafetySubjectContext,
): NativeToolSafetySubject | undefined {
  const match = toolName.match(/^mcp__([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)$/);
  if (!match) return undefined;
  const serverName = match[1];
  const mcpTool = match[2];
  if (!serverName || !mcpTool) return undefined;

  const payloadFingerprint = fingerprintText(JSON.stringify({ serverName, mcpTool, input }));
  const targetOrgType =
    context.mcpTargetType === "sandbox" || context.mcpTargetType === "production"
      ? context.mcpTargetType
      : undefined;

  if (RECORD_SERVERS.has(serverName)) {
    const deleting = RECORD_DELETE_TOOLS.has(mcpTool);
    if (!deleting && !RECORD_WRITE_TOOLS.has(mcpTool)) return undefined;
    return recordSubject({
      toolName,
      serverName,
      mcpTool,
      input,
      deleting,
      payloadFingerprint,
      targetOrgType,
    });
  }

  if (serverName === "salesforce-data360" && mcpTool === "execute") {
    const dispatchedTool = stringValue(input.toolName) ?? "unknown Data 360 operation";
    return {
      kind: "nativeTool",
      toolName,
      action: mcpTool,
      ruleId: "native-sf-mcp-data360-execute",
      subject: `${serverName} execute ${dispatchedTool}`,
      reason: `Salesforce MCP Data 360 execute requested for ${dispatchedTool}.`,
      promptTitle: "⚠ Salesforce MCP Data 360 execution",
      operationFamily: "mcp data360 execute",
      riskTier: "mcp_data360_execute_exact",
      fingerprint: `sf-mcp|${serverName}|${mcpTool}|${payloadFingerprint}`,
      approvalLabel: `execute ${dispatchedTool} through ${serverName}`,
      approvalDetail: `server=${serverName}; tool=${dispatchedTool}; payload=${payloadFingerprint}`,
      usesSalesforceOrg: true,
      targetOrgType,
      targetOrgUnverified: !targetOrgType,
      blockProductionOrUnknown: true,
      allowSession: false,
    };
  }

  if (serverName === "salesforce-dx" && DX_MUTATION_PATTERN.test(mcpTool)) {
    const targetOrg =
      stringValue(input.target_org) ??
      stringValue(input.targetOrg) ??
      stringValue(input.usernameOrAlias) ??
      stringValue(input.org);
    return {
      kind: "nativeTool",
      toolName,
      action: mcpTool,
      ruleId: "native-sf-mcp-dx-mutation",
      subject: `${serverName} ${mcpTool}`,
      reason: `Salesforce DX MCP mutation-like tool ${mcpTool} requested.`,
      promptTitle: "⚠ Salesforce DX MCP mutation",
      operationFamily: "mcp dx mutation",
      riskTier: "mcp_dx_mutation_exact",
      fingerprint: `sf-mcp|${serverName}|${mcpTool}|${payloadFingerprint}`,
      approvalLabel: `${mcpTool} through ${serverName}`,
      approvalDetail: `server=${serverName}; tool=${mcpTool}; payload=${payloadFingerprint}`,
      usesSalesforceOrg: true,
      targetOrg,
      targetOrgExplicit: targetOrg !== undefined,
      blockProductionOrUnknown: true,
      allowSession: false,
    };
  }

  if (EXTERNAL_SERVERS.has(serverName)) {
    return {
      kind: "nativeTool",
      toolName,
      action: mcpTool,
      ruleId: "native-sf-mcp-external-operation",
      subject: `${serverName} ${mcpTool}`,
      reason: `Managed external MCP operation ${mcpTool} requested through ${serverName}.`,
      promptTitle: "⚠ Managed external MCP operation",
      operationFamily: "mcp external operation",
      riskTier: "mcp_external_operation_exact",
      fingerprint: `sf-mcp|${serverName}|${mcpTool}|${payloadFingerprint}`,
      approvalLabel: `${mcpTool} through ${serverName}`,
      approvalDetail: `server=${serverName}; tool=${mcpTool}; payload=${payloadFingerprint}`,
      allowSession: false,
    };
  }

  return undefined;
}

function recordSubject(input: {
  toolName: string;
  serverName: string;
  mcpTool: string;
  input: Record<string, unknown>;
  deleting: boolean;
  payloadFingerprint: string;
  targetOrgType: "production" | "sandbox" | undefined;
}): NativeToolSafetySubject {
  const objectName = stringValue(input.input["sobject-name"]) ?? "unknown object";
  const recordId = stringValue(input.input.id);
  const operationFamily = input.deleting ? "mcp record delete" : "mcp record write";
  const actionLabel = input.deleting
    ? "delete"
    : input.mcpTool.startsWith("create")
      ? "create"
      : "update";
  const target = recordId ? `${objectName} ${recordId}` : objectName;
  return {
    kind: "nativeTool",
    toolName: input.toolName,
    action: input.mcpTool,
    ruleId: input.deleting ? "native-sf-mcp-record-delete" : "native-sf-mcp-record-write",
    subject: `${input.serverName} ${input.mcpTool} ${target}`,
    reason: `Salesforce MCP ${actionLabel} requested for ${target}. ${
      input.targetOrgType
        ? `The native MCP endpoint identifies the target as ${input.targetOrgType}; the exact OAuth org is not correlated to the active Salesforce CLI org.`
        : "The hosted OAuth target is not yet correlated to the active Salesforce CLI org."
    }`,
    promptTitle: input.deleting
      ? "⚠ Salesforce MCP record delete"
      : "⚠ Salesforce MCP record write",
    operationFamily,
    riskTier: input.deleting ? "mcp_record_delete_exact" : "mcp_record_write_exact",
    fingerprint: `sf-mcp|${input.serverName}|${input.mcpTool}|${input.payloadFingerprint}`,
    approvalLabel: `${actionLabel} ${target} through ${input.serverName}`,
    approvalDetail: `server=${input.serverName}; tool=${input.mcpTool}; object=${objectName}; payload=${input.payloadFingerprint}`,
    usesSalesforceOrg: true,
    targetOrgType: input.targetOrgType,
    targetOrgUnverified: !input.targetOrgType,
    blockProductionOrUnknown: true,
    allowSession: false,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
