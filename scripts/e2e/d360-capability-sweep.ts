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

export type SweepStage = "contract" | "dry_run" | "live" | "live_skip";

export type SweepOutcome =
  | "contract_ok"
  | "dry_run_ok"
  | "reachable"
  | "empty"
  | "feature_gated"
  | "not_found_optional"
  | "dependency_missing"
  | "skipped_needs_payload"
  | "failed";

export interface SweepPlanOptions {
  targetOrg: string;
  live?: boolean;
  families?: string[];
  capabilities?: string[];
  maxLive?: number;
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

interface CliOptions extends SweepPlanOptions {
  outputDir?: string;
  timeoutMs?: number;
  dryRunOnly?: boolean;
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

export function buildDynamicFollowUpChecks(
  sourceCheck: SweepCheck,
  result: Record<string, unknown>,
  capabilities: D360Capability[] = getD360Capabilities(),
): SweepCheck[] {
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

export function classifySweepResult(
  check: Pick<SweepCheck, "stage" | "capability" | "skipReason">,
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

  if (ok && check.stage === "dry_run") {
    return { outcome: "dry_run_ok", fail: false, summary, status, error };
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
  if (
    status === 404 ||
    message.includes("not_found") ||
    message.includes("does not exist") ||
    message.includes("no stdm interaction found") ||
    message.includes("no stdm session found")
  ) {
    return { outcome: "not_found_optional", fail: false, summary, status, error };
  }
  if (
    status === 401 ||
    status === 403 ||
    message.includes("not visible") ||
    message.includes("permission")
  ) {
    return { outcome: "feature_gated", fail: false, summary, status, error };
  }
  if (
    message.includes("requires") ||
    message.includes("dependency") ||
    message.includes("invalid input") ||
    message.includes("provide a valid recordid") ||
    message.includes("developer name is missing") ||
    message.includes("field ids should not be empty") ||
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

  const env = await loadEnvironment();
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const outputDir = path.resolve(
    options.outputDir ?? path.join(os.tmpdir(), "pi-d360-capability-sweeps", runId),
  );
  mkdirSync(outputDir, { recursive: true });

  const capabilities = getD360Capabilities();
  const plan = buildCapabilitySweepPlan(capabilities, {
    ...options,
    live: !options.dryRunOnly,
  });
  const seenChecks = new Set(plan.map(checkKey));
  const ctx = createHeadlessContext();
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
          timeout_ms: options.timeoutMs,
          output_mode: "summary",
        };
        const result = await runFacade(input, env, ctx, ctx.signal);
        classified = classifySweepResult(check, result);
        for (const followUp of buildDynamicFollowUpChecks(check, result, capabilities)) {
          const key = checkKey(followUp);
          if (!seenChecks.has(key)) {
            seenChecks.add(key);
            plan.push(followUp);
          }
        }
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
      : record.outcome === "reachable" || record.outcome === "dry_run_ok"
        ? "✓"
        : "•";
    console.log(`  ${marker} ${record.stage.padEnd(8)} ${record.capability} — ${record.outcome}`);
  }

  const summary = summarize(records);
  const result = {
    ok: summary.failed === 0,
    targetOrg: options.targetOrg,
    runId,
    summary,
    records,
  };
  const jsonPath = path.join(outputDir, "d360-capability-sweep.json");
  const mdPath = path.join(outputDir, "d360-capability-sweep.md");
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  writeFileSync(mdPath, renderMarkdown(result));

  console.log(`\nSummary: ${summary.failed} failed / ${records.length} checks`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${mdPath}`);
  process.exit(summary.failed === 0 ? 0 : 1);
}

function checkKey(check: SweepCheck): string {
  return [check.stage, check.capability, JSON.stringify(check.params ?? {})].join(":");
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
};

const dynamicDetailCapabilities = new Set(
  Object.values(dynamicFollowUps).flatMap((followUps) =>
    followUps.map((followUp) => followUp.capability),
  ),
);

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

function renderMarkdown(result: {
  ok: boolean;
  targetOrg: string;
  runId: string;
  summary: Record<string, number>;
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
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
        if (!options.targetOrg) options.targetOrg = arg;
        break;
    }
  }
  return options;
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

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
}
