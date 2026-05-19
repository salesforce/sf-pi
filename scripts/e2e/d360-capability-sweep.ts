/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Repeatable facade-first Data 360 capability sweep.
 *
 * Phase 1: contract/dry-run request resolution for the capability registry.
 * Phase 2: bounded live checks for read and safe POST capabilities where the
 * required params can be supplied without mutating org state.
 *
 *   node --experimental-strip-types scripts/e2e/d360-capability-sweep.ts AgentforceSTDM
 *   node --experimental-strip-types scripts/e2e/d360-capability-sweep.ts --target-org AgentforceSTDM --family Query
 */

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { detectEnvironment } from "../../lib/common/sf-environment/detect.ts";
import type { SfEnvironment } from "../../lib/common/sf-environment/types.ts";
import { runFacade, type D360FacadeInput } from "../../extensions/sf-data360/lib/facade-tool.ts";
import {
  getD360Capabilities,
  getD360Examples,
  type D360Capability,
  type D360OperationSafety,
} from "../../extensions/sf-data360/lib/facade/registry.ts";

export type SweepStage = "contract" | "dry_run" | "live" | "live_skip" | "mutate";

export type SweepOutcome =
  | "contract_ok"
  | "dry_run_ok"
  | "reachable"
  | "empty"
  | "feature_gated"
  | "not_found_optional"
  | "dependency_missing"
  | "skipped_needs_payload"
  | "mutation_ok"
  | "failed";

export type MutationLifecycleName =
  | "activation"
  | "activation-target"
  | "calculated-insight"
  | "dmo"
  | "dlo"
  | "mapping"
  | "retriever"
  | "search-index"
  | "segment"
  | "sdm"
  | "sdm-data-object"
  | "sdm-calculated-fields"
  | "sdm-metric"
  | "sdm-relationship"
  | "transform"
  | "data-action";

export interface SweepPlanOptions {
  targetOrg: string;
  live?: boolean;
  families?: string[];
  capabilities?: string[];
  maxLive?: number;
}

export type SweepPresetName = "agentforce-stdm-mutate" | "agentforce-stdm-safe";

export interface SweepThresholdOptions {
  minReachable?: number;
  minMutationOk?: number;
  maxSkipped?: number;
  requiredOutcomes?: Record<string, SweepOutcome>;
}

export interface DiscoveredCleanupResource {
  family: string;
  name: string;
}

export interface FamilySummaryRow extends Record<
  SweepOutcome | "family" | "total",
  string | number
> {
  family: string;
  total: number;
}

export interface SweepCheck {
  stage: SweepStage;
  capability: string;
  family?: string;
  kind?: string;
  safety?: D360OperationSafety;
  params?: Record<string, unknown>;
  skipReason?: string;
  sourceCapability?: string;
}

export interface SweepRecord extends SweepCheck {
  outcome: SweepOutcome;
  fail: boolean;
  summary: string;
  status?: number;
  error?: string;
  durationMs?: number;
}

interface CliOptions extends SweepPlanOptions, SweepThresholdOptions {
  outputDir?: string;
  timeoutMs?: number;
  dryRunOnly?: boolean;
  mutate?: boolean;
  runId?: string;
  lifecycles?: MutationLifecycleName[];
  cleanupRunId?: string;
  cleanupStale?: boolean;
  onlyLifecycle?: boolean;
  preset?: SweepPresetName;
}

interface MutationGateOptions {
  mutate?: boolean;
  targetOrg: string;
  runId: string;
  destructiveEnvValue?: string;
}

interface DmoLifecyclePlan {
  resourceName: string;
  dmoName?: string;
  dloName?: string;
  modelApiNameOrId?: string;
  secondaryDloName?: string;
  transformName?: string;
  dataActionTargetName?: string;
  dataActionName?: string;
  steps: SweepCheck[];
}

export function buildCapabilitySweepPlan(
  capabilities: D360Capability[],
  options: SweepPlanOptions,
): SweepCheck[] {
  const selected = capabilities.filter((capability) => matchesFilters(capability, options));
  const checks: SweepCheck[] = [];
  let liveCount = 0;

  for (const capability of selected) {
    if (capability.kind === "runbook") {
      checks.push(baseCheck(capability, "contract"));
    } else {
      checks.push({ ...baseCheck(capability, "dry_run"), params: paramsForDryRun(capability) });
    }

    if (!options.live || !isLiveEligible(capability.safety)) continue;
    const params = paramsForLiveCheck(capability);
    if (!params) {
      if (!isDynamicDetailCapability(capability.name)) {
        checks.push({
          ...baseCheck(capability, "live_skip"),
          skipReason: "No public-safe live params are available yet.",
        });
      }
      continue;
    }
    if (options.maxLive !== undefined && liveCount >= options.maxLive) {
      checks.push({
        ...baseCheck(capability, "live_skip"),
        skipReason: `Skipped after --max-live ${options.maxLive}.`,
      });
      continue;
    }
    checks.push({ ...baseCheck(capability, "live"), params });
    liveCount++;
  }

  return checks;
}

export function canRunMutationLifecycle(
  options: MutationGateOptions,
): { ok: true } | { ok: false; reason: string } {
  if (!options.mutate) return { ok: false, reason: "Pass --mutate to run lifecycle checks." };
  if (options.targetOrg !== SWEEP_MUTATION_TARGET_ORG) {
    return {
      ok: false,
      reason: `Mutation lifecycle requires --target-org ${SWEEP_MUTATION_TARGET_ORG}.`,
    };
  }
  if (options.destructiveEnvValue !== options.targetOrg) {
    return {
      ok: false,
      reason: `Set D360_SWEEP_ALLOW_DESTRUCTIVE=${options.targetOrg} to run destructive cleanup.`,
    };
  }
  if (!/^[A-Za-z0-9]{8,32}$/.test(options.runId)) {
    return { ok: false, reason: "Mutation lifecycle requires a stable alphanumeric run id." };
  }
  return { ok: true };
}

export function buildDloLifecyclePlan(runId: string): DmoLifecyclePlan {
  const resourceName = `PiSweepDlo_${runId}__dll`;
  const dloName = resourceName;
  return {
    resourceName,
    dloName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_dlo_create",
        family: "DLO",
        safety: "confirmed",
        params: { body: buildDloCreateBody(resourceName, runId) },
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName },
        sourceCapability: "dlo_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dlo_update",
        family: "DLO",
        safety: "confirmed",
        params: {
          dloName,
          body: {
            label: `Pi Sweep DLO ${runId} Updated`,
          },
        },
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName },
        sourceCapability: "dlo_update_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dlo_delete",
        family: "DLO",
        safety: "destructive",
        params: { dloName },
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName },
        sourceCapability: "dlo_delete_verify",
      },
    ],
  };
}

export function buildSemanticModelLifecyclePlan(runId: string): DmoLifecyclePlan {
  const resourceName = `PiSweepSdm_${runId}`;
  return {
    resourceName,
    modelApiNameOrId: resourceName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_sdm_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: { body: buildSemanticModelCreateBody(resourceName, runId) },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_create_verify",
      },
      {
        stage: "live",
        capability: "d360_sdm_validate",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_validate",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_delete",
        family: "Semantic Retrieval",
        safety: "destructive",
        params: { modelApiNameOrId: resourceName },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_delete_verify",
      },
    ],
  };
}

export function buildSearchIndexReadinessPlan(_runId = "readiness"): DmoLifecyclePlan {
  return {
    resourceName: "PiSweepSearchIndexReadiness",
    steps: [
      {
        stage: "live",
        capability: "d360_model_artifact_list",
        family: "Semantic Retrieval",
        safety: "read",
        params: { limit: 200 },
        sourceCapability: "search_index_model_artifact_readiness",
      },
      {
        stage: "live",
        capability: "d360_search_index_config",
        family: "Semantic Retrieval",
        safety: "read",
        params: {},
        sourceCapability: "search_index_config_readiness",
      },
      {
        stage: "live",
        capability: "d360_search_index_list",
        family: "Semantic Retrieval",
        safety: "read",
        params: { limit: 10 },
        sourceCapability: "search_index_list_readiness",
      },
    ],
  };
}

export function buildRetrieverReadinessPlan(_runId = "readiness"): DmoLifecyclePlan {
  return {
    resourceName: "PiSweepRetrieverReadiness",
    steps: [
      {
        stage: "live",
        capability: "d360_retriever_list",
        family: "Semantic Retrieval",
        safety: "read",
        params: { limit: 10 },
        sourceCapability: "retriever_list_readiness",
      },
    ],
  };
}

export function buildActivationLifecyclePlan(runId: string): DmoLifecyclePlan {
  const activationName = `PiSweepActivation_${runId}`;
  const activationTargetName = `PiSweepActTarget_${runId}`;
  const segmentApiName = `PiSweepActSegment_${runId}`;
  return {
    resourceName: activationName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_activation_target_create",
        family: "Activation",
        safety: "confirmed",
        params: { body: buildActivationTargetCreateBody(activationTargetName) },
      },
      {
        stage: "live",
        capability: "d360_activation_target_list",
        family: "Activation",
        safety: "read",
        params: { limit: 10 },
        sourceCapability: "activation_target_for_activation_verify",
      },
      {
        stage: "mutate",
        capability: "d360_segment_create",
        family: "Segment",
        safety: "confirmed",
        params: { body: buildSegmentCreateBody(segmentApiName, runId) },
      },
      {
        stage: "live",
        capability: "d360_segment_get",
        family: "Segment",
        safety: "read",
        params: { segmentId: segmentApiName },
        sourceCapability: "activation_segment_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_activation_create",
        family: "Activation",
        safety: "confirmed",
        params: {
          body: buildActivationCreateBody(activationName, activationTargetName, segmentApiName),
        },
      },
      {
        stage: "mutate",
        capability: "d360_segment_delete",
        family: "Segment",
        safety: "destructive",
        params: { segmentApiName },
        sourceCapability: "activation_cleanup_segment",
      },
      {
        stage: "live",
        capability: "d360_segment_get",
        family: "Segment",
        safety: "read",
        params: { segmentId: segmentApiName },
        sourceCapability: "activation_segment_delete_verify",
      },
    ],
  };
}

export function buildActivationTargetLifecyclePlan(runId: string): DmoLifecyclePlan {
  const activationTargetName = `PiSweepActTarget_${runId}`;
  return {
    resourceName: activationTargetName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_activation_target_create",
        family: "Activation",
        safety: "confirmed",
        params: { body: buildActivationTargetCreateBody(activationTargetName) },
      },
      {
        stage: "live",
        capability: "d360_activation_target_list",
        family: "Activation",
        safety: "read",
        params: { limit: 10 },
        sourceCapability: "activation_target_create_verify",
      },
    ],
  };
}

export function buildSegmentLifecyclePlan(runId: string): DmoLifecyclePlan {
  const segmentApiName = `PiSweepSegment_${runId}`;
  return {
    resourceName: segmentApiName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_segment_create",
        family: "Segment",
        safety: "confirmed",
        params: { body: buildSegmentCreateBody(segmentApiName, runId) },
      },
      {
        stage: "live",
        capability: "d360_segment_get",
        family: "Segment",
        safety: "read",
        params: { segmentId: segmentApiName },
        sourceCapability: "segment_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_segment_delete",
        family: "Segment",
        safety: "destructive",
        params: { segmentApiName },
      },
      {
        stage: "live",
        capability: "d360_segment_get",
        family: "Segment",
        safety: "read",
        params: { segmentId: segmentApiName },
        sourceCapability: "segment_delete_verify",
      },
    ],
  };
}

export function buildCalculatedInsightLifecyclePlan(runId: string): DmoLifecyclePlan {
  const ciName = `PiSweepCi_${runId}__cio`;
  return {
    resourceName: ciName,
    steps: [
      {
        stage: "live",
        capability: "d360_ci_validate",
        family: "Calculated Insights",
        safety: "safe_post",
        params: { body: buildCalculatedInsightValidateBody(runId) },
        sourceCapability: "ci_validate_before_create",
      },
      {
        stage: "mutate",
        capability: "d360_ci_create",
        family: "Calculated Insights",
        safety: "confirmed",
        params: { body: buildCalculatedInsightCreateBody(runId) },
      },
      {
        stage: "live",
        capability: "d360_ci_get",
        family: "Calculated Insights",
        safety: "read",
        params: { ciName },
        sourceCapability: "ci_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_ci_run",
        family: "Calculated Insights",
        safety: "confirmed",
        params: { ciName },
      },
      {
        stage: "mutate",
        capability: "d360_ci_delete",
        family: "Calculated Insights",
        safety: "destructive",
        params: { ciName },
      },
      {
        stage: "live",
        capability: "d360_ci_get",
        family: "Calculated Insights",
        safety: "read",
        params: { ciName },
        sourceCapability: "ci_delete_verify",
      },
    ],
  };
}

export function buildDataActionLifecyclePlan(runId: string): DmoLifecyclePlan {
  const dataActionTargetName = `PiSweepTarget_${runId}`;
  const dataActionName = `PiSweepAction_${runId}`;
  return {
    resourceName: `PiSweepDataAction_${runId}`,
    dataActionTargetName,
    dataActionName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_dataaction_target_create",
        family: "DataAction",
        safety: "confirmed",
        params: { body: buildDataActionTargetCreateBody(dataActionTargetName, runId) },
      },
      {
        stage: "live",
        capability: "d360_dataaction_target_get",
        family: "DataAction",
        safety: "read",
        params: { dataActionTargetId: dataActionTargetName },
        sourceCapability: "dataaction_target_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dataaction_create",
        family: "DataAction",
        safety: "confirmed",
        params: { body: buildDataActionCreateBody(dataActionName, dataActionTargetName, runId) },
      },
      {
        stage: "live",
        capability: "d360_dataaction_get",
        family: "DataAction",
        safety: "read",
        params: { dataActionId: dataActionName },
        sourceCapability: "dataaction_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dataaction_delete",
        family: "DataAction",
        safety: "destructive",
        params: { dataActionId: dataActionName },
      },
      {
        stage: "live",
        capability: "d360_dataaction_get",
        family: "DataAction",
        safety: "read",
        params: { dataActionId: dataActionName },
        sourceCapability: "dataaction_delete_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dataaction_target_delete",
        family: "DataAction",
        safety: "destructive",
        params: { dataActionTargetId: dataActionTargetName },
      },
      {
        stage: "live",
        capability: "d360_dataaction_target_get",
        family: "DataAction",
        safety: "read",
        params: { dataActionTargetId: dataActionTargetName },
        sourceCapability: "dataaction_target_delete_verify",
      },
    ],
  };
}

export function buildTransformLifecyclePlan(runId: string): DmoLifecyclePlan {
  const resourceName = `PiSwTx_${runId}`;
  const sourceDloName = "AIRetrieverRequest__dll";
  const targetDloName = `PiSwTxTgt_${runId}__dll`;
  const body = buildTransformBody(resourceName, sourceDloName, targetDloName, runId);
  const updateBody = { ...body, label: `Pi Sweep Transform ${runId} Updated` };
  return {
    resourceName,
    dloName: targetDloName,
    secondaryDloName: sourceDloName,
    transformName: resourceName,
    steps: [
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName: sourceDloName },
        sourceCapability: "transform_source_dlo_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dlo_create",
        family: "DLO",
        safety: "confirmed",
        params: {
          body: {
            name: targetDloName,
            label: `Pi Tx Target ${runId}`,
            category: "Other",
            dataspaceInfo: [{ name: "default" }],
            dataLakeFieldInputRepresentations: [
              { name: "Id__c", label: "Id", dataType: "Text", isPrimaryKey: true },
            ],
          },
        },
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName: targetDloName },
        sourceCapability: "transform_target_dlo_create_verify",
      },
      {
        stage: "live",
        capability: "d360_transform_validate",
        family: "DataTransform",
        safety: "safe_post",
        params: { body },
        sourceCapability: "transform_validate_before_create",
      },
      {
        stage: "mutate",
        capability: "d360_transform_create",
        family: "DataTransform",
        safety: "confirmed",
        params: { body },
      },
      {
        stage: "live",
        capability: "d360_transform_get",
        family: "DataTransform",
        safety: "read",
        params: { transformId: resourceName },
        sourceCapability: "transform_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_transform_update",
        family: "DataTransform",
        safety: "confirmed",
        params: { transformId: resourceName, body: updateBody },
      },
      {
        stage: "live",
        capability: "d360_transform_get",
        family: "DataTransform",
        safety: "read",
        params: { transformId: resourceName },
        sourceCapability: "transform_update_verify",
      },
      {
        stage: "mutate",
        capability: "d360_transform_schedule_set",
        family: "DataTransform",
        safety: "confirmed",
        params: {
          transformId: resourceName,
          body: {
            frequency: "None",
            time: { hour: 3, minute: 0, timeZone: "America/Los_Angeles" },
          },
        },
      },
      {
        stage: "live",
        capability: "d360_transform_schedule_get",
        family: "DataTransform",
        safety: "read",
        params: { transformId: resourceName },
        sourceCapability: "transform_schedule_verify",
      },
      {
        stage: "mutate",
        capability: "d360_transform_delete",
        family: "DataTransform",
        safety: "destructive",
        params: { transformId: resourceName },
      },
      {
        stage: "live",
        capability: "d360_transform_get",
        family: "DataTransform",
        safety: "read",
        params: { transformId: resourceName },
        sourceCapability: "transform_delete_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dlo_delete",
        family: "DLO",
        safety: "destructive",
        params: { dloName: targetDloName },
        sourceCapability: "transform_cleanup_target_dlo",
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName: targetDloName },
        sourceCapability: "transform_target_dlo_delete_verify",
      },
    ],
  };
}

export function buildSemanticRelationshipLifecyclePlan(runId: string): DmoLifecyclePlan {
  const resourceName = `PiSweepSdmRel_${runId}`;
  const leftDloName = `PiSwRelL_${runId}__dll`;
  const rightDloName = `PiSwRelR_${runId}__dll`;
  const leftDataObjectApiName = `PiSweepRelLeftObject_${runId}`;
  const rightDataObjectApiName = `PiSweepRelRightObject_${runId}`;
  return {
    resourceName,
    dloName: leftDloName,
    secondaryDloName: rightDloName,
    modelApiNameOrId: resourceName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_dlo_create",
        family: "DLO",
        safety: "confirmed",
        params: { body: buildDloCreateBody(leftDloName, runId, "Pi Rel Left") },
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName: leftDloName },
        sourceCapability: "sdm_relationship_left_dlo_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dlo_create",
        family: "DLO",
        safety: "confirmed",
        params: {
          body: buildDloCreateBody(rightDloName, runId, "Pi Rel Right"),
        },
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName: rightDloName },
        sourceCapability: "sdm_relationship_right_dlo_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: { body: buildSemanticModelCreateBody(resourceName, runId) },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_relationship_model_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_data_object_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: {
          modelApiNameOrId: resourceName,
          body: buildRelationshipSemanticDataObjectCreateBody(
            leftDataObjectApiName,
            leftDloName,
            runId,
            "Left",
          ),
        },
      },
      {
        stage: "mutate",
        capability: "d360_sdm_data_object_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: {
          modelApiNameOrId: resourceName,
          body: buildRelationshipSemanticDataObjectCreateBody(
            rightDataObjectApiName,
            rightDloName,
            runId,
            "Right",
          ),
        },
      },
      {
        stage: "mutate",
        capability: "d360_sdm_relationship_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: {
          modelApiNameOrId: resourceName,
          body: buildSemanticRelationshipCreateBody(
            leftDataObjectApiName,
            rightDataObjectApiName,
            runId,
          ),
        },
      },
      {
        stage: "live",
        capability: "d360_sdm_relationships_list",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_relationship_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_relationship_delete",
        family: "Semantic Retrieval",
        safety: "destructive",
        params: { modelApiNameOrId: resourceName, relationshipId: `PiSweepRelationship_${runId}` },
      },
      {
        stage: "live",
        capability: "d360_sdm_relationship_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName, relationshipId: `PiSweepRelationship_${runId}` },
        sourceCapability: "sdm_relationship_delete_verify",
      },
      {
        stage: "live",
        capability: "d360_sdm_validate",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_relationship_validate",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_delete",
        family: "Semantic Retrieval",
        safety: "destructive",
        params: { modelApiNameOrId: resourceName },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_relationship_model_delete_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dlo_delete",
        family: "DLO",
        safety: "destructive",
        params: { dloName: leftDloName },
        sourceCapability: "sdm_relationship_cleanup_left_dlo",
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName: leftDloName },
        sourceCapability: "sdm_relationship_left_dlo_delete_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dlo_delete",
        family: "DLO",
        safety: "destructive",
        params: { dloName: rightDloName },
        sourceCapability: "sdm_relationship_cleanup_right_dlo",
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName: rightDloName },
        sourceCapability: "sdm_relationship_right_dlo_delete_verify",
      },
    ],
  };
}

export function buildSemanticMetricLifecyclePlan(runId: string): DmoLifecyclePlan {
  const resourceName = `PiSweepSdmMetric_${runId}`;
  const dloName = `PiSweepMetricDlo_${runId}__dll`;
  const dataObjectApiName = `PiSweepMetricDataObject_${runId}`;
  const metricApiName = `PiSweepMetric_${runId}`;
  return {
    resourceName,
    dloName,
    modelApiNameOrId: resourceName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_dlo_create",
        family: "DLO",
        safety: "confirmed",
        params: { body: buildMetricDloCreateBody(dloName, runId) },
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName },
        sourceCapability: "sdm_metric_dlo_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: { body: buildSemanticModelCreateBody(resourceName, runId) },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_metric_model_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_data_object_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: {
          modelApiNameOrId: resourceName,
          body: buildMetricSemanticDataObjectCreateBody(dataObjectApiName, dloName, runId),
        },
      },
      {
        stage: "live",
        capability: "d360_sdm_data_objects_list",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_metric_data_object_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_metric_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: {
          modelApiNameOrId: resourceName,
          body: buildSemanticMetricCreateBody(metricApiName, dataObjectApiName, runId),
        },
      },
      {
        stage: "live",
        capability: "d360_sdm_metrics_list",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_metric_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_metric_delete",
        family: "Semantic Retrieval",
        safety: "destructive",
        params: { modelApiNameOrId: resourceName, metricNameOrId: metricApiName },
      },
      {
        stage: "live",
        capability: "d360_sdm_metric_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName, metricNameOrId: metricApiName },
        sourceCapability: "sdm_metric_delete_verify",
      },
      {
        stage: "live",
        capability: "d360_sdm_validate",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_metric_validate",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_delete",
        family: "Semantic Retrieval",
        safety: "destructive",
        params: { modelApiNameOrId: resourceName },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_metric_model_delete_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dlo_delete",
        family: "DLO",
        safety: "destructive",
        params: { dloName },
        sourceCapability: "sdm_metric_cleanup_dlo",
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName },
        sourceCapability: "sdm_metric_dlo_delete_verify",
      },
    ],
  };
}

export function buildSemanticCalculatedFieldsLifecyclePlan(runId: string): DmoLifecyclePlan {
  const resourceName = `PiSweepSdmCalc_${runId}`;
  return {
    resourceName,
    modelApiNameOrId: resourceName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_sdm_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: { body: buildSemanticModelCreateBody(resourceName, runId) },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_calculated_fields_model_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_calc_measure_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: { modelApiNameOrId: resourceName, body: buildCalcMeasurementCreateBody(runId) },
      },
      {
        stage: "live",
        capability: "d360_sdm_calc_measures_list",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_calc_measure_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_calc_dim_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: { modelApiNameOrId: resourceName, body: buildCalcDimensionCreateBody(runId) },
      },
      {
        stage: "live",
        capability: "d360_sdm_calc_dims_list",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_calc_dim_create_verify",
      },
      {
        stage: "live",
        capability: "d360_sdm_validate",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_calculated_fields_validate",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_delete",
        family: "Semantic Retrieval",
        safety: "destructive",
        params: { modelApiNameOrId: resourceName },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_calculated_fields_delete_verify",
      },
    ],
  };
}

export function buildSemanticDataObjectLifecyclePlan(runId: string): DmoLifecyclePlan {
  const resourceName = `PiSweepSdmDo_${runId}`;
  const dmoResourceName = `PiSweepSdmDmo_${runId}`;
  const dmoName = `${dmoResourceName}__dlm`;
  const dataObjectApiName = `PiSweepSdmDataObject_${runId}`;
  return {
    resourceName,
    dmoName,
    modelApiNameOrId: resourceName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_dmo_create",
        family: "DMO",
        safety: "confirmed",
        params: { body: buildDmoCreateBody(dmoResourceName, runId, "Pi Sweep SDM DMO") },
      },
      {
        stage: "live",
        capability: "d360_dmo_get",
        family: "DMO",
        safety: "read",
        params: { dmoName },
        sourceCapability: "sdm_data_object_dmo_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: { body: buildSemanticModelCreateBody(resourceName, runId) },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_data_object_model_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_data_object_create",
        family: "Semantic Retrieval",
        safety: "confirmed",
        params: {
          modelApiNameOrId: resourceName,
          body: buildSemanticDataObjectCreateBody(dataObjectApiName, dmoName, runId),
        },
      },
      {
        stage: "live",
        capability: "d360_sdm_data_objects_list",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_data_object_create_verify",
      },
      {
        stage: "live",
        capability: "d360_sdm_validate",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_data_object_validate",
      },
      {
        stage: "mutate",
        capability: "d360_sdm_delete",
        family: "Semantic Retrieval",
        safety: "destructive",
        params: { modelApiNameOrId: resourceName },
      },
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: resourceName },
        sourceCapability: "sdm_data_object_model_delete_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dmo_delete",
        family: "DMO",
        safety: "destructive",
        params: { dmoName },
        sourceCapability: "sdm_data_object_cleanup_dmo",
      },
      {
        stage: "live",
        capability: "d360_dmo_get",
        family: "DMO",
        safety: "read",
        params: { dmoName },
        sourceCapability: "sdm_data_object_dmo_delete_verify",
      },
    ],
  };
}

export function buildMappingLifecyclePlan(runId: string): DmoLifecyclePlan {
  const resourceName = `PiSweepMapping_${runId}`;
  const dmoResourceName = `PiSweepMapDmo_${runId}`;
  const dmoName = `${dmoResourceName}__dlm`;
  const dloName = `PiSweepMapDlo_${runId}__dll`;
  return {
    resourceName,
    dmoName,
    dloName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_dlo_create",
        family: "DLO",
        safety: "confirmed",
        params: { body: buildDloCreateBody(dloName, runId, "Pi Sweep Mapping DLO") },
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName },
        sourceCapability: "mapping_dlo_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dmo_create",
        family: "DMO",
        safety: "confirmed",
        params: { body: buildDmoCreateBody(dmoResourceName, runId, "Pi Sweep Mapping DMO") },
      },
      {
        stage: "live",
        capability: "d360_dmo_get",
        family: "DMO",
        safety: "read",
        params: { dmoName },
        sourceCapability: "mapping_dmo_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dmo_mapping_create",
        family: "Mappings",
        safety: "confirmed",
        params: { body: buildMappingCreateBody(dloName, dmoName) },
      },
      {
        stage: "live",
        capability: "d360_dmo_mapping_list",
        family: "Mappings",
        safety: "read",
        params: { dmoDeveloperName: dmoName },
        sourceCapability: "mapping_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dmo_delete",
        family: "DMO",
        safety: "destructive",
        params: { dmoName },
        sourceCapability: "mapping_cleanup_dmo",
      },
      {
        stage: "live",
        capability: "d360_dmo_get",
        family: "DMO",
        safety: "read",
        params: { dmoName },
        sourceCapability: "mapping_dmo_delete_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dlo_delete",
        family: "DLO",
        safety: "destructive",
        params: { dloName },
        sourceCapability: "mapping_cleanup_dlo",
      },
      {
        stage: "live",
        capability: "d360_dlo_get",
        family: "DLO",
        safety: "read",
        params: { dloName },
        sourceCapability: "mapping_dlo_delete_verify",
      },
    ],
  };
}

export function applySweepPreset<T extends SweepThresholdOptions>(
  options: T,
  preset: SweepPresetName,
): T {
  if (preset === "agentforce-stdm-safe") {
    return {
      ...options,
      minReachable: options.minReachable ?? 20,
      maxSkipped: options.maxSkipped ?? 100,
    };
  }

  return {
    ...options,
    minMutationOk: options.minMutationOk ?? 30,
    maxSkipped: options.maxSkipped ?? 10,
    requiredOutcomes: {
      d360_sdm_relationship_create: "mutation_ok",
      d360_transform_update: "mutation_ok",
      d360_dataaction_create: "mutation_ok",
      ...(options.requiredOutcomes ?? {}),
    },
  };
}

export function buildDiscoveredCleanupLifecyclePlan(
  resources: DiscoveredCleanupResource[],
): DmoLifecyclePlan {
  const steps = resources.flatMap((resource): SweepCheck[] => {
    if (!isSweepOwnedResourceName(resource.name)) return [];
    switch (resource.family) {
      case "DMO":
        return [cleanupCheck("d360_dmo_delete", "DMO", { dmoName: resource.name }, "cleanup_dmo")];
      case "DLO":
        return [cleanupCheck("d360_dlo_delete", "DLO", { dloName: resource.name }, "cleanup_dlo")];
      case "Semantic Retrieval":
        return [
          cleanupCheck(
            "d360_sdm_delete",
            "Semantic Retrieval",
            { modelApiNameOrId: resource.name },
            "cleanup_sdm",
          ),
        ];
      case "DataTransform":
        return [
          cleanupCheck(
            "d360_transform_delete",
            "DataTransform",
            { transformId: resource.name },
            "cleanup_transform",
          ),
        ];
      case "DataAction":
        return [
          cleanupCheck(
            "d360_dataaction_delete",
            "DataAction",
            { dataActionId: resource.name },
            "cleanup_dataaction",
          ),
        ];
      case "DataActionTarget":
        return [
          cleanupCheck(
            "d360_dataaction_target_delete",
            "DataAction",
            { dataActionTargetId: resource.name },
            "cleanup_dataaction_target",
          ),
        ];
      default:
        return [];
    }
  });
  return { resourceName: "PiSweepDiscoveredCleanup", steps };
}

function cleanupCheck(
  capability: string,
  family: string,
  params: Record<string, unknown>,
  sourceCapability: string,
): SweepCheck {
  return { stage: "mutate", capability, family, safety: "destructive", params, sourceCapability };
}

function isSweepOwnedResourceName(name: string): boolean {
  return /^(PiSweep|PiSw|PiRel)/.test(name);
}

export function buildCleanupLifecyclePlan(runId: string): DmoLifecyclePlan {
  const dmoNames = [
    `PiSweepDmo_${runId}__dlm`,
    `PiSweepMapDmo_${runId}__dlm`,
    `PiSweepSdmDmo_${runId}__dlm`,
  ];
  const dloNames = [
    `PiSweepDlo_${runId}__dll`,
    `PiSweepMapDlo_${runId}__dll`,
    `PiSwRelL_${runId}__dll`,
    `PiSwRelR_${runId}__dll`,
    `PiSweepMetricDlo_${runId}__dll`,
    `PiSwTxTgt_${runId}__dll`,
  ];
  const modelNames = [
    `PiSweepSdm_${runId}`,
    `PiSweepSdmDo_${runId}`,
    `PiSweepSdmCalc_${runId}`,
    `PiSweepSdmMetric_${runId}`,
    `PiSweepSdmRel_${runId}`,
  ];
  const transformNames = [`PiSwTx_${runId}`];
  const dataActionNames = [`PiSweepAction_${runId}`];
  const calculatedInsightNames = [`PiSweepCi_${runId}__cio`];
  const segmentNames = [`PiSweepSegment_${runId}`, `PiSweepActSegment_${runId}`];
  const activationNames = [`PiSweepActivation_${runId}`];
  const dataActionTargetNames = [`PiSweepTarget_${runId}`];
  return {
    resourceName: `PiSweepCleanup_${runId}`,
    steps: [
      ...activationNames.map(
        (activationId): SweepCheck => ({
          stage: "mutate",
          capability: "d360_activation_delete",
          family: "Activation",
          safety: "destructive",
          params: { activationId },
          sourceCapability: "cleanup_activation",
        }),
      ),
      ...segmentNames.map(
        (segmentApiName): SweepCheck => ({
          stage: "mutate",
          capability: "d360_segment_delete",
          family: "Segment",
          safety: "destructive",
          params: { segmentApiName },
          sourceCapability: "cleanup_segment",
        }),
      ),
      ...calculatedInsightNames.map(
        (ciName): SweepCheck => ({
          stage: "mutate",
          capability: "d360_ci_delete",
          family: "Calculated Insights",
          safety: "destructive",
          params: { ciName },
          sourceCapability: "cleanup_ci",
        }),
      ),
      ...dataActionNames.map(
        (dataActionId): SweepCheck => ({
          stage: "mutate",
          capability: "d360_dataaction_delete",
          family: "DataAction",
          safety: "destructive",
          params: { dataActionId },
          sourceCapability: "cleanup_dataaction",
        }),
      ),
      ...dataActionTargetNames.map(
        (dataActionTargetId): SweepCheck => ({
          stage: "mutate",
          capability: "d360_dataaction_target_delete",
          family: "DataAction",
          safety: "destructive",
          params: { dataActionTargetId },
          sourceCapability: "cleanup_dataaction_target",
        }),
      ),
      ...transformNames.map(
        (transformId): SweepCheck => ({
          stage: "mutate",
          capability: "d360_transform_delete",
          family: "DataTransform",
          safety: "destructive",
          params: { transformId },
          sourceCapability: "cleanup_transform",
        }),
      ),
      ...modelNames.map(
        (modelApiNameOrId): SweepCheck => ({
          stage: "mutate",
          capability: "d360_sdm_delete",
          family: "Semantic Retrieval",
          safety: "destructive",
          params: { modelApiNameOrId },
          sourceCapability: "cleanup_sdm",
        }),
      ),
      ...dmoNames.map(
        (dmoName): SweepCheck => ({
          stage: "mutate",
          capability: "d360_dmo_delete",
          family: "DMO",
          safety: "destructive",
          params: { dmoName },
          sourceCapability: "cleanup_dmo",
        }),
      ),
      ...dloNames.map(
        (dloName): SweepCheck => ({
          stage: "mutate",
          capability: "d360_dlo_delete",
          family: "DLO",
          safety: "destructive",
          params: { dloName },
          sourceCapability: "cleanup_dlo",
        }),
      ),
    ],
  };
}

const lifecycleBuilders: Record<MutationLifecycleName, (runId: string) => DmoLifecyclePlan> = {
  activation: buildActivationLifecyclePlan,
  "activation-target": buildActivationTargetLifecyclePlan,
  "calculated-insight": buildCalculatedInsightLifecyclePlan,
  dmo: buildDmoLifecyclePlan,
  dlo: buildDloLifecyclePlan,
  mapping: buildMappingLifecyclePlan,
  retriever: buildRetrieverReadinessPlan,
  "search-index": buildSearchIndexReadinessPlan,
  segment: buildSegmentLifecyclePlan,
  sdm: buildSemanticModelLifecyclePlan,
  "sdm-data-object": buildSemanticDataObjectLifecyclePlan,
  "sdm-calculated-fields": buildSemanticCalculatedFieldsLifecyclePlan,
  "sdm-metric": buildSemanticMetricLifecyclePlan,
  "sdm-relationship": buildSemanticRelationshipLifecyclePlan,
  transform: buildTransformLifecyclePlan,
  "data-action": buildDataActionLifecyclePlan,
};

export function buildMutationLifecyclePlans(
  runId: string,
  lifecycles?: MutationLifecycleName[],
): DmoLifecyclePlan[] {
  const selected = lifecycles?.length
    ? lifecycles
    : (Object.keys(lifecycleBuilders) as MutationLifecycleName[]);
  return selected.map((name) => lifecycleBuilders[name](runId));
}

export function buildDmoLifecyclePlan(runId: string): DmoLifecyclePlan {
  const resourceName = `PiSweepDmo_${runId}`;
  const dmoName = `${resourceName}__dlm`;
  return {
    resourceName,
    dmoName,
    steps: [
      {
        stage: "mutate",
        capability: "d360_dmo_create",
        family: "DMO",
        safety: "confirmed",
        params: { body: buildDmoCreateBody(resourceName, runId) },
      },
      {
        stage: "live",
        capability: "d360_dmo_get",
        family: "DMO",
        safety: "read",
        params: { dmoName },
        sourceCapability: "dmo_create_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dmo_update",
        family: "DMO",
        safety: "confirmed",
        params: {
          dmoName,
          body: {
            label: `Pi Sweep DMO ${runId} Updated`,
            description: `Sweep-owned DMO updated by run ${runId}.`,
          },
        },
      },
      {
        stage: "live",
        capability: "d360_dmo_get",
        family: "DMO",
        safety: "read",
        params: { dmoName },
        sourceCapability: "dmo_update_verify",
      },
      {
        stage: "mutate",
        capability: "d360_dmo_delete",
        family: "DMO",
        safety: "destructive",
        params: { dmoName },
      },
      {
        stage: "live",
        capability: "d360_dmo_get",
        family: "DMO",
        safety: "read",
        params: { dmoName },
        sourceCapability: "dmo_delete_verify",
      },
    ],
  };
}

export function insertFollowUpChecks(
  plan: SweepCheck[],
  index: number,
  seenChecks: Set<string>,
  followUps: SweepCheck[],
): void {
  const newChecks: SweepCheck[] = [];
  for (const followUp of followUps) {
    const key = checkKey(followUp);
    if (!seenChecks.has(key)) {
      seenChecks.add(key);
      newChecks.push(followUp);
    }
  }
  if (newChecks.length) plan.splice(index + 1, 0, ...newChecks);
}

export function buildDynamicFollowUpChecks(
  sourceCheck: SweepCheck,
  result: Record<string, unknown>,
  capabilities: D360Capability[] = getD360Capabilities(),
): SweepCheck[] {
  if (result.ok === true && sourceCheck.capability === "d360_activation_create") {
    return buildActivationCreateFollowUps(sourceCheck, result);
  }
  if (result.ok === true && sourceCheck.capability === "d360_activation_target_create") {
    return buildActivationTargetCreateFollowUps(sourceCheck, result);
  }
  if (sourceCheck.stage !== "live" || result.ok !== true) return [];
  const followUps = dynamicFollowUps[sourceCheck.capability] ?? [];
  if (!followUps.length) return [];

  const row = firstObjectRow((result as { response?: unknown }).response);
  if (!row) return [];

  return followUps.flatMap((followUp) => {
    const capability = capabilities.find((entry) => entry.name === followUp.capability);
    if (!capability || !isLiveEligible(capability.safety)) return [];

    const params: Record<string, unknown> = { ...(followUp.constantParams ?? {}) };
    for (const inherited of followUp.inheritParams ?? []) {
      const value = sourceCheck.params?.[inherited];
      if (value !== undefined) params[inherited] = value;
    }
    for (const [paramName, candidates] of Object.entries(followUp.params)) {
      if (params[paramName] !== undefined) continue;
      const value = findValueByCandidateKey(row, candidates);
      if (value === undefined) return [];
      params[paramName] = value;
    }

    if (containsPlaceholderValue(params)) return [];
    return [
      {
        ...baseCheck(capability, "live"),
        params,
        sourceCapability: sourceCheck.capability,
      },
    ];
  });
}

function buildActivationCreateFollowUps(
  sourceCheck: SweepCheck,
  result: Record<string, unknown>,
): SweepCheck[] {
  const row = firstObjectRow(result.response);
  const activationId = row ? firstString(row, ["id", "developerName", "name"]) : undefined;
  if (!activationId) return [];
  return [
    {
      stage: "live",
      capability: "d360_activation_get",
      family: "Activation",
      safety: "read",
      params: { activationId },
      sourceCapability: `${sourceCheck.capability}_get`,
    },
    {
      stage: "mutate",
      capability: "d360_activation_delete",
      family: "Activation",
      safety: "destructive",
      params: { activationId },
      sourceCapability: `${sourceCheck.capability}_delete`,
    },
    {
      stage: "live",
      capability: "d360_activation_get",
      family: "Activation",
      safety: "read",
      params: { activationId },
      sourceCapability: "activation_delete_verify",
    },
  ];
}

function buildActivationTargetCreateFollowUps(
  sourceCheck: SweepCheck,
  result: Record<string, unknown>,
): SweepCheck[] {
  const row = firstObjectRow(result.response);
  const activationTargetId = row ? firstString(row, ["id"]) : undefined;
  const name = row ? firstString(row, ["name"]) : undefined;
  if (!activationTargetId || !name) return [];
  return [
    {
      stage: "live",
      capability: "d360_activation_target_get",
      family: "Activation",
      safety: "read",
      params: { activationTargetId },
      sourceCapability: `${sourceCheck.capability}_get`,
    },
    {
      stage: "mutate",
      capability: "d360_activation_target_update",
      family: "Activation",
      safety: "confirmed",
      params: {
        activationTargetId,
        body: {
          name,
          platformType: "DataCloud",
          dataSpaceName: "default",
          connector: {},
          description: `Sweep-owned activation target updated from ${name}.`,
        },
      },
      sourceCapability: `${sourceCheck.capability}_update`,
    },
    {
      stage: "live",
      capability: "d360_activation_target_get",
      family: "Activation",
      safety: "read",
      params: { activationTargetId },
      sourceCapability: `${sourceCheck.capability}_update_verify`,
    },
  ];
}

export function paramsForDryRun(capability: D360Capability): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const required of capability.requiredParams ?? capability.operation?.requiredParams ?? []) {
    params[required] = dryRunValue(required);
  }
  return params;
}

export function paramsForLiveCheck(
  capability: D360Capability,
): Record<string, unknown> | undefined {
  if (!isLiveEligible(capability.safety) || liveParamDenyList.has(capability.name))
    return undefined;

  const special = liveParamOverrides[capability.name];
  if (special) return special;

  const required = capability.requiredParams ?? capability.operation?.requiredParams ?? [];
  const example = exampleParams(capability.name);

  if (required.length === 0) {
    if (example && !containsPlaceholderValue(example)) return example;
    return { limit: 1 };
  }

  if (example && !containsPlaceholderValue(example)) return example;
  return undefined;
}

export function containsPlaceholderValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /(^|[^a-z0-9])(Example[A-Za-z0-9_]*|Placeholder|SomeDmo|SomeDlo|Replace|ReviewedReal|Dummy)([^a-z0-9]|$)/i.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some((entry) => containsPlaceholderValue(entry));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      containsPlaceholderValue(entry),
    );
  }
  return false;
}

export function shouldRetrySweepResult(
  result: Record<string, unknown>,
  check?: SweepCheck,
): boolean {
  if (check?.sourceCapability?.endsWith("_delete_verify") && result.ok === true) return true;
  if (check?.sourceCapability === "dataaction_target_create_verify" && result.ok === true) {
    const status = String((result.response as Record<string, unknown> | undefined)?.status ?? "");
    return status.toUpperCase() === "PROCESSING";
  }

  const message = [
    stringValue(result.summary),
    stringValue(result.error),
    JSON.stringify(result.response ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  return (
    message.includes("currently in processing or deleting") ||
    message.includes("currently: processing") ||
    message.includes("being processed") ||
    message.includes("mktdatatransform can only be updated") ||
    message.includes("try again later")
  );
}

export function classifySweepResult(
  check: Pick<SweepCheck, "stage" | "capability" | "skipReason" | "sourceCapability">,
  result: Record<string, unknown>,
): Pick<SweepRecord, "outcome" | "fail" | "summary" | "status" | "error"> {
  if (check.stage === "contract") {
    return { outcome: "contract_ok", fail: false, summary: "Runbook capability registered" };
  }
  if (check.stage === "live_skip") {
    return {
      outcome: "skipped_needs_payload",
      fail: false,
      summary: check.skipReason ?? "Skipped live execution",
    };
  }

  const ok = result.ok === true;
  const status = typeof result.status === "number" ? result.status : undefined;
  const summary = stringValue(result.summary) ?? `${check.capability} ${ok ? "ok" : "failed"}`;
  const error = stringValue(result.error) ?? extractError(result);

  if (
    ok &&
    check.capability === "d360_model_artifact_list" &&
    !hasEmbeddingModelArtifact(result.response)
  ) {
    return {
      outcome: "feature_gated",
      fail: false,
      summary: "No embedding-capable model artifact found for search index creation",
      status,
      error,
    };
  }

  if (ok && check.stage === "dry_run") {
    return { outcome: "dry_run_ok", fail: false, summary, status, error };
  }
  if (ok && check.stage === "mutate") {
    return { outcome: "mutation_ok", fail: false, summary, status, error };
  }
  if (ok) {
    return {
      outcome: looksEmpty(result.response) ? "empty" : "reachable",
      fail: false,
      summary,
      status,
      error,
    };
  }

  const message = [summary, error, JSON.stringify(result.response ?? "")].join(" ").toLowerCase();
  if (check.sourceCapability?.startsWith("cleanup_") && !result.ok) {
    return { outcome: "not_found_optional", fail: false, summary, status, error };
  }

  if (
    status === 404 ||
    message.includes("not_found") ||
    message.includes("does not exist") ||
    message.includes("no stdm interaction found") ||
    message.includes("no stdm session found") ||
    message.includes("id can not be null or empty") ||
    message.includes("activation not found") ||
    message.includes("semantic object not found") ||
    (message.includes("semantic definition") &&
      message.includes("doesn") &&
      message.includes("exist")) ||
    message.includes("semantic_entity_not_exist") ||
    (check.sourceCapability?.endsWith("_delete_verify") &&
      message.includes("provide a valid recordid"))
  ) {
    return { outcome: "not_found_optional", fail: false, summary, status, error };
  }
  if (
    status === 401 ||
    status === 403 ||
    message.includes("api_disabled_for_org") ||
    message.includes("not visible") ||
    message.includes("permission")
  ) {
    return { outcome: "feature_gated", fail: false, summary, status, error };
  }
  if (
    message.includes("can not deserialize: unexpected array") ||
    message.includes("method_not_allowed")
  ) {
    return { outcome: "skipped_needs_payload", fail: false, summary, status, error };
  }

  if (
    message.includes("requires") ||
    message.includes("dependency") ||
    message.includes("invalid input") ||
    message.includes("provide a valid recordid") ||
    message.includes("developer name is missing") ||
    message.includes("field ids should not be empty") ||
    message.includes("mktdatatransform can only be updated") ||
    message.includes("not enabled") ||
    message.includes("feature")
  ) {
    return { outcome: "dependency_missing", fail: false, summary, status, error };
  }

  return { outcome: "failed", fail: true, summary, status, error };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.targetOrg) {
    console.error(
      "Usage: node --experimental-strip-types scripts/e2e/d360-capability-sweep.ts --target-org <alias>",
    );
    process.exit(2);
  }

  if (options.preset) applySweepPreset(options, options.preset);

  const env = await loadEnvironment();
  const runId =
    options.runId ??
    new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14);
  const outputDir = path.resolve(
    options.outputDir ?? path.join(os.tmpdir(), "pi-d360-capability-sweeps", runId),
  );
  mkdirSync(outputDir, { recursive: true });

  const capabilities = getD360Capabilities();
  const plan =
    options.cleanupRunId || options.cleanupStale || options.onlyLifecycle
      ? []
      : buildCapabilitySweepPlan(capabilities, {
          ...options,
          live: !options.dryRunOnly,
        });
  const seenChecks = new Set(plan.map(checkKey));
  const ctx = createHeadlessContext();
  if (options.onlyLifecycle && !options.mutate && options.lifecycles?.length) {
    for (const lifecycle of buildMutationLifecyclePlans(runId, options.lifecycles)) {
      for (const check of lifecycle.steps) {
        const key = checkKey(check);
        if (!seenChecks.has(key)) {
          seenChecks.add(key);
          plan.push(check);
        }
      }
    }
  }

  if (options.mutate || options.cleanupRunId || options.cleanupStale) {
    const gate = canRunMutationLifecycle({
      mutate: true,
      targetOrg: options.targetOrg,
      runId: options.cleanupRunId ?? runId,
      destructiveEnvValue: process.env.D360_SWEEP_ALLOW_DESTRUCTIVE,
    });
    if (gate.ok !== true) throw new Error(gate.reason);
    const lifecycles = options.cleanupRunId
      ? [buildCleanupLifecyclePlan(options.cleanupRunId)]
      : options.cleanupStale
        ? [await discoverStaleCleanupLifecyclePlan(options.targetOrg, env, ctx)]
        : buildMutationLifecyclePlans(runId, options.lifecycles);
    for (const lifecycle of lifecycles) {
      for (const check of lifecycle.steps) {
        const key = checkKey(check);
        if (!seenChecks.has(key)) {
          seenChecks.add(key);
          plan.push(check);
        }
      }
    }
  }
  const mutationCtx = createSweepMutationContext();
  const records: SweepRecord[] = [];

  console.log(`D360 capability sweep`);
  console.log(`  target_org: ${options.targetOrg}`);
  console.log(`  initial checks: ${plan.length}`);
  console.log(`  output: ${outputDir}`);

  for (let index = 0; index < plan.length; index++) {
    const check = plan[index];
    const started = Date.now();
    let classified: Pick<SweepRecord, "outcome" | "fail" | "summary" | "status" | "error">;
    try {
      if (check.stage === "contract" || check.stage === "live_skip") {
        classified = classifySweepResult(check, {});
      } else {
        const input: D360FacadeInput = {
          action: "execute",
          capability: check.capability,
          target_org: options.targetOrg,
          params: check.params,
          dry_run: check.stage === "dry_run",
          allow_confirmed: check.stage === "mutate",
          timeout_ms: options.timeoutMs,
          output_mode: "summary",
        };
        const activeCtx = check.stage === "mutate" ? mutationCtx : ctx;
        const result = await runFacadeWithRetry(input, env, activeCtx, check);
        classified = classifySweepResult(check, result);
        insertFollowUpChecks(
          plan,
          index,
          seenChecks,
          buildDynamicFollowUpChecks(check, result, capabilities),
        );
      }
    } catch (err) {
      classified = classifySweepResult(check, {
        ok: false,
        summary: `${check.capability} threw`,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const record: SweepRecord = {
      ...check,
      ...classified,
      durationMs: Date.now() - started,
    };
    records.push(record);
    const marker = record.fail
      ? "✗"
      : record.outcome === "reachable" ||
          record.outcome === "dry_run_ok" ||
          record.outcome === "mutation_ok"
        ? "✓"
        : "•";
    console.log(`  ${marker} ${record.stage.padEnd(8)} ${record.capability} — ${record.outcome}`);
  }

  const summary = summarize(records);
  const familySummary = buildFamilySummary(records);
  const thresholdErrors = evaluateSweepThresholds(records, options);
  const result = {
    ok: summary.failed === 0 && thresholdErrors.length === 0,
    targetOrg: options.targetOrg,
    runId,
    summary,
    familySummary,
    thresholdErrors,
    records,
  };
  const jsonPath = path.join(outputDir, "d360-capability-sweep.json");
  const mdPath = path.join(outputDir, "d360-capability-sweep.md");
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  writeFileSync(mdPath, renderMarkdown(result));

  console.log(`\nSummary: ${summary.failed} failed / ${records.length} checks`);
  for (const error of thresholdErrors) console.log(`Threshold: ${error}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${mdPath}`);
  process.exit(result.ok ? 0 : 1);
}

async function runFacadeWithRetry(
  input: D360FacadeInput,
  env: SfEnvironment,
  ctx: ExtensionContext,
  check: SweepCheck,
): Promise<Record<string, unknown>> {
  const maxAttempts =
    input.allow_confirmed || check.sourceCapability?.endsWith("_delete_verify") ? 20 : 1;
  let result: Record<string, unknown> = {};
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result = await runFacade(input, env, ctx, ctx.signal);
    if (!shouldRetrySweepResult(result, check) || attempt === maxAttempts) return result;
    await sleep(15_000);
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverStaleCleanupLifecyclePlan(
  targetOrg: string,
  env: SfEnvironment,
  ctx: ExtensionContext,
): Promise<DmoLifecyclePlan> {
  const listCalls: Array<{ capability: string; family: string }> = [
    { capability: "d360_dmo_list", family: "DMO" },
    { capability: "d360_dlo_list", family: "DLO" },
    { capability: "d360_sdm_list", family: "Semantic Retrieval" },
    { capability: "d360_transform_list", family: "DataTransform" },
    { capability: "d360_dataaction_list", family: "DataAction" },
    { capability: "d360_dataaction_target_list", family: "DataActionTarget" },
  ];
  const resources: DiscoveredCleanupResource[] = [];
  for (const call of listCalls) {
    const result = await runFacade(
      {
        action: "execute",
        capability: call.capability,
        target_org: targetOrg,
        params: { limit: 200 },
        output_mode: "summary",
      },
      env,
      ctx,
      ctx.signal,
    );
    if (result.ok !== true) continue;
    for (const row of findFirstArray(result.response)?.filter(isRecord) ?? []) {
      const name = firstString(row, ["apiName", "name", "developerName"]);
      if (name) resources.push({ family: call.family, name });
    }
  }
  return buildDiscoveredCleanupLifecyclePlan(resources);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkKey(check: SweepCheck): string {
  return [
    check.stage,
    check.capability,
    check.sourceCapability ?? "",
    JSON.stringify(check.params ?? {}),
  ].join(":");
}

function baseCheck(capability: D360Capability, stage: SweepStage): SweepCheck {
  return {
    stage,
    capability: capability.name,
    family: capability.family,
    kind: capability.kind,
    safety: capability.safety,
  };
}

function matchesFilters(capability: D360Capability, options: SweepPlanOptions): boolean {
  if (options.families?.length && !options.families.includes(capability.family)) return false;
  if (options.capabilities?.length && !options.capabilities.includes(capability.name)) return false;
  return true;
}

function isLiveEligible(safety: D360OperationSafety | undefined): boolean {
  return safety === "read" || safety === "safe_post";
}

function isDynamicDetailCapability(capabilityName: string): boolean {
  return dynamicDetailCapabilities.has(capabilityName);
}

interface DynamicFollowUp {
  capability: string;
  params: Record<string, string[]>;
  inheritParams?: string[];
  constantParams?: Record<string, unknown>;
}

const SWEEP_MUTATION_TARGET_ORG = "AgentforceSTDM";

const idOrNameCandidates = [
  "id",
  "Id",
  "name",
  "apiName",
  "developerName",
  "devName",
  "masterLabel",
];
const nameCandidates = ["name", "apiName", "developerName", "devName", "catalogName", "id"];
const apiNameCandidates = ["apiName", "name", "developerName", "devName", "id"];
const dmoNameCandidates = ["apiName", "name", "developerName", "dmoName"];
const dloNameCandidates = ["apiName", "name", "developerName", "dloName"];
const mappingNameCandidates = ["developerName", "name", "mappingName", "id"];

const dynamicFollowUps: Record<string, DynamicFollowUp[]> = {
  d360_data_spaces_list: [
    { capability: "d360_dataspace_get", params: { dataSpaceName: nameCandidates } },
    { capability: "d360_dataspace_member_list", params: { dataSpaceName: nameCandidates } },
  ],
  d360_data_streams_list: [
    { capability: "d360_datastream_get", params: { dataStreamId: idOrNameCandidates } },
  ],
  d360_datastream_list: [
    { capability: "d360_datastream_get", params: { dataStreamId: idOrNameCandidates } },
  ],
  d360_data_transforms_list: [
    { capability: "d360_transform_get", params: { transformId: idOrNameCandidates } },
  ],
  d360_transform_list: [
    { capability: "d360_transform_get", params: { transformId: idOrNameCandidates } },
  ],
  d360_data_actions_list: [
    { capability: "d360_dataaction_get", params: { dataActionId: idOrNameCandidates } },
  ],
  d360_dataaction_list: [
    { capability: "d360_dataaction_get", params: { dataActionId: idOrNameCandidates } },
  ],
  d360_dataaction_target_list: [
    {
      capability: "d360_dataaction_target_get",
      params: { dataActionTargetId: idOrNameCandidates },
    },
  ],
  d360_semantic_models_list: [
    { capability: "d360_semantic_model_get", params: { semanticModelName: idOrNameCandidates } },
  ],
  d360_sdm_list: [{ capability: "d360_sdm_get", params: { modelApiNameOrId: idOrNameCandidates } }],
  d360_sdm_get: [
    { capability: "d360_sdm_dependencies", params: { modelApiNameOrId: idOrNameCandidates } },
    { capability: "d360_sdm_data_objects_list", params: { modelApiNameOrId: idOrNameCandidates } },
    { capability: "d360_sdm_calc_dims_list", params: { modelApiNameOrId: idOrNameCandidates } },
    { capability: "d360_sdm_calc_measures_list", params: { modelApiNameOrId: idOrNameCandidates } },
    { capability: "d360_sdm_metrics_list", params: { modelApiNameOrId: idOrNameCandidates } },
    { capability: "d360_sdm_relationships_list", params: { modelApiNameOrId: idOrNameCandidates } },
    { capability: "d360_sdm_validate", params: { modelApiNameOrId: idOrNameCandidates } },
  ],
  d360_sdm_data_objects_list: [
    {
      capability: "d360_sdm_data_object_get",
      params: {
        modelApiNameOrId: idOrNameCandidates,
        dataObjectNameOrId: idOrNameCandidates,
      },
      inheritParams: ["modelApiNameOrId"],
    },
    {
      capability: "d360_sdm_dimensions_list",
      params: {
        modelApiNameOrId: idOrNameCandidates,
        dataObjectNameOrId: idOrNameCandidates,
      },
      inheritParams: ["modelApiNameOrId"],
    },
    {
      capability: "d360_sdm_measurements_list",
      params: {
        modelApiNameOrId: idOrNameCandidates,
        dataObjectNameOrId: idOrNameCandidates,
      },
      inheritParams: ["modelApiNameOrId"],
    },
  ],
  d360_sdm_calc_dims_list: [
    {
      capability: "d360_sdm_calc_dim_get",
      params: {
        modelApiNameOrId: idOrNameCandidates,
        calculatedDimensionId: idOrNameCandidates,
      },
      inheritParams: ["modelApiNameOrId"],
    },
  ],
  d360_sdm_calc_measures_list: [
    {
      capability: "d360_sdm_calc_measure_get",
      params: {
        modelApiNameOrId: idOrNameCandidates,
        calculatedMeasureId: idOrNameCandidates,
      },
      inheritParams: ["modelApiNameOrId"],
    },
  ],
  d360_sdm_metrics_list: [
    {
      capability: "d360_sdm_metric_get",
      params: { modelApiNameOrId: idOrNameCandidates, metricNameOrId: idOrNameCandidates },
      inheritParams: ["modelApiNameOrId"],
    },
  ],
  d360_sdm_relationships_list: [
    {
      capability: "d360_sdm_relationship_get",
      params: { modelApiNameOrId: idOrNameCandidates, relationshipId: idOrNameCandidates },
      inheritParams: ["modelApiNameOrId"],
    },
  ],
  d360_search_indexes_list: [
    {
      capability: "d360_search_index_get",
      params: { searchIndexApiNameOrId: idOrNameCandidates },
    },
    {
      capability: "d360_search_index_process_history",
      params: { searchIndexApiNameOrId: idOrNameCandidates },
    },
  ],
  d360_search_index_list: [
    {
      capability: "d360_search_index_get",
      params: { searchIndexApiNameOrId: idOrNameCandidates },
    },
    {
      capability: "d360_search_index_process_history",
      params: { searchIndexApiNameOrId: idOrNameCandidates },
    },
  ],
  d360_retrievers_list: [
    { capability: "d360_retriever_get", params: { retrieverId: idOrNameCandidates } },
    { capability: "d360_retriever_config_list", params: { retrieverIdOrName: idOrNameCandidates } },
  ],
  d360_retriever_list: [
    { capability: "d360_retriever_get", params: { retrieverId: idOrNameCandidates } },
    { capability: "d360_retriever_config_list", params: { retrieverIdOrName: idOrNameCandidates } },
  ],
  d360_retriever_config_list: [
    {
      capability: "d360_retriever_config_get",
      params: {
        retrieverIdOrName: idOrNameCandidates,
        configurationIdOrName: idOrNameCandidates,
      },
      inheritParams: ["retrieverIdOrName"],
    },
  ],
  d360_datakits_list: [
    { capability: "d360_datakit_get", params: { dataKitId: idOrNameCandidates } },
    { capability: "d360_datakit_manifest", params: { dataKitId: idOrNameCandidates } },
    { capability: "d360_datakit_components", params: { dataKitId: idOrNameCandidates } },
  ],
  d360_datakit_components: [
    {
      capability: "d360_datakit_component_status",
      params: { dataKitId: idOrNameCandidates, componentId: idOrNameCandidates },
      inheritParams: ["dataKitId"],
    },
    {
      capability: "d360_datakit_component_deps",
      params: { dataKitId: idOrNameCandidates, componentId: idOrNameCandidates },
      inheritParams: ["dataKitId"],
    },
  ],
  d360_datakit_list: [
    { capability: "d360_datakit_get", params: { dataKitId: idOrNameCandidates } },
    { capability: "d360_datakit_manifest", params: { dataKitId: idOrNameCandidates } },
    { capability: "d360_datakit_components", params: { dataKitId: idOrNameCandidates } },
  ],
  d360_segments_list: [
    { capability: "d360_segment_get", params: { segmentId: idOrNameCandidates } },
  ],
  d360_segment_list: [
    { capability: "d360_segment_get", params: { segmentId: idOrNameCandidates } },
  ],
  d360_activations_list: [
    { capability: "d360_activation_get", params: { activationId: idOrNameCandidates } },
  ],
  d360_activation_list: [
    { capability: "d360_activation_get", params: { activationId: idOrNameCandidates } },
  ],
  d360_activation_target_list: [
    {
      capability: "d360_activation_target_get",
      params: { activationTargetId: idOrNameCandidates },
    },
  ],
  d360_calculated_insights_list: [
    { capability: "d360_ci_get", params: { ciName: apiNameCandidates } },
  ],
  d360_ci_list: [{ capability: "d360_ci_get", params: { ciName: apiNameCandidates } }],
  d360_identity_resolutions_list: [
    { capability: "d360_ir_get", params: { identityResolutionId: idOrNameCandidates } },
  ],
  d360_ir_list: [
    { capability: "d360_ir_get", params: { identityResolutionId: idOrNameCandidates } },
  ],
  d360_connections_sfdc_list: [
    {
      capability: "d360_connection_get",
      params: { connectionId: idOrNameCandidates },
      constantParams: { connectorType: "SalesforceDotCom" },
    },
  ],
  d360_connection_list: [
    {
      capability: "d360_connection_get",
      params: { connectionId: idOrNameCandidates },
      inheritParams: ["connectorType"],
    },
  ],
  d360_connectors_list: [
    { capability: "d360_connector_metadata", params: { connectorName: nameCandidates } },
  ],
  d360_connector_list: [
    { capability: "d360_connector_metadata", params: { connectorName: nameCandidates } },
  ],
  d360_dmo_list: [{ capability: "d360_dmo_get", params: { dmoName: dmoNameCandidates } }],
  d360_dlo_list: [{ capability: "d360_dlo_get", params: { dloName: dloNameCandidates } }],
  d360_dmo_mapping_list: [
    { capability: "d360_dmo_mapping_get", params: { mappingName: mappingNameCandidates } },
  ],
};

const dynamicDetailCapabilities = new Set(
  Object.values(dynamicFollowUps).flatMap((followUps) =>
    followUps.map((followUp) => followUp.capability),
  ),
);

function buildDloCreateBody(
  resourceName: string,
  runId: string,
  labelPrefix = "Pi Sweep DLO",
): Record<string, unknown> {
  return {
    name: resourceName,
    label: `${labelPrefix} ${runId}`,
    category: "Other",
    dataspaceInfo: [{ name: "default" }],
    dataLakeFieldInputRepresentations: buildDloFields(),
  };
}

function buildDloFields(): Array<Record<string, unknown>> {
  return [
    { name: "Id__c", label: "Id", dataType: "Text", isPrimaryKey: true },
    { name: "Name__c", label: "Name", dataType: "Text", isPrimaryKey: false },
  ];
}

function buildActivationCreateBody(
  activationName: string,
  activationTargetName: string,
  segmentApiName: string,
): Record<string, unknown> {
  return {
    name: activationName,
    activationTargetName,
    dataSpaceName: "default",
    refreshType: "INCREMENTAL",
    activationType: "Segment",
    segmentApiName,
    activationTargetSubjectConfig: { developerName: "ssot__AiAgentSession__dlm" },
    attributesConfig: {
      attributes: [
        {
          dataSourceType: "Text",
          entityName: "ssot__AiAgentSession__dlm",
          label: "AI Agent Session Id",
          name: "ssot__Id__c",
          referenceAttributeName: "Id",
          source: "DIRECT",
          type: "MODEL",
        },
      ],
    },
  };
}

function buildActivationTargetCreateBody(activationTargetName: string): Record<string, unknown> {
  return {
    name: activationTargetName,
    platformType: "DataCloud",
    dataSpaceName: "default",
    connector: {},
  };
}

function buildSegmentCreateBody(segmentApiName: string, runId: string): Record<string, unknown> {
  return {
    developerName: segmentApiName,
    displayName: `Pi Sweep Segment ${runId}`,
    description: `Sweep-owned segment created by run ${runId}.`,
    segmentOnApiName: "ssot__AiAgentSession__dlm",
    segmentType: "Dbt",
    publishSchedule: "NoRefresh",
    segmentCreationFlow: "Visual",
    includeDbt: {
      models: {
        models: [
          {
            name: `pi_sweep_segment_${runId}`,
            sql: "SELECT DISTINCT ssot__AiAgentSession__dlm.ssot__Id__c, ssot__AiAgentSession__dlm.KQ_Id__c FROM ssot__AiAgentSession__dlm",
          },
        ],
      },
    },
  };
}

function buildCalculatedInsightValidateBody(runId: string): Record<string, unknown> {
  return { expression: calculatedInsightExpression(runId) };
}

function buildCalculatedInsightCreateBody(runId: string): Record<string, unknown> {
  return {
    apiName: `PiSweepCi_${runId}__cio`,
    displayName: `Pi Sweep CI ${runId}`,
    definitionType: "CALCULATED_METRIC",
    dataSpaceName: "default",
    publishScheduleInterval: "SYSTEM_MANAGED",
    expression: calculatedInsightExpression(runId),
  };
}

function calculatedInsightExpression(_runId: string): string {
  return [
    "SELECT ssot__AiAgentSession__dlm.ssot__Id__c AS session_id__c,",
    "COUNT(*) AS interaction_count__c",
    "FROM ssot__AiAgentSession__dlm",
    "GROUP BY ssot__AiAgentSession__dlm.ssot__Id__c",
  ].join(" ");
}

function buildDataActionTargetCreateBody(
  dataActionTargetName: string,
  runId: string,
): Record<string, unknown> {
  return {
    apiName: dataActionTargetName,
    label: `Pi Target ${runId}`,
    type: "WebHook",
    config: { targetEndpoint: "https://example.invalid/data-action" },
  };
}

function buildDataActionCreateBody(
  dataActionName: string,
  dataActionTargetName: string,
  runId: string,
): Record<string, unknown> {
  return {
    dataActionName: `Pi Action ${runId}`,
    developerName: dataActionName,
    dataspace: "default",
    masterLabel: `Pi Action ${runId}`,
    description: `Sweep-owned data action created by run ${runId}.`,
    actionConditionExpression: "(1)",
    shouldTriggerEventOnlyFirstTime: true,
    dataActionSources: [
      {
        sourceName: "ssot__AiAgentInteraction__dlm",
        sourceType: "DataModelEntity",
        sourceCdcSubscriptions: ["CREATE", "UPDATE", "DELETE"],
      },
    ],
    actionConditions: [
      {
        fieldName: "ssot__AiAgentInteractionType__c",
        objectName: "ssot__AiAgentInteraction__dlm",
        operator: "Equal",
        order: "1",
        value: "SESSION_END",
      },
    ],
    dataActionTargetNames: [dataActionTargetName],
    dataActionProjectedFields: [],
    dataActionEnrichmentProperties: [],
  };
}

function buildTransformBody(
  transformName: string,
  sourceDloName: string,
  targetDloName: string,
  runId: string,
): Record<string, unknown> {
  return {
    label: `Pi Sweep Transform ${runId}`,
    name: transformName,
    type: "BATCH",
    definition: {
      type: "STL",
      version: "66.0",
      nodes: {
        LOAD_DATASET0: {
          action: "load",
          parameters: {
            dataset: { name: sourceDloName, type: "dataLakeObject" },
            fields: ["id__c"],
            sampleDetails: { sortBy: [], type: "TopN" },
          },
          sources: [],
        },
        OUTPUT0: {
          action: "outputD360",
          parameters: {
            name: targetDloName,
            type: "dataLakeObject",
            writeMode: "OVERWRITE",
            fieldsMappings: [{ sourceField: "id__c", targetField: "Id__c" }],
          },
          sources: ["LOAD_DATASET0"],
        },
      },
    },
  };
}

function buildRelationshipSemanticDataObjectCreateBody(
  apiName: string,
  dloName: string,
  runId: string,
  side: "Left" | "Right",
): Record<string, unknown> {
  return {
    apiName,
    label: `Pi Sweep Relationship ${side} Object ${runId}`,
    dataObjectType: "Dlo",
    dataObjectName: dloName,
    shouldIncludeAllFields: false,
    semanticDimensions: [
      { apiName: "Id", label: "Id", dataType: "Text", dataObjectFieldName: "Id__c" },
    ],
  };
}

function buildSemanticRelationshipCreateBody(
  leftDataObjectApiName: string,
  rightDataObjectApiName: string,
  runId: string,
): Record<string, unknown> {
  return {
    apiName: `PiSweepRelationship_${runId}`,
    label: `Pi Sweep Relationship ${runId}`,
    leftSemanticDefinitionApiName: leftDataObjectApiName,
    rightSemanticDefinitionApiName: rightDataObjectApiName,
    cardinality: "ManyToOne",
    joinType: "Auto",
    criteria: [
      {
        joinOperator: "Equals",
        leftFieldType: "TableField",
        leftSemanticFieldApiName: "Id",
        rightFieldType: "TableField",
        rightSemanticFieldApiName: "Id",
      },
    ],
  };
}

function buildMetricDloCreateBody(dloName: string, runId: string): Record<string, unknown> {
  return {
    name: dloName,
    label: `Pi Sweep Metric DLO ${runId}`,
    category: "Other",
    dataspaceInfo: [{ name: "default" }],
    dataLakeFieldInputRepresentations: [
      { name: "Id__c", label: "Id", dataType: "Text", isPrimaryKey: true },
      { name: "Name__c", label: "Name", dataType: "Text", isPrimaryKey: false },
      { name: "EventTime__c", label: "Event Time", dataType: "DateTime", isPrimaryKey: false },
      { name: "Amount__c", label: "Amount", dataType: "Number", isPrimaryKey: false },
    ],
  };
}

function buildMappingCreateBody(dloName: string, dmoName: string): Record<string, unknown> {
  return {
    sourceEntityDeveloperName: dloName,
    targetEntityDeveloperName: dmoName,
    fieldMapping: [
      { sourceFieldDeveloperName: "Id__c", targetFieldDeveloperName: "Id__c" },
      { sourceFieldDeveloperName: "Name__c", targetFieldDeveloperName: "Name__c" },
    ],
  };
}

function buildMetricSemanticDataObjectCreateBody(
  apiName: string,
  dloName: string,
  runId: string,
): Record<string, unknown> {
  return {
    apiName,
    label: `Pi Sweep Metric Data Object ${runId}`,
    dataObjectType: "Dlo",
    dataObjectName: dloName,
    shouldIncludeAllFields: false,
    semanticDimensions: [
      { apiName: "Name", label: "Name", dataType: "Text", dataObjectFieldName: "Name__c" },
      {
        apiName: "EventTime",
        label: "Event Time",
        dataType: "DateTime",
        dataObjectFieldName: "EventTime__c",
      },
    ],
    semanticMeasurements: [
      {
        apiName: "Amount",
        label: "Amount",
        dataType: "Number",
        dataObjectFieldName: "Amount__c",
        aggregationType: "Sum",
      },
    ],
  };
}

function buildSemanticMetricCreateBody(
  apiName: string,
  dataObjectApiName: string,
  runId: string,
): Record<string, unknown> {
  return {
    apiName,
    label: `Pi Sweep Metric ${runId}`,
    measurementReference: {
      tableFieldReference: { fieldApiName: "Amount", tableApiName: dataObjectApiName },
    },
    timeDimensionReference: {
      tableFieldReference: { fieldApiName: "EventTime", tableApiName: dataObjectApiName },
    },
    aggregationType: "Sum",
    timeGrains: ["Day", "Month"],
    additionalDimensions: [
      { tableFieldReference: { fieldApiName: "Name", tableApiName: dataObjectApiName } },
    ],
  };
}

function buildCalcMeasurementCreateBody(runId: string): Record<string, unknown> {
  return {
    label: `Pi Sweep Calc Measurement ${runId}`,
    expression: "COUNT('x')",
    dataType: "Number",
    aggregationType: "UserAgg",
  };
}

function buildCalcDimensionCreateBody(runId: string): Record<string, unknown> {
  return {
    label: `Pi Sweep Calc Dimension ${runId}`,
    expression: "IF 'x' = 'x' THEN 'High' ELSE 'Low' END",
    dataType: "Text",
  };
}

function buildSemanticDataObjectCreateBody(
  apiName: string,
  dmoName: string,
  runId: string,
): Record<string, unknown> {
  return {
    apiName,
    label: `Pi Sweep SDM Data Object ${runId}`,
    dataObjectType: "Dmo",
    dataObjectName: dmoName,
    shouldIncludeAllFields: true,
  };
}

function buildSemanticModelCreateBody(
  resourceName: string,
  runId: string,
): Record<string, unknown> {
  return {
    apiName: resourceName,
    label: `Pi Sweep SDM ${runId}`,
    description: `Sweep-owned semantic model shell created by run ${runId}.`,
    dataspace: "default",
  };
}

function buildDmoCreateBody(
  resourceName: string,
  runId: string,
  labelPrefix = "Pi Sweep DMO",
): Record<string, unknown> {
  return {
    name: resourceName,
    label: `${labelPrefix} ${runId}`,
    category: "PROFILE",
    dataSpaceName: "default",
    description: `Sweep-owned DMO created by run ${runId}.`,
    fields: [
      {
        name: "Id__c",
        label: "Id",
        dataType: "Text",
        isPrimaryKey: true,
      },
      {
        name: "Name__c",
        label: "Name",
        dataType: "Text",
        isPrimaryKey: false,
      },
    ],
  };
}

function dryRunValue(paramName: string): unknown {
  if (paramName === "body") return {};
  if (paramName === "sql") return 'SELECT COUNT(*) AS n FROM "ssot__AiAgentSession__dlm"';
  return `SweepDryRun${toPascal(paramName)}`;
}

function toPascal(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function exampleParams(capabilityName: string): Record<string, unknown> | undefined {
  const example = getD360Examples()[capabilityName];
  if (!example || typeof example !== "object" || Array.isArray(example)) return undefined;
  const params = (example as Record<string, unknown>).params;
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : undefined;
}

const liveParamDenyList = new Set(["d360_semantic_query", "d360_sdm_query"]);

const sweepSourceFields = [
  { name: "Id__c", label: "Id", dataType: "Text" },
  { name: "Name__c", label: "Name", dataType: "Text" },
  { name: "CreatedDate__c", label: "Created Date", dataType: "DateTime" },
];

const sweepTargetFields = [
  { name: "Id__c", label: "Id", dataType: "Text" },
  { name: "Name__c", label: "Name", dataType: "Text" },
  { name: "CreatedDate__c", label: "Created Date", dataType: "DateTime" },
];

const liveParamOverrides: Record<string, Record<string, unknown>> = {
  d360_query_sql: {
    dataspaceName: "default",
    sql: 'SELECT COUNT(*) AS n FROM "ssot__AiAgentSession__dlm"',
  },
  d360_metadata_entities: { entityType: "DataModelObject" },
  d360_metadata_search: {
    body: {
      query: "AI Agent Interaction",
      pagination: { limit: 5 },
      filters: [{ field: "metadataType", values: ["DataModelObject"] }],
    },
  },
  d360_dmo_describe: { dmoName: "ssot__AiAgentSession__dlm" },
  d360_dmo_get: { dmoName: "ssot__AiAgentSession__dlm" },
  d360_connection_list: { connectorType: "SalesforceDotCom" },
  d360_preview_field_matches: {
    sourceFields: sweepSourceFields,
    targetFields: sweepTargetFields,
    sourceDloName: "Sweep_Source__dll",
    targetDmoName: "Sweep_Target__dlm",
    threshold: 0.45,
  },
  d360_smart_mapping_suggest: {
    sourceFields: sweepSourceFields,
    targetFields: sweepTargetFields,
    sourceDloName: "Sweep_Source__dll",
    targetDmoName: "Sweep_Target__dlm",
    threshold: 0.45,
  },
  d360_event_date_recommend: {
    category: "Engagement",
    fields: sweepSourceFields,
  },
  d360_smart_datastream_create: {
    body: {
      name: "Sweep_Engagement_Stream",
      label: "Sweep Engagement Stream",
      datastreamType: "EXTERNAL",
      category: "Engagement",
      dataLakeObjectInfo: {
        name: "Sweep_Engagement__dll",
        label: "Sweep Engagement",
        fields: sweepSourceFields,
      },
    },
    autoSelectEventDate: true,
  },
};

function looksEmpty(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length === 0;
  const record = value as Record<string, unknown>;
  for (const key of ["records", "data", "items", "results", "segments", "activations"]) {
    if (Array.isArray(record[key]) && record[key].length === 0) return true;
  }
  for (const key of ["total", "totalSize", "count"]) {
    if (record[key] === 0) return true;
  }
  return false;
}

function firstObjectRow(response: unknown): Record<string, unknown> | undefined {
  const rows = findFirstArray(response);
  const row = rows?.find(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
  if (row) return row;
  return response && typeof response === "object" && !Array.isArray(response)
    ? (response as Record<string, unknown>)
    : undefined;
}

function findFirstArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const preferredKeys = [
    "records",
    "data",
    "items",
    "results",
    "dataSpaces",
    "dataStreams",
    "connections",
    "connectors",
    "segments",
    "activations",
    "activationTargets",
    "calculatedInsights",
    "identityResolutions",
    "dataTransforms",
    "dataActions",
    "dataActionTargets",
    "semanticModels",
    "searchIndexes",
    "retrievers",
    "dataKits",
    "objects",
  ];
  for (const key of preferredKeys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return Object.values(record).find(Array.isArray) as unknown[] | undefined;
}

function findValueByCandidateKey(
  row: Record<string, unknown>,
  candidateKeys: string[],
): string | number | boolean | undefined {
  const lowerCandidates = new Set(candidateKeys.map((key) => key.toLowerCase()));
  const queue: unknown[] = [row];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || Array.isArray(current)) continue;
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (lowerCandidates.has(key.toLowerCase()) && isScalarIdentifier(value)) return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return undefined;
}

function isScalarIdentifier(value: unknown): value is string | number | boolean {
  if (typeof value === "string") return Boolean(value.trim());
  return typeof value === "number" || typeof value === "boolean";
}

function hasEmbeddingModelArtifact(response: unknown): boolean {
  const rows = findFirstArray(response) ?? [];
  return rows.filter(isRecord).some((row) => {
    const text = [row.capability, row.name, row.label, row.id].filter(Boolean).join(" ");
    return /embedding|embed|e5|ada|vector/i.test(text);
  });
}

function extractError(result: Record<string, unknown>): string | undefined {
  const response = result.response;
  if (response && typeof response === "object" && !Array.isArray(response)) {
    return stringValue((response as Record<string, unknown>).message);
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function summarize(records: SweepRecord[]): Record<string, number> {
  const summary: Record<string, number> = { total: records.length, failed: 0 };
  for (const record of records) {
    if (record.outcome === "failed") {
      summary.failed++;
    } else {
      summary[record.outcome] = (summary[record.outcome] ?? 0) + 1;
      if (record.fail) summary.failed++;
    }
  }
  return summary;
}

export function buildFamilySummary(records: SweepRecord[]): FamilySummaryRow[] {
  const byFamily = new Map<string, FamilySummaryRow>();
  for (const record of records) {
    const family = record.family ?? "Unspecified";
    const row = byFamily.get(family) ?? emptyFamilySummaryRow(family);
    row.total++;
    row[record.outcome] = Number(row[record.outcome] ?? 0) + 1;
    byFamily.set(family, row);
  }
  return [...byFamily.values()].sort(
    (a, b) => b.total - a.total || a.family.localeCompare(b.family),
  );
}

export function evaluateSweepThresholds(
  records: SweepRecord[],
  options: SweepThresholdOptions,
): string[] {
  const summary = summarize(records);
  const errors: string[] = [];
  const reachable = summary.reachable ?? 0;
  const mutationOk = summary.mutation_ok ?? 0;
  const skipped = summary.skipped_needs_payload ?? 0;
  if (options.minReachable !== undefined && reachable < options.minReachable) {
    errors.push(`reachable count ${reachable} is below --min-reachable ${options.minReachable}`);
  }
  if (options.minMutationOk !== undefined && mutationOk < options.minMutationOk) {
    errors.push(
      `mutation_ok count ${mutationOk} is below --min-mutation-ok ${options.minMutationOk}`,
    );
  }
  if (options.maxSkipped !== undefined && skipped > options.maxSkipped) {
    errors.push(
      `skipped_needs_payload count ${skipped} is above --max-skipped ${options.maxSkipped}`,
    );
  }
  for (const [capability, outcome] of Object.entries(options.requiredOutcomes ?? {})) {
    if (!records.some((record) => record.capability === capability && record.outcome === outcome)) {
      errors.push(`${capability} did not produce required outcome ${outcome}`);
    }
  }
  return errors;
}

function emptyFamilySummaryRow(family: string): FamilySummaryRow {
  return {
    family,
    total: 0,
    contract_ok: 0,
    dry_run_ok: 0,
    reachable: 0,
    empty: 0,
    feature_gated: 0,
    not_found_optional: 0,
    dependency_missing: 0,
    skipped_needs_payload: 0,
    mutation_ok: 0,
    failed: 0,
  };
}

function renderMarkdown(result: {
  ok: boolean;
  targetOrg: string;
  runId: string;
  summary: Record<string, number>;
  familySummary: FamilySummaryRow[];
  thresholdErrors: string[];
  records: SweepRecord[];
}): string {
  const lines = [
    `# D360 Capability Sweep`,
    "",
    `- Target org: \`${result.targetOrg}\``,
    `- Run id: \`${result.runId}\``,
    `- Failed checks: ${result.summary.failed}`,
    "",
    "## Outcomes",
    "",
    "| Outcome | Count |",
    "| --- | ---: |",
  ];
  for (const [key, value] of Object.entries(result.summary).filter(([key]) => key !== "total")) {
    lines.push(`| ${key} | ${value} |`);
  }
  if (result.thresholdErrors.length) {
    lines.push("", "## Threshold failures", "");
    for (const error of result.thresholdErrors) lines.push(`- ${error}`);
  }
  lines.push(
    "",
    "## Family summary",
    "",
    "| Family | Total | Reachable | Mutation OK | Skipped | Dependency missing | Empty | Not found | Failed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const row of result.familySummary) {
    lines.push(
      `| ${escapeCell(row.family)} | ${row.total} | ${row.reachable} | ${row.mutation_ok} | ${row.skipped_needs_payload} | ${row.dependency_missing} | ${row.empty} | ${row.not_found_optional} | ${row.failed} |`,
    );
  }
  lines.push(
    "",
    "## Checks",
    "",
    "| Stage | Capability | Family | Outcome | Summary |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const record of result.records) {
    lines.push(
      `| ${record.stage} | ${record.capability} | ${record.family ?? ""} | ${record.outcome} | ${escapeCell(record.summary)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { targetOrg: process.env.D360_E2E_ORG ?? "", live: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--target-org":
      case "-o":
        options.targetOrg = requiredArg(args, ++i, arg);
        break;
      case "--family":
        options.families = [...(options.families ?? []), requiredArg(args, ++i, arg)];
        break;
      case "--capability":
        options.capabilities = [...(options.capabilities ?? []), requiredArg(args, ++i, arg)];
        break;
      case "--max-live":
        options.maxLive = Number(requiredArg(args, ++i, arg));
        break;
      case "--output-dir":
        options.outputDir = requiredArg(args, ++i, arg);
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(requiredArg(args, ++i, arg));
        break;
      case "--dry-run-only":
        options.dryRunOnly = true;
        break;
      case "--mutate":
        options.mutate = true;
        break;
      case "--run-id":
        options.runId = requiredArg(args, ++i, arg);
        break;
      case "--lifecycle":
        options.lifecycles = [
          ...(options.lifecycles ?? []),
          parseLifecycleName(requiredArg(args, ++i, arg)),
        ];
        break;
      case "--cleanup-run-id":
        options.cleanupRunId = requiredArg(args, ++i, arg);
        break;
      case "--cleanup-stale":
        options.cleanupStale = true;
        break;
      case "--only-lifecycle":
        options.onlyLifecycle = true;
        break;
      case "--preset":
        options.preset = parseSweepPresetName(requiredArg(args, ++i, arg));
        break;
      case "--min-reachable":
        options.minReachable = Number(requiredArg(args, ++i, arg));
        break;
      case "--min-mutation-ok":
        options.minMutationOk = Number(requiredArg(args, ++i, arg));
        break;
      case "--max-skipped":
        options.maxSkipped = Number(requiredArg(args, ++i, arg));
        break;
      case "--require-outcome": {
        const [capability, outcome] = requiredArg(args, ++i, arg).split("=");
        if (!capability || !outcome)
          throw new Error("--require-outcome expects capability=outcome.");
        options.requiredOutcomes = {
          ...(options.requiredOutcomes ?? {}),
          [capability]: parseSweepOutcome(outcome),
        };
        break;
      }
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
        if (!options.targetOrg) options.targetOrg = arg;
        break;
    }
  }
  return options;
}

function parseSweepPresetName(value: string): SweepPresetName {
  if (value === "agentforce-stdm-mutate" || value === "agentforce-stdm-safe") return value;
  throw new Error(
    "Unknown preset '${value}'. Expected agentforce-stdm-mutate or agentforce-stdm-safe.",
  );
}

function parseLifecycleName(value: string): MutationLifecycleName {
  if (value in lifecycleBuilders) return value as MutationLifecycleName;
  throw new Error(
    `Unknown lifecycle '${value}'. Expected one of: ${Object.keys(lifecycleBuilders).join(", ")}`,
  );
}

function parseSweepOutcome(value: string): SweepOutcome {
  const outcomes: SweepOutcome[] = [
    "contract_ok",
    "dry_run_ok",
    "reachable",
    "empty",
    "feature_gated",
    "not_found_optional",
    "dependency_missing",
    "skipped_needs_payload",
    "mutation_ok",
    "failed",
  ];
  if (outcomes.includes(value as SweepOutcome)) return value as SweepOutcome;
  throw new Error(`Unknown outcome '${value}'. Expected one of: ${outcomes.join(", ")}`);
}

function requiredArg(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

async function loadEnvironment(): Promise<SfEnvironment> {
  return detectEnvironment((cmd, args) => {
    return new Promise((resolve) => {
      const child = spawn(cmd, args);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (code) => resolve({ stdout, stderr, code }));
    });
  }, process.cwd());
}

function createHeadlessContext(): ExtensionContext {
  const controller = new AbortController();
  return {
    hasUI: false,
    signal: controller.signal,
    ui: {
      select: async () => "Block",
    },
  } as unknown as ExtensionContext;
}

function createSweepMutationContext(): ExtensionContext {
  const controller = new AbortController();
  return {
    hasUI: true,
    signal: controller.signal,
    ui: {
      select: async () => "Allow once",
    },
  } as unknown as ExtensionContext;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
}
