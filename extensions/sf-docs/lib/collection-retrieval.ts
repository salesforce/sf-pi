/* SPDX-License-Identifier: Apache-2.0 */
/** Collection-specific query defaults and bounded developer peer fallback. */
import { DocsClient } from "./client.ts";
import {
  buildSearchRequest,
  parseSearchResponse,
  type SearchRequest,
  type SearchResponse,
} from "./protocol.ts";

export interface CollectionQueryCompilation {
  query: string;
  changed: boolean;
  intent?: "mulesoft_latest";
  reason?: string;
}

export interface DocsSlice {
  collection: string;
  version: string;
  locale: string;
}

export type SearchOperationArgs = Omit<SearchRequest, "collection" | "version" | "locale">;

export function compileCollectionQuery(
  collection: string,
  query: string,
): CollectionQueryCompilation {
  if (
    collection !== "mulesoft" ||
    /(?:^|\s)\+?latest:/iu.test(query) ||
    /(?:^|\s)\+?release:/iu.test(query) ||
    hasExplicitMulesoftVersion(query)
  ) {
    return { query, changed: false };
  }
  return {
    query: `+latest:true ${query}`,
    changed: true,
    intent: "mulesoft_latest",
    reason: "MuleSoft searches default to the latest released version of each component.",
  };
}

export async function runSearchWithDeveloperPeerFallback(
  client: DocsClient,
  args: SearchOperationArgs,
  slice: DocsSlice,
  fallbackCollection: string | undefined,
  signal?: AbortSignal,
): Promise<{
  response: SearchResponse;
  slice: DocsSlice;
  collectionOverride?: { from: string; to: string; reason: "developer_reference_coverage" };
}> {
  const response = parseSearchResponse(
    await client.callTool("search", buildSearchRequest({ ...args, ...slice }), signal),
  );
  if (
    response.error ||
    (response.results ?? []).length ||
    !fallbackCollection ||
    fallbackCollection === slice.collection
  ) {
    return { response, slice };
  }

  const fallbackSlice = { ...slice, collection: fallbackCollection };
  const fallbackResponse = parseSearchResponse(
    await client.callTool("search", buildSearchRequest({ ...args, ...fallbackSlice }), signal),
  );
  if (fallbackResponse.error || !(fallbackResponse.results ?? []).length) {
    return { response, slice };
  }
  return {
    response: fallbackResponse,
    slice: fallbackSlice,
    collectionOverride: {
      from: slice.collection,
      to: fallbackCollection,
      reason: "developer_reference_coverage",
    },
  };
}

function hasExplicitMulesoftVersion(query: string): boolean {
  return Boolean(
    /\b(?:version|release|v)\s*\d+\.\d+(?:\.\d+)?\b/iu.test(query) ||
    /\b(?:dataweave|mule(?:\s+runtime)?|cloudhub|munit|studio|connector|api\s+manager|runtime\s+fabric)\s+\d+\.\d+(?:\.\d+)?\b/iu.test(
      query,
    ) ||
    /\/\d+\.\d+(?:\.\d+)?(?:\/|\b)/u.test(query),
  );
}
