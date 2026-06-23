/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { formatAnswer, formatSearch } from "../lib/render.ts";

describe("sf-docs render", () => {
  it("renders visible search URLs and ids", () => {
    const text = formatSearch({
      collection: "developer",
      version: "current",
      locale: "en-us",
      query: "Named Credentials",
      totalCount: 1,
      results: [
        {
          id: "abcdef1234567890",
          title: "Use the Named Credential in a Callout",
          url: "https://developer.salesforce.com/docs/example",
          product: "Named Credentials",
        },
      ],
    });
    expect(text).toContain("https://developer.salesforce.com/docs/example");
    expect(text).toContain("abcdef12…");
    expect(text).not.toMatch(/sfmcp_/);
  });

  it("renders visible answer citations", () => {
    const text = formatAnswer({
      collection: "developer",
      answer: "Use callout:Name.",
      citations: [
        {
          title: "Use the Named Credential in a Callout",
          url: "https://developer.salesforce.com/docs/named-credentials",
        },
      ],
    });
    expect(text).toContain("Use callout:Name.");
    expect(text).toContain("Citations");
    expect(text).toContain("https://developer.salesforce.com/docs/named-credentials");
  });
});
