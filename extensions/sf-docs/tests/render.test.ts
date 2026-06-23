/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { formatAnswer, formatFetch, formatSearch } from "../lib/render.ts";

describe("sf-docs render", () => {
  it("renders visible search URLs and ids", () => {
    const text = formatSearch({
      collection: "developer",
      version: "current",
      locale: "en-us",
      query: "Named Credentials",
      totalCount: 1,
      displayDensity: "balanced",
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

  it("shows search snippets only in expanded or verbose views", () => {
    const details = {
      collection: "developer",
      query: "Named Credentials",
      totalCount: 1,
      displayDensity: "balanced",
      results: [
        {
          title: "Use the Named Credential in a Callout",
          content: "Use a named credential to authenticate an Apex callout.",
        },
      ],
    };

    expect(formatSearch(details)).not.toContain("Snippet:");
    expect(formatSearch(details, undefined, { expanded: true })).toContain("Snippet:");
    expect(formatSearch({ ...details, displayDensity: "verbose" })).toContain("Snippet:");
  });

  it("renders visible answer citations", () => {
    const text = formatAnswer({
      collection: "developer",
      displayDensity: "balanced",
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

  it("clips collapsed answers by density while keeping citations visible", () => {
    const answer = `${"A".repeat(2000)} UNIQUE_ANSWER_TAIL`;
    const text = formatAnswer({
      collection: "developer",
      displayDensity: "compact",
      answer,
      citations: [{ title: "Apex", url: "https://developer.salesforce.com/docs/apex" }],
    });

    expect(text).toContain("truncated");
    expect(text).not.toContain("UNIQUE_ANSWER_TAIL");
    expect(text).toContain("https://developer.salesforce.com/docs/apex");
    expect(
      formatAnswer({ displayDensity: "compact", answer }, undefined, { expanded: true }),
    ).toContain("UNIQUE_ANSWER_TAIL");
  });

  it("renders collapsed fetch as cards without full fetched bodies", () => {
    const text = formatFetch({
      collection: "admin",
      version: "current",
      locale: "en-us",
      displayDensity: "balanced",
      totalContentChars: 15000,
      llmBudget: {
        maxTotalChars: 48000,
        returnedChars: 12000,
        truncatedDocuments: 1,
        metadataOnlyDocuments: 0,
      },
      documents: [
        {
          id: "abcdef1234567890",
          title: "Apex",
          url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_apex.htm&type=5",
          contentChars: 15000,
          llmReturnedChars: 12000,
          llmTruncated: true,
          headings: ["Apex", "Database Operations Run in User Mode by Default"],
          humanPreview: `Short preview. ${"B".repeat(300)} UNIQUE_FETCH_TAIL`,
        },
      ],
    });

    expect(text).toContain(
      "https://help.salesforce.com/s/articleView?id=release-notes.rn_apex.htm&type=5",
    );
    expect(text).toContain("abcdef12…");
    expect(text).toContain("LLM packet");
    expect(text).toContain("Headings: Apex");
    expect(text).not.toContain("UNIQUE_FETCH_TAIL");
  });

  it("renders expanded fetch with bounded previews but not full bodies", () => {
    const text = formatFetch(
      {
        collection: "admin",
        displayDensity: "balanced",
        llmBudget: { maxTotalChars: 48000, returnedChars: 12000 },
        documents: [
          {
            id: "abcdef1234567890",
            title: "Apex",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_apex.htm&type=5",
            contentChars: 20000,
            llmReturnedChars: 12000,
            llmTruncated: true,
            headings: ["Apex"],
            humanPreview: `${"C".repeat(1200)} UNIQUE_EXPANDED_TAIL`,
          },
        ],
      },
      undefined,
      { expanded: true },
    );

    expect(text).toContain("Preview:");
    expect(text).toContain("truncated");
    expect(text).not.toContain("UNIQUE_EXPANDED_TAIL");
  });
});
