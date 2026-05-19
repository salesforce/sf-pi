/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  findCapability,
  getD360Capabilities,
  getD360Examples,
  getD360Families,
  getD360Operations,
  getD360Runbooks,
  searchRegistry,
} from "../lib/facade/registry.ts";

describe("d360 facade registry", () => {
  it("keeps operation and runbook names unique", () => {
    const operationNames = getD360Operations().map((operation) => operation.name);
    const runbookNames = getD360Runbooks().map((runbook) => runbook.name);

    expect(new Set(operationNames).size).toBe(operationNames.length);
    expect(new Set(runbookNames).size).toBe(runbookNames.length);
  });

  it("exposes operations and runbooks through one capability view", () => {
    expect(getD360Capabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "d360_query_sql",
          kind: "rest_operation",
          family: "Query",
          phase: "retrieve",
          safety: "safe_post",
        }),
        expect.objectContaining({
          name: "agent_observability.stdm_session_timeline",
          kind: "runbook",
          family: "Agent Observability",
          phase: "observe",
          safety: "read",
          requiredParams: ["session_id"],
        }),
      ]),
    );

    expect(findCapability("agent_observability.stdm_session_timeline")).toMatchObject({
      kind: "runbook",
      phase: "observe",
    });
  });

  it("finds Agentforce observability by intent", () => {
    const results = searchRegistry("agent trace errors");

    expect(results[0]?.family).toBe("Agent Observability");
    expect(results[0]?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "agent_observability.platform_error_traces" }),
      ]),
    );
  });

  it("returns matching capabilities for each search result", () => {
    const results = searchRegistry("session timeline");

    expect(results[0]).toMatchObject({ family: "Agent Observability" });
    expect(results[0]?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "agent_observability.stdm_session_timeline",
          kind: "runbook",
        }),
      ]),
    );
    expect(results[0]).not.toHaveProperty("operations");
    expect(results[0]).not.toHaveProperty("runbooks");
  });

  it("finds expanded read-only domain families by intent", () => {
    const ingestion = searchRegistry("connector ingestion connection").find(
      (result) => result.family === "Ingestion",
    );
    expectCapabilityNames(ingestion, ["d360_connectors_list"]);
    expectCapabilityNames(searchRegistry("identity resolution rulesets")[0], [
      "d360_identity_resolutions_list",
      "d360_ir_list",
    ]);
    expectCapabilityNames(searchRegistry("semantic retriever search index")[0], [
      "d360_semantic_models_list",
      "d360_retrievers_list",
    ]);
    expectCapabilityNames(searchRegistry("datakit bundle deploy")[0], [
      "d360_datakits_list",
      "d360_datakit_list",
    ]);
  });

  it("finds safe POST operation families by intent", () => {
    expectCapabilityNames(searchRegistry("metadata search natural language")[0], [
      "d360_metadata_search",
    ]);
    expectCapabilityNames(searchRegistry("validate calculated insight sql")[0], [
      "d360_ci_validate",
    ]);
    expectCapabilityNames(searchRegistry("semantic query gateway")[0], ["d360_semantic_query"]);
    expectCapabilityNames(searchRegistry("create run enable calculated insight")[0], [
      "d360_ci_create",
      "d360_ci_run",
      "d360_ci_enable",
    ]);
    expectCapabilityNames(searchRegistry("create publish deactivate audience segment")[0], [
      "d360_segment_create",
      "d360_segment_publish",
      "d360_segment_deactivate",
    ]);
    expectCapabilityNames(searchRegistry("create update activation target audience delivery")[0], [
      "d360_activation_create",
      "d360_activation_update",
      "d360_activation_target_create",
      "d360_activation_target_update",
    ]);
    expectCapabilityNames(searchRegistry("create update run schedule data transform")[0], [
      "d360_transform_create",
      "d360_transform_update",
      "d360_transform_run",
      "d360_transform_schedule_set",
    ]);
    expectCapabilityNames(searchRegistry("create update data action target event delivery")[0], [
      "d360_dataaction_create",
      "d360_dataaction_target_create",
      "d360_dataaction_target_update",
    ]);
    expectCapabilityNames(
      searchRegistry("create update retriever configuration search index rag vector")[0],
      [
        "d360_search_index_create",
        "d360_search_index_update",
        "d360_retriever_create",
        "d360_retriever_update",
        "d360_retriever_config_create",
        "d360_retriever_config_update",
      ],
    );
    expectCapabilityNames(
      searchRegistry("create update run data stream salesforce snowflake ingestion")[0],
      [
        "d360_datastream_create",
        "d360_datastream_update",
        "d360_datastream_run",
        "d360_datastream_create_sfdc",
        "d360_datastream_create_snowflake",
      ],
    );
    expectCapabilityNames(searchRegistry("create update data model object dmo schema")[0], [
      "d360_dmo_create",
      "d360_dmo_update",
    ]);
    const dlo = searchRegistry("create update data lake object dlo schema").find(
      (result) => result.family === "DLO",
    );
    expectCapabilityNames(dlo, ["d360_dlo_create", "d360_dlo_update"]);
    expectCapabilityNames(searchRegistry("create update add field mapping dlo dmo")[0], [
      "d360_dmo_mapping_create",
      "d360_dmo_mapping_update",
      "d360_dmo_field_mapping_add",
    ]);
    expectCapabilityNames(searchRegistry("connection test connector")[0], ["d360_connection_test"]);
    expectCapabilityNames(searchRegistry("create update snowflake connection connector")[0], [
      "d360_connection_create",
      "d360_connection_update",
      "d360_connection_create_snowflake",
    ]);
    expectCapabilityNames(
      searchRegistry("create update publish run identity resolution ruleset")[0],
      ["d360_ir_create", "d360_ir_update", "d360_ir_full_update", "d360_ir_publish", "d360_ir_run"],
    );
    expectCapabilityNames(searchRegistry("create update add member data space dataspace")[0], [
      "d360_dataspace_create",
      "d360_dataspace_update",
      "d360_dataspace_member_add",
    ]);
    expectCapabilityNames(
      searchRegistry("create update clone semantic model data object metric relationship")[0],
      [
        "d360_sdm_create",
        "d360_sdm_update",
        "d360_sdm_clone",
        "d360_sdm_data_object_create",
        "d360_sdm_metric_create",
        "d360_sdm_relationship_create",
      ],
    );
    expectCapabilityNames(searchRegistry("deploy update components datakit bundle package")[0], [
      "d360_datakit_deploy",
    ]);
    expectCapabilityNames(
      searchRegistry("standard mapping create preview field mapping dlo dmo")[0],
      ["d360_standard_mapping_preview", "d360_standard_mapping_create"],
    );
    expectCapabilityNames(searchRegistry("smart field match event date recommend mapping")[0], [
      "d360_preview_field_matches",
      "d360_smart_mapping_suggest",
      "d360_event_date_recommend",
      "d360_smart_datastream_create",
    ]);
  });

  it("uses the live semantic model validation method", () => {
    expect(findCapability("d360_sdm_validate")?.operation).toMatchObject({
      method: "GET",
      safety: "read",
      path: "/ssot/semantic/models/{modelApiNameOrId}/validate",
    });
  });

  it("returns capability-shaped examples that point at registered names", () => {
    for (const example of Object.values(getD360Examples()) as Array<Record<string, unknown>>) {
      const capability = typeof example.capability === "string" ? example.capability : undefined;
      expect(capability).toBeTruthy();
      expect(findCapability(capability ?? "")).toBeTruthy();
    }
  });

  it("keeps confirmed operations reviewable", () => {
    const examples = getD360Examples();

    for (const operation of getD360Operations().filter((entry) => entry.safety === "confirmed")) {
      expect(
        operation.requiredParams?.length,
        `${operation.name} missing required params`,
      ).toBeGreaterThan(0);
      expect(operation.tips, `${operation.name} missing safety tips`).toBeTruthy();
      expect(
        examples[operation.name],
        `${operation.name} missing public-safe example`,
      ).toBeTruthy();
    }
  });

  it("keeps destructive operations reviewable", () => {
    const examples = getD360Examples();
    const destructive = getD360Operations().filter(
      (operation) => operation.safety === "destructive",
    );

    expect(destructive.length).toBeGreaterThan(0);
    for (const operation of destructive) {
      expect(
        operation.requiredParams?.length,
        `${operation.name} missing required params`,
      ).toBeGreaterThan(0);
      expect(operation.tips, `${operation.name} missing safety tips`).toContain("AgentforceSTDM");
      expect(
        examples[operation.name],
        `${operation.name} missing public-safe example`,
      ).toBeTruthy();
    }
  });

  it("validates registry integrity", () => {
    const families = new Set(getD360Families().map((family) => family.name));

    for (const operation of getD360Operations()) {
      expect(families.has(operation.family), `${operation.name} has unknown family`).toBe(true);
      expect(["read", "safe_post", "confirmed", "destructive"]).toContain(operation.safety);
      expect(operation.path).toMatch(/^\//);
      for (const pathParam of operation.path.matchAll(/\{([^}]+)\}/g)) {
        expect(
          operation.requiredParams ?? [],
          `${operation.name} missing path param declaration`,
        ).toContain(pathParam[1]);
      }
    }

    for (const runbook of getD360Runbooks()) {
      expect(families.has(runbook.family), `${runbook.name} has unknown family`).toBe(true);
    }
  });
});

function expectCapabilityNames(
  result: ReturnType<typeof searchRegistry>[number] | undefined,
  names: string[],
): void {
  expect(result?.capabilities.map((capability) => capability.name)).toEqual(
    expect.arrayContaining(names),
  );
}
