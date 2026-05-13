/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Quick "is this agent's user wired up correctly?" check.
 *
 * Used by:
 *   - agentscript_lifecycle action='agent_user_status' (direct LLM call)
 *   - agentscript_lifecycle action='publish' (auto-preflight on Service
 *     Agents to fail fast with a clear recover_via instead of letting the
 *     SFAP error catch us)
 *
 * Cheap by design: 2 SOQL hits in the happy path (license + the user's
 * PS assignments). Full diagnose is its own verb (`diagnose_agent_user`).
 *
 * Read-only. No mutations. Safe on production.
 */

import type { Connection } from "@salesforce/core";
import { getDigitalAgentLicense } from "./license.ts";
import { findUserByUsername, type AgentUserRow } from "./users.ts";
import { listPermissionSetAssignments, SYSTEM_AGENT_PS_NAME } from "./permset.ts";

export interface AgentUserStatus {
  ok: boolean;
  /** "ready" — every Service-Agent prereq is in place. */
  /** "not_ready" — at least one prereq is missing; check `reason` + `detail`. */
  /** "n/a" — agent_type is Employee Agent, no user wiring needed. */
  status: "ready" | "not_ready" | "n/a";
  agent_type: "Service" | "Employee" | "unknown";
  short_message: string;
  /** Stable code for branching on the result. */
  reason?:
    | "no_default_agent_user"
    | "license_missing"
    | "user_not_found"
    | "user_inactive"
    | "system_ps_unassigned"
    | "ok";
  /** Resolved User row when found. */
  user?: AgentUserRow;
  /** PS DeveloperNames assigned to the user (when found). */
  assigned_permission_sets?: string[];
}

export interface AgentUserStatusInput {
  /** From the .agent file: `config.agent_type`. */
  agent_type: "AgentforceServiceAgent" | "AgentforceEmployeeAgent" | string;
  /** From the .agent file: `config.default_agent_user`. */
  default_agent_user?: string;
}

/**
 * Walk: agent_type → license → user → system PS. First failure short-
 * circuits with a clear `reason` + a one-line `short_message`.
 */
export async function checkAgentUserStatus(
  conn: Connection,
  input: AgentUserStatusInput,
): Promise<AgentUserStatus> {
  const isService = input.agent_type === "AgentforceServiceAgent";
  if (!isService) {
    return {
      ok: true,
      status: "n/a",
      agent_type: input.agent_type === "AgentforceEmployeeAgent" ? "Employee" : "unknown",
      reason: "ok",
      short_message:
        input.agent_type === "AgentforceEmployeeAgent"
          ? "Employee Agent — no Einstein Agent User wiring required."
          : `agent_type='${input.agent_type}' — agent-user wiring not applicable.`,
    };
  }

  // Service Agent path.
  if (!input.default_agent_user) {
    return {
      ok: false,
      status: "not_ready",
      agent_type: "Service",
      reason: "no_default_agent_user",
      short_message:
        `Service Agent has no 'default_agent_user' in config — add one ` +
        `(or run agentscript_lifecycle action='diagnose_agent_user' to see ` +
        `which Einstein Agent Users exist in this org).`,
    };
  }

  const license = await getDigitalAgentLicense(conn);
  if (!license.ok) {
    return {
      ok: false,
      status: "not_ready",
      agent_type: "Service",
      reason: "license_missing",
      short_message: license.detail,
    };
  }

  const user = await findUserByUsername(conn, input.default_agent_user);
  if (!user) {
    return {
      ok: false,
      status: "not_ready",
      agent_type: "Service",
      reason: "user_not_found",
      short_message:
        `Service Agent's default_agent_user '${input.default_agent_user}' ` +
        `is not a User in this org. Run diagnose_agent_user to see candidate ` +
        `Einstein Agent Users, or provision_agent_user to create one.`,
    };
  }
  if (!user.IsActive) {
    return {
      ok: false,
      status: "not_ready",
      agent_type: "Service",
      reason: "user_inactive",
      user,
      short_message:
        `Service Agent's default_agent_user '${input.default_agent_user}' ` +
        `exists but is inactive. Reactivate it in Setup, or pick a different ` +
        `Einstein Agent User.`,
    };
  }

  const assignments = await listPermissionSetAssignments(conn, user.Id);
  const psNames = assignments.map((a) => a.PermissionSetName);
  if (!psNames.includes(SYSTEM_AGENT_PS_NAME)) {
    return {
      ok: false,
      status: "not_ready",
      agent_type: "Service",
      reason: "system_ps_unassigned",
      user,
      assigned_permission_sets: psNames,
      short_message:
        `Service Agent's default_agent_user lacks the system PS ` +
        `'${SYSTEM_AGENT_PS_NAME}'. Without it, publish fails with a ` +
        `cryptic Internal Error. Run agentscript_lifecycle ` +
        `action='provision_agent_user' to assign it (idempotent).`,
    };
  }

  return {
    ok: true,
    status: "ready",
    agent_type: "Service",
    user,
    assigned_permission_sets: psNames,
    reason: "ok",
    short_message: `Service Agent user '${input.default_agent_user}' is ready (license ✓, active ✓, system PS ✓).`,
  };
}
