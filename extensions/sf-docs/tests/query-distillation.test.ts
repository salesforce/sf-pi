/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  distillDocsQuery,
  isHighConfidenceDistilledResult,
  primaryDistilledSearch,
  rankDistilledResults,
} from "../lib/query-distillation.ts";

describe("Docs Query Distillation", () => {
  it("turns Salesforce Help article URLs into an admin recovery query", () => {
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
    expect(primaryDistilledSearch(plan!)).toEqual({
      collection: "admin",
      query: "ai.agent_connect_rep_other_voice_calls_sample",
    });
  });

  it("retains an explicit collection as mismatch evidence without changing the primary", () => {
    const plan = distillDocsQuery(
      "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&type=5",
      { defaultCollection: "developer", explicitCollection: "developer" },
    );

    expect(plan?.collectionCandidates).toEqual(["admin", "developer"]);
    expect(primaryDistilledSearch(plan!)).toMatchObject({ collection: "admin" });
  });

  it("supports developer docs and Atlas URL ownership", () => {
    expect(
      distillDocsQuery(
        "https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-record",
        { defaultCollection: "developer" },
      ),
    ).toMatchObject({
      collectionCandidates: ["developer", "legacydeveloper"],
      semanticQuery: "reference wire adapters record",
    });

    expect(
      distillDocsQuery(
        "https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customobject.htm",
        { defaultCollection: "developer" },
      ),
    ).toMatchObject({
      collectionCandidates: ["legacydeveloper", "developer"],
      semanticQuery: "customobject",
    });
  });

  it("compiles seasonal release-note intent to one primary filtered query", () => {
    const plan = distillDocsQuery("Sales Cloud Spring '26 release notes", {
      defaultCollection: "developer",
    });

    expect(plan).toMatchObject({
      source: "query",
      collectionCandidates: ["admin"],
      releaseHint: { season: "spring", year: 2026, release: "260" },
      releaseNoteIntent: true,
      retrievalFilters: ["+release:260"],
      retrievalBoosts: ["guides:_sales"],
    });
    expect(primaryDistilledSearch(plan!)).toEqual({
      collection: "admin",
      query: "+release:260 guides:_sales sales cloud release notes",
    });
  });

  it("keeps plain product release-note queries on the literal path", () => {
    expect(
      distillDocsQuery("Apex release notes", { defaultCollection: "developer" }),
    ).toBeUndefined();
  });

  it("detects release hints from Salesforce Help parameters", () => {
    expect(
      distillDocsQuery(
        "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=260&type=5",
        { defaultCollection: "developer" },
      ),
    ).toMatchObject({
      collectionCandidates: ["admin"],
      releaseHint: { season: "spring", year: 2026, release: "260" },
      releaseNoteIntent: true,
    });
  });

  it("ranks matching release-note results above wrong-release and patch pages", () => {
    const plan = distillDocsQuery("Spring 2026 release notes", {
      defaultCollection: "developer",
    })!;
    const request = primaryDistilledSearch(plan)!;
    const ranked = rankDistilledResults(plan, request, [
      {
        id: "summer-current",
        title: "Spring ’26 Release Notes",
        url: "https://help.salesforce.com/s/articleView?id=xcloud.rn.htm&release=262&type=5",
        release: "262",
      },
      {
        id: "patch",
        title: "Patch Releases Spring `26",
        url: "https://help.salesforce.com/s/articleView?id=ind.patch.htm&release=260&type=5",
        release: "260",
      },
      {
        id: "main",
        title: "Salesforce Spring ’26 Release Notes",
        url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=260&type=5",
        release: "260",
      },
    ]);

    expect(ranked.map((result) => result.id)).toEqual(["main", "patch", "summer-current"]);
  });

  it("keeps patch pages competitive when the query asks for patches", () => {
    const plan = distillDocsQuery("Spring 2026 patch release notes", {
      defaultCollection: "developer",
    })!;
    const request = primaryDistilledSearch(plan)!;
    const ranked = rankDistilledResults(plan, request, [
      {
        id: "patch",
        title: "Patch Releases Spring `26",
        url: "https://help.salesforce.com/s/articleView?id=ind.patch.htm&release=260&type=5",
        release: "260",
      },
      {
        id: "main",
        title: "Salesforce Spring ’26 Release Notes",
        url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=260&type=5",
        release: "260",
      },
    ]);

    expect(ranked.find((result) => result.id === "patch")?.score).toBeGreaterThanOrEqual(
      ranked.find((result) => result.id === "main")!.score - 25,
    );
  });

  it("ranks an exact original URL above neighboring documents", () => {
    const plan = distillDocsQuery(
      "https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customobject.htm",
      { defaultCollection: "developer" },
    )!;
    const request = primaryDistilledSearch(plan)!;
    const ranked = rankDistilledResults(plan, request, [
      {
        id: "tooling-custom-object",
        title: "CustomObject",
        url: "https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_customobject.htm",
      },
      {
        id: "metadata-custom-object",
        title: "CustomObject",
        url: "https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customobject.htm",
      },
    ]);

    expect(ranked.map((result) => result.id)).toEqual([
      "metadata-custom-object",
      "tooling-custom-object",
    ]);
    expect(isHighConfidenceDistilledResult(ranked[0])).toBe(true);
  });
});
