/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic docs-locator query distillation for Salesforce-owned docs URLs. */
import type { DocsSearchResult } from "./types.ts";

const HOST_COLLECTIONS: Record<string, string[]> = {
  "help.salesforce.com": ["admin"],
  "developer.salesforce.com": ["developer", "legacydeveloper"],
  "architect.salesforce.com": ["architect"],
  "admin.salesforce.com": ["admin"],
  "docs.mulesoft.com": ["mulesoft"],
  "help.tableau.com": ["tableau"],
  "lightningdesignsystem.com": ["developer"],
  "www.lightningdesignsystem.com": ["developer"],
};

const STOP_WORDS = new Set([
  "article",
  "configure",
  "configuration",
  "docs",
  "guide",
  "help",
  "salesforce",
  "sample",
  "setup",
]);

const GENERIC_PATH_SEGMENTS = new Set([
  "articleview",
  "content",
  "docs",
  "documentation",
  "en-us",
  "guide",
  "guides",
  "latest",
  "s",
]);

export interface DocsQueryDistillationPlan {
  kind: "docs_locator";
  original: string;
  source: "url" | "identifier";
  host?: string;
  locator: string;
  locatorAliases: string[];
  semanticQuery: string;
  semanticTokens: string[];
  variants: string[];
  collectionCandidates: string[];
}

export interface DistilledSearchRequest {
  collection: string;
  query: string;
  variantIndex: number;
  fallbackCollection: boolean;
}

export interface DistilledSearchBatch {
  request: DistilledSearchRequest;
  results: DocsSearchResult[];
  totalCount?: number;
}

export interface RankedDistilledResult extends DocsSearchResult {
  score: number;
  collection: string;
  version?: string;
  locale?: string;
  matchedByUrl: boolean;
  rank: number;
  variant: string;
}

export const DISTILLED_AUTO_FETCH_SCORE = 70;

export function distillDocsQuery(
  input: string,
  options: { defaultCollection: string; explicitCollection?: string },
): DocsQueryDistillationPlan | undefined {
  const original = input.trim();
  if (!original) return undefined;

  const docsUrl = parseSupportedDocsUrl(original);
  if (docsUrl) {
    const extracted = extractLocatorFromUrl(docsUrl);
    if (!extracted) return undefined;
    return buildPlan({
      original,
      source: "url",
      host: docsUrl.hostname.toLowerCase(),
      locator: extracted.locator,
      contextLocator: extracted.contextLocator,
      collectionCandidates: mergeCollections(
        HOST_COLLECTIONS[docsUrl.hostname.toLowerCase()] ?? [],
        options.explicitCollection,
      ),
    });
  }

  const identifier = detectArticleLikeIdentifier(original);
  if (!identifier) return undefined;
  return buildPlan({
    original,
    source: "identifier",
    locator: identifier,
    collectionCandidates: mergeCollections([options.defaultCollection], options.explicitCollection),
  });
}

export function buildDistilledSearchRequests(
  plan: DocsQueryDistillationPlan,
  maxCalls = 4,
): DistilledSearchRequest[] {
  const [primary, ...fallbacks] = plan.collectionCandidates;
  if (!primary) return [];

  const requests: DistilledSearchRequest[] = plan.variants.slice(0, 3).map((query, index) => ({
    collection: primary,
    query,
    variantIndex: index,
    fallbackCollection: false,
  }));

  for (const collection of fallbacks) {
    if (requests.length >= maxCalls) break;
    requests.push({
      collection,
      query: plan.semanticQuery,
      variantIndex: plan.variants.indexOf(plan.semanticQuery),
      fallbackCollection: true,
    });
  }

  return requests.slice(0, maxCalls);
}

export function rankDistilledResults(
  plan: DocsQueryDistillationPlan,
  batches: DistilledSearchBatch[],
): RankedDistilledResult[] {
  const byKey = new Map<string, RankedDistilledResult>();

  for (const batch of batches) {
    batch.results.forEach((result, index) => {
      const score = scoreResult(plan, result, index, batch.request.fallbackCollection);
      const key =
        result.id ?? result.url ?? `${result.title ?? "untitled"}:${batch.request.collection}`;
      const existing = byKey.get(key);
      if (!existing || score > existing.score) {
        byKey.set(key, {
          ...result,
          score,
          collection: result.collection ?? batch.request.collection,
          version: result.version,
          locale: result.locale,
          matchedByUrl: locatorIsInUrl(plan, result.url),
          rank: index + 1,
          variant: batch.request.query,
        });
      }
    });
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score || a.rank - b.rank);
}

export function isHighConfidenceDistilledResult(
  result: RankedDistilledResult | undefined,
): boolean {
  return Boolean(result && (result.matchedByUrl || result.score >= DISTILLED_AUTO_FETCH_SCORE));
}

function buildPlan(input: {
  original: string;
  source: "url" | "identifier";
  host?: string;
  locator: string;
  contextLocator?: string;
  collectionCandidates: string[];
}): DocsQueryDistillationPlan | undefined {
  const locator = stripLocatorExtension(input.locator);
  const slug = lastSlugPart(locator);
  const semanticQuery = semanticize(slug);
  if (!semanticQuery) return undefined;

  const contextSemantic = input.contextLocator ? semanticize(input.contextLocator) : "";
  const reduced = semanticQuery
    .split(/\s+/u)
    .filter((token) => !STOP_WORDS.has(token.toLowerCase()))
    .join(" ")
    .trim();

  const variants = unique([
    locator,
    semanticQuery,
    contextSemantic && contextSemantic !== semanticQuery
      ? `${contextSemantic} ${semanticQuery}`.trim()
      : reduced,
    reduced,
  ])
    .filter(Boolean)
    .slice(0, 3);

  return {
    kind: "docs_locator",
    original: input.original,
    source: input.source,
    host: input.host,
    locator,
    locatorAliases: unique([input.locator, locator, slug, semanticQuery]),
    semanticQuery,
    semanticTokens: tokenize(semanticQuery),
    variants,
    collectionCandidates: unique(input.collectionCandidates.filter(Boolean)),
  };
}

function parseSupportedDocsUrl(input: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const host = url.hostname.toLowerCase();
  return HOST_COLLECTIONS[host] ? url : undefined;
}

function extractLocatorFromUrl(url: URL): { locator: string; contextLocator?: string } | undefined {
  const articleId = url.searchParams.get("id")?.trim();
  if (articleId) return { locator: articleId };

  const segments = url.pathname
    .split("/")
    .map((segment) => safeDecode(segment).trim())
    .filter(Boolean)
    .filter((segment) => !GENERIC_PATH_SEGMENTS.has(segment.toLowerCase()));
  const locator = segments.at(-1);
  if (!locator) return undefined;
  const contextLocator = segments
    .slice(0, -1)
    .reverse()
    .find((segment) => meaningfulTokenCount(segment) > 0);
  return { locator, contextLocator };
}

function detectArticleLikeIdentifier(input: string): string | undefined {
  if (/\s/u.test(input)) return undefined;
  if (/^https?:\/\//iu.test(input)) return undefined;
  if (!/[._-]/u.test(input)) return undefined;
  if (/\.htm$/iu.test(input)) return input;
  if (/^[a-z][a-z0-9]*\.[a-z0-9][a-z0-9_-]+$/iu.test(input)) return input;
  if (/^[a-z0-9]+(?:[_-][a-z0-9]+){2,}$/iu.test(input)) return input;
  return undefined;
}

function scoreResult(
  plan: DocsQueryDistillationPlan,
  result: DocsSearchResult,
  zeroBasedRank: number,
  fallbackCollection: boolean,
): number {
  let score = 0;
  if (locatorIsInUrl(plan, result.url)) score += 100;
  const titleOverlap = overlapRatio(plan.semanticTokens, result.title ?? "");
  const snippetOverlap = overlapRatio(plan.semanticTokens, result.content ?? "");
  if (titleOverlap >= 0.7) score += 40;
  else if (titleOverlap >= 0.5) score += 25;
  if (snippetOverlap >= 0.7) score += 20;
  else if (snippetOverlap >= 0.5) score += 10;
  if (zeroBasedRank === 0) score += 10;
  if (fallbackCollection) score -= 5;
  return score;
}

function locatorIsInUrl(plan: DocsQueryDistillationPlan, url?: string): boolean {
  if (!url) return false;
  const normalizedUrl = normalizeComparable(url);
  return plan.locatorAliases
    .map(normalizeComparable)
    .filter((alias) => alias.length >= 8)
    .some((alias) => normalizedUrl.includes(alias));
}

function overlapRatio(needles: string[], haystack: string): number {
  if (!needles.length || !haystack) return 0;
  const tokens = new Set(tokenize(haystack));
  const hits = needles.filter((token) => tokens.has(token)).length;
  return hits / needles.length;
}

function semanticize(value: string): string {
  return stripLocatorExtension(value)
    .replace(/[._/-]+/gu, " ")
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return semanticize(value)
    .split(/\s+/u)
    .map((token) => token.replace(/[^a-z0-9]/giu, "").toLowerCase())
    .filter((token) => token.length > 1);
}

function normalizeComparable(value: string): string {
  return stripLocatorExtension(safeDecode(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/giu, "");
}

function stripLocatorExtension(value: string): string {
  return value.replace(/\.html?$/iu, "");
}

function lastSlugPart(value: string): string {
  const parts = value.split(".").filter(Boolean);
  return parts.at(-1) ?? value;
}

function meaningfulTokenCount(value: string): number {
  return tokenize(value).filter((token) => !STOP_WORDS.has(token)).length;
}

function mergeCollections(primary: string[], explicitCollection?: string): string[] {
  return unique(
    [...primary, explicitCollection].filter((value): value is string => Boolean(value)),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
