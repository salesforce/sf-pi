/* SPDX-License-Identifier: Apache-2.0 */
/** Destructive-operation authority gates for the single sf_data360 surface. */
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import type { D360Operation } from "./operation-registry.ts";

export interface OwnedData360SweepCleanup {
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
  params?: Record<string, unknown>;
  ownedSweepCleanup?: OwnedData360SweepCleanup;
}

export function shouldBlockMutation(
  input: { dry_run?: boolean; allow_mutation?: boolean },
  operation: Pick<D360Operation, "safety">,
): boolean {
  if (operation.safety === "read" || operation.safety === "safe_post") return false;
  if (input.dry_run) return false;
  return input.allow_mutation !== true;
}

export function evaluateDestructiveExecutionGuard(input: DestructiveExecutionGuardInput): {
  blocked: boolean;
  summary?: string;
  error?: string;
} {
  if (input.operation.safety !== "destructive") return { blocked: false };
  if (!isVerifiedMutationTarget(input)) {
    return {
      blocked: true,
      summary: `${input.operation.name} requires a verified non-production org`,
      error:
        "Destructive Data 360 operations are blocked for production, unresolved, or mismatched target orgs.",
    };
  }
  if (input.hasUI || isOwnedSweepCleanup(input)) return { blocked: false };
  return {
    blocked: true,
    summary: `${input.operation.name} requires interactive confirmation`,
    error:
      "Destructive Data 360 operations require Pi UI human confirmation and are blocked in headless execution unless an exact sweep-owned cleanup gate applies.",
  };
}

function isVerifiedMutationTarget(input: DestructiveExecutionGuardInput): boolean {
  const targetMatchesResolvedOrg =
    input.targetOrg === input.targetOrgInfo?.alias ||
    input.targetOrg === input.targetOrgInfo?.username;
  const targetMatchesDetectedOrg =
    input.targetOrg === input.env.config.targetOrg ||
    input.targetOrg === input.env.org.alias ||
    input.targetOrg === input.env.org.username;
  const orgType =
    input.targetOrgInfo?.orgType ?? (targetMatchesDetectedOrg ? input.env.org.orgType : "unknown");
  return (
    (input.targetResolved || targetMatchesResolvedOrg || targetMatchesDetectedOrg) &&
    ["sandbox", "scratch", "developer", "trial"].includes(orgType)
  );
}

function isOwnedSweepCleanup(input: DestructiveExecutionGuardInput): boolean {
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
    input.params?.dloName === `PiData360SweepDlo_${cleanup.runId}__dll`
  );
}
