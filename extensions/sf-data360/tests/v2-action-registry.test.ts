/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { getD360Operations } from "../lib/facade/registry.ts";
import {
  findData360Action,
  getData360Actions,
  searchData360Actions,
} from "../lib/v2/action-registry.ts";

const V2_TOOLS = [
  "data360_discover",
  "data360_connect",
  "data360_prepare",
  "data360_harmonize",
  "data360_segment",
  "data360_activate",
  "data360_query",
  "data360_semantic",
  "data360_observe",
  "data360_orchestrate",
  "data360_api",
] as const;

describe("Data 360 v2 action registry", () => {
  it("maps every existing operation to exactly one primary data360 action", () => {
    const actions = getData360Actions();
    const operationNames = getD360Operations().map((operation) => operation.name);

    for (const operationName of operationNames) {
      const owners = actions.filter((action) => action.capability === operationName);
      expect(owners, operationName).toHaveLength(1);
      expect(V2_TOOLS).toContain(owners[0]?.tool);
    }

    const primaryKeys = actions.map((action) => `${action.tool}:${action.action}`);
    expect(new Set(primaryKeys).size).toBe(primaryKeys.length);
  });

  it("uses curated agent-friendly names for the first ingestion vertical slice", () => {
    expect(findData360Action("data360_connect", "source_schema.test")).toMatchObject({
      capability: "d360_ingest_api_schema_test",
      phase: "connect",
      safety: "safe_post",
    });
    expect(findData360Action("data360_connect", "source_schema.put")).toMatchObject({
      capability: "d360_ingest_api_schema_put",
      safety: "confirmed",
    });
    expect(findData360Action("data360_prepare", "stream.create_ingest_api")).toMatchObject({
      capability: "d360_datastream_create_ingest_api",
      phase: "prepare",
      safety: "confirmed",
    });
    expect(findData360Action("data360_query", "sql.verify_rows")).toMatchObject({
      implementation: { kind: "local", name: "sql.verify_rows" },
      phase: "retrieve",
      safety: "safe_post",
    });
    expect(findData360Action("data360_orchestrate", "ingest_csv.plan")).toMatchObject({
      implementation: { kind: "journey", name: "ingest_csv" },
      phase: "orchestrate",
      safety: "read",
    });
  });

  it("searches actions without loading the full catalog into tool schemas", () => {
    const results = searchData360Actions("ingestion api stream");

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_prepare", action: "stream.create_ingest_api" }),
        expect.objectContaining({ tool: "data360_connect", action: "source_schema.test" }),
      ]),
    );
  });
});
