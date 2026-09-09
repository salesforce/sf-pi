/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit deterministic search/fetch grounding workflow for SF Docs. */
import { formatCacheAge, readCatalogCache, writeCatalogCache } from "./catalog-cache.ts";
import { DocsClient } from "./client.ts";
import { compileCollectionQuery } from "./collection-retrieval.ts";
import { planDeveloperReferenceRouting } from "./developer-reference.ts";
import {
  EVIDENCE_PREVIEW_CHAR_LIMIT,
  buildFetchEvidencePacket,
  classifyFetchDocuments,
  fetchContentStatus,
  formatFetchOutcome,
  structuredPreview,
} from "./evidence.ts";
import {
  buildFetchRequest,
  buildSearchRequest,
  parseFetchResponse,
  parseListResponse,
  parseSearchResponse,
} from "./protocol.ts";
import {
  distillDocsQuery,
  primaryDistilledSearch,
  isHighConfidenceDistilledResult,
  rankDistilledResults,
  type DocsQueryDistillationPlan,
} from "./query-distillation.ts";
import { evaluateReleaseNoteEvidence } from "./release-notes.ts";
import type { DocsCollection, DocsDocument, DocsSearchResult } from "./types.ts";

export interface GroundInput {
  query: string;
  collection: string;
  collectionExplicit: boolean;
  version: string;
  locale: string;
  pageSize: number;
  format: "text" | "markdown" | "html";
}

export interface GroundWorkflowResult {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
}

interface GroundStep {
  action: "catalog" | "search" | "fetch";
  status: "ok" | "partial" | "failed";
  source?: "cache" | "service";
  collection?: string;
  version?: string;
  locale?: string;
  query?: string;
  ids?: string[];
  urls?: string[];
  resultCount?: number;
  message?: string;
}

interface GroundContext {
  input: GroundInput;
  client: DocsClient;
  endpoint: string;
  signal?: AbortSignal;
  steps: GroundStep[];
  catalog: DocsCollection[];
  distilled?: DocsQueryDistillationPlan;
  slice: { collection: string; version: string; locale: string };
}

interface ReleaseEvidenceRequirement {
  release: string;
  subjectTokens: string[];
}

export async function runGroundWorkflow(args: {
  client: DocsClient;
  endpoint: string;
  input: GroundInput;
  signal?: AbortSignal;
}): Promise<GroundWorkflowResult> {
  const distilled = distillDocsQuery(args.input.query, {
    defaultCollection: args.input.collection,
    explicitCollection: args.input.collectionExplicit ? args.input.collection : undefined,
  });
  const suggestedCollection =
    distilled?.source === "url" ? distilled.collectionCandidates[0] : undefined;
  const inferredCollection = inferredCollectionFor(args.input, distilled);
  if (
    args.input.collectionExplicit &&
    suggestedCollection &&
    suggestedCollection !== args.input.collection
  ) {
    return groundFailure(
      "collection_mismatch",
      "The explicit collection conflicts with the documentation URL host.",
      {
        requestedCollection: args.input.collection,
        suggestedCollection,
        originalRequest: originalRequest(args.input),
        steps: [],
      },
    );
  }

  const context: GroundContext = {
    input: args.input,
    client: args.client,
    endpoint: args.endpoint,
    signal: args.signal,
    steps: [],
    catalog: [],
    distilled,
    slice: {
      collection: inferredCollection,
      version: args.input.version,
      locale: args.input.locale,
    },
  };

  const catalogResult = await loadCatalog(context);
  if (catalogResult) return catalogResult;
  const sliceFailure = validateSlice(context);
  if (sliceFailure) return sliceFailure;

  return distilled?.source === "url" ? groundUrl(context) : groundQuery(context);
}

async function loadCatalog(context: GroundContext): Promise<GroundWorkflowResult | undefined> {
  const cache = readCatalogCache(Date.now(), context.endpoint);
  if (cache.hit && !cache.stale && cache.collections) {
    context.catalog = cache.collections;
    context.steps.push({
      action: "catalog",
      status: "ok",
      source: "cache",
      message: `catalog cache ${formatCacheAge(cache.fetchedAt)}`,
    });
    return undefined;
  }

  const response = parseListResponse(await context.client.callTool("list", {}, context.signal));
  if (response.error) {
    context.steps.push({ action: "catalog", status: "failed", source: "service" });
    return serviceFailure("catalog", response, context);
  }
  context.catalog = response.collections ?? [];
  writeCatalogCache(context.catalog, Date.now(), context.endpoint);
  context.steps.push({ action: "catalog", status: "ok", source: "service" });
  return undefined;
}

function validateSlice(context: GroundContext): GroundWorkflowResult | undefined {
  const collection = context.catalog.find(
    (candidate) => candidate.collection === context.slice.collection,
  );
  if (!collection) {
    return groundFailure(
      "slice_not_available",
      `Collection '${context.slice.collection}' is not available.`,
      {
        originalRequest: originalRequest(context.input),
        effectiveSlice: context.slice,
        steps: context.steps,
        available: { collections: context.catalog.map((candidate) => candidate.collection) },
      },
    );
  }
  if (collection.versions?.length && !collection.versions.includes(context.slice.version)) {
    return groundFailure(
      "slice_not_available",
      `Version '${context.slice.version}' is not available for ${context.slice.collection}.`,
      {
        originalRequest: originalRequest(context.input),
        effectiveSlice: context.slice,
        steps: context.steps,
        available: { versions: collection.versions },
      },
    );
  }
  if (
    context.slice.locale !== "auto" &&
    collection.locales?.length &&
    !collection.locales.includes(context.slice.locale)
  ) {
    return groundFailure(
      "slice_not_available",
      `Locale '${context.slice.locale}' is not available for ${context.slice.collection}.`,
      {
        originalRequest: originalRequest(context.input),
        effectiveSlice: context.slice,
        steps: context.steps,
        available: { locales: collection.locales },
      },
    );
  }
  if (collection.formats?.length && !collection.formats.includes(context.input.format)) {
    return groundFailure(
      "slice_not_available",
      `Format '${context.input.format}' is not available for ${context.slice.collection}.`,
      {
        originalRequest: originalRequest(context.input),
        effectiveSlice: context.slice,
        steps: context.steps,
        available: { formats: collection.formats },
      },
    );
  }
  return undefined;
}

async function groundQuery(context: GroundContext): Promise<GroundWorkflowResult> {
  let query = context.input.query;
  if (context.distilled?.source === "identifier" || context.distilled?.source === "query") {
    query = context.distilled.variants[0] ?? query;
  }

  const referencePlan = planDeveloperReferenceRouting({
    collection: context.slice.collection,
    query,
  });
  query = referencePlan?.compiledQuery ?? query;
  query = compileCollectionQuery(context.slice.collection, query).query;

  let search = await searchOnce(context, query);
  if (isGroundFailure(search)) return search;

  if (
    search.results.length === 0 &&
    !context.input.collectionExplicit &&
    referencePlan?.fallbackCollection
  ) {
    context.slice = { ...context.slice, collection: referencePlan.fallbackCollection };
    const sliceFailure = validateSlice(context);
    if (sliceFailure) return sliceFailure;
    search = await searchOnce(context, query);
    if (isGroundFailure(search)) return search;
  }

  if (search.results.length === 0) {
    return groundFailure(
      "no_matches",
      "No documents matched the grounding query.",
      baseDetails(context),
    );
  }

  let candidatePool = search.results;
  let releaseRequirement: ReleaseEvidenceRequirement | undefined;
  if (context.distilled?.releaseHint && context.distilled.releaseNoteIntent) {
    releaseRequirement = {
      release: context.distilled.releaseHint.release,
      subjectTokens: context.distilled.semanticTokens,
    };
    const evidence = evaluateReleaseNoteEvidence({
      ...releaseRequirement,
      releaseNoteIntent: true,
      collection: context.slice.collection,
      results: search.results,
    });
    if (evidence.status !== "ok") {
      return groundFailure(
        "insufficient_docs_evidence",
        evidence.message ?? "Release-note evidence was insufficient.",
        {
          ...baseDetails(context),
          evidenceStatus: evidence.status,
        },
      );
    }
    candidatePool = evidence.candidates;
  }

  const candidates = candidatePool
    .slice(0, Math.min(3, context.input.pageSize))
    .filter((candidate): candidate is DocsSearchResult & { id: string } => Boolean(candidate.id));
  if (!candidates.length) {
    return groundFailure(
      "no_fetchable_results",
      "Search results did not include fetchable document IDs.",
      baseDetails(context),
    );
  }
  const fetchSlice = {
    ...context.slice,
    locale: candidates[0]?.locale ?? context.slice.locale,
  };
  return fetchGroundedDocuments(
    context,
    candidates.map((candidate) => candidate.id),
    fetchSlice,
    { status: "search_fetch" },
    releaseRequirement,
  );
}

async function groundUrl(context: GroundContext): Promise<GroundWorkflowResult> {
  const direct = await fetchDocuments(context, {
    urls: [context.input.query],
    slice: context.slice,
  });
  if (isGroundFailure(direct)) return direct;
  if (direct.outcome.retrievalStatus !== "failed") {
    return groundedResult(context, direct.docs, direct.slice, direct.outcome, {
      status: "direct_url",
    });
  }

  const request = context.distilled
    ? primaryDistilledSearch(context.distilled, context.slice.collection)
    : undefined;
  if (!request || !context.distilled) {
    return groundFailure(
      "no_usable_documents",
      "The URL fetch returned no usable document.",
      baseDetails(context),
    );
  }
  const search = await searchOnce(context, request.query);
  if (isGroundFailure(search)) return search;
  const ranked = rankDistilledResults(context.distilled, request, search.results);
  const best = ranked[0];
  if (!best?.id || !isHighConfidenceDistilledResult(best)) {
    return groundFailure(
      "no_recovery_candidate",
      "The URL fetch failed and no high-confidence recovery candidate was found.",
      {
        ...baseDetails(context),
        candidates: ranked.slice(0, 3),
      },
    );
  }

  const recoveredSlice = {
    collection: best.collection,
    version: best.version ?? context.slice.version,
    locale: best.locale ?? context.slice.locale,
  };
  return fetchGroundedDocuments(context, [best.id], recoveredSlice, {
    status: "recovered",
    resolvedId: best.id,
    resolvedUrl: best.url,
    score: best.score,
  });
}

async function searchOnce(
  context: GroundContext,
  query: string,
): Promise<{ results: DocsSearchResult[]; totalCount: number } | GroundWorkflowResult> {
  const response = parseSearchResponse(
    await context.client.callTool(
      "search",
      buildSearchRequest({
        ...context.slice,
        query,
        page: 1,
        pageSize: context.input.pageSize,
      }),
      context.signal,
    ),
  );
  if (response.error) {
    context.steps.push({
      action: "search",
      status: "failed",
      collection: context.slice.collection,
      query,
    });
    return serviceFailure("search", response, context);
  }
  const results = response.results ?? [];
  context.steps.push({
    action: "search",
    status: "ok",
    collection: context.slice.collection,
    version: context.slice.version,
    locale: context.slice.locale,
    query,
    resultCount: results.length,
  });
  return { results, totalCount: response.totalCount ?? results.length };
}

async function fetchGroundedDocuments(
  context: GroundContext,
  ids: string[],
  slice: { collection: string; version: string; locale: string },
  resolution: Record<string, unknown>,
  releaseRequirement?: ReleaseEvidenceRequirement,
): Promise<GroundWorkflowResult> {
  const fetched = await fetchDocuments(context, { ids, slice });
  if (isGroundFailure(fetched)) return fetched;
  if (fetched.outcome.retrievalStatus === "failed") {
    const packet = buildFetchEvidencePacket(fetched.docs, fetched.slice);
    const recoveryAttempted = resolution.status === "recovered";
    return groundFailure(
      recoveryAttempted ? "recovery_fetch_failed" : "no_usable_documents",
      [
        "The selected documents contained no usable source text.",
        formatFetchOutcome("failed", fetchContentStatus(packet)),
        "",
        packet.text,
      ].join("\n"),
      {
        ...baseDetails(context),
        resolution: recoveryAttempted ? { ...resolution, status: "failed" } : resolution,
        documents: packet.documents,
        retrievalStatus: "failed",
        contentStatus: fetchContentStatus(packet),
      },
    );
  }
  if (releaseRequirement) {
    const expectedIds = new Set(ids);
    const hasUnexpectedDocument = fetched.docs.some(
      (document) => !document.id || !expectedIds.has(document.id),
    );
    const evidence = evaluateReleaseNoteEvidence({
      ...releaseRequirement,
      releaseNoteIntent: true,
      collection: fetched.slice.collection,
      results: fetched.docs,
    });
    if (
      hasUnexpectedDocument ||
      evidence.status !== "ok" ||
      evidence.candidates.length !== fetched.docs.length
    ) {
      const packet = buildFetchEvidencePacket(fetched.docs, fetched.slice);
      const evidenceStatus = hasUnexpectedDocument
        ? "unexpected_fetched_document"
        : evidence.status;
      return groundFailure(
        "fetched_evidence_mismatch",
        hasUnexpectedDocument
          ? "Fetched documents did not match the selected release-note candidate IDs."
          : (evidence.message ??
              "Fetched documents did not satisfy the release-note evidence gate."),
        {
          ...baseDetails(context),
          resolution,
          evidenceStatus,
          documents: packet.documents,
          retrievalStatus: fetched.outcome.retrievalStatus,
          contentStatus: fetchContentStatus(packet),
        },
      );
    }
  }
  return groundedResult(context, fetched.docs, fetched.slice, fetched.outcome, resolution);
}

async function fetchDocuments(
  context: GroundContext,
  request: {
    ids?: string[];
    urls?: string[];
    slice: { collection: string; version: string; locale: string };
  },
): Promise<
  | {
      docs: DocsDocument[];
      slice: { collection: string; version: string; locale: string };
      outcome: ReturnType<typeof classifyFetchDocuments>;
    }
  | GroundWorkflowResult
> {
  const response = parseFetchResponse(
    await context.client.callTool(
      "fetch",
      buildFetchRequest({
        ...request.slice,
        ids: request.ids,
        urls: request.urls,
        format: context.input.format,
      }),
      context.signal,
    ),
  );
  if (response.error) {
    context.steps.push({
      action: "fetch",
      status: "failed",
      collection: request.slice.collection,
      ids: request.ids,
      urls: request.urls,
    });
    return serviceFailure("fetch", response, context);
  }
  const docs = response.documents ?? [];
  const requestedCount = request.ids?.length ?? request.urls?.length ?? 0;
  const outcome = classifyFetchDocuments(docs, requestedCount);
  context.steps.push({
    action: "fetch",
    status:
      outcome.retrievalStatus === "complete"
        ? "ok"
        : outcome.retrievalStatus === "partial"
          ? "partial"
          : "failed",
    collection: request.slice.collection,
    version: request.slice.version,
    locale: request.slice.locale,
    ids: request.ids,
    urls: request.urls,
    resultCount: docs.length,
  });
  return { docs, slice: request.slice, outcome };
}

function groundedResult(
  context: GroundContext,
  docs: DocsDocument[],
  fetchSlice: { collection: string; version: string; locale: string },
  outcome: ReturnType<typeof classifyFetchDocuments>,
  resolution: Record<string, unknown>,
): GroundWorkflowResult {
  const packetSlice = {
    ...fetchSlice,
    locale: docs[0]?.locale ?? fetchSlice.locale,
  };
  const packet = buildFetchEvidencePacket(docs, packetSlice);
  const contentStatus = fetchContentStatus(packet);
  const verdict =
    outcome.retrievalStatus === "complete" && contentStatus === "complete" ? "grounded" : "partial";
  const sourceUrls = [...new Set(docs.map((doc) => doc.url).filter(isString))];
  return {
    ok: true,
    text: [
      `Ground verdict: ${verdict}`,
      formatGroundSteps(context.steps),
      formatFetchOutcome(outcome.retrievalStatus, contentStatus),
      "",
      packet.text,
    ].join("\n"),
    details: {
      ...baseDetails(context),
      verdict,
      effectiveSlice: context.slice,
      fetchSlice: packetSlice,
      resolution,
      sourceUrls,
      documents: packet.documents,
      totalDocuments: packet.documents.length,
      totalContentChars: packet.totalContentChars,
      llmBudget: packet.llmBudget,
      retrievalStatus: outcome.retrievalStatus,
      contentStatus,
    },
  };
}

function inferredCollectionFor(
  input: GroundInput,
  distilled: DocsQueryDistillationPlan | undefined,
): string {
  if (input.collectionExplicit) return input.collection;
  if (distilled?.source === "url" || distilled?.source === "query") {
    return distilled.collectionCandidates[0] ?? input.collection;
  }
  return input.collection;
}

function baseDetails(context: GroundContext): Record<string, unknown> {
  return {
    originalRequest: originalRequest(context.input),
    effectiveSlice: context.slice,
    steps: context.steps,
  };
}

function originalRequest(input: GroundInput): Record<string, unknown> {
  return {
    query: input.query,
    collection: input.collectionExplicit ? input.collection : undefined,
    version: input.version,
    locale: input.locale,
    pageSize: input.pageSize,
    format: input.format,
  };
}

function serviceFailure(
  action: GroundStep["action"],
  response: { error?: string; requested?: Record<string, unknown>; available?: unknown },
  context: GroundContext,
): GroundWorkflowResult {
  const available = structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT);
  return groundFailure(
    "docs_service_error",
    `Docs service ${action} error: ${response.error ?? "unknown error"}${available ? `\nAvailable: ${available}` : ""}`,
    {
      ...baseDetails(context),
      requested: response.requested,
      available,
    },
  );
}

function groundFailure(
  reason: string,
  text: string,
  details: Record<string, unknown>,
): GroundWorkflowResult {
  const steps = Array.isArray(details.steps) ? (details.steps as GroundStep[]) : [];
  return {
    ok: false,
    text: [text, formatGroundSteps(steps)].filter(Boolean).join("\n\n"),
    details: {
      ...details,
      verdict: "not_grounded",
      reason,
    },
  };
}

function formatGroundSteps(steps: GroundStep[]): string {
  if (!steps.length) return "";
  return [
    "Ground steps:",
    ...steps.map((step, index) => {
      const target = step.collection ? ` ${step.collection}` : "";
      const count = step.resultCount === undefined ? "" : ` (${step.resultCount} result(s))`;
      const request = step.query
        ? ` query=${JSON.stringify(step.query.slice(0, 500))}`
        : step.ids?.length
          ? ` ids=${JSON.stringify(step.ids.map((id) => id.slice(0, 200)))}`
          : step.urls?.length
            ? ` urls=${JSON.stringify(step.urls.map((url) => url.slice(0, 1000)))}`
            : step.source
              ? ` source=${step.source}`
              : "";
      return `${index + 1}. ${step.action}${target}: ${step.status}${count}${request}`;
    }),
  ].join("\n");
}

function isGroundFailure(
  value: GroundWorkflowResult | { [key: string]: unknown },
): value is GroundWorkflowResult {
  return "ok" in value;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && Boolean(value);
}
