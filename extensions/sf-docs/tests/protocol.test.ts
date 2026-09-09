/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  buildAnswerRequest,
  buildExplainRequest,
  buildFetchRequest,
  buildSearchRequest,
  parseAnswerResponse,
  parseFetchResponse,
  parseListResponse,
  parseSearchResponse,
} from "../lib/protocol.ts";

describe("SF Docs protocol payloads", () => {
  it("builds documented action requests and omits auto locale", () => {
    expect(
      buildSearchRequest({
        collection: "developer",
        version: "current",
        locale: "auto",
        query: "Apex",
        page: 1,
        pageSize: 5,
      }),
    ).toEqual({
      collection: "developer",
      version: "current",
      query: "Apex",
      page: 1,
      pageSize: 5,
    });
    expect(
      buildFetchRequest({
        collection: "developer",
        version: "current",
        locale: "ja-jp",
        ids: ["doc"],
        format: "markdown",
      }),
    ).toMatchObject({ locale: "ja-jp", ids: ["doc"] });
    expect(
      buildAnswerRequest({
        collection: "developer",
        version: "current",
        locale: "auto",
        query: "Apex",
        cite: true,
      }),
    ).not.toHaveProperty("locale");
    expect(
      buildExplainRequest({ query: "Summary", url: "https://example.test/doc", cite: true }),
    ).toEqual({ query: "Summary", url: "https://example.test/doc", cite: true });
  });

  it("accepts documented action payloads", () => {
    expect(
      parseListResponse({ collections: [{ collection: "developer" }] }).collections,
    ).toHaveLength(1);
    expect(parseSearchResponse({ results: [], totalCount: 0 }).results).toEqual([]);
    expect(parseFetchResponse({ documents: [] }).documents).toEqual([]);
    expect(parseAnswerResponse("answer", { answer: "Grounded", citations: [] }).answer).toBe(
      "Grounded",
    );
    expect(
      parseAnswerResponse("explain", { explanation: "Document summary", citations: [] })
        .explanation,
    ).toBe("Document summary");
  });

  it("preserves structured service errors for domain-level handling", () => {
    expect(
      parseSearchResponse({
        error: "slice_not_available",
        requested: { collection: "developer" },
        available: { locales: ["en-us"] },
      }),
    ).toMatchObject({ error: "slice_not_available" });
  });

  it("rejects malformed successful payloads", () => {
    expect(() => parseListResponse({ collections: "developer" })).toThrow(/collections/i);
    expect(() => parseSearchResponse({ totalCount: 0 })).toThrow(/results/i);
    expect(() => parseFetchResponse({ documents: "none" })).toThrow(/documents/i);
    expect(() => parseAnswerResponse("answer", { answer: "", citations: [] })).toThrow(
      /non-empty answer/i,
    );
    expect(() => parseAnswerResponse("answer", { answer: "text" })).toThrow(/citations/i);
    expect(() => parseAnswerResponse("explain", { citations: [] })).toThrow(
      /answer or explanation/i,
    );
  });
});
