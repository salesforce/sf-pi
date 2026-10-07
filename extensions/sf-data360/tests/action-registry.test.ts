/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { getD360Operations } from "../lib/operation-registry.ts";
import {
  findPublicData360Action,
  getPublicData360Actions,
  searchPublicData360Actions,
} from "../lib/actions/action-registry.ts";
import { getData360Journeys } from "../lib/actions/journey-catalog.ts";

const NAMESPACES = new Set([
  "discover",
  "connect",
  "prepare",
  "harmonize",
  "segment",
  "activate",
  "query",
  "semantic",
  "observe",
  "orchestrate",
  "api",
]);

describe("sf_data360 action registry", () => {
  it("maps every upstream operation to one globally unique business action", () => {
    const actions = getPublicData360Actions();
    const upstream = getD360Operations().filter(
      (operation) => (operation as { origin?: string }).origin === "upstream",
    );
    for (const operation of upstream) {
      expect(
        actions.filter(
          (action) =>
            action.operationId === operation.name ||
            action.operationAliases?.includes(operation.name),
        ),
        operation.name,
      ).toHaveLength(1);
    }
    expect(new Set(actions.map((action) => action.action)).size).toBe(actions.length);
    expect(actions.every((action) => NAMESPACES.has(action.namespace))).toBe(true);
    expect(actions.some((action) => action.action.includes(".compat"))).toBe(false);
  });

  it("uses recognizable business namespaces", () => {
    expect(findPublicData360Action("connect.source_schema.test")).toMatchObject({
      namespace: "connect",
      operationId: "d360_ingest_api_schema_test",
      safety: "safe_post",
    });
    expect(findPublicData360Action("prepare.stream.create_ingest_api")).toMatchObject({
      namespace: "prepare",
      operationId: "d360_datastream_create_ingest_api",
      safety: "confirmed",
    });
    expect(findPublicData360Action("query.sql.chunk")).toMatchObject({
      namespace: "query",
      implementation: { kind: "local", name: "query.sql.chunk" },
      requiredParams: ["queryId", "chunkId"],
    });
    expect(findPublicData360Action("query.sql.verify_rows")).toMatchObject({
      namespace: "query",
      implementation: { kind: "local", name: "sql.verify_rows" },
      inputSchema: {
        type: "object",
        required: ["dloName"],
        properties: { dloName: { type: "string" } },
      },
    });
    expect(findPublicData360Action("orchestrate.ingest_csv.plan")).toMatchObject({
      namespace: "orchestrate",
      implementation: { kind: "journey", name: "ingest_csv" },
    });
  });

  it("publishes cross-field requirements for selector-dependent reads", () => {
    expect(findPublicData360Action("harmonize.dmo_mapping.list")).toMatchObject({
      requiredParams: [],
      requiredAnyOf: [["dmoDeveloperName"], ["dloDeveloperName"], ["sourceObjectName"]],
      inputSchema: {
        anyOf: [
          { required: ["dmoDeveloperName"] },
          { required: ["dloDeveloperName"] },
          { required: ["sourceObjectName"] },
        ],
      },
    });
    expect(findPublicData360Action("query.profile.query")).toMatchObject({
      requiredParams: ["dataModelName"],
      requiredAnyOf: [["id"], ["filters"]],
      optionalParams: expect.arrayContaining(["fields", "filters", "limit", "offset", "orderby"]),
    });
    expect(findPublicData360Action("prepare.datakit_components")).toMatchObject({
      requiredParams: ["componentType", "dataKitDevName"],
      optionalParams: ["limit", "offset"],
      inputSchema: {
        required: ["componentType", "dataKitDevName"],
        properties: {
          componentType: {
            type: "string",
            examples: expect.arrayContaining(["DataStreamBundle"]),
          },
        },
      },
    });
  });

  it("requires OpenAPI-mandated Data Kit and data-graph selectors", () => {
    expect(findPublicData360Action("prepare.datakit_component_deps")).toMatchObject({
      requiredParams: ["dataKitId", "componentId", "componentType"],
      optionalParams: ["dataspace"],
    });
    expect(findPublicData360Action("prepare.datakit.deploy")).toMatchObject({
      requiredParams: ["dataKitDevName", "asyncMode", "body"],
      inputSchema: {
        properties: { asyncMode: { type: "boolean" } },
      },
    });
    expect(findPublicData360Action("prepare.datakit.undeploy")).toMatchObject({
      requiredParams: ["dataKitId", "asyncMode", "body"],
      inputSchema: {
        properties: { asyncMode: { type: "boolean" } },
      },
    });
    expect(findPublicData360Action("query.datagraph.lookup")).toMatchObject({
      requiredParams: ["entity", "lookupKeys"],
      optionalParams: ["dataspace", "live", "limit"],
    });
    for (const actionName of [
      "harmonize.dmo_mapping.create",
      "harmonize.standard_mapping.create",
    ]) {
      expect(findPublicData360Action(actionName), actionName).toMatchObject({
        requiredParams: ["body", "dataspace"],
      });
    }
  });

  it("publishes Wave 1 Connect OpenAPI promotions as read-only activation actions", () => {
    const promoted = getPublicData360Actions().filter(
      (action) => action.promotionWave === "wave1_activation_metadata_reads",
    );
    expect(promoted).toHaveLength(3);
    expect(promoted.every((action) => action.namespace === "activate")).toBe(true);
    expect(promoted.every((action) => action.safety === "read")).toBe(true);
    expect(promoted.map((action) => action.action)).toEqual([
      "activate.activation.metadata.activatable_object_category.list",
      "activate.activation.metadata.related_attribute_activation_quota.get",
      "activate.activation.metadata.related_attribute_configuration_limits.get",
    ]);
  });

  it("publishes the complete Wave 2 existing-family read surface", () => {
    const promoted = getPublicData360Actions().filter(
      (action) => action.promotionWave === "wave2_existing_family_reads",
    );
    expect(promoted).toHaveLength(39);
    expect(promoted.every((action) => action.safety === "read")).toBe(true);
    expect(promoted.map((action) => action.action)).toEqual(
      expect.arrayContaining([
        "activate.activation.history.list",
        "connect.connection.endpoint.list",
        "harmonize.dmo.relationship.list",
        "prepare.dataspace_member.get",
        "query.profile.search_key.get",
        "segment.members.list",
        "semantic.ml.prediction_job.list",
      ]),
    );
  });

  it("publishes the complete Wave 3 new-family read surface", () => {
    const promoted = getPublicData360Actions().filter(
      (action) => action.promotionWave === "wave3_new_family_reads",
    );
    expect(promoted).toHaveLength(66);
    expect(promoted.every((action) => action.safety === "read")).toBe(true);
    expect(promoted.map((action) => action.action)).toEqual(
      expect.arrayContaining([
        "harmonize.governance.access_policy.list",
        "semantic.knowledge_space.list",
        "activate.clean_room.collaboration.list",
        "activate.communication_capping.dimension.list",
        "prepare.custom_code.list",
        "connect.data_share.list",
        "prepare.document_ai.configuration.list",
        "semantic.agent_config.list",
        "connect.private_network_route.list",
        "query.universal_id.lookup",
      ]),
    );
  });

  it("publishes the complete Wave 4 POST surface with reviewed safety", () => {
    const promoted = getPublicData360Actions().filter(
      (action) => action.promotionWave === "wave4_post_operations",
    );
    expect(promoted).toHaveLength(112);
    expect(
      promoted.reduce<Record<string, number>>((counts, action) => {
        counts[action.safety] = (counts[action.safety] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({ confirmed: 86, safe_post: 15, destructive: 11 });
    expect(promoted.map((action) => action.action)).toEqual(
      expect.arrayContaining([
        "query.sql.v2.query",
        "segment.count",
        "connect.connection.existing_connection_action.test",
        "harmonize.governance.classification.bulk_delete",
        "semantic.knowledge_space.file.remove",
      ]),
    );
  });

  it("publishes complete Wave 5 and Wave 6 mutation surfaces", () => {
    const updates = getPublicData360Actions().filter(
      (action) => action.promotionWave === "wave5_update_operations",
    );
    const deletes = getPublicData360Actions().filter(
      (action) => action.promotionWave === "wave6_destructive_operations",
    );
    expect(updates).toHaveLength(22);
    expect(updates.every((action) => action.safety === "confirmed")).toBe(true);
    expect(deletes).toHaveLength(26);
    expect(deletes.every((action) => action.safety === "destructive")).toBe(true);
    expect([...updates, ...deletes].map((action) => action.action)).toEqual(
      expect.arrayContaining([
        "activate.activation_platform.update",
        "connect.connection.sitemap.upsert",
        "harmonize.governance.tag.update",
        "semantic.knowledge_space.library.update",
        "activate.activation_platform.delete",
        "harmonize.governance.tag.delete",
        "prepare.document_ai.configuration.delete",
        "semantic.knowledge_space.session.delete",
      ]),
    );
  });

  it("publishes exact discovery action parameter contracts", () => {
    expect(findPublicData360Action("discover.action.search")).toMatchObject({
      requiredParams: [],
      optionalParams: expect.arrayContaining(["query", "intent", "limit"]),
      inputSchema: {
        properties: { query: { type: "string" }, intent: { type: "string" } },
      },
    });
    expect(findPublicData360Action("discover.action.describe")).toMatchObject({
      requiredParams: ["action"],
      inputSchema: { required: ["action"], properties: { action: { type: "string" } } },
    });
    expect(findPublicData360Action("discover.action.list")).toMatchObject({
      optionalParams: expect.arrayContaining(["namespace", "limit"]),
    });
  });

  it("classifies in-memory auth-state changes as confirmed mutations", () => {
    for (const actionName of ["connect.auth.pkce_start", "connect.auth.clear"]) {
      expect(findPublicData360Action(actionName), actionName).toMatchObject({
        safety: "confirmed",
      });
    }
  });

  it("keeps destructive guidance target-neutral and Guardrail-aware", () => {
    const destructive = getPublicData360Actions().filter(
      (action) => action.safety === "destructive",
    );
    expect(destructive.length).toBeGreaterThan(0);
    for (const action of destructive) {
      expect(action.tips, action.action).toContain("verified non-production");
      expect(action.tips).toContain("allow_mutation=true");
      expect(action.tips).not.toContain("target_org=");
    }
  });

  it("routes representative prompts through the business vocabulary", () => {
    const cases = [
      ["show available Data Lake Objects and inspect their fields", "prepare"],
      ["ingest a CSV and make it queryable", "orchestrate"],
      ["map new data to an Individual DMO and run identity resolution", "harmonize"],
      ["build a high value customer segment and activate it", "orchestrate"],
      ["create a semantic search index and retriever", "semantic"],
      ["query top customers by product usage", "query"],
    ] as const;
    for (const [prompt, namespace] of cases) {
      expect(searchPublicData360Actions(prompt)[0]?.namespace, prompt).toBe(namespace);
    }
    const readResults = searchPublicData360Actions("query top customers by product usage", {
      limit: 5,
    });
    expect(readResults.some((action) => action.safety === "destructive")).toBe(false);
  });

  it("treats generated registries as session-stable", () => {
    expect(getPublicData360Actions()).toBe(getPublicData360Actions());
    expect(getData360Journeys()).toBe(getData360Journeys());
  });
});
