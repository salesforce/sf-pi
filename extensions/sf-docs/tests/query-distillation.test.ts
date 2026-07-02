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

  it("detects seasonal release-note queries without a public release parameter", () => {
    const plan = distillDocsQuery("Whats new with Spring '26 release notes", {
      defaultCollection: "developer",
    });

    expect(plan).toMatchObject({
      source: "query",
      collectionCandidates: ["admin"],
      releaseHint: { season: "spring", year: 2026, release: "260" },
      releaseNoteIntent: true,
    });
    expect(plan?.variants).toEqual([
      "Whats new with Spring '26 release notes",
      "Salesforce Spring 26 Release Notes",
    ]);
    expect(buildDistilledSearchRequests(plan!).map((request) => request.collection)).toEqual([
      "admin",
      "admin",
    ]);
  });

  it("keeps plain product release-note queries on the normal search path", () => {
    expect(
      distillDocsQuery("Apex release notes", { defaultCollection: "developer" }),
    ).toBeUndefined();
  });

  it("detects release hints from Salesforce Help release parameters", () => {
    const plan = distillDocsQuery(
      "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=260&type=5",
      { defaultCollection: "developer" },
    );

    expect(plan).toMatchObject({
      host: "help.salesforce.com",
      collectionCandidates: ["admin"],
      releaseHint: { season: "spring", year: 2026, release: "260" },
      releaseNoteIntent: true,
    });
  });

  it("prefers exact seasonal release results and avoids patch pages unless requested", () => {
    const plan = distillDocsQuery("Spring 2026 release notes", {
      defaultCollection: "developer",
    })!;
    const request = buildDistilledSearchRequests(plan)[0]!;
    const ranked = rankDistilledResults(plan, [
      {
        request,
        results: [
          {
            id: "summer-current",
            title: "Spring ’26 Release Notes",
            url: "https://help.salesforce.com/s/articleView?id=xcloud.starter_prosuite_rn_2026_spring_release.htm&release=262.0.0&type=5",
            release: "262",
            content: "Explore what’s new in Salesforce Suites for Spring ’26.",
          },
          {
            id: "patch",
            title: "Patch Releases Spring `26",
            url: "https://help.salesforce.com/s/articleView?id=ind.comms_patch_releases_spring_26.htm&release=260&type=5",
            release: "260",
            content: "Information on each Spring `26 patch release.",
          },
          {
            id: "main",
            title: "Salesforce Spring ’26 Release Notes",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=260&type=5",
            release: "260",
            content: "The Spring ’26 release helps companies become an Agentic Enterprise.",
          },
        ],
      },
    ]);

    expect(ranked.map((result) => result.id)).toEqual(["main", "patch", "summer-current"]);
  });

  it("keeps patch release pages competitive for patch queries", () => {
    const plan = distillDocsQuery("Spring 2026 patch release notes", {
      defaultCollection: "developer",
    })!;
    const request = buildDistilledSearchRequests(plan)[0]!;
    const ranked = rankDistilledResults(plan, [
      {
        request,
        results: [
          {
            id: "patch",
            title: "Patch Releases Spring `26",
            url: "https://help.salesforce.com/s/articleView?id=ind.comms_patch_releases_spring_26.htm&release=260&type=5",
            release: "260",
          },
          {
            id: "main",
            title: "Salesforce Spring ’26 Release Notes",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=260&type=5",
            release: "260",
          },
        ],
      },
    ]);

    expect(ranked.find((result) => result.id === "patch")?.score).toBeGreaterThanOrEqual(
      ranked.find((result) => result.id === "main")!.score - 25,
    );
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
