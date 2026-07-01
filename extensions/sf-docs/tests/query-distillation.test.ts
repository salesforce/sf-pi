/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  buildDistilledSearchRequests,
  distillDocsQuery,
  isHighConfidenceDistilledResult,
  rankDistilledResults,
} from "../lib/query-distillation.ts";

describe("Docs Query Distillation", () => {
  it("turns Salesforce Help article URLs into admin search variants", () => {
    const plan = distillDocsQuery(
      "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&type=5",
      { defaultCollection: "developer" },
    );

    expect(plan).toMatchObject({
      kind: "docs_locator",
      host: "help.salesforce.com",
      collectionCandidates: ["admin"],
      semanticQuery: "agent connect rep other voice calls sample",
    });
    expect(plan?.variants).toEqual([
      "ai.agent_connect_rep_other_voice_calls_sample",
      "agent connect rep other voice calls sample",
      "agent connect rep other voice calls",
    ]);
  });

  it("keeps explicit collection as fallback after host-derived collections", () => {
    const plan = distillDocsQuery(
      "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&type=5",
      { defaultCollection: "developer", explicitCollection: "developer" },
    );

    expect(plan?.collectionCandidates).toEqual(["admin", "developer"]);
    expect(buildDistilledSearchRequests(plan!)).toEqual([
      {
        collection: "admin",
        query: "ai.agent_connect_rep_other_voice_calls_sample",
        variantIndex: 0,
        fallbackCollection: false,
      },
      {
        collection: "admin",
        query: "agent connect rep other voice calls sample",
        variantIndex: 1,
        fallbackCollection: false,
      },
      {
        collection: "admin",
        query: "agent connect rep other voice calls",
        variantIndex: 2,
        fallbackCollection: false,
      },
      {
        collection: "developer",
        query: "agent connect rep other voice calls sample",
        variantIndex: 1,
        fallbackCollection: true,
      },
    ]);
  });

  it("supports developer docs URLs with legacydeveloper fallback", () => {
    const plan = distillDocsQuery(
      "https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-record",
      { defaultCollection: "developer" },
    );

    expect(plan).toMatchObject({
      host: "developer.salesforce.com",
      collectionCandidates: ["developer", "legacydeveloper"],
      semanticQuery: "reference wire adapters record",
    });
    expect(plan?.variants).toContain("lwc reference wire adapters record");
  });

  it("scores exact locator URL matches as high confidence", () => {
    const plan = distillDocsQuery(
      "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&type=5",
      { defaultCollection: "developer" },
    )!;
    const request = buildDistilledSearchRequests(plan)[0]!;
    const ranked = rankDistilledResults(plan, [
      {
        request,
        results: [
          {
            id: "doc-1",
            title: "Sample Voice Call Connection Configuration in Genesys",
            url: "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&release=262.0.0&type=5",
            content: "Connect a Rep voice call record with an Agent voice call record.",
          },
        ],
      },
    ]);

    expect(ranked[0]?.matchedByUrl).toBe(true);
    expect(isHighConfidenceDistilledResult(ranked[0])).toBe(true);
  });
});
