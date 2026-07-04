/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  detectDeveloperReferenceSignal,
  isAtlasDeveloperReferenceLocator,
  planDeveloperReferenceRouting,
} from "../lib/developer-reference.ts";

describe("Developer reference routing", () => {
  it("detects strong developer reference signals", () => {
    expect(detectDeveloperReferenceSignal("Metadata API CustomObject reference")).toMatchObject({
      signal: "metadata_api_reference",
      guide: "api_meta",
    });
    expect(detectDeveloperReferenceSignal("Apex String class reference")).toMatchObject({
      signal: "apex_class_reference",
      guide: "apexref",
    });
  });

  it("does not route weak modern developer guide queries", () => {
    expect(detectDeveloperReferenceSignal("LWC wire adapters record")).toBeUndefined();
    expect(detectDeveloperReferenceSignal("Named Credentials Apex callout")).toBeUndefined();
  });

  it("routes developer reference queries from developer to legacydeveloper", () => {
    expect(
      planDeveloperReferenceRouting({
        collection: "developer",
        query: "Metadata API CustomObject reference",
      }),
    ).toMatchObject({
      collection: "legacydeveloper",
      compiledQuery: "guides:api_meta Metadata API CustomObject reference",
      collectionOverride: {
        from: "developer",
        to: "legacydeveloper",
        reason: "developer_reference_coverage",
      },
    });
  });

  it("does not override non-developer collections for natural-language reference queries", () => {
    expect(
      planDeveloperReferenceRouting({
        collection: "admin",
        query: "Metadata API CustomObject reference",
      }),
    ).toBeUndefined();
  });

  it("recognizes Atlas developer reference locators without rewriting the URL query", () => {
    const url =
      "https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customobject.htm";
    expect(isAtlasDeveloperReferenceLocator(url)).toBe(true);
    expect(
      planDeveloperReferenceRouting({
        collection: "admin",
        urls: [url],
      }),
    ).toMatchObject({
      collection: "legacydeveloper",
      source: "atlas_url",
      collectionOverride: { from: "admin", to: "legacydeveloper" },
    });
    expect(planDeveloperReferenceRouting({ collection: "developer", query: url })).toMatchObject({
      compiledQuery: url,
    });
  });
});
