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
      guide: "_api_meta",
    });
    expect(detectDeveloperReferenceSignal("Apex String class reference")).toMatchObject({
      signal: "apex_class_reference",
      guide: "_apexref",
    });
  });

  it("normalizes legacy unprefixed guide filters without treating them as Atlas URLs", () => {
    expect(
      planDeveloperReferenceRouting({
        collection: "developer",
        query: "+guides:api_meta CustomObject",
      }),
    ).toMatchObject({
      source: "reference_query",
      collection: "developer",
      fallbackCollection: "legacydeveloper",
      compiledQuery: "+guides:_api_meta CustomObject",
    });
  });

  it("does not route weak modern developer guide queries", () => {
    expect(detectDeveloperReferenceSignal("LWC wire adapters record")).toBeUndefined();
    expect(detectDeveloperReferenceSignal("Named Credentials Apex callout")).toBeUndefined();
  });

  it("keeps the requested developer collection and plans a legacydeveloper fallback", () => {
    expect(
      planDeveloperReferenceRouting({
        collection: "developer",
        query: "Metadata API CustomObject reference",
      }),
    ).toMatchObject({
      collection: "developer",
      fallbackCollection: "legacydeveloper",
      compiledQuery: "guides:_api_meta Metadata API CustomObject reference",
      collectionOverride: undefined,
    });
  });

  it("plans the reverse fallback while reference content is migrating", () => {
    expect(
      planDeveloperReferenceRouting({
        collection: "legacydeveloper",
        query: "Metadata API reference guide",
      }),
    ).toMatchObject({
      collection: "legacydeveloper",
      fallbackCollection: "developer",
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
      fallbackCollection: "developer",
    });
  });

  it("rejects host-confused Atlas lookalikes and still accepts scheme-less Atlas paths", () => {
    expect(
      isAtlasDeveloperReferenceLocator(
        "https://evil.example/developer.salesforce.com/docs/atlas.en-us.apexref",
      ),
    ).toBe(false);
    expect(
      isAtlasDeveloperReferenceLocator(
        "developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex.htm",
      ),
    ).toBe(true);
    expect(isAtlasDeveloperReferenceLocator("notes about atlas.en-us in a query")).toBe(true);
  });
});
