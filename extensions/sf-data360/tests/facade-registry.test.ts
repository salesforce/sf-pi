/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  findOperation,
  findRunbook,
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

  it("finds Agentforce observability by intent", () => {
    const results = searchRegistry("agent trace errors");

    expect(results[0]?.family).toBe("Agent Observability");
    expect(results[0]?.runbooks).toContain("agent_observability.platform_error_traces");
  });

  it("finds expanded read-only domain families by intent", () => {
    expect(searchRegistry("data stream connector ingestion")[0]).toMatchObject({
      family: "Ingestion",
      operations: expect.arrayContaining(["d360_data_streams_list", "d360_connectors_list"]),
    });
    expect(searchRegistry("identity resolution rulesets")[0]).toMatchObject({
      family: "Identity Resolution",
      operations: expect.arrayContaining(["d360_identity_resolutions_list"]),
    });
    expect(searchRegistry("semantic retriever search index")[0]).toMatchObject({
      family: "Semantic Retrieval",
      operations: expect.arrayContaining(["d360_semantic_models_list", "d360_retrievers_list"]),
    });
    expect(searchRegistry("datakit bundle deploy")[0]).toMatchObject({
      family: "DataKit",
      operations: expect.arrayContaining(["d360_datakits_list"]),
    });
  });

  it("finds safe POST operation families by intent", () => {
    expect(searchRegistry("metadata search natural language")[0]).toMatchObject({
      family: "Metadata",
      operations: expect.arrayContaining(["d360_metadata_search"]),
    });
    expect(searchRegistry("validate calculated insight sql")[0]).toMatchObject({
      family: "Calculated Insights",
      operations: expect.arrayContaining(["d360_ci_validate"]),
    });
    expect(searchRegistry("semantic query gateway")[0]).toMatchObject({
      family: "Semantic Retrieval",
      operations: expect.arrayContaining(["d360_semantic_query"]),
    });
    expect(searchRegistry("create run enable calculated insight")[0]).toMatchObject({
      family: "Calculated Insights",
      operations: expect.arrayContaining(["d360_ci_create", "d360_ci_run", "d360_ci_enable"]),
    });
    expect(searchRegistry("create publish deactivate audience segment")[0]).toMatchObject({
      family: "Segment",
      operations: expect.arrayContaining([
        "d360_segment_create",
        "d360_segment_publish",
        "d360_segment_deactivate",
      ]),
    });
    expect(searchRegistry("create update activation target audience delivery")[0]).toMatchObject({
      family: "Activation",
      operations: expect.arrayContaining([
        "d360_activation_create",
        "d360_activation_update",
        "d360_activation_target_create",
        "d360_activation_target_update",
      ]),
    });
    expect(searchRegistry("create update run schedule data transform")[0]).toMatchObject({
      family: "DataTransform",
      operations: expect.arrayContaining([
        "d360_transform_create",
        "d360_transform_update",
        "d360_transform_run",
        "d360_transform_schedule_set",
      ]),
    });
    expect(searchRegistry("create update data action target event delivery")[0]).toMatchObject({
      family: "DataAction",
      operations: expect.arrayContaining([
        "d360_dataaction_create",
        "d360_dataaction_target_create",
        "d360_dataaction_target_update",
      ]),
    });
    expect(
      searchRegistry("create update retriever configuration search index rag vector")[0],
    ).toMatchObject({
      family: "Semantic Retrieval",
      operations: expect.arrayContaining([
        "d360_search_index_create",
        "d360_search_index_update",
        "d360_retriever_create",
        "d360_retriever_update",
        "d360_retriever_config_create",
        "d360_retriever_config_update",
      ]),
    });
    expect(searchRegistry("connection test connector")[0]).toMatchObject({
      family: "Connection",
      operations: expect.arrayContaining(["d360_connection_test"]),
    });
  });

  it("returns operation and runbook examples that point at registered names", () => {
    for (const example of Object.values(getD360Examples()) as Array<Record<string, unknown>>) {
      const operation = typeof example.operation === "string" ? example.operation : undefined;
      const runbook = typeof example.runbook === "string" ? example.runbook : undefined;
      if (operation) expect(findOperation(operation)).toBeTruthy();
      if (runbook) expect(findRunbook(runbook)).toBeTruthy();
      expect(operation || runbook).toBeTruthy();
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
