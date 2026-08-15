/* SPDX-License-Identifier: Apache-2.0 */
/** Destructive-operation authority and confirmation gates for facade-backed execution. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { SfEnvironment } from "../../../../lib/common/sf-environment/types.ts";
import type { D360Operation } from "./registry.ts";

const DESTRUCTIVE_ALLOWED_TARGET_ORG = "AgentforceSTDM";

export interface OwnedV2SweepCleanup {
  runId: string;
  mutationTargetOrg?: string;
  destructiveTargetOrg?: string;
}

interface DestructiveExecutionGuardInput {
  operation: Pick<D360Operation, "name" | "safety">;
  targetOrg: string;
  env: SfEnvironment;
  targetOrgInfo?: Partial<SfEnvironment["org"]>;
  targetResolved?: boolean;
  hasUI: boolean;
  executionSurface?: "v2";
  params?: Record<string, unknown>;
  ownedSweepCleanup?: OwnedV2SweepCleanup;
}

export function shouldBlockConfirmedOperation(
  input: { dry_run?: boolean; allow_confirmed?: boolean },
  operation: Pick<D360Operation, "safety">,
): boolean {
  if (operation.safety === "read" || operation.safety === "safe_post") return false;
  if (input.dry_run) return false;
  return input.allow_confirmed !== true;
}

export function evaluateDestructiveExecutionGuard(input: DestructiveExecutionGuardInput): {
  blocked: boolean;
  summary?: string;
  error?: string;
} {
  if (input.operation.safety !== "destructive") return { blocked: false };

  if (input.executionSurface === "v2") {
    if (
      !isVerifiedV2MutationTarget(
        input.targetOrg,
        input.env,
        input.targetOrgInfo,
        input.targetResolved,
      )
    ) {
      return {
        blocked: true,
        summary: `${input.operation.name} requires a verified non-production org`,
        error:
          "Destructive Data 360 v2 operations are blocked for production, unresolved, or mismatched target orgs.",
      };
    }
    if (input.hasUI || isOwnedV2SweepCleanup(input)) return { blocked: false };
    return interactiveDestructiveBlock(input.operation.name);
  }

  if (!isAgentforceStdmTarget(input.targetOrg, input.env, input.targetOrgInfo)) {
    return {
      blocked: true,
      summary: `${input.operation.name} requires target_org=${DESTRUCTIVE_ALLOWED_TARGET_ORG}`,
      error:
        "Destructive Data 360 operations are only allowed against the AgentforceSTDM org. Re-run the dry-run and execution with target_org='AgentforceSTDM'.",
    };
  }

  if (!input.hasUI) return interactiveDestructiveBlock(input.operation.name);

  return { blocked: false };
}

export function isAgentforceStdmTarget(
  targetOrg: string,
  env: SfEnvironment,
  targetOrgInfo?: Partial<SfEnvironment["org"]>,
): boolean {
  return (
    targetOrg === DESTRUCTIVE_ALLOWED_TARGET_ORG ||
    targetOrgInfo?.alias === DESTRUCTIVE_ALLOWED_TARGET_ORG ||
    (targetMatchesEnvironmentForGuard(targetOrg, env) &&
      (env.config.targetOrg === DESTRUCTIVE_ALLOWED_TARGET_ORG ||
        env.org.alias === DESTRUCTIVE_ALLOWED_TARGET_ORG))
  );
}

export async function enforceOperationSafety(
  ctx: ExtensionContext,
  operation: D360Operation,
): Promise<void> {
  if (operation.safety === "read" || operation.safety === "safe_post") return;
  if (!ctx.hasUI) return;
  const choice = await ctx.ui.select(
    `Confirm Data 360 ${operation.safety} operation\n\n${operation.name}`,
    ["Allow once", "Block"],
    { timeout: 30_000, signal: ctx.signal },
  );
  if (choice !== "Allow once") throw new Error("Blocked by user via d360 facade confirmation.");
}

function isVerifiedV2MutationTarget(
  targetOrg: string,
  env: SfEnvironment,
  targetOrgInfo?: Partial<SfEnvironment["org"]>,
  targetResolved = false,
): boolean {
  const targetMatchesResolvedOrg =
    targetOrg === targetOrgInfo?.alias || targetOrg === targetOrgInfo?.username;
  const targetMatchesDetectedOrg = targetMatchesEnvironmentForGuard(targetOrg, env);
  const orgType =
    targetOrgInfo?.orgType ?? (targetMatchesDetectedOrg ? env.org.orgType : "unknown");
  return (
    (targetResolved || targetMatchesResolvedOrg || targetMatchesDetectedOrg) &&
    ["sandbox", "scratch", "developer", "trial"].includes(orgType)
  );
}

function isOwnedV2SweepCleanup(input: DestructiveExecutionGuardInput): boolean {
  const cleanup = input.ownedSweepCleanup;
  if (!cleanup || !/^[A-Za-z0-9]{8,32}$/.test(cleanup.runId)) return false;
  if (
    cleanup.mutationTargetOrg !== input.targetOrg ||
    cleanup.destructiveTargetOrg !== input.targetOrg
  ) {
    return false;
  }
  return (
    input.operation.name === "d360_dlo_delete" &&
    input.params?.dloName === `PiV2SweepDlo_${cleanup.runId}__dll`
  );
}

function targetMatchesEnvironmentForGuard(targetOrg: string, env: SfEnvironment): boolean {
  return (
    targetOrg === env.config.targetOrg ||
    targetOrg === env.org.alias ||
    targetOrg === env.org.username
  );
}

function interactiveDestructiveBlock(operationName: string): {
  blocked: true;
  summary: string;
  error: string;
} {
  return {
    blocked: true,
    summary: `${operationName} requires interactive confirmation`,
    error:
      "Destructive Data 360 operations require Pi UI human-in-the-loop confirmation and are blocked in headless execution unless an exact sweep-owned cleanup gate applies.",
  };
}
