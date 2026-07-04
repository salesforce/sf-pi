/* SPDX-License-Identifier: Apache-2.0 */
/** Developer reference routing helpers for SF Docs. */

export interface DeveloperReferenceRoutingPlan {
  intent: "developer_reference";
  source: "atlas_url" | "reference_query";
  collection: string;
  compiledQuery?: string;
  reason: string;
  matchedSignals: string[];
  collectionOverride?: { from: string; to: string; reason: "developer_reference_coverage" };
}

interface PlanInput {
  collection: string;
  query?: string;
  urls?: string[];
  url?: string;
}

interface ReferenceSignal {
  signal: string;
  guide?: string;
}

const DEVELOPER_COLLECTIONS = new Set(["developer", "legacydeveloper"]);
const REFERENCE_GUIDES = new Set([
  "apexref",
  "api_meta",
  "api_tooling",
  "object_reference",
  "pages",
  "chatterapi",
]);

export function planDeveloperReferenceRouting(
  input: PlanInput,
): DeveloperReferenceRoutingPlan | undefined {
  const collection = input.collection.trim().toLowerCase();
  const locators = [input.query, input.url, ...(input.urls ?? [])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  const atlasLocator = locators.find(isAtlasDeveloperReferenceLocator);
  if (atlasLocator) {
    return buildPlan({
      collection,
      targetCollection: "legacydeveloper",
      source: "atlas_url",
      reason: "Atlas developer reference URLs belong to the legacydeveloper collection.",
      matchedSignals: ["atlas_url"],
      query: input.query,
      guide: guideFromAtlasLocator(atlasLocator),
      preserveQuery: true,
    });
  }

  if (!DEVELOPER_COLLECTIONS.has(collection)) return undefined;
  const query = input.query?.trim();
  if (!query) return undefined;
  const signal = detectDeveloperReferenceSignal(query);
  if (!signal) return undefined;
  return buildPlan({
    collection,
    targetCollection: "legacydeveloper",
    source: "reference_query",
    reason:
      "Current Salesforce developer reference coverage is served from the legacydeveloper collection.",
    matchedSignals: [signal.signal],
    query,
    guide: signal.guide,
  });
}

export function isAtlasDeveloperReferenceLocator(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "developer.salesforce.com") return false;
    const comparable = `${url.pathname} ${url.href}`.toLowerCase();
    return comparable.includes("/docs/atlas") || comparable.includes("atlas.en-us");
  } catch {
    return (
      /\batlas\.en-us\b/iu.test(value) ||
      /\b(?:apexref|api_meta|api_tooling|object_reference)\b/iu.test(value)
    );
  }
}

export function detectDeveloperReferenceSignal(query: string): ReferenceSignal | undefined {
  const normalized = query.toLowerCase();
  const guide = normalized.match(/\bguides:([a-z0-9_]+)\b/u)?.[1];
  if (guide && REFERENCE_GUIDES.has(guide)) return { signal: `guides:${guide}`, guide };
  if (/\bmetadata\s+api\b/u.test(normalized) && /\breference\b/u.test(normalized)) {
    return { signal: "metadata_api_reference", guide: "api_meta" };
  }
  if (/\btooling\s+api\b/u.test(normalized) && /\b(?:object|reference)\b/u.test(normalized)) {
    return { signal: "tooling_api_reference", guide: "api_tooling" };
  }
  if (/\bobject\s+reference\b/u.test(normalized)) {
    return { signal: "object_reference", guide: "object_reference" };
  }
  if (/\bapex\s+reference\b/u.test(normalized)) {
    return { signal: "apex_reference", guide: "apexref" };
  }
  if (
    /\bapex\b/u.test(normalized) &&
    /\bclass\b/u.test(normalized) &&
    /\breference\b/u.test(normalized)
  ) {
    return { signal: "apex_class_reference", guide: "apexref" };
  }
  if (/\bvisualforce\b/u.test(normalized) && /\breference\b/u.test(normalized)) {
    return { signal: "visualforce_reference", guide: "pages" };
  }
  if (/\bchatter\s+rest\b/u.test(normalized) && /\breference\b/u.test(normalized)) {
    return { signal: "chatter_rest_reference", guide: "chatterapi" };
  }
  if (/\b(?:soap|rest|bulk)\s+api\b/u.test(normalized) && /\breference\b/u.test(normalized)) {
    return { signal: "platform_api_reference" };
  }
  if (
    /\breference\s+guide\b/u.test(normalized) &&
    /\b(?:apex|metadata|tooling|object|visualforce|chatter|api)\b/u.test(normalized)
  ) {
    return { signal: "reference_guide" };
  }
  return undefined;
}

function buildPlan(input: {
  collection: string;
  targetCollection: string;
  source: DeveloperReferenceRoutingPlan["source"];
  reason: string;
  matchedSignals: string[];
  query?: string;
  guide?: string;
  preserveQuery?: boolean;
}): DeveloperReferenceRoutingPlan {
  const collectionOverride =
    input.collection !== input.targetCollection
      ? {
          from: input.collection,
          to: input.targetCollection,
          reason: "developer_reference_coverage" as const,
        }
      : undefined;
  return {
    intent: "developer_reference",
    source: input.source,
    collection: input.targetCollection,
    compiledQuery: input.preserveQuery
      ? input.query
      : compileReferenceQuery(input.query, input.guide),
    reason: input.reason,
    matchedSignals: input.matchedSignals,
    collectionOverride,
  };
}

function compileReferenceQuery(
  query: string | undefined,
  guide: string | undefined,
): string | undefined {
  if (!query?.trim()) return undefined;
  if (!guide || /\bguides:/iu.test(query)) return query;
  return `guides:${guide} ${query}`;
}

function guideFromAtlasLocator(value: string): string | undefined {
  const normalized = value.toLowerCase();
  if (normalized.includes("apexref")) return "apexref";
  if (normalized.includes("api_meta")) return "api_meta";
  if (normalized.includes("api_tooling")) return "api_tooling";
  if (normalized.includes("object_reference")) return "object_reference";
  if (normalized.includes("chatterapi")) return "chatterapi";
  if (normalized.includes("pages")) return "pages";
  return undefined;
}
