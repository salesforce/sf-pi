/* SPDX-License-Identifier: Apache-2.0 */
/** Normalize durable SF MCP native-configuration writes into Safety Subjects. */
import { fingerprintText } from "./fingerprint.ts";
import type { NativeToolSafetySubject } from "./types.ts";

export function classifySfMcpConfiguration(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  if (toolName !== "sf_mcp") return undefined;
  const action = stringValue(input.action);
  if (
    action !== "configure.apply" &&
    action !== "connection.apply" &&
    action !== "tools.apply" &&
    action !== "disable.apply"
  ) {
    return undefined;
  }

  const presetId = stringValue(input.preset_id) ?? "unspecified preset";
  const scope = stringValue(input.scope) ?? "unspecified scope";
  const connectionName = stringValue(input.connection_name) ?? "preset default";
  const planId = stringValue(input.plan_id) ?? "missing-plan";
  const planHash = stringValue(input.plan_hash) ?? "missing-hash";
  const disabling = action === "disable.apply";
  const operationFamily = disabling
    ? "mcp configuration disable"
    : action === "connection.apply"
      ? "mcp connection configuration"
      : action === "tools.apply"
        ? "mcp tool access configuration"
        : "mcp configuration";
  const riskTier = disabling
    ? "mcp_configuration_disable_exact"
    : "mcp_configuration_mutation_exact";
  const operation = {
    action,
    presetId,
    scope,
    connectionName,
    planId,
    planHash,
    allowMutation: input.allow_mutation === true,
  };
  const fingerprint = fingerprintText(JSON.stringify(operation));
  return {
    kind: "nativeTool",
    toolName,
    action,
    ruleId: "native-sf-mcp-config",
    subject: `sf_mcp ${action} ${presetId} ${connectionName} ${scope}`,
    reason: `SF MCP ${action} requested for ${presetId} connection ${connectionName} in ${scope} scope.`,
    promptTitle: disabling
      ? "⚠ Disable Salesforce MCP preset"
      : "⚠ Configure Salesforce MCP preset",
    operationFamily,
    riskTier,
    fingerprint: `sf_mcp|${action}|${fingerprint}`,
    approvalLabel: `${action} ${presetId}/${connectionName} in ${scope} scope`,
    approvalDetail: [
      `preset=${presetId}`,
      `scope=${scope}`,
      `connection=${connectionName}`,
      `plan_id=${planId}`,
      `plan_hash=${fingerprintText(planHash)}`,
      `allow_mutation=${input.allow_mutation === true}`,
    ].join("; "),
    allowSession: false,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
