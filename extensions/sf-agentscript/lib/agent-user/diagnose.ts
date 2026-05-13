/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only diagnose for the agent-user setup checklist.
 *
 * Walks the canonical agent-user-setup workflow against a single .agent
 * bundle and a target org, returns a structured per-check report. No
 * mutations — safe to run on production.
 *
 * The report is what the LLM (or a human) reads to decide whether the
 * org is ready for this agent and what's missing if not. Provision
 * (PR3) consumes the same report and turns the missing checks into
 * idempotent fix steps.
 *
 * Design notes:
 *   - License check runs first; if missing, every other check is
 *     skipped (no point asking about user wiring when the org isn't
 *     Agentforce-enabled).
 *   - Apex class access is checked by capability — every `apex://`
 *     target in the .agent must be granted by SOME PS the user has,
 *     not by name. The doc's `{AgentName}_Access` convention is
 *     unreliable in practice (auto-generated PSs miss classes,
 *     customers rename).
 *   - For Employee Agents, returns a one-line "n/a" report — the
 *     verb is still useful to confirm wiring isn't expected, and
 *     keeps the LLM from guessing what's required for that agent type.
 */

import type { Connection } from "@salesforce/core";
import { extractActionTargets } from "../preflight/parse.ts";
import type { ComponentSummary } from "../inspect.ts";
import { getDigitalAgentLicense } from "./license.ts";
import { findEinsteinAgentUsers, findUserByUsername, type AgentUserRow } from "./users.ts";
import {
  listClassAccessForUser,
  listPermissionSetAssignments,
  SYSTEM_AGENT_PS_NAME,
} from "./permset.ts";

export type DiagnoseCheckId =
  | "license"
  | "agent_user_exists"
  | "agent_user_active"
  | "system_permset_assigned"
  | "apex_class_access";

export type DiagnoseStatus = "ok" | "missing" | "unknown" | "skipped" | "n/a";

export interface DiagnoseCheck {
  id: DiagnoseCheckId;
  status: DiagnoseStatus;
  /** Human-readable detail surfaced to the LLM / user. */
  detail: string;
  /** When non-empty, a one-line next step (e.g. "run provision_agent_user"). */
  fix_hint?: string;
}

export interface DiagnoseApexAction {
  /** Action name from the .agent. */
  name: string;
  /** Apex class name extracted from `target: "apex://X"`. */
  apex_class: string;
  /** Status against the user's current PS bundle. */
  status: "ok" | "missing";
  /** PS that grants access when status='ok'. */
  granted_via?: string;
}

export interface DiagnoseReport {
  ok: boolean;
  agent_type: "Service" | "Employee" | "unknown";
  default_agent_user?: string;
  /** Active Einstein Agent Users in the org — useful when the named user is missing. */
  candidate_einstein_agent_users?: AgentUserRow[];
  /** Active Agentforce-family PSL DeveloperNames found in the org. */
  found_licenses?: string[];
  checks: DiagnoseCheck[];
  /** Per-action capability check (Service Agents with apex:// targets only). */
  apex_actions?: DiagnoseApexAction[];
  /** Suggested next step when ok=false. */
  recover_via?: { tool: string; params: Record<string, unknown> };
}

export interface RunDiagnoseInput {
  /** From .agent: `config.agent_type`. */
  agent_type: "AgentforceServiceAgent" | "AgentforceEmployeeAgent" | string;
  /** From .agent: `config.default_agent_user`. */
  default_agent_user?: string;
  /** From .agent: every action with a target — used for apex_class_access. */
  actions: readonly ComponentSummary[];
  /** Used in recover_via params. */
  agent_file: string;
  /** Used in recover_via params. */
  agent_api_name?: string;
}

export async function runDiagnose(
  conn: Connection,
  input: RunDiagnoseInput,
): Promise<DiagnoseReport> {
  const isService = input.agent_type === "AgentforceServiceAgent";
  const agentType: DiagnoseReport["agent_type"] = isService
    ? "Service"
    : input.agent_type === "AgentforceEmployeeAgent"
      ? "Employee"
      : "unknown";

  const checks: DiagnoseCheck[] = [];

  // ---- 1. License ---------------------------------------------------------
  const license = await getDigitalAgentLicense(conn);
  checks.push({
    id: "license",
    status: license.ok ? "ok" : "missing",
    detail: license.detail,
    ...(license.ok
      ? {}
      : {
          fix_hint:
            `An admin must provision an Agentforce license on this org. ` +
            `Without it, none of the other checks can succeed.`,
        }),
  });

  // Employee Agent: license is the only check we need to think about. Other
  // wiring is per-employee, not per-bundle, so we report n/a and stop.
  if (!isService) {
    checks.push({
      id: "agent_user_exists",
      status: "n/a",
      detail: "Employee Agents run as the logged-in user; no Einstein Agent User is required.",
    });
    checks.push({
      id: "agent_user_active",
      status: "n/a",
      detail: "n/a — see agent_user_exists.",
    });
    checks.push({
      id: "system_permset_assigned",
      status: "n/a",
      detail:
        "Employee Agents don't use the AgentforceServiceAgentUser system PS. " +
        "Custom PSs for Apex action access are assigned to employees, not a service account.",
    });
    if (input.actions.length > 0) {
      checks.push({
        id: "apex_class_access",
        status: "n/a",
        detail:
          "For Employee Agents, ensure each invoking employee has a PS granting " +
          "access to the agent's Apex classes. Per-user check is out of scope here.",
      });
    }
    return {
      ok: license.ok,
      agent_type: agentType,
      default_agent_user: input.default_agent_user,
      found_licenses: license.found_licenses,
      checks,
      ...(license.ok
        ? {}
        : {
            recover_via: undefined,
          }),
    };
  }

  // Service Agent path. Short-circuit when license is missing.
  if (!license.ok) {
    for (const id of [
      "agent_user_exists",
      "agent_user_active",
      "system_permset_assigned",
      "apex_class_access",
    ] as const) {
      checks.push({
        id,
        status: "skipped",
        detail: "Skipped: license check failed; downstream checks are moot.",
      });
    }
    return {
      ok: false,
      agent_type: "Service",
      default_agent_user: input.default_agent_user,
      checks,
    };
  }

  // ---- 2. agent_user_exists ----------------------------------------------
  let user: AgentUserRow | undefined;
  let candidates: AgentUserRow[] | undefined;
  if (!input.default_agent_user) {
    candidates = await findEinsteinAgentUsers(conn);
    checks.push({
      id: "agent_user_exists",
      status: "missing",
      detail:
        `No 'default_agent_user' in the .agent config. ` +
        (candidates.length > 0
          ? `${candidates.length} active Einstein Agent User(s) in this org: ` +
            candidates.map((c) => c.Username).join(", ")
          : `No active Einstein Agent Users in this org either.`),
      fix_hint:
        candidates.length > 0
          ? `Add 'default_agent_user: "${candidates[0].Username}"' to the .agent config and re-publish.`
          : `Run agentscript_lifecycle action='provision_agent_user' to create one.`,
    });
  } else {
    user = await findUserByUsername(conn, input.default_agent_user);
    if (!user) {
      candidates = await findEinsteinAgentUsers(conn);
      checks.push({
        id: "agent_user_exists",
        status: "missing",
        detail:
          `User '${input.default_agent_user}' from .agent config does not exist in this org. ` +
          (candidates.length > 0
            ? `Active Einstein Agent Users that DO exist: ` +
              candidates.map((c) => c.Username).join(", ")
            : `There are no active Einstein Agent Users in this org.`),
        fix_hint:
          candidates.length > 0
            ? `Either rename the .agent's default_agent_user to one of the existing users, or run provision_agent_user to create the named user.`
            : `Run agentscript_lifecycle action='provision_agent_user' to create the user.`,
      });
    } else {
      checks.push({
        id: "agent_user_exists",
        status: "ok",
        detail: `User '${input.default_agent_user}' exists (Id ${user.Id}, Profile=${user.ProfileName ?? "unknown"}).`,
      });
    }
  }

  // ---- 3. agent_user_active ---------------------------------------------
  if (user) {
    checks.push({
      id: "agent_user_active",
      status: user.IsActive ? "ok" : "missing",
      detail: user.IsActive
        ? `User '${user.Username}' is active.`
        : `User '${user.Username}' exists but IsActive=false.`,
      ...(user.IsActive
        ? {}
        : {
            fix_hint:
              "Reactivate the user in Setup, or pick a different active Einstein Agent User in default_agent_user.",
          }),
    });
  } else {
    checks.push({
      id: "agent_user_active",
      status: "skipped",
      detail: "Skipped: no resolved user from agent_user_exists.",
    });
  }

  // ---- 4. system_permset_assigned ---------------------------------------
  if (user && user.IsActive) {
    const assignments = await listPermissionSetAssignments(conn, user.Id);
    const assignedPSNames = assignments.map((a) => a.PermissionSetName);
    const hasSystem = assignedPSNames.includes(SYSTEM_AGENT_PS_NAME);
    checks.push({
      id: "system_permset_assigned",
      status: hasSystem ? "ok" : "missing",
      detail: hasSystem
        ? `'${SYSTEM_AGENT_PS_NAME}' is assigned. Currently assigned PSs: ${assignedPSNames.join(", ")}.`
        : `'${SYSTEM_AGENT_PS_NAME}' is NOT assigned to '${user.Username}'. Currently assigned: ${assignedPSNames.join(", ") || "<none>"}.`,
      ...(hasSystem
        ? {}
        : {
            fix_hint:
              "Run agentscript_lifecycle action='provision_agent_user' to assign the system PS (idempotent).",
          }),
    });
  } else {
    checks.push({
      id: "system_permset_assigned",
      status: "skipped",
      detail: "Skipped: user not resolvable or inactive.",
    });
  }

  // ---- 5. apex_class_access ---------------------------------------------
  // Capability check, not name-match. We compare the .agent's apex://
  // action targets against every Apex class the user can execute via
  // any assigned PS. Any uncovered class is a hard miss.
  let apexActions: DiagnoseApexAction[] | undefined;
  const apexTargets = extractActionTargets(input.actions).filter((t) => t.scheme === "apex");
  if (apexTargets.length === 0) {
    checks.push({
      id: "apex_class_access",
      status: "n/a",
      detail: "Bundle declares no apex:// action targets; no class-access check needed.",
    });
  } else if (!user || !user.IsActive) {
    checks.push({
      id: "apex_class_access",
      status: "skipped",
      detail: "Skipped: user not resolvable or inactive.",
    });
  } else {
    const access = await listClassAccessForUser(conn, user.Id);
    const grantedByClass = new Map(access.map((r) => [r.apex_class, r.granted_via_permission_set]));
    apexActions = apexTargets.map((t) => {
      const granted = grantedByClass.get(t.ref_name);
      return granted
        ? { name: t.name, apex_class: t.ref_name, status: "ok" as const, granted_via: granted }
        : { name: t.name, apex_class: t.ref_name, status: "missing" as const };
    });
    const missing = apexActions.filter((a) => a.status === "missing");
    checks.push({
      id: "apex_class_access",
      status: missing.length === 0 ? "ok" : "missing",
      detail:
        missing.length === 0
          ? `All ${apexActions.length} apex:// action target(s) are accessible via the user's PSs.`
          : `${missing.length} of ${apexActions.length} apex:// action target(s) are NOT accessible: ` +
            missing.map((m) => m.apex_class).join(", "),
      ...(missing.length === 0
        ? {}
        : {
            fix_hint:
              "Run agentscript_lifecycle action='provision_agent_user' to synthesize a custom PS that grants access to every apex:// target in the bundle.",
          }),
    });
  }

  // ---- aggregate ---------------------------------------------------------
  const ok = checks.every((c) => c.status === "ok" || c.status === "n/a");
  const recover_via: DiagnoseReport["recover_via"] = ok
    ? undefined
    : {
        tool: "agentscript_lifecycle",
        params: {
          action: "provision_agent_user",
          agent_file: input.agent_file,
          dry_run: true,
        },
      };
  return {
    ok,
    agent_type: "Service",
    default_agent_user: input.default_agent_user,
    found_licenses: license.found_licenses,
    candidate_einstein_agent_users: candidates,
    checks,
    apex_actions: apexActions,
    recover_via,
  };
}
