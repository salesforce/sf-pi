/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { findData360Action } from "../lib/v2/action-registry.ts";

describe("Data 360 v2 curated action names", () => {
  it("uses readable data action and activation names", () => {
    expect(findData360Action("data360_activate", "data_action.create")).toMatchObject({
      capability: "d360_dataaction_create",
    });
    expect(findData360Action("data360_activate", "data_action_target.create")).toMatchObject({
      capability: "d360_dataaction_target_create",
    });
    expect(findData360Action("data360_activate", "activation.list")).toMatchObject({
      capability: "d360_activations_list",
    });
  });

  it("uses readable calculated insight and segment names", () => {
    expect(findData360Action("data360_segment", "ci.list")).toMatchObject({
      capability: "d360_calculated_insights_list",
    });
    expect(findData360Action("data360_segment", "ci.run.status")).toMatchObject({
      capability: "d360_ci_run_status",
    });
    expect(findData360Action("data360_segment", "segment.list")).toMatchObject({
      capability: "d360_segments_list",
    });
  });

  it("uses semantic_model names instead of sdm abbreviations for semantic model actions", () => {
    expect(findData360Action("data360_semantic", "semantic_model.create")).toMatchObject({
      capability: "d360_sdm_create",
    });
    expect(
      findData360Action("data360_semantic", "semantic_model.data_object.create"),
    ).toMatchObject({
      capability: "d360_sdm_data_object_create",
    });
    expect(findData360Action("data360_semantic", "semantic_model.metric.create")).toMatchObject({
      capability: "d360_sdm_metric_create",
    });
    expect(findData360Action("data360_semantic", "semantic_model.relationship.list")).toMatchObject(
      {
        capability: "d360_sdm_relationships_list",
      },
    );
  });

  it("uses readable retriever and search index subresource names", () => {
    expect(findData360Action("data360_semantic", "retriever.config.create")).toMatchObject({
      capability: "d360_retriever_config_create",
    });
    expect(findData360Action("data360_semantic", "search_index.process_history")).toMatchObject({
      capability: "d360_search_index_process_history",
    });
  });
});
