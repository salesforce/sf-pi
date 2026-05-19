/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  buildCapabilitySweepPlan,
  buildDloLifecyclePlan,
  buildDmoLifecyclePlan,
  buildDynamicFollowUpChecks,
  buildMappingLifecyclePlan,
  buildSemanticCalculatedFieldsLifecyclePlan,
  buildSemanticDataObjectLifecyclePlan,
  buildSemanticModelLifecyclePlan,
  canRunMutationLifecycle,
  classifySweepResult,
  containsPlaceholderValue,
  insertFollowUpChecks,
  paramsForDryRun,
  paramsForLiveCheck,
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

describe("d360 capability sweep planning", () => {
  it("plans dry-run coverage for every capability and live checks only for read/safe-post capabilities", () => {
    const plan = buildCapabilitySweepPlan(
      [listCapability, destructiveCapability, safePostCapability],
      {
        targetOrg: "AgentforceSTDM",
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
        targetOrg: "AgentforceSTDM",
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

  it("requires explicit mutation gate for sweep-owned destructive lifecycle checks", () => {
    expect(
      canRunMutationLifecycle({
        mutate: true,
        targetOrg: "AgentforceSTDM",
        runId: "20260519010101",
        destructiveEnvValue: "AgentforceSTDM",
      }),
    ).toEqual({ ok: true });

    expect(
      canRunMutationLifecycle({
        mutate: true,
        targetOrg: "OtherOrg",
        runId: "20260519010101",
        destructiveEnvValue: "AgentforceSTDM",
      }).ok,
    ).toBe(false);
    expect(
      canRunMutationLifecycle({
        mutate: true,
        targetOrg: "AgentforceSTDM",
        runId: "20260519010101",
      }).ok,
    ).toBe(false);
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
        { stage: "live", capability: "d360_data_spaces_list" },
        { ok: false, error: "Cannot read properties of undefined" },
      ),
    ).toMatchObject({ outcome: "failed", fail: true });
  });
});
