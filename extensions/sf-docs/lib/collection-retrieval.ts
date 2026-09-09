/* SPDX-License-Identifier: Apache-2.0 */
/** Collection-specific query compilation used by explicit grounding workflows. */

export interface CollectionQueryCompilation {
  query: string;
  changed: boolean;
  intent?: "mulesoft_latest";
  reason?: string;
}

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

function hasExplicitMulesoftVersion(query: string): boolean {
  return Boolean(
    /\b(?:version|release|v)\s*\d+\.\d+(?:\.\d+)?\b/iu.test(query) ||
    /\b(?:dataweave|mule(?:\s+runtime)?|cloudhub|munit|studio|connector|api\s+manager|runtime\s+fabric)\s+\d+\.\d+(?:\.\d+)?\b/iu.test(
      query,
    ) ||
    /\/\d+\.\d+(?:\.\d+)?(?:\/|\b)/u.test(query),
  );
}
