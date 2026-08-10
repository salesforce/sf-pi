/* SPDX-License-Identifier: Apache-2.0 */
/** Lifecycle Agent User actions: status, diagnosis, and provisioning. */
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connFromAlias } from "../../../../../lib/common/sf-conn/index.ts";
import {
  checkAgentUserStatus,
  readAgentConfigSlice,
  runDiagnose,
  runProvision,
  type AgentUserStatus,
  type DiagnoseReport,
  type ProvisionReport,
  type ProvisionStep,
} from "../../agent-user/index.ts";
import { inspectFile } from "../../inspect.ts";
import { isAgentScriptFile } from "../../file-classify.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "../../tool-types.ts";
import { classifyLifecycleError } from "../error-classification.ts";

export interface AgentUserLifecycleActionInput {
  target_org?: string;
  agent_file?: string;
  dry_run?: boolean;
  username_override?: string;
}

export async function actionAgentUserStatus(
  ctx: ExtensionContext,
  input: AgentUserLifecycleActionInput,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }
  const cfg = await readAgentConfigSlice(filePath);
  if (cfg.ok === false) {
    return toolError(
      `Cannot read .agent config from ${filePath}: ${cfg.reason_detail}`,
      cfg.reason === "parse_failed"
        ? "Run agentscript_authoring compile/check and fix severity-1 errors first."
        : undefined,
      cfg.reason === "parse_failed"
        ? {
            tool: "agentscript_authoring",
            params: { verb: "compile", mode: "check", agent_file: filePath },
          }
        : undefined,
    );
  }
  if (!cfg.agent_type) {
    return toolError(
      `'${filePath}' has no 'config.agent_type' — cannot determine wiring requirements.`,
      "Add 'agent_type: \"AgentforceEmployeeAgent\"' or 'AgentforceServiceAgent' to the config block.",
    );
  }
  try {
    const conn = await connFromAlias(input.target_org);
    const status = await checkAgentUserStatus(conn, {
      agent_type: cfg.agent_type,
      default_agent_user: cfg.default_agent_user,
    });
    return toolOk({ ok: true as const, ...status }, formatAgentUserStatusText(status));
  } catch (err) {
    return classifyLifecycleError(
      err,
      cfg.agent_name ?? path.basename(filePath, ".agent"),
      "list_versions", // closest existing classifier action; keeps recover_via shape sane
      filePath,
    );
  }
}

function formatAgentUserStatusText(s: AgentUserStatus): string {
  const icon = s.status === "ready" ? "\u2705" : s.status === "n/a" ? "\u26AA" : "\u26A0\uFE0F";
  const userLine = s.user
    ? `\n  user: ${s.user.Username} (Id ${s.user.Id}, ${s.user.IsActive ? "active" : "inactive"})`
    : "";
  const psLine = s.assigned_permission_sets?.length
    ? `\n  permission sets: ${s.assigned_permission_sets.join(", ")}`
    : "";
  return `${icon} agent_user_status: ${s.status} (${s.agent_type})\n  ${s.short_message}${userLine}${psLine}`;
}

// -------------------------------------------------------------------------------------------------
// action = diagnose_agent_user
// -------------------------------------------------------------------------------------------------

export async function actionDiagnoseAgentUser(
  ctx: ExtensionContext,
  input: AgentUserLifecycleActionInput,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }
  const cfg = await readAgentConfigSlice(filePath);
  if (cfg.ok === false) {
    return toolError(
      `Cannot read .agent config from ${filePath}: ${cfg.reason_detail}`,
      cfg.reason === "parse_failed"
        ? "Run agentscript_authoring compile/check and fix severity-1 errors first."
        : undefined,
      cfg.reason === "parse_failed"
        ? {
            tool: "agentscript_authoring",
            params: { verb: "compile", mode: "check", agent_file: filePath },
          }
        : undefined,
    );
  }
  if (!cfg.agent_type) {
    return toolError(
      `'${filePath}' has no 'config.agent_type'.`,
      "Add 'agent_type: \"AgentforceEmployeeAgent\"' or 'AgentforceServiceAgent'.",
    );
  }

  // Pull every action with a target so the apex_class_access check has
  // the .agent's full apex:// surface to verify against the user's PSs.
  const inspect = await inspectFile(filePath);
  const actions = inspect.ok ? (inspect.components?.actions ?? []) : [];

  try {
    const conn = await connFromAlias(input.target_org);
    const report = await runDiagnose(conn, {
      agent_type: cfg.agent_type,
      default_agent_user: cfg.default_agent_user,
      actions,
      agent_file: filePath,
      agent_api_name: cfg.agent_name,
    });
    return toolOk({ ok: true as const, ...report }, formatDiagnoseReportText(report));
  } catch (err) {
    return classifyLifecycleError(
      err,
      cfg.agent_name ?? path.basename(filePath, ".agent"),
      "list_versions",
      filePath,
    );
  }
}

function formatDiagnoseReportText(r: DiagnoseReport): string {
  const headerIcon = r.ok ? "\u2705" : "\u26A0\uFE0F";
  const lines: string[] = [];
  lines.push(
    `${headerIcon} diagnose_agent_user: ${r.ok ? "ready" : "not_ready"} (${r.agent_type} Agent)`,
  );
  if (r.default_agent_user) {
    lines.push(`  default_agent_user: ${r.default_agent_user}`);
  }
  if (r.found_licenses?.length) {
    lines.push(`  licenses: ${r.found_licenses.join(", ")}`);
  }
  lines.push("");
  lines.push("Checks:");
  for (const c of r.checks) {
    const icon = checkIcon(c.status);
    lines.push(`  ${icon} ${c.id}: ${c.status}`);
    lines.push(`     ${c.detail}`);
    if (c.fix_hint) lines.push(`     \u2192 ${c.fix_hint}`);
  }
  if (r.apex_actions && r.apex_actions.length > 0) {
    lines.push("");
    lines.push("Apex action targets:");
    for (const a of r.apex_actions) {
      const icon = a.status === "ok" ? "\u2705" : "\u274C";
      const granted = a.granted_via ? ` (via ${a.granted_via})` : "";
      lines.push(`  ${icon} ${a.name} \u2192 ${a.apex_class}${granted}`);
    }
  }
  if (r.candidate_einstein_agent_users?.length) {
    lines.push("");
    lines.push("Candidate Einstein Agent Users in this org:");
    for (const u of r.candidate_einstein_agent_users) {
      lines.push(`  \u2022 ${u.Username} (${u.IsActive ? "active" : "inactive"}, Id ${u.Id})`);
    }
  }
  return lines.join("\n");
}

function checkIcon(status: DiagnoseReport["checks"][number]["status"]): string {
  switch (status) {
    case "ok":
      return "\u2705";
    case "missing":
      return "\u274C";
    case "unknown":
      return "\u2754";
    case "skipped":
      return "\u23ED\uFE0F";
    case "n/a":
      return "\u26AA";
  }
}

// -------------------------------------------------------------------------------------------------
// action = provision_agent_user
// -------------------------------------------------------------------------------------------------

export async function actionProvisionAgentUser(
  ctx: ExtensionContext,
  input: AgentUserLifecycleActionInput,
  stream: (msg: string) => void,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }
  const cfg = await readAgentConfigSlice(filePath);
  if (cfg.ok === false) {
    return toolError(
      `Cannot read .agent config from ${filePath}: ${cfg.reason_detail}`,
      cfg.reason === "parse_failed"
        ? "Run agentscript_authoring compile/check and fix severity-1 errors first."
        : undefined,
      cfg.reason === "parse_failed"
        ? {
            tool: "agentscript_authoring",
            params: { verb: "compile", mode: "check", agent_file: filePath },
          }
        : undefined,
    );
  }
  if (!cfg.agent_type) {
    return toolError(
      `'${filePath}' has no 'config.agent_type'.`,
      "Add 'agent_type: \"AgentforceServiceAgent\"' (or Employee).",
    );
  }
  if (cfg.agent_type !== "AgentforceServiceAgent") {
    return toolOk(
      {
        ok: true as const,
        agent_type: cfg.agent_type,
        was_dry_run: input.dry_run !== false,
        steps: [],
      },
      `\u26AA provision_agent_user: n/a (${cfg.agent_type})\n  Only Service Agents need user provisioning. Employee Agents run as the logged-in user.`,
    );
  }

  const agentApiName = cfg.agent_name ?? path.basename(filePath, ".agent");
  const inspect = await inspectFile(filePath);
  const actions = inspect.ok ? (inspect.components?.actions ?? []) : [];

  const dryRun = input.dry_run !== false;
  stream(
    dryRun
      ? "Provisioning (dry-run): gathering plan; no org mutations\u2026"
      : "Provisioning (live): executing org mutations idempotently\u2026",
  );

  try {
    const conn = await connFromAlias(input.target_org);
    const report = await runProvision(conn, {
      agent_type: cfg.agent_type,
      default_agent_user: cfg.default_agent_user,
      actions,
      agent_file: filePath,
      agent_api_name: agentApiName,
      dry_run: dryRun,
      signal,
      ...(input.username_override ? { username_override: input.username_override } : {}),
    });
    return toolOk(
      { ok: true as const, ...report },
      formatProvisionReportText(report, filePath, input.target_org),
    );
  } catch (err) {
    return classifyLifecycleError(err, agentApiName, "list_versions", filePath);
  }
}

function formatProvisionReportText(
  r: ProvisionReport,
  agentFile: string,
  targetOrg: string | undefined,
): string {
  const headerIcon = r.was_dry_run ? "\u2139\uFE0F" : r.ok ? "\u2705" : "\u274C";
  const mode = r.was_dry_run ? "dry-run" : r.ok ? "executed" : "failed";
  const lines: string[] = [];
  lines.push(`${headerIcon} provision_agent_user: ${mode} (${r.agent_type} Agent)`);
  lines.push("");
  lines.push("Steps:");
  for (const step of r.steps) {
    lines.push(`  ${stepIcon(step)} ${step.id}: ${step.action}`);
    lines.push(`     ${step.detail}`);
    if (step.error) lines.push(`     error: ${step.error}`);
  }
  if (r.preview_custom_ps_xml) {
    lines.push("");
    lines.push(
      r.was_dry_run ? "Custom PS that would be deployed (preview):" : "Custom PS deployed:",
    );
    for (const xmlLine of r.preview_custom_ps_xml.split("\n")) {
      lines.push(`    ${xmlLine}`);
    }
  }
  if (r.was_dry_run && r.steps.some((s) => s.action === "would_execute")) {
    const orgFlag = targetOrg ? ` target_org='${targetOrg}'` : "";
    lines.push("");
    lines.push(
      `\u2192 To execute: agentscript_lifecycle action='provision_agent_user' agent_file='${agentFile}'${orgFlag} dry_run=false`,
    );
  }
  return lines.join("\n");
}

function stepIcon(step: ProvisionStep): string {
  switch (step.action) {
    case "executed":
      return "\u2705";
    case "skipped":
      return "\u23ED\uFE0F";
    case "would_execute":
      return "\u2139\uFE0F";
    case "failed":
      return "\u274C";
  }
}
