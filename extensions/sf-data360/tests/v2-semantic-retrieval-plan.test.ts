/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { runData360V2Action } from "../lib/v2/dispatcher.ts";

const env: SfEnvironment = {
  cli: { installed: true, version: "2.136.8" },
  project: { detected: true, sourceApiVersion: "67.0" },
  config: { hasTargetOrg: true, targetOrg: "AgentforceSTDM", location: "Global" },
  org: {
    detected: true,
    alias: "AgentforceSTDM",
    username: "agentforce@example.invalid",
    instanceUrl: "https://example.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "67.0",
  },
  detectedAt: 1,
};

const ctx = { hasUI: false } as never;

describe("Data 360 v2 semantic retrieval planning", () => {
  it("plans semantic retrieval without mutation", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "semantic_retrieval.plan",
        target_org: "AgentforceSTDM",
        params: { sourceObjects: ["Product__dlm"], retrievalUseCase: "RAG" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "semantic_retrieval.plan",
      journey: "semantic_retrieval",
      phases: ["semantic", "retrieve"],
      summary: expect.stringContaining("semantic_retrieval plan resolved"),
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_semantic", action: "semantic_model.list" }),
        expect.objectContaining({ tool: "data360_semantic", action: "model_artifact.list" }),
        expect.objectContaining({ tool: "data360_semantic", action: "search_index.config" }),
        expect.objectContaining({ tool: "data360_semantic", action: "search_index.create" }),
        expect.objectContaining({ tool: "data360_semantic", action: "retriever.create" }),
        expect.objectContaining({ tool: "data360_semantic", action: "retriever.config.create" }),
      ]),
    );
    expect(result.verification).toEqual(
      expect.arrayContaining(["semantic_model.validate", "retriever.get"]),
    );
  });
});
