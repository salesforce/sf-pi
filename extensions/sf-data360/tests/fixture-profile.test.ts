/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { buildData360FixtureProfile } from "../../../scripts/e2e/data360/fixture-profile.ts";

describe("sf_data360 recursive fixture profiles", () => {
  it("derives action-scoped read parameters without leaking unrelated IDs", () => {
    const profile = buildData360FixtureProfile({
      dataspace: { name: "default" },
      dlo: { name: "Example__dll" },
      dmo: { name: "Example__dlm" },
      sourceFields: [{ name: "Id__c", dataType: "Text" }],
      targetFields: [{ name: "Id__c", dataType: "Text" }],
      stream: { recordId: "stream-1" },
      searchIndex: { id: "index-1" },
      retriever: { namespace: "example", name: "Retriever" },
      semanticModel: { apiName: "ExampleModel" },
      configuredModel: { namespace: "example", name: "ConfiguredModel" },
      modelArtifact: { namespace: "example", name: "Artifact" },
      session: { session_id: "session-1" },
      interaction: { interaction_id: "interaction-1", trace_id: "trace-1" },
      queryId: "query-1",
      csvPath: "/tmp/coverage.csv",
      manifestPath: "/tmp/manifest.json",
    });

    expect(profile.actions).toMatchObject({
      "prepare.dlo.get": { dloName: "Example__dll" },
      "harmonize.dmo.get": { dmoName: "Example__dlm" },
      "prepare.stream.get": { dataStreamId: "stream-1" },
      "harmonize.preview_field_matches": {
        sourceFields: [{ name: "Id__c", dataType: "Text" }],
        targetFields: [{ name: "Id__c", dataType: "Text" }],
      },
      "harmonize.smart_mapping.suggest": {
        sourceDloName: "Example__dll",
        sourceFields: [{ name: "Id__c", dataType: "Text" }],
        targetDmoName: "Example__dlm",
        targetFields: [{ name: "Id__c", dataType: "Text" }],
      },
      "semantic.search_index.get": { searchIndexApiNameOrId: "index-1" },
      "semantic.retriever.get": { retrieverId: "example__Retriever" },
      "semantic.semantic_model.get": { modelApiNameOrId: "ExampleModel" },
      "semantic.ml.configured_model.get": { idOrName: "example__ConfiguredModel" },
      "semantic.ml.model_artifact.get": { idOrName: "example__Artifact" },
      "observe.stdm.session_timeline": { session_id: "session-1", limit: 20 },
      "observe.trace.trace_tree": { trace_id: "trace-1" },
      "query.sql.rows": { queryId: "query-1", limit: 5 },
      "prepare.csv_schema.infer": {
        csvPath: "/tmp/coverage.csv",
        schemaName: "PiCoverageSchema",
        primaryKey: "Id",
        recordModifiedField: "CreatedDate",
      },
      "orchestrate.manifest.plan": { manifestPath: "/tmp/manifest.json" },
      "orchestrate.cleanup.discover_owned": {
        prefixes: ["PiData360SweepDlo_", "PiData360SweepDmo_"],
        maxResults: 20,
      },
    });
    expect(profile.actions).not.toHaveProperty("connect.source_schema.get");
  });
});
