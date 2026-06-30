/* SPDX-License-Identifier: Apache-2.0 */
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildActivationLifecyclePlan,
  buildActivationTargetLifecyclePlan,
  buildCapabilitySweepPlan,
  applySweepPreset,
  buildCalculatedInsightLifecyclePlan,
  buildCleanupLifecyclePlan,
  buildDataActionLifecyclePlan,
  buildDiscoveredCleanupLifecyclePlan,
  buildDloLifecyclePlan,
  buildDmoLifecyclePlan,
  buildDynamicFollowUpChecks,
  buildFamilySummary,
  buildMappingLifecyclePlan,
  buildMutationLifecyclePlans,
  buildSemanticCalculatedFieldsLifecyclePlan,
  buildSemanticDataObjectLifecyclePlan,
  buildSegmentLifecyclePlan,
  buildSearchIndexReadinessPlan,
  buildRetrieverReadinessPlan,
  buildSemanticMetricLifecyclePlan,
  buildSemanticModelLifecyclePlan,
  buildSemanticRelationshipLifecyclePlan,
  buildTransformLifecyclePlan,
  canRunMutationLifecycle,
  classifySweepResult,
  evaluateSweepThresholds,
  containsPlaceholderValue,
  insertFollowUpChecks,
  paramsForDryRun,
  paramsForLiveCheck,
  resolveSweepOutputDir,
  shouldRetrySweepResult,
} from "../../../scripts/e2e/d360-capability-sweep.ts";
import type { D360Capability } from "../lib/facade/registry.ts";

const listCapability: D360Capability = {
  name: "d360_data_spaces_list",
  kind: "rest_operation",
  family: "Dataspace",
  phase: "orchestrate",
  description: "List data spaces.",
  safety: "read",
  operation: {
    name: "d360_data_spaces_list",
    family: "Dataspace",
    description: "List data spaces.",
    method: "GET",
    path: "/ssot/data-spaces",
    safety: "read",
  },
};

const destructiveCapability: D360Capability = {
  name: "d360_dmo_delete",
  kind: "rest_operation",
  family: "DMO",
  phase: "harmonize",
  description: "Delete a DMO.",
  safety: "destructive",
  requiredParams: ["dmoName"],
  operation: {
    name: "d360_dmo_delete",
    family: "DMO",
    description: "Delete a DMO.",
    method: "DELETE",
    path: "/ssot/data-model-objects/{dmoName}",
    safety: "destructive",
    requiredParams: ["dmoName"],
  },
};

const streamDetailCapability: D360Capability = {
  name: "d360_datastream_get",
  kind: "rest_operation",
  family: "DataStreams",
  phase: "prepare",
  description: "Get a data stream.",
  safety: "read",
  requiredParams: ["dataStreamId"],
  operation: {
    name: "d360_datastream_get",
    family: "DataStreams",
    description: "Get a data stream.",
    method: "GET",
    path: "/ssot/data-streams/{dataStreamId}",
    safety: "read",
    requiredParams: ["dataStreamId"],
  },
};

const semanticDataObjectsCapability: D360Capability = {
  name: "d360_sdm_data_objects_list",
  kind: "rest_operation",
  family: "Semantic Retrieval",
  phase: "retrieve",
  description: "List semantic data objects.",
  safety: "read",
  requiredParams: ["modelApiNameOrId"],
  operation: {
    name: "d360_sdm_data_objects_list",
    family: "Semantic Retrieval",
    description: "List semantic data objects.",
    method: "GET",
    path: "/ssot/semantic/models/{modelApiNameOrId}/data-objects",
    safety: "read",
    requiredParams: ["modelApiNameOrId"],
  },
};

const semanticQueryCapability: D360Capability = {
  name: "d360_sdm_query",
  kind: "rest_operation",
  family: "Semantic Retrieval",
  phase: "retrieve",
  description: "Run semantic query.",
  safety: "safe_post",
  requiredParams: ["body"],
  operation: {
    name: "d360_sdm_query",
    family: "Semantic Retrieval",
    description: "Run semantic query.",
    method: "POST",
    path: "/semantic-engine/gateway",
    safety: "safe_post",
    requiredParams: ["body"],
  },
};

const localHelperCapability: D360Capability = {
  name: "d360_preview_field_matches",
  kind: "local_helper",
  family: "Smart",
  phase: "harmonize",
  description: "Preview field matches.",
  safety: "safe_post",
  requiredParams: ["sourceFields", "targetFields"],
  operation: {
    name: "d360_preview_field_matches",
    family: "Smart",
    description: "Preview field matches.",
    method: "POST",
    path: "/local/preview-field-matches",
    safety: "safe_post",
    requiredParams: ["sourceFields", "targetFields"],
  },
};

const safePostCapability: D360Capability = {
  name: "d360_query_sql",
  kind: "rest_operation",
  family: "Query",
  phase: "retrieve",
  description: "Run SQL.",
  safety: "safe_post",
  requiredParams: ["sql"],
  operation: {
    name: "d360_query_sql",
    family: "Query",
    description: "Run SQL.",
    method: "POST",
    path: "/ssot/query-sql",
    safety: "safe_post",
    requiredParams: ["sql"],
  },
};

describe("d360 capability sweep output paths", () => {
  it("honors explicit output directories unchanged except path resolution", () => {
    expect(resolveSweepOutputDir("run-123", "relative-output")).toBe(
      path.resolve("relative-output"),
    );
  });

  it("creates the default output as a unique per-run temp root", () => {
    const outputDir = resolveSweepOutputDir("run-123");
    try {
      expect(path.basename(outputDir)).toMatch(/^pi-d360-capability-sweeps-run-123-/);
      expect(path.dirname(outputDir)).toBe(os.tmpdir());
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe("d360 capability sweep planning", () => {
  it("plans dry-run coverage for every capability and live checks only for read/safe-post capabilities", () => {
    const plan = buildCapabilitySweepPlan(
      [listCapability, destructiveCapability, safePostCapability],
      {
        targetOrg: "Data360ReadOnlySandbox",
        live: true,
      },
    );

    expect(
      plan.filter((check) => check.stage === "dry_run").map((check) => check.capability),
    ).toEqual(["d360_data_spaces_list", "d360_dmo_delete", "d360_query_sql"]);
    expect(plan.filter((check) => check.stage === "live").map((check) => check.capability)).toEqual(
      ["d360_data_spaces_list", "d360_query_sql"],
    );
  });

  it("waits for dynamic list results instead of marking known detail capabilities as skipped", () => {
    const plan = buildCapabilitySweepPlan(
      [
        {
          ...listCapability,
          name: "d360_data_streams_list",
          family: "DataStreams",
        },
        streamDetailCapability,
      ],
      {
        targetOrg: "Data360ReadOnlySandbox",
        live: true,
      },
    );

    expect(plan.map((check) => `${check.stage}:${check.capability}`)).toEqual([
      "dry_run:d360_data_streams_list",
      "live:d360_data_streams_list",
      "dry_run:d360_datastream_get",
    ]);
  });

  it("builds dynamic detail checks from list responses", () => {
    const followUps = buildDynamicFollowUpChecks(
      {
        stage: "live",
        capability: "d360_data_streams_list",
        family: "DataStreams",
        safety: "read",
      },
      {
        ok: true,
        response: {
          dataStreams: [{ id: "stream-1", name: "StreamOne" }],
        },
      },
      [streamDetailCapability],
    );

    expect(followUps).toEqual([
      expect.objectContaining({
        stage: "live",
        capability: "d360_datastream_get",
        params: { dataStreamId: "stream-1" },
        sourceCapability: "d360_data_streams_list",
      }),
    ]);
  });

  it("builds nested semantic model read checks from a model detail response", () => {
    const followUps = buildDynamicFollowUpChecks(
      {
        stage: "live",
        capability: "d360_sdm_get",
        family: "Semantic Retrieval",
        safety: "read",
        params: { modelApiNameOrId: "model-1" },
      },
      { ok: true, response: { id: "model-1", name: "ModelOne" } },
      [semanticDataObjectsCapability],
    );

    expect(followUps).toEqual([
      expect.objectContaining({
        stage: "live",
        capability: "d360_sdm_data_objects_list",
        params: { modelApiNameOrId: "model-1" },
        sourceCapability: "d360_sdm_get",
      }),
    ]);
  });

  it("uses curated public-safe params for local helper safe POST probes", () => {
    const params = paramsForLiveCheck(localHelperCapability);

    expect(params).toMatchObject({
      sourceDloName: "Sweep_Source__dll",
      targetDmoName: "Sweep_Target__dlm",
    });
    expect(containsPlaceholderValue(params)).toBe(false);
  });

  it("skips unsafe semantic query live probes until a dynamic model-specific payload is available", () => {
    expect(paramsForLiveCheck(semanticQueryCapability)).toBeUndefined();
  });

  it("inserts dynamic follow-ups immediately after the source check", () => {
    const plan = [
      { stage: "live" as const, capability: "d360_dmo_mapping_list" },
      { stage: "mutate" as const, capability: "d360_dmo_delete" },
    ];
    const seen = new Set(plan.map((check) => `${check.stage}:${check.capability}`));

    insertFollowUpChecks(plan, 0, seen, [
      {
        stage: "live",
        capability: "d360_dmo_mapping_get",
        params: { mappingName: "mapping-1" },
      },
    ]);

    expect(plan.map((check) => check.capability)).toEqual([
      "d360_dmo_mapping_list",
      "d360_dmo_mapping_get",
      "d360_dmo_delete",
    ]);
  });

  it("supports preset thresholds for CI-friendly runs", () => {
    expect(applySweepPreset({}, "agentforce-stdm-mutate")).toMatchObject({
      minMutationOk: 30,
      requiredOutcomes: expect.objectContaining({
        d360_sdm_relationship_create: "mutation_ok",
        d360_transform_update: "mutation_ok",
        d360_dataaction_create: "mutation_ok",
      }),
    });
  });

  it("selects specific mutation lifecycles", () => {
    const selected = buildMutationLifecyclePlans("20260519010101", ["dmo", "transform"]);

    expect(selected.map((lifecycle) => lifecycle.resourceName)).toEqual([
      "PiSweepDmo_20260519010101",
      "PiSwTx_20260519010101",
    ]);
  });

  it("builds discovered stale cleanup checks from matching resources", () => {
    const cleanup = buildDiscoveredCleanupLifecyclePlan([
      { family: "DLO", name: "PiSweepDlo_20260519010101__dll" },
      { family: "DLO", name: "RegularObject__dll" },
      { family: "Semantic Retrieval", name: "PiSweepSdm_20260519010101" },
      { family: "DataAction", name: "PiSweepAction_20260519010101" },
    ]);

    expect(cleanup.steps.map((step) => step.capability)).toEqual([
      "d360_dlo_delete",
      "d360_sdm_delete",
      "d360_dataaction_delete",
    ]);
  });

  it("builds cleanup checks for a run id", () => {
    const cleanup = buildCleanupLifecyclePlan("20260519010101");

    expect(cleanup.steps.map((step) => step.capability)).toEqual(
      expect.arrayContaining([
        "d360_dmo_delete",
        "d360_dlo_delete",
        "d360_sdm_delete",
        "d360_transform_delete",
      ]),
    );
    expect(
      cleanup.steps.some((step) => step.params?.dmoName === "PiSweepDmo_20260519010101__dlm"),
    ).toBe(true);
    expect(cleanup.steps.some((step) => step.params?.transformId === "PiSwTx_20260519010101")).toBe(
      true,
    );
  });

  it("evaluates coverage thresholds and required outcomes", () => {
    const records = [
      {
        stage: "live" as const,
        capability: "a",
        family: "A",
        outcome: "reachable" as const,
        fail: false,
        summary: "ok",
      },
      {
        stage: "mutate" as const,
        capability: "b",
        family: "B",
        outcome: "mutation_ok" as const,
        fail: false,
        summary: "ok",
      },
      {
        stage: "live_skip" as const,
        capability: "c",
        family: "C",
        outcome: "skipped_needs_payload" as const,
        fail: false,
        summary: "skip",
      },
    ];

    expect(
      evaluateSweepThresholds(records, {
        minReachable: 1,
        minMutationOk: 1,
        maxSkipped: 1,
        requiredOutcomes: { b: "mutation_ok" },
      }),
    ).toEqual([]);
    expect(
      evaluateSweepThresholds(records, { minReachable: 2, requiredOutcomes: { b: "reachable" } }),
    ).toEqual(
      expect.arrayContaining([
        "reachable count 1 is below --min-reachable 2",
        "b did not produce required outcome reachable",
      ]),
    );
  });

  it("builds a family summary table model", () => {
    const rows = buildFamilySummary([
      {
        stage: "live" as const,
        capability: "a",
        family: "A",
        outcome: "reachable" as const,
        fail: false,
        summary: "ok",
      },
      {
        stage: "mutate" as const,
        capability: "b",
        family: "A",
        outcome: "mutation_ok" as const,
        fail: false,
        summary: "ok",
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({ family: "A", reachable: 1, mutation_ok: 1, total: 2 }),
    ]);
  });

  it("builds placeholder params for dry-run request resolution without using them for live checks", () => {
    expect(paramsForDryRun(destructiveCapability)).toEqual({ dmoName: "SweepDryRunDmoName" });
    expect(paramsForLiveCheck(destructiveCapability)).toBeUndefined();
    expect(paramsForLiveCheck(safePostCapability)).toMatchObject({
      sql: expect.stringContaining("COUNT(*)"),
    });
  });

  it("detects placeholder payloads before live execution", () => {
    expect(containsPlaceholderValue({ body: { apiName: "Example_Score__cio" } })).toBe(true);
    expect(containsPlaceholderValue({ body: { semanticModelId: "ExampleSemanticModel" } })).toBe(
      true,
    );
    expect(containsPlaceholderValue({ limit: 5, query: "AI Agent Interaction" })).toBe(false);
  });

  it("builds a sweep-owned DMO lifecycle plan", () => {
    const lifecycle = buildDmoLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepDmo_20260519010101");
    expect(lifecycle.dmoName).toBe("PiSweepDmo_20260519010101__dlm");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_dmo_create",
      "d360_dmo_get",
      "d360_dmo_update",
      "d360_dmo_get",
      "d360_dmo_delete",
      "d360_dmo_get",
    ]);
    expect(lifecycle.steps[0].params?.body).toMatchObject({
      name: "PiSweepDmo_20260519010101",
      label: "Pi Sweep DMO 20260519010101",
      category: "PROFILE",
    });
    expect(JSON.stringify(lifecycle.steps[0].params?.body)).not.toContain("creationType");
    expect(lifecycle.steps[4].params).toEqual({ dmoName: "PiSweepDmo_20260519010101__dlm" });
  });

  it("builds a sweep-owned DLO lifecycle plan", () => {
    const lifecycle = buildDloLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepDlo_20260519010101__dll");
    expect(lifecycle.dloName).toBe("PiSweepDlo_20260519010101__dll");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_dlo_create",
      "d360_dlo_get",
      "d360_dlo_update",
      "d360_dlo_get",
      "d360_dlo_delete",
      "d360_dlo_get",
    ]);
    expect(lifecycle.steps[0].params?.body).toMatchObject({
      name: "PiSweepDlo_20260519010101__dll",
      label: "Pi Sweep DLO 20260519010101",
      category: "Other",
      dataspaceInfo: [{ name: "default" }],
    });
    expect(lifecycle.steps[2].params?.body).toEqual({
      label: "Pi Sweep DLO 20260519010101 Updated",
    });
    expect(lifecycle.steps[4].params).toEqual({ dloName: "PiSweepDlo_20260519010101__dll" });
  });

  it("retries transient processing-state lifecycle responses", () => {
    expect(
      shouldRetrySweepResult({
        ok: false,
        error:
          "Data Lake Object is currently in processing or deleting cannot be updated or deleted.",
      }),
    ).toBe(true);
    expect(
      shouldRetrySweepResult({
        ok: false,
        error:
          "Cannot schedule a transform that is not active, transform X is currently: PROCESSING",
      }),
    ).toBe(true);
    expect(
      shouldRetrySweepResult({
        ok: false,
        error:
          "You can't delete data transforms that are either being processed or are being deleted.",
      }),
    ).toBe(true);
    expect(
      shouldRetrySweepResult({
        ok: false,
        error:
          "MktDataTransform can only be updated when it is not a draft with a ACTIVE/ERROR state",
      }),
    ).toBe(true);
    expect(
      shouldRetrySweepResult(
        { ok: true },
        { stage: "live", capability: "d360_dlo_get", sourceCapability: "dlo_delete_verify" },
      ),
    ).toBe(true);
    expect(shouldRetrySweepResult({ ok: false, error: "Unrecognized field" })).toBe(false);
  });

  it("builds a sweep-owned DLO-to-DMO mapping lifecycle plan", () => {
    const lifecycle = buildMappingLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepMapping_20260519010101");
    expect(lifecycle.dmoName).toBe("PiSweepMapDmo_20260519010101__dlm");
    expect(lifecycle.dloName).toBe("PiSweepMapDlo_20260519010101__dll");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_dlo_create",
      "d360_dlo_get",
      "d360_dmo_create",
      "d360_dmo_get",
      "d360_dmo_mapping_create",
      "d360_dmo_mapping_list",
      "d360_dmo_delete",
      "d360_dmo_get",
      "d360_dlo_delete",
      "d360_dlo_get",
    ]);
    expect(lifecycle.steps[4].params?.body).toEqual({
      sourceEntityDeveloperName: "PiSweepMapDlo_20260519010101__dll",
      targetEntityDeveloperName: "PiSweepMapDmo_20260519010101__dlm",
      fieldMapping: [
        { sourceFieldDeveloperName: "Id__c", targetFieldDeveloperName: "Id__c" },
        { sourceFieldDeveloperName: "Name__c", targetFieldDeveloperName: "Name__c" },
      ],
    });
  });

  it("builds a sweep-owned semantic model shell lifecycle plan", () => {
    const lifecycle = buildSemanticModelLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepSdm_20260519010101");
    expect(lifecycle.modelApiNameOrId).toBe("PiSweepSdm_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_sdm_create",
      "d360_sdm_get",
      "d360_sdm_validate",
      "d360_sdm_delete",
      "d360_sdm_get",
    ]);
    expect(lifecycle.steps[0].params?.body).toEqual({
      apiName: "PiSweepSdm_20260519010101",
      label: "Pi Sweep SDM 20260519010101",
      description: "Sweep-owned semantic model shell created by run 20260519010101.",
      dataspace: "default",
    });
    expect(lifecycle.steps[3].params).toEqual({
      modelApiNameOrId: "PiSweepSdm_20260519010101",
    });
  });

  it("builds a sweep-owned semantic data-object lifecycle plan", () => {
    const lifecycle = buildSemanticDataObjectLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepSdmDo_20260519010101");
    expect(lifecycle.dmoName).toBe("PiSweepSdmDmo_20260519010101__dlm");
    expect(lifecycle.modelApiNameOrId).toBe("PiSweepSdmDo_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_dmo_create",
      "d360_dmo_get",
      "d360_sdm_create",
      "d360_sdm_get",
      "d360_sdm_data_object_create",
      "d360_sdm_data_objects_list",
      "d360_sdm_validate",
      "d360_sdm_delete",
      "d360_sdm_get",
      "d360_dmo_delete",
      "d360_dmo_get",
    ]);
    expect(lifecycle.steps[4].params).toEqual({
      modelApiNameOrId: "PiSweepSdmDo_20260519010101",
      body: {
        apiName: "PiSweepSdmDataObject_20260519010101",
        label: "Pi Sweep SDM Data Object 20260519010101",
        dataObjectType: "Dmo",
        dataObjectName: "PiSweepSdmDmo_20260519010101__dlm",
        shouldIncludeAllFields: true,
      },
    });
  });

  it("builds a sweep-owned semantic calculated field lifecycle plan", () => {
    const lifecycle = buildSemanticCalculatedFieldsLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepSdmCalc_20260519010101");
    expect(lifecycle.modelApiNameOrId).toBe("PiSweepSdmCalc_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_sdm_create",
      "d360_sdm_get",
      "d360_sdm_calc_measure_create",
      "d360_sdm_calc_measures_list",
      "d360_sdm_calc_dim_create",
      "d360_sdm_calc_dims_list",
      "d360_sdm_validate",
      "d360_sdm_delete",
      "d360_sdm_get",
    ]);
    expect(lifecycle.steps[2].params).toEqual({
      modelApiNameOrId: "PiSweepSdmCalc_20260519010101",
      body: {
        label: "Pi Sweep Calc Measurement 20260519010101",
        expression: "COUNT('x')",
        dataType: "Number",
        aggregationType: "UserAgg",
      },
    });
    expect(lifecycle.steps[4].params).toEqual({
      modelApiNameOrId: "PiSweepSdmCalc_20260519010101",
      body: {
        label: "Pi Sweep Calc Dimension 20260519010101",
        expression: "IF 'x' = 'x' THEN 'High' ELSE 'Low' END",
        dataType: "Text",
      },
    });
  });

  it("builds a sweep-owned semantic metric lifecycle plan", () => {
    const lifecycle = buildSemanticMetricLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepSdmMetric_20260519010101");
    expect(lifecycle.dloName).toBe("PiSweepMetricDlo_20260519010101__dll");
    expect(lifecycle.modelApiNameOrId).toBe("PiSweepSdmMetric_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_dlo_create",
      "d360_dlo_get",
      "d360_sdm_create",
      "d360_sdm_get",
      "d360_sdm_data_object_create",
      "d360_sdm_data_objects_list",
      "d360_sdm_metric_create",
      "d360_sdm_metrics_list",
      "d360_sdm_metric_delete",
      "d360_sdm_metric_get",
      "d360_sdm_validate",
      "d360_sdm_delete",
      "d360_sdm_get",
      "d360_dlo_delete",
      "d360_dlo_get",
    ]);
    expect(lifecycle.steps[6].params).toEqual({
      modelApiNameOrId: "PiSweepSdmMetric_20260519010101",
      body: {
        apiName: "PiSweepMetric_20260519010101",
        label: "Pi Sweep Metric 20260519010101",
        measurementReference: {
          tableFieldReference: {
            fieldApiName: "Amount",
            tableApiName: "PiSweepMetricDataObject_20260519010101",
          },
        },
        timeDimensionReference: {
          tableFieldReference: {
            fieldApiName: "EventTime",
            tableApiName: "PiSweepMetricDataObject_20260519010101",
          },
        },
        aggregationType: "Sum",
        timeGrains: ["Day", "Month"],
        additionalDimensions: [
          {
            tableFieldReference: {
              fieldApiName: "Name",
              tableApiName: "PiSweepMetricDataObject_20260519010101",
            },
          },
        ],
      },
    });
  });

  it("builds a sweep-owned semantic relationship lifecycle plan", () => {
    const lifecycle = buildSemanticRelationshipLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepSdmRel_20260519010101");
    expect(lifecycle.dloName).toBe("PiSwRelL_20260519010101__dll");
    expect(lifecycle.secondaryDloName).toBe("PiSwRelR_20260519010101__dll");
    expect(lifecycle.modelApiNameOrId).toBe("PiSweepSdmRel_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_dlo_create",
      "d360_dlo_get",
      "d360_dlo_create",
      "d360_dlo_get",
      "d360_sdm_create",
      "d360_sdm_get",
      "d360_sdm_data_object_create",
      "d360_sdm_data_object_create",
      "d360_sdm_relationship_create",
      "d360_sdm_relationships_list",
      "d360_sdm_relationship_delete",
      "d360_sdm_relationship_get",
      "d360_sdm_validate",
      "d360_sdm_delete",
      "d360_sdm_get",
      "d360_dlo_delete",
      "d360_dlo_get",
      "d360_dlo_delete",
      "d360_dlo_get",
    ]);
    expect(lifecycle.steps[8].params?.body).toEqual({
      apiName: "PiSweepRelationship_20260519010101",
      label: "Pi Sweep Relationship 20260519010101",
      leftSemanticDefinitionApiName: "PiSweepRelLeftObject_20260519010101",
      rightSemanticDefinitionApiName: "PiSweepRelRightObject_20260519010101",
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
    });
  });

  it("builds a sweep-owned segment lifecycle plan", () => {
    const lifecycle = buildSegmentLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepSegment_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_segment_create",
      "d360_segment_get",
      "d360_segment_delete",
      "d360_segment_get",
    ]);
    expect(lifecycle.steps[0].params?.body).toMatchObject({
      developerName: "PiSweepSegment_20260519010101",
      segmentOnApiName: "ssot__AiAgentSession__dlm",
      segmentType: "Dbt",
      segmentCreationFlow: "Visual",
    });
  });

  it("builds retriever delete follow-ups from the create response root", () => {
    const followUps = buildDynamicFollowUpChecks(
      { stage: "mutate", capability: "d360_retriever_create", family: "Semantic Retrieval" },
      {
        ok: true,
        response: {
          url: "/services/data/v66.0/ssot/machine-learning/retrievers/1CxExample",
          dataSpaces: [{ name: "default" }],
        },
      },
      [],
    );

    expect(followUps.map((step) => step.capability)).toEqual([
      "d360_retriever_get",
      "d360_retriever_delete",
      "d360_retriever_get",
    ]);
    expect(followUps[1].params).toEqual({ retrieverIdOrName: "1CxExample" });
  });

  it("builds a retriever mutation lifecycle plan", () => {
    const lifecycle = buildMutationLifecyclePlans("20260519010101", ["retriever-mutation"])[0];

    expect(lifecycle.resourceName).toBe("PiSweepRetriever_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual(["d360_search_index_list"]);
    expect(lifecycle.steps[0].sourceCapability).toBe("retriever_source_index_select");
  });

  it("builds search index and retriever readiness plans", () => {
    expect(buildSearchIndexReadinessPlan().steps.map((step) => step.capability)).toEqual([
      "d360_model_artifact_list",
      "d360_search_index_config",
      "d360_search_index_list",
    ]);
    expect(buildRetrieverReadinessPlan().steps.map((step) => step.capability)).toEqual([
      "d360_retriever_list",
    ]);
  });

  it("builds a sweep-owned activation lifecycle plan", () => {
    const lifecycle = buildActivationLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepActivation_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_activation_target_create",
      "d360_activation_target_list",
      "d360_segment_create",
      "d360_segment_get",
      "d360_activation_create",
      "d360_segment_delete",
      "d360_segment_get",
    ]);
    expect(lifecycle.steps[4].params?.body).toMatchObject({
      name: "PiSweepActivation_20260519010101",
      activationTargetName: "PiSweepActTarget_20260519010101",
      dataSpaceName: "default",
      refreshType: "INCREMENTAL",
      segmentApiName: "PiSweepActSegment_20260519010101",
      activationTargetSubjectConfig: { developerName: "ssot__AiAgentSession__dlm" },
    });
  });

  it("builds activation delete follow-ups from create response", () => {
    const followUps = buildDynamicFollowUpChecks(
      { stage: "mutate", capability: "d360_activation_create", family: "Activation" },
      { ok: true, response: { id: "activation-1", name: "Activation" } },
      [],
    );

    expect(followUps.map((step) => step.capability)).toEqual([
      "d360_activation_get",
      "d360_activation_delete",
      "d360_activation_get",
    ]);
    expect(followUps[1].params).toEqual({ activationId: "activation-1" });
  });

  it("builds a sweep-owned activation target lifecycle plan", () => {
    const lifecycle = buildActivationTargetLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepActTarget_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_activation_target_create",
      "d360_activation_target_list",
    ]);
    expect(lifecycle.steps[0].params?.body).toEqual({
      name: "PiSweepActTarget_20260519010101",
      platformType: "DataCloud",
      dataSpaceName: "default",
      connector: {},
    });
  });

  it("builds a sweep-owned calculated insight lifecycle plan", () => {
    const lifecycle = buildCalculatedInsightLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepCi_20260519010101__cio");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_ci_validate",
      "d360_ci_create",
      "d360_ci_get",
      "d360_ci_run",
      "d360_ci_delete",
      "d360_ci_get",
    ]);
    expect(lifecycle.steps[1].params?.body).toMatchObject({
      apiName: "PiSweepCi_20260519010101__cio",
      displayName: "Pi Sweep CI 20260519010101",
      definitionType: "CALCULATED_METRIC",
      dataSpaceName: "default",
      publishScheduleInterval: "SYSTEM_MANAGED",
    });
  });

  it("builds a sweep-owned data action lifecycle plan", () => {
    const lifecycle = buildDataActionLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSweepDataAction_20260519010101");
    expect(lifecycle.dataActionTargetName).toBe("PiSweepTarget_20260519010101");
    expect(lifecycle.dataActionName).toBe("PiSweepAction_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_dataaction_target_create",
      "d360_dataaction_target_get",
      "d360_dataaction_create",
      "d360_dataaction_get",
      "d360_dataaction_delete",
      "d360_dataaction_get",
      "d360_dataaction_target_delete",
      "d360_dataaction_target_get",
    ]);
    expect(lifecycle.steps[2].params?.body).toMatchObject({
      developerName: "PiSweepAction_20260519010101",
      dataActionTargetNames: ["PiSweepTarget_20260519010101"],
      dataActionSources: [
        {
          sourceName: "ssot__AiAgentInteraction__dlm",
          sourceType: "DataModelEntity",
          sourceCdcSubscriptions: ["CREATE", "UPDATE", "DELETE"],
        },
      ],
    });
  });

  it("builds a sweep-owned data transform lifecycle plan", () => {
    const lifecycle = buildTransformLifecyclePlan("20260519010101");

    expect(lifecycle.resourceName).toBe("PiSwTx_20260519010101");
    expect(lifecycle.dloName).toBe("PiSwTxTgt_20260519010101__dll");
    expect(lifecycle.secondaryDloName).toBe("AIRetrieverRequest__dll");
    expect(lifecycle.transformName).toBe("PiSwTx_20260519010101");
    expect(lifecycle.steps.map((step) => step.capability)).toEqual([
      "d360_dlo_get",
      "d360_dlo_create",
      "d360_dlo_get",
      "d360_transform_validate",
      "d360_transform_create",
      "d360_transform_get",
      "d360_transform_update",
      "d360_transform_get",
      "d360_transform_schedule_set",
      "d360_transform_schedule_get",
      "d360_transform_delete",
      "d360_transform_get",
      "d360_dlo_delete",
      "d360_dlo_get",
    ]);
    expect(lifecycle.steps[3].params?.body).toMatchObject({
      name: "PiSwTx_20260519010101",
      label: "Pi Sweep Transform 20260519010101",
      type: "BATCH",
    });
    expect(lifecycle.steps[4].params?.body).toMatchObject({
      name: "PiSwTx_20260519010101",
      label: "Pi Sweep Transform 20260519010101",
      type: "BATCH",
      definition: {
        type: "STL",
        version: "66.0",
      },
    });
  });

  it("requires explicit mutation gate for sweep-owned destructive lifecycle checks", () => {
    const previousTarget = process.env.SF_PI_D360_SWEEP_MUTATION_TARGET_ORG;
    process.env.SF_PI_D360_SWEEP_MUTATION_TARGET_ORG = "Data360MutationSandbox";
    try {
      expect(
        canRunMutationLifecycle({
          mutate: true,
          targetOrg: "Data360MutationSandbox",
          runId: "20260519010101",
          destructiveEnvValue: "Data360MutationSandbox",
        }),
      ).toEqual({ ok: true });

      expect(
        canRunMutationLifecycle({
          mutate: true,
          targetOrg: "OtherOrg",
          runId: "20260519010101",
          destructiveEnvValue: "Data360MutationSandbox",
        }).ok,
      ).toBe(false);
      expect(
        canRunMutationLifecycle({
          mutate: true,
          targetOrg: "Data360MutationSandbox",
          runId: "20260519010101",
        }).ok,
      ).toBe(false);
    } finally {
      if (previousTarget === undefined) delete process.env.SF_PI_D360_SWEEP_MUTATION_TARGET_ORG;
      else process.env.SF_PI_D360_SWEEP_MUTATION_TARGET_ORG = previousTarget;
    }
  });

  it("classifies mutation outcomes separately from read reachability", () => {
    expect(
      classifySweepResult({ stage: "mutate", capability: "d360_dmo_create" }, { ok: true }),
    ).toMatchObject({ outcome: "mutation_ok", fail: false });
  });

  it("classifies live outcomes without failing on expected org-state limitations", () => {
    expect(
      classifySweepResult({ stage: "dry_run", capability: "d360_dmo_delete" }, { ok: true }),
    ).toMatchObject({ outcome: "dry_run_ok", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_search_index_list" },
        { ok: false, status: 404, error: "NOT_FOUND" },
      ),
    ).toMatchObject({ outcome: "not_found_optional", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_dlo_describe" },
        {
          ok: false,
          status: 500,
          error:
            "Please provide a valid recordId of type DataLakeObjectInstance or a valid developerName for a Data Lake Object.",
        },
      ),
    ).toMatchObject({ outcome: "dependency_missing", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_dmo_mapping_list" },
        { ok: false, status: 500, error: "DMO or Source Object (CRM) developer Name is missing" },
      ),
    ).toMatchObject({ outcome: "dependency_missing", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_metadata" },
        { ok: false, status: 500, error: "Field Ids should not be empty" },
      ),
    ).toMatchObject({ outcome: "dependency_missing", fail: false });

    expect(
      classifySweepResult(
        { stage: "mutate", capability: "d360_sdm_relationship_create" },
        { ok: false, status: 281, error: "Can not deserialize: unexpected array" },
      ),
    ).toMatchObject({ outcome: "skipped_needs_payload", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_model_artifact_list" },
        {
          ok: true,
          response: { modelArtifacts: [{ name: "GPT41", capability: "ChatCompletion" }] },
        },
      ),
    ).toMatchObject({ outcome: "feature_gated", fail: false });

    expect(
      classifySweepResult(
        { stage: "mutate", capability: "d360_transform_update" },
        {
          ok: false,
          status: 500,
          error: "MktDataTransform can only be updated when it is not a draft",
        },
      ),
    ).toMatchObject({ outcome: "dependency_missing", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_ci_validate" },
        { ok: false, status: 500, error: "API_DISABLED_FOR_ORG This feature is not supported" },
      ),
    ).toMatchObject({ outcome: "feature_gated", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_ci_run_status" },
        { ok: false, status: 500, error: "METHOD_NOT_ALLOWED HTTP Method 'GET' not allowed" },
      ),
    ).toMatchObject({ outcome: "skipped_needs_payload", fail: false });

    expect(
      classifySweepResult(
        {
          stage: "mutate",
          capability: "d360_dataaction_delete",
          sourceCapability: "cleanup_dataaction",
        },
        { ok: false, status: 500, error: "An unexpected error occurred" },
      ),
    ).toMatchObject({ outcome: "not_found_optional", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "agent_observability.join_interaction_trace" },
        { ok: false, error: "No STDM interaction found for 'abc'." },
      ),
    ).toMatchObject({ outcome: "not_found_optional", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_dlo_get", sourceCapability: "dlo_delete_verify" },
        {
          ok: false,
          status: 500,
          error:
            "Please provide a valid recordId of type DataLakeObjectInstance or a valid developerName for a Data Lake Object.",
        },
      ),
    ).toMatchObject({ outcome: "not_found_optional", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_sdm_get", sourceCapability: "sdm_delete_verify" },
        {
          ok: false,
          status: 500,
          error: "SemanticAuthoringError: Semantic object not found",
        },
      ),
    ).toMatchObject({ outcome: "not_found_optional", fail: false });

    expect(
      classifySweepResult(
        {
          stage: "live",
          capability: "d360_sdm_relationship_get",
          sourceCapability: "sdm_relationship_delete_verify",
        },
        {
          ok: false,
          status: 500,
          error: "Semantic definition (RelA) doesn't exist in semantic model.",
        },
      ),
    ).toMatchObject({ outcome: "not_found_optional", fail: false });

    expect(
      classifySweepResult(
        { stage: "live", capability: "d360_data_spaces_list" },
        { ok: false, error: "Cannot read properties of undefined" },
      ),
    ).toMatchObject({ outcome: "failed", fail: true });
  });
});
