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

describe("Data 360 v2 intent planning", () => {
  it("lists outcome journeys without loading endpoint catalogs", async () => {
    const result = await runData360V2Action(
      { tool: "data360_orchestrate", action: "journey.list", target_org: "AgentforceSTDM" },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({ ok: true, tool: "data360_orchestrate", action: "journey.list" });
    expect(result.journeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "ingest_csv" }),
        expect.objectContaining({ name: "make_data_usable" }),
        expect.objectContaining({ name: "build_segment" }),
        expect.objectContaining({ name: "semantic_retrieval" }),
        expect.objectContaining({ name: "agent_behavior_investigation" }),
      ]),
    );
  });

  it("describes one journey with phases, inputs, verification, and available actions", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "journey.describe",
        target_org: "AgentforceSTDM",
        params: { journey: "make_data_usable" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      journey: expect.objectContaining({
        name: "make_data_usable",
        phases: ["connect", "prepare", "harmonize", "retrieve"],
        requiredInputs: expect.arrayContaining(["source", "primaryKey", "targetModel"]),
        verification: expect.arrayContaining(["sql.verify_rows", "mapping.get"]),
      }),
    });
    expect(result.availableActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_orchestrate", action: "manifest.plan" }),
        expect.objectContaining({ tool: "data360_harmonize", action: "mapping.create" }),
      ]),
    );
  });

  it("routes a vague load-data utterance to make_data_usable with missing inputs", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "intent.plan",
        target_org: "AgentforceSTDM",
        params: { utterance: "load the GPS demo data into Data Cloud and make it usable" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      recommendedJourney: "make_data_usable",
      confidence: "high",
      targetTool: "data360_orchestrate",
      targetAction: "journey.describe",
    });
    expect(result.missingInputs).toEqual(
      expect.arrayContaining(["source", "primaryKey", "targetModel"]),
    );
    expect(result.suggestedQuestions).toEqual(
      expect.arrayContaining([expect.stringContaining("source local CSV")]),
    );
  });

  it("routes Agentforce troubleshooting utterances to observe journeys", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "intent.plan",
        target_org: "AgentforceSTDM",
        params: { utterance: "why did my agent fail yesterday and where was it slow" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      recommendedJourney: "agent_behavior_investigation",
      targetTool: "data360_observe",
    });
    expect(result.next_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_observe", action: "actions.search" }),
      ]),
    );
  });
});
