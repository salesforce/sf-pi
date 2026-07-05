/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Native Tool Risk Registry.
 *
 * Keep this registry small and pure: it normalizes known high-value durable
 * native SF Pi tool mutations into Safety Subjects. It must not call
 * Salesforce, Slack, Data 360, browser, or filesystem APIs.
 */
import { fingerprintText } from "./fingerprint.ts";
import type { NativeToolSafetySubject } from "./types.ts";

const COMMITTING_UI_REASON_PATTERN =
  /\b(save|apply|deploy|enable|disable|delete|remove|assign|create|update|submit|activate|deactivate)\b/i;

export function classifyNativeToolRisk(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  return (
    classifySfApex(toolName, input) ??
    classifySlackCanvas(toolName, input) ??
    classifySfBrowserCommit(toolName, input)
  );
}

function classifySfApex(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  if (toolName !== "sf_apex" || input.action !== "anon.run") return undefined;
  if (input.allow_mutation !== true || typeof input.body !== "string") return undefined;

  const risk = classifyAnonymousApex(input.body);
  if (!risk.mutating) return undefined;

  const bodyFingerprint = fingerprintText(normalizeApexBody(input.body));
  const targetOrg = typeof input.target_org === "string" ? input.target_org : undefined;
  return {
    kind: "nativeTool",
    toolName,
    action: "anon.run",
    ruleId: "native-sf-apex-anon-mutating",
    subject: `sf_apex anon.run mutating body ${bodyFingerprint}`,
    reason: `Mutating Anonymous Apex requested (${risk.reasons.join(", ")}).`,
    promptTitle: "⚠ Mutating Anonymous Apex",
    operationFamily: "anonymous apex",
    riskTier: "org_mutation_exact",
    fingerprint: `sf_apex|anon.run|body=${bodyFingerprint}`,
    approvalLabel: "this exact Anonymous Apex body",
    approvalDetail: `Body fingerprint ${bodyFingerprint}; reasons: ${risk.reasons.join(", ")}.`,
    usesSalesforceOrg: true,
    targetOrg,
    targetOrgExplicit: targetOrg !== undefined,
  };
}

function classifySlackCanvas(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  if (toolName !== "slack_canvas") return undefined;
  const action = input.action;
  if (action !== "create" && action !== "edit") return undefined;

  const title = stringValue(input.title);
  const canvasId = stringValue(input.canvas_id);
  const channelId = stringValue(input.channel_id);
  const operation = stringValue(input.operation);
  const markdown = stringValue(input.markdown);
  const sectionId = stringValue(input.section_id);
  const contentFingerprint = fingerprintText(
    JSON.stringify({ action, title, canvasId, channelId, operation, sectionId, markdown }),
  );
  const target = canvasId ?? title ?? "new canvas";
  const detailParts = [
    title ? `title=${title}` : undefined,
    canvasId ? `canvas=${canvasId}` : undefined,
    channelId ? `channel=${channelId}` : undefined,
    operation ? `operation=${operation}` : undefined,
    sectionId ? `section=${sectionId}` : undefined,
    `content=${contentFingerprint}`,
  ].filter((part): part is string => Boolean(part));

  return {
    kind: "nativeTool",
    toolName,
    action,
    ruleId: "native-slack-canvas-write",
    subject: `slack_canvas ${action} ${target}`,
    reason: `Slack canvas ${action} writes externally visible collaboration content.`,
    promptTitle: "⚠ Slack canvas write",
    operationFamily: "slack canvas write",
    riskTier: "external_content_write_exact",
    fingerprint: `slack_canvas|${action}|${contentFingerprint}`,
    approvalLabel: `Slack canvas ${action} ${target}`,
    approvalDetail: detailParts.join("; "),
  };
}

function classifySfBrowserCommit(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  if (toolName !== "sf_browser_click" && toolName !== "sf_browser_press") return undefined;
  const reason = stringValue(input.reason);
  const mutation = input.mutation === true;
  const reasonLooksCommitting = COMMITTING_UI_REASON_PATTERN.test(reason ?? "");
  if (!mutation && !reasonLooksCommitting) return undefined;

  const action = toolName === "sf_browser_click" ? "click" : "press";
  const target = toolName === "sf_browser_click" ? stringValue(input.ref) : stringValue(input.key);
  const targetLabel = target ?? "<unknown>";
  const source = mutation ? "mutation flag" : "commit-like reason";
  const payloadFingerprint = fingerprintText(JSON.stringify({ toolName, action, target, reason }));

  return {
    kind: "nativeTool",
    toolName,
    action,
    ruleId: "native-sf-browser-commit",
    subject: `${toolName} ${targetLabel}`,
    reason: `Salesforce browser ${action} appears to be a committing UI gesture (${source}).`,
    promptTitle: "⚠ Salesforce browser commit",
    operationFamily: "browser commit",
    riskTier: "browser_commit_exact",
    fingerprint: `${toolName}|${action}|${payloadFingerprint}`,
    approvalLabel: `Salesforce browser ${action} ${targetLabel}`,
    approvalDetail: [reason ? `reason=${reason}` : undefined, `source=${source}`]
      .filter(Boolean)
      .join("; "),
  };
}

function classifyAnonymousApex(body: string): { mutating: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ["DML keyword", /\b(insert|update|upsert|delete|undelete|merge)\b/i],
    ["Database DML", /\bDatabase\s*\.\s*(insert|update|upsert|delete|undelete|merge)\b/i],
    ["async enqueue", /\bSystem\s*\.\s*enqueueJob\b|\bDatabase\s*\.\s*executeBatch\b/i],
  ];
  for (const [reason, pattern] of checks) if (pattern.test(body)) reasons.push(reason);
  return { mutating: reasons.length > 0, reasons };
}

function normalizeApexBody(body: string): string {
  return body.trim().replace(/\s+/g, " ");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
