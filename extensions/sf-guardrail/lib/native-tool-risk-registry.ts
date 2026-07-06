/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Native Tool Risk Registry.
 *
 * Keep this registry small and pure: it normalizes known high-value durable
 * native SF Pi tool mutations into Safety Subjects. It must not call
 * Salesforce, Slack, Data 360, browser, or filesystem APIs.
 */
import {
  findLatestBrowserSnapshotRefLookup,
  type BrowserSnapshotRefLookup,
} from "../../../lib/common/sf-browser-snapshot-state.ts";
import { fingerprintText } from "./fingerprint.ts";
import type { SafetySubjectContext } from "./safety-subject.ts";
import type { NativeToolSafetySubject } from "./types.ts";

const COMMITTING_UI_REASON_PATTERN =
  /\b(save|apply|deploy|enable|disable|delete|remove|assign|create|update|submit|activate|deactivate|publish|install|upgrade|upload|import|sync|connect|authorize|confirm|continue|finish|next)\b/i;
const COMMITTING_UI_LABEL_PATTERN =
  /\b(save|save\s*&\s*new|apply|deploy|enable|disable|delete|remove|assign|unassign|revoke|create|update|submit|activate|deactivate|publish|install|upgrade|upload|import|export|sync|connect|authorize|confirm|continue|finish|next|ok|done)\b/i;
const SAFE_NON_COMMITTING_UI_LABEL_PATTERN =
  /\b(cancel|close|dismiss|back|previous|details|view|search|filter)\b/i;

export function classifyNativeToolRisk(
  toolName: string,
  input: Record<string, unknown>,
  context: SafetySubjectContext = {},
): NativeToolSafetySubject | undefined {
  return (
    classifySfApex(toolName, input) ??
    classifyAgentScriptLifecycle(toolName, input) ??
    classifyData360(toolName, input) ??
    classifySfSoql(toolName, input) ??
    classifySlackCanvas(toolName, input) ??
    classifySfBrowserCommit(toolName, input, context)
  );
}

function classifySfApex(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  if (toolName !== "sf_apex" || input.action !== "anon.run") return undefined;
  if (typeof input.body !== "string") return undefined;

  const risk = classifyAnonymousApex(input.body);
  const bodyFingerprint = fingerprintText(normalizeApexBody(input.body));
  const targetOrg = typeof input.target_org === "string" ? input.target_org : undefined;
  const mutating = risk.mutating;
  return {
    kind: "nativeTool",
    toolName,
    action: "anon.run",
    ruleId: "native-sf-apex-anon-run",
    subject: `sf_apex anon.run body ${bodyFingerprint}`,
    reason: mutating
      ? `Anonymous Apex requested with mutation signals (${risk.reasons.join(", ")}).`
      : "Anonymous Apex can call org code and may have side effects even when direct DML is not visible in the submitted body.",
    promptTitle: mutating ? "⚠ Anonymous Apex with mutation signals" : "⚠ Anonymous Apex execution",
    operationFamily: "anonymous apex",
    riskTier: mutating ? "org_mutation_exact" : "apex_execution_exact",
    fingerprint: `sf_apex|anon.run|body=${bodyFingerprint}`,
    approvalLabel: "this exact Anonymous Apex body",
    approvalDetail: [
      `Body fingerprint ${bodyFingerprint}`,
      mutating ? `mutation signals: ${risk.reasons.join(", ")}` : "mutation signals: none detected",
      `allow_mutation=${input.allow_mutation === true}`,
    ].join("; "),
    usesSalesforceOrg: true,
    targetOrg,
    targetOrgExplicit: targetOrg !== undefined,
  };
}

function classifyAgentScriptLifecycle(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  if (toolName !== "agentscript_lifecycle") return undefined;
  const action = input.action;
  if (action === "publish") return agentScriptPublishSubject(toolName, input);
  if (action === "activate" || action === "deactivate") {
    return agentScriptActivationSubject(toolName, input, action);
  }
  if (action === "provision_agent_user" && input.dry_run === false) {
    return agentScriptProvisionSubject(toolName, input);
  }
  return undefined;
}

function agentScriptPublishSubject(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  const agentFile = stringValue(input.agent_file);
  if (!agentFile) return undefined;
  const agentApiName = stringValue(input.agent_api_name) ?? agentNameFromFile(agentFile);
  const targetOrg = stringValue(input.target_org);
  const activates = input.activate === true;
  const operationFamily = activates ? "agent publish+activate" : "agent publish";
  const fingerprint = fingerprintText(JSON.stringify({ operationFamily, agentApiName, agentFile }));
  return {
    kind: "nativeTool",
    toolName,
    action: "publish",
    ruleId: "native-agentscript-lifecycle",
    subject: `agentscript_lifecycle publish ${agentApiName}`,
    reason: activates
      ? `Agent Script publish requested with immediate activation for ${agentApiName}.`
      : `Agent Script publish requested for ${agentApiName}.`,
    promptTitle: activates ? "⚠ Agent publish + activate" : "⚠ Agent publish",
    operationFamily,
    riskTier: "agent_lifecycle_mutation",
    fingerprint: `agentscript|publish|activate=${activates}|${fingerprint}`,
    approvalLabel: activates
      ? `publish and activate agent ${agentApiName}`
      : `publish agent ${agentApiName}`,
    approvalDetail: `agent=${agentApiName}; file=${agentFile}; activate=${activates}`,
    usesSalesforceOrg: true,
    targetOrg,
    targetOrgExplicit: targetOrg !== undefined,
  };
}

function agentScriptActivationSubject(
  toolName: string,
  input: Record<string, unknown>,
  action: "activate" | "deactivate",
): NativeToolSafetySubject | undefined {
  const agentApiName = stringValue(input.agent_api_name);
  if (!agentApiName) return undefined;
  const targetOrg = stringValue(input.target_org);
  const version = typeof input.version === "number" ? String(input.version) : "latest";
  const fingerprint = fingerprintText(JSON.stringify({ action, agentApiName, version }));
  return {
    kind: "nativeTool",
    toolName,
    action,
    ruleId: "native-agentscript-lifecycle",
    subject: `agentscript_lifecycle ${action} ${agentApiName} v${version}`,
    reason: `Agent Script ${action} requested for ${agentApiName} (${version}).`,
    promptTitle: `⚠ Agent ${action}`,
    operationFamily: "agent activation",
    riskTier: "agent_lifecycle_activation",
    fingerprint: `agentscript|${action}|${fingerprint}`,
    approvalLabel: `${action} agent ${agentApiName}`,
    approvalDetail: `agent=${agentApiName}; version=${version}`,
    usesSalesforceOrg: true,
    targetOrg,
    targetOrgExplicit: targetOrg !== undefined,
  };
}

function agentScriptProvisionSubject(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  const agentFile = stringValue(input.agent_file);
  if (!agentFile) return undefined;
  const agentApiName = stringValue(input.agent_api_name) ?? agentNameFromFile(agentFile);
  const targetOrg = stringValue(input.target_org);
  const usernameOverride = stringValue(input.username_override);
  const fingerprint = fingerprintText(
    JSON.stringify({ agentApiName, agentFile, usernameOverride, permissionImpact: "unresolved" }),
  );
  return {
    kind: "nativeTool",
    toolName,
    action: "provision_agent_user",
    ruleId: "native-agentscript-lifecycle",
    subject: `agentscript_lifecycle provision_agent_user ${agentApiName}`,
    reason: `Agent Script Service Agent user provisioning requested for ${agentApiName}.`,
    promptTitle: "⚠ Agent user provisioning",
    operationFamily: "agent user provisioning",
    riskTier: "agent_user_provisioning_exact",
    fingerprint: `agentscript|provision_agent_user|${fingerprint}`,
    approvalLabel: `provision agent user for ${agentApiName}`,
    approvalDetail: [
      `agent=${agentApiName}`,
      `file=${agentFile}`,
      usernameOverride ? `username_override=${usernameOverride}` : undefined,
      "permission-impact fingerprint unavailable pre-execution",
    ]
      .filter(Boolean)
      .join("; "),
    usesSalesforceOrg: true,
    targetOrg,
    targetOrgExplicit: targetOrg !== undefined,
    allowSession: false,
  };
}

const DATA360_TOOL_NAMES = new Set([
  "data360_discover",
  "data360_connect",
  "data360_prepare",
  "data360_harmonize",
  "data360_segment",
  "data360_activate",
  "data360_query",
  "data360_semantic",
  "data360_observe",
  "data360_orchestrate",
  "data360_api",
]);

const DATA360_READ_PREFIXES = [
  "actions.",
  "action.",
  "examples.",
  "readiness.",
  "metadata.",
] as const;

function classifyData360(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  if (!DATA360_TOOL_NAMES.has(toolName)) return undefined;
  if (input.dry_run === true || input.allow_confirmed !== true) return undefined;
  const action = stringValue(input.action);
  if (!action || isData360ReadLikeAction(action)) return undefined;

  const targetOrg = stringValue(input.target_org);
  const params = input.params && typeof input.params === "object" ? input.params : undefined;
  const paramsFingerprint = fingerprintText(JSON.stringify({ toolName, action, params }));
  const family =
    toolName === "data360_api" ? "data360 raw rest" : `data360 ${actionFamily(action)}`;
  const childMutations = declaredData360ChildMutations(action);
  const childDetail = childMutations.length
    ? `; journey_fingerprint=${paramsFingerprint}; declared child mutations may include: ${childMutations.join(", ")}; read/validation/status steps may also run`
    : "";

  return {
    kind: "nativeTool",
    toolName,
    action,
    ruleId: "native-data360-confirmed-execute",
    subject: `${toolName} ${action}`,
    reason: `Data 360 confirmed execution requested for ${toolName} ${action}.`,
    promptTitle: "⚠ Data 360 execution",
    operationFamily: family,
    riskTier: "data360_confirmed_execution_exact",
    fingerprint: `data360|${toolName}|${action}|${paramsFingerprint}`,
    approvalLabel: `Data 360 ${toolName} ${action}`,
    approvalDetail: `tool=${toolName}; action=${action}; params=${paramsFingerprint}${childDetail}`,
    usesSalesforceOrg: true,
    targetOrg,
    targetOrgExplicit: targetOrg !== undefined,
  };
}

function classifySfSoql(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject | undefined {
  if (toolName !== "sf_soql") return undefined;
  const action = input.action;
  if (action === "query.export") return soqlExportSubject(toolName, input);
  if (action === "history.rerun") return soqlHistoryRerunSubject(toolName, input);
  if (action === "query.queryAll") return soqlBroadReadSubject(toolName, input, "queryAll");
  if (action === "query.run" && (input.allow_unbounded === true || queryUsesAllRows(input.query))) {
    return soqlBroadReadSubject(
      toolName,
      input,
      queryUsesAllRows(input.query) ? "queryAll" : "unbounded",
    );
  }
  return undefined;
}

function soqlExportSubject(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject {
  const outputFile = stringValue(input.output_file) ?? "<missing output_file>";
  const format = stringValue(input.format) ?? "csv";
  const fingerprint = fingerprintText(JSON.stringify({ outputFile, format }));
  return {
    kind: "nativeTool",
    toolName,
    action: "query.export",
    ruleId: "native-sf-soql-disclosure",
    subject: `sf_soql query.export ${outputFile}`,
    reason:
      "SOQL artifact export copies previously queried data into a workspace-visible export file.",
    promptTitle: "⚠ SOQL artifact export",
    operationFamily: "soql artifact export",
    riskTier: "soql_artifact_export_exact",
    fingerprint: `sf_soql|query.export|${fingerprint}`,
    approvalLabel: `export SOQL artifact to ${outputFile}`,
    approvalDetail: `output_file=${outputFile}; format=${format}`,
    allowSession: false,
  };
}

function soqlHistoryRerunSubject(
  toolName: string,
  input: Record<string, unknown>,
): NativeToolSafetySubject {
  const targetOrg = stringValue(input.target_org);
  const fingerprint = fingerprintText(JSON.stringify({ targetOrg }));
  return {
    kind: "nativeTool",
    toolName,
    action: "history.rerun",
    ruleId: "native-sf-soql-disclosure",
    subject: "sf_soql history.rerun",
    reason:
      "SOQL history.rerun replays a previous query action, which may disclose broad or deleted-row data.",
    promptTitle: "⚠ SOQL history rerun",
    operationFamily: "soql history rerun",
    riskTier: "soql_history_replay_exact",
    fingerprint: `sf_soql|history.rerun|${fingerprint}`,
    approvalLabel: "rerun the previous SOQL action",
    approvalDetail: `target_org=${targetOrg ?? "default"}; prior action is resolved at execution time`,
    usesSalesforceOrg: true,
    targetOrg,
    targetOrgExplicit: targetOrg !== undefined,
    allowSession: false,
  };
}

function soqlBroadReadSubject(
  toolName: string,
  input: Record<string, unknown>,
  kind: "queryAll" | "unbounded",
): NativeToolSafetySubject | undefined {
  const query = stringValue(input.query);
  if (!query) return undefined;
  const normalizedQuery = normalizeSoql(query);
  const queryFingerprint = fingerprintText(normalizedQuery);
  const targetOrg = stringValue(input.target_org);
  const objectName = primaryObjectFromSoql(normalizedQuery) ?? "unknown object";
  const operationFamily = kind === "queryAll" ? "soql queryAll" : "soql broad read";
  return {
    kind: "nativeTool",
    toolName,
    action: kind === "queryAll" ? "query.queryAll" : "query.run",
    ruleId: "native-sf-soql-disclosure",
    subject: `sf_soql ${operationFamily} ${objectName}`,
    reason:
      kind === "queryAll"
        ? "SOQL QueryAll / ALL ROWS can include deleted or archived records where supported."
        : "SOQL query.run requested an unbounded read override.",
    promptTitle: kind === "queryAll" ? "⚠ SOQL QueryAll" : "⚠ SOQL broad read",
    operationFamily,
    riskTier: kind === "queryAll" ? "soql_deleted_row_read_exact" : "soql_unbounded_read_exact",
    fingerprint: `sf_soql|${operationFamily}|query=${queryFingerprint}`,
    approvalLabel: `${operationFamily} on ${objectName}`,
    approvalDetail: [
      `object=${objectName}`,
      `query=${queryFingerprint}`,
      `max_rows=${typeof input.max_rows === "number" ? input.max_rows : "default"}`,
      `limit=${typeof input.limit === "number" ? input.limit : "default"}`,
    ].join("; "),
    usesSalesforceOrg: true,
    targetOrg,
    targetOrgExplicit: targetOrg !== undefined,
    allowSession: false,
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
  context: SafetySubjectContext,
): NativeToolSafetySubject | undefined {
  if (toolName !== "sf_browser_click" && toolName !== "sf_browser_press") return undefined;
  const reason = stringValue(input.reason);
  const mutation = input.mutation === true;
  const reasonLooksCommitting = COMMITTING_UI_REASON_PATTERN.test(reason ?? "");
  const action = toolName === "sf_browser_click" ? "click" : "press";
  const target = toolName === "sf_browser_click" ? stringValue(input.ref) : stringValue(input.key);
  const snapshotLookup =
    toolName === "sf_browser_click"
      ? findLatestBrowserSnapshotRefLookup(context.sessionId, stringValue(input.ref))
      : undefined;
  const snapshotSignal = snapshotCommitSignal(snapshotLookup);
  const keyLooksCommitting =
    toolName === "sf_browser_press"
      ? browserPressKeyLooksCommitting(stringValue(input.key))
      : false;
  if (!mutation && !reasonLooksCommitting && !snapshotSignal.committing && !keyLooksCommitting) {
    return undefined;
  }

  const targetLabel = target ?? "<unknown>";
  const source = mutation
    ? "mutation flag"
    : reasonLooksCommitting
      ? "commit-like reason"
      : keyLooksCommitting
        ? "commit-like key"
        : snapshotSignal.source;
  const snapshotRef = snapshotLookup?.ref;
  const payloadFingerprint = fingerprintText(
    JSON.stringify({
      toolName,
      action,
      target,
      reason,
      keyLooksCommitting,
      snapshotStatus: snapshotLookup?.status,
      snapshot: snapshotRef?.line,
    }),
  );

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
    approvalDetail: [
      reason ? `reason=${reason}` : undefined,
      snapshotRef?.label ? `snapshot_label=${snapshotRef.label}` : undefined,
      snapshotRef?.role ? `snapshot_role=${snapshotRef.role}` : undefined,
      snapshotLookup?.status ? `snapshot_status=${snapshotLookup.status}` : undefined,
      snapshotLookup?.ageMs !== undefined
        ? `snapshot_age_ms=${Math.round(snapshotLookup.ageMs)}`
        : undefined,
      snapshotLookup?.url ? `snapshot_url=${snapshotLookup.url}` : undefined,
      `source=${source}`,
    ]
      .filter(Boolean)
      .join("; "),
    allowSession: false,
  };
}

function snapshotCommitSignal(lookup: BrowserSnapshotRefLookup | undefined): {
  committing: boolean;
  source: string;
} {
  if (!lookup) return { committing: false, source: "snapshot unavailable" };
  if (lookup.status === "missing-session" || lookup.status === "missing-ref") {
    return { committing: true, source: lookup.status };
  }
  if (lookup.status === "stale") return { committing: true, source: "stale snapshot" };
  const ref = lookup.ref;
  if (!ref) return { committing: true, source: "snapshot unavailable" };
  const haystack = [ref.role, ref.label, ref.line].filter(Boolean).join(" ");
  if (COMMITTING_UI_LABEL_PATTERN.test(haystack))
    return { committing: true, source: "snapshot label" };
  if (isCommitCapableSnapshotRef(ref) && !SAFE_NON_COMMITTING_UI_LABEL_PATTERN.test(haystack)) {
    return { committing: true, source: "button-like snapshot ref" };
  }
  return { committing: false, source: "snapshot label" };
}

function isCommitCapableSnapshotRef(ref: {
  role?: string;
  label?: string;
  line?: string;
}): boolean {
  const haystack = [ref.role, ref.line].filter(Boolean).join(" ").toLowerCase();
  return /\b(button|menuitem|checkbox|radio|switch)\b/.test(haystack) && !ref.label;
}

function browserPressKeyLooksCommitting(key: string | undefined): boolean {
  const normalized = key?.toLowerCase().replace(/\s+/g, "");
  return (
    normalized === "enter" ||
    normalized === "numpadenter" ||
    normalized === "space" ||
    normalized === "control+enter" ||
    normalized === "ctrl+enter" ||
    normalized === "meta+enter" ||
    normalized === "command+enter" ||
    normalized === "cmd+enter"
  );
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

function declaredData360ChildMutations(action: string): string[] {
  switch (action) {
    case "manifest.run":
    case "ingest_csv.run":
    case "make_data_usable.run":
      return [
        "source_schema.put",
        "stream.create_ingest_api",
        "ingest_job.create",
        "ingest_job.upload_csv",
        "ingest_job.close",
      ];
    case "build_segment.run":
      return ["ci.create", "ci.run", "segment.create", "segment.publish"];
    case "activate_segment.run":
      return ["activation_target.create", "activation.create"];
    case "semantic_retrieval.run":
      return ["search_index.create", "retriever.create", "retriever_config.create"];
    case "cleanup.run":
      return ["cleanup resource deletes from cleanup plan"];
    default:
      return [];
  }
}

function isData360ReadLikeAction(action: string): boolean {
  return (
    DATA360_READ_PREFIXES.some((prefix) => action.startsWith(prefix)) ||
    action.endsWith(".plan") ||
    action.endsWith(".get") ||
    action.endsWith(".list") ||
    action.endsWith(".describe") ||
    action.endsWith(".status") ||
    action.endsWith(".sample") ||
    action.endsWith(".count") ||
    action.endsWith(".validate") ||
    action === "help" ||
    action === "status"
  );
}

function actionFamily(action: string): string {
  const parts = action.split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, -1).join(".") : action;
}

function queryUsesAllRows(value: unknown): boolean {
  return typeof value === "string" && /\bALL\s+ROWS\b/i.test(value);
}

function normalizeSoql(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function primaryObjectFromSoql(query: string): string | undefined {
  return query.match(/\bFROM\s+([a-zA-Z0-9_]+)\b/i)?.[1];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function agentNameFromFile(agentFile: string): string {
  const basename = agentFile.split(/[\\/]/).pop() ?? agentFile;
  return basename.endsWith(".agent") ? basename.slice(0, -".agent".length) : basename;
}
