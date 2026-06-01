/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const orgCreateMock = vi.fn();
const requestMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  Org: { create: (opts: unknown) => orgCreateMock(opts) },
}));

import { clearConnectionCache } from "../../../lib/common/sf-conn/connection.ts";
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
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("plans semantic retrieval with read-only org readiness", async () => {
    requestMock.mockImplementation(async (request: { url: string }) => {
      if (request.url.includes("/semantic/models"))
        return { semanticModels: [{ name: "RetailModel" }] };
      if (request.url.includes("/machine-learning/model-artifacts")) return { modelArtifacts: [] };
      if (request.url.includes("/search-index/config")) return { fields: [] };
      if (request.url.includes("/machine-learning/retrievers")) return { retrievers: [] };
      return {};
    });

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
      readiness: "blocked",
      blockers: expect.arrayContaining([expect.stringContaining("embedding model")]),
      recommendedFirstAction: { tool: "data360_semantic", action: "model_artifact.list" },
      preflight: {
        semanticModels: { count: 1, ok: true },
        modelArtifacts: { count: 0, ok: true },
        searchIndexConfig: { ok: true },
        retrievers: { count: 0, ok: true },
      },
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
