/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Idempotent agent-user provisioner — turns the read-only diagnose
 * report into a sequence of write steps that brings the org into the
 * "ready" state for a Service Agent.
 *
 * Walks the canonical 4-step path:
 *   1. create_user        — when the named default_agent_user doesn't exist
 *   2. assign_system_ps   — when AgentforceServiceAgentUser isn't assigned
 *   3. deploy_custom_ps   — when any apex:// target lacks class access
 *   4. assign_custom_ps   — assign the freshly-deployed custom PS
 *
 * Each step's idempotency guard (skip-if-already-done) lives in the
 * underlying primitive — provision composes them. dry_run mode runs the
 * read-only diagnose phase and emits a "would_execute" plan instead of
 * mutating.
 *
 * No sf CLI subprocess. User CRUD via Connection.sobject('User').create();
 * PSA via Connection.sobject('PermissionSetAssignment').create();
 * custom PS deploy via @salesforce/source-deploy-retrieve.
 */

import type { Connection } from "@salesforce/core";
import { extractActionTargets } from "../preflight/parse.ts";
import type { ComponentSummary } from "../inspect.ts";
import { synthesizeCustomPS } from "./custom-ps.ts";
import { deployPermissionSet } from "./deploy.ts";
import { runDiagnose, type DiagnoseReport } from "./diagnose.ts";
import { assignPermissionSet, findPermissionSetByName, SYSTEM_AGENT_PS_NAME } from "./permset.ts";
import { createAgentUser, findUserByUsername, getEinsteinAgentUserProfileId } from "./users.ts";

export type ProvisionStepId =
  | "create_user"
  | "assign_system_ps"
  | "deploy_custom_ps"
  | "assign_custom_ps";

export type ProvisionStepAction = "skipped" | "executed" | "would_execute" | "failed";

export interface ProvisionStep {
  id: ProvisionStepId;
  action: ProvisionStepAction;
  /** Human-readable explanation of what we did / would do. */
  detail: string;
  /** Recordid on insert; deploy job id on a deploy. */
  result?: string;
  /** Set when action='failed' or when a precondition was unmet. */
  error?: string;
}

export interface ProvisionReport {
  ok: boolean;
  was_dry_run: boolean;
  agent_type: "Service" | "Employee" | "unknown";
  /** Pre-mutation diagnose snapshot — what we found before doing anything. */
  before: DiagnoseReport;
  /** Step plan + outcomes. */
  steps: ProvisionStep[];
  /**
   * The fully-rendered Custom PS XML, when the bundle has apex://
   * targets and a deploy is in scope. Always populated for transparency,
   * regardless of dry_run state.
   */
  preview_custom_ps_xml?: string;
  /** Suggested next step. */
  recover_via?: { tool: string; params: Record<string, unknown> };
}

export interface RunProvisionInput {
  agent_type: "AgentforceServiceAgent" | "AgentforceEmployeeAgent" | string;
  default_agent_user?: string;
  /** Used by the apex_class_access check + custom-PS synthesis. */
  actions: readonly ComponentSummary[];
  /** Used in recover_via params. */
  agent_file: string;
  /** Bundle DeveloperName — used to name the custom PS. */
  agent_api_name: string;
  /**
   * Override the username to provision. Useful when the bundle's
   * default_agent_user doesn't match the org's expected format and the
   * caller wants to wire a different existing user.
   */
  username_override?: string;
  /** Override the apex class list — by default we extract from .actions. */
  apex_targets_override?: readonly string[];
  /**
   * When true, gather the plan without mutating. Default true. The
   * caller must explicitly pass `false` to actually execute.
   */
  dry_run?: boolean;
}

export async function runProvision(
  conn: Connection,
  input: RunProvisionInput,
): Promise<ProvisionReport> {
  const dryRun = input.dry_run !== false; // default true

  // Always start from the read-only diagnose so we know what to do.
  const before = await runDiagnose(conn, {
    agent_type: input.agent_type,
    default_agent_user: input.default_agent_user,
    actions: input.actions,
    agent_file: input.agent_file,
    agent_api_name: input.agent_api_name,
  });

  const steps: ProvisionStep[] = [];
  const isService = input.agent_type === "AgentforceServiceAgent";

  // Hard-stop short-circuits: license missing or not a Service Agent.
  if (!isService) {
    return {
      ok: before.ok,
      was_dry_run: dryRun,
      agent_type: before.agent_type,
      before,
      steps: [
        {
          id: "create_user",
          action: "skipped",
          detail: "Not a Service Agent — no provisioning required.",
        },
      ],
    };
  }
  const licenseCheck = before.checks.find((c) => c.id === "license");
  if (licenseCheck?.status !== "ok") {
    return {
      ok: false,
      was_dry_run: dryRun,
      agent_type: "Service",
      before,
      steps: [
        {
          id: "create_user",
          action: "skipped",
          detail:
            "Aborted: org doesn't have an active Agentforce license. " +
            "An admin must provision the license before provisioning can run.",
        },
      ],
    };
  }

  // ---- Step 1: create_user ----------------------------------------------
  const desiredUsername = input.username_override ?? input.default_agent_user;
  if (!desiredUsername) {
    return {
      ok: false,
      was_dry_run: dryRun,
      agent_type: "Service",
      before,
      steps: [
        {
          id: "create_user",
          action: "skipped",
          detail:
            "Aborted: no default_agent_user in the .agent and no username_override " +
            "supplied. Set 'config.default_agent_user' in the .agent file (or pass " +
            "username_override) and re-run.",
        },
      ],
    };
  }
  let userId: string | undefined;
  const existingUser = await findUserByUsername(conn, desiredUsername);
  if (existingUser) {
    if (!existingUser.IsActive) {
      steps.push({
        id: "create_user",
        action: "failed",
        detail: `User '${desiredUsername}' exists but IsActive=false. Reactivate it in Setup or pick a different username.`,
        error: "user_inactive",
      });
      return finalize(steps, before, dryRun);
    }
    userId = existingUser.Id;
    steps.push({
      id: "create_user",
      action: "skipped",
      detail: `User '${desiredUsername}' already exists (Id ${existingUser.Id}, active).`,
      result: existingUser.Id,
    });
  } else {
    const profileId = await getEinsteinAgentUserProfileId(conn);
    if (!profileId) {
      steps.push({
        id: "create_user",
        action: "failed",
        detail:
          "Cannot create User: profile 'Einstein Agent User' not found in this org. " +
          "Older orgs may use a different profile name; ask an admin to confirm.",
        error: "profile_not_found",
      });
      return finalize(steps, before, dryRun);
    }
    if (dryRun) {
      steps.push({
        id: "create_user",
        action: "would_execute",
        detail:
          `Would insert User Username='${desiredUsername}', ProfileId='${profileId}' ` +
          `(Profile=Einstein Agent User), Alias derived from username, Email=placeholder@example.com.`,
      });
      // For dry-runs we can't continue past create_user (we don't have a userId).
      // Surface the remaining steps as 'would_execute' summaries.
      return finalize(addRemainingDryRunSteps(steps, before, input, dryRun), before, dryRun);
    }
    const created = await createAgentUser(conn, {
      username: desiredUsername,
      profile_id: profileId,
    });
    if (!created.ok || !created.user_id) {
      steps.push({
        id: "create_user",
        action: "failed",
        detail: `User insert failed for '${desiredUsername}': ${created.error}`,
        error: created.error,
      });
      return finalize(steps, before, dryRun);
    }
    userId = created.user_id;
    steps.push({
      id: "create_user",
      action: "executed",
      detail: `Created User '${desiredUsername}' (Id ${created.user_id}).`,
      result: created.user_id,
    });
  }

  // ---- Step 2: assign_system_ps ----------------------------------------
  const sysPsCheck = before.checks.find((c) => c.id === "system_permset_assigned");
  if (sysPsCheck?.status === "ok") {
    steps.push({
      id: "assign_system_ps",
      action: "skipped",
      detail: `'${SYSTEM_AGENT_PS_NAME}' is already assigned.`,
    });
  } else if (dryRun) {
    steps.push({
      id: "assign_system_ps",
      action: "would_execute",
      detail: `Would insert PermissionSetAssignment(AssigneeId='${userId}', PermissionSet.Name='${SYSTEM_AGENT_PS_NAME}').`,
    });
  } else {
    const sysAssign = await assignPermissionSet(conn, {
      user_id: userId,
      permission_set_name: SYSTEM_AGENT_PS_NAME,
    });
    if (sysAssign.ok) {
      steps.push({
        id: "assign_system_ps",
        action: sysAssign.already_assigned ? "skipped" : "executed",
        detail: sysAssign.already_assigned
          ? `'${SYSTEM_AGENT_PS_NAME}' was already assigned (idempotent).`
          : `Assigned '${SYSTEM_AGENT_PS_NAME}' to user.`,
        result: sysAssign.assignment_id,
      });
    } else {
      steps.push({
        id: "assign_system_ps",
        action: "failed",
        detail: `Failed to assign '${SYSTEM_AGENT_PS_NAME}': ${sysAssign.error}`,
        error: sysAssign.error,
      });
      return finalize(steps, before, dryRun);
    }
  }

  // ---- Step 3 + 4: custom PS (deploy + assign) -------------------------
  const apexClasses =
    input.apex_targets_override ??
    extractActionTargets(input.actions)
      .filter((t) => t.scheme === "apex")
      .map((t) => t.ref_name);

  if (apexClasses.length === 0) {
    steps.push({
      id: "deploy_custom_ps",
      action: "skipped",
      detail: "Bundle has no apex:// action targets; no custom PS needed.",
    });
    steps.push({
      id: "assign_custom_ps",
      action: "skipped",
      detail: "n/a — see deploy_custom_ps.",
    });
    return finalize(steps, before, dryRun);
  }

  const synthesized = synthesizeCustomPS({
    agent_name: input.agent_api_name,
    apex_classes: apexClasses,
  });

  // Skip-if-already-done: every required class is reachable via some
  // existing PS the user has? Then the custom PS deploy is a no-op.
  const apexCheck = before.checks.find((c) => c.id === "apex_class_access");
  const apexAlreadyOk = apexCheck?.status === "ok";

  if (apexAlreadyOk) {
    steps.push({
      id: "deploy_custom_ps",
      action: "skipped",
      detail: "All apex:// classes already reachable via the user's existing PS bundle.",
    });
    steps.push({
      id: "assign_custom_ps",
      action: "skipped",
      detail: "Skipped: no custom PS deployed in this run.",
    });
  } else if (dryRun) {
    steps.push({
      id: "deploy_custom_ps",
      action: "would_execute",
      detail:
        `Would deploy PermissionSet '${synthesized.developer_name}' covering ` +
        `${apexClasses.length} apex class(es): ${apexClasses.slice(0, 5).join(", ")}` +
        (apexClasses.length > 5 ? `, +${apexClasses.length - 5} more` : "") +
        ". XML preview is on the report.",
    });
    steps.push({
      id: "assign_custom_ps",
      action: "would_execute",
      detail: `Would insert PermissionSetAssignment(AssigneeId='${userId}', PermissionSet.Name='${synthesized.developer_name}').`,
    });
  } else {
    const deployed = await deployPermissionSet(conn, {
      developer_name: synthesized.developer_name,
      xml: synthesized.xml,
    });
    if (!deployed.ok) {
      steps.push({
        id: "deploy_custom_ps",
        action: "failed",
        detail: `Custom PS deploy failed: ${deployed.error}`,
        error: deployed.error,
      });
      return finalize(steps, before, dryRun, synthesized.xml);
    }
    steps.push({
      id: "deploy_custom_ps",
      action: "executed",
      detail: `Deployed PermissionSet '${synthesized.developer_name}' (${apexClasses.length} class entries).`,
      result: deployed.job_id,
    });
    // Wait briefly for the new PS to become queryable. Salesforce metadata
    // deploys are eventually consistent for SOQL; ~1s is usually enough.
    await new Promise((r) => setTimeout(r, 1000));
    const psRow = await findPermissionSetByName(conn, synthesized.developer_name);
    if (!psRow) {
      steps.push({
        id: "assign_custom_ps",
        action: "failed",
        detail:
          `Deployed PS '${synthesized.developer_name}' but couldn't find it in SOQL ` +
          `to assign. Re-run provision; the platform may still be propagating the ` +
          `deploy.`,
        error: "post_deploy_query_failed",
      });
      return finalize(steps, before, dryRun, synthesized.xml);
    }
    const assigned = await assignPermissionSet(conn, {
      user_id: userId,
      permission_set_id: psRow.Id,
    });
    if (!assigned.ok) {
      steps.push({
        id: "assign_custom_ps",
        action: "failed",
        detail: `Failed to assign custom PS: ${assigned.error}`,
        error: assigned.error,
      });
      return finalize(steps, before, dryRun, synthesized.xml);
    }
    steps.push({
      id: "assign_custom_ps",
      action: assigned.already_assigned ? "skipped" : "executed",
      detail: assigned.already_assigned
        ? `Custom PS '${synthesized.developer_name}' was already assigned (idempotent).`
        : `Assigned custom PS '${synthesized.developer_name}' to user.`,
      result: assigned.assignment_id,
    });
  }

  return finalize(steps, before, dryRun, synthesized.xml);
}

/**
 * Used in the dry-run branch when we can't query state past create_user.
 * Emits "would_execute" placeholder steps so the LLM sees the full plan.
 */
function addRemainingDryRunSteps(
  steps: ProvisionStep[],
  before: DiagnoseReport,
  input: RunProvisionInput,
  _dryRun: boolean,
): ProvisionStep[] {
  steps.push({
    id: "assign_system_ps",
    action: "would_execute",
    detail: `Would insert PermissionSetAssignment for the new user against '${SYSTEM_AGENT_PS_NAME}'.`,
  });
  const apexClasses =
    input.apex_targets_override ??
    extractActionTargets(input.actions)
      .filter((t) => t.scheme === "apex")
      .map((t) => t.ref_name);
  if (apexClasses.length > 0) {
    steps.push({
      id: "deploy_custom_ps",
      action: "would_execute",
      detail: `Would deploy custom PS for ${apexClasses.length} apex class(es).`,
    });
    steps.push({
      id: "assign_custom_ps",
      action: "would_execute",
      detail: "Would assign the custom PS to the new user.",
    });
  } else {
    steps.push({
      id: "deploy_custom_ps",
      action: "skipped",
      detail: "No apex:// action targets in bundle.",
    });
    steps.push({
      id: "assign_custom_ps",
      action: "skipped",
      detail: "n/a — no custom PS deployed.",
    });
  }
  return steps;
}

function finalize(
  steps: ProvisionStep[],
  before: DiagnoseReport,
  dryRun: boolean,
  customPsXml?: string,
): ProvisionReport {
  const failures = steps.filter((s) => s.action === "failed");
  const ok = failures.length === 0;
  return {
    ok,
    was_dry_run: dryRun,
    agent_type: before.agent_type,
    before,
    steps,
    ...(customPsXml ? { preview_custom_ps_xml: customPsXml } : {}),
    ...(failures.length > 0
      ? {
          recover_via: undefined, // failure detail explains the next step inline
        }
      : {}),
  };
}
