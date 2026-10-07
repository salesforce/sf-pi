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
