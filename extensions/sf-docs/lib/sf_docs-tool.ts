/* SPDX-License-Identifier: Apache-2.0 */
/** The single SF Docs family tool. */
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDocsToken, resolveEndpoint } from "./auth.ts";
import { DocsClient } from "./client.ts";
import { formatCacheAge, readCatalogCache, writeCatalogCache } from "./catalog-cache.ts";
import { readEffectiveDocsPreferences } from "./preferences.ts";
import { buildStatus } from "./status.ts";
import { renderToolCall, renderToolResult, clipText } from "./render.ts";
import {
  buildDistilledSearchRequests,
  distillDocsQuery,
  isHighConfidenceDistilledResult,
  rankDistilledResults,
  type DistilledSearchBatch,
  type DistilledSearchRequest,
  type DocsQueryDistillationPlan,
  type RankedDistilledResult,
} from "./query-distillation.ts";
import {
  TOOL_NAME,
  type DocsCitation,
  type DocsCollection,
  type DocsDocument,
  type DocsSearchResult,
  type SfDocsDisplayDensity,
  type ToolResultShape,
} from "./types.ts";

interface SearchResponse {
  results?: DocsSearchResult[];
  totalCount?: number;
  [key: string]: unknown;
}

interface FetchResponse {
  documents?: DocsDocument[];
  [key: string]: unknown;
}

interface AnswerResponse {
  answer?: string;
  explanation?: string;
  citations?: DocsCitation[];
  [key: string]: unknown;
}

const FETCH_PER_DOCUMENT_CHAR_LIMIT = 12000;
const FETCH_TOTAL_CHAR_LIMIT = 48000;
const FETCH_DETAILS_PREVIEW_CHAR_LIMIT = 1600;

interface DistilledSearchRun {
  requests: DistilledSearchRequest[];
  batches: DistilledSearchBatch[];
  ranked: RankedDistilledResult[];
}

type DocsEvidenceStatus = "ok" | "no_matches" | "wrong_release" | "insufficient" | "not_checked";

interface DocsQueryPlanSummary {
  original: string;
  compiledQuery: string;
  collection: string;
  version: string;
  locale: string;
  filters: string[];
  boosts: string[];
  evidenceStatus: DocsEvidenceStatus;
  evidenceMessage?: string;
}

interface DocsEvidenceEvaluation {
  status: DocsEvidenceStatus;
  message?: string;
}

interface FetchRecoveryResult {
  recovered: boolean;
  search: DistilledSearchRun;
  docs: DocsDocument[];
  slice: { collection: string; version: string; locale: string };
  recoveredRequest?: { ids?: string[]; urls?: string[]; format: "text" | "markdown" | "html" };
  resolved?: RankedDistilledResult;
}

const Params = Type.Object({
  action: StringEnum(
    ["status", "collections", "search", "fetch", "answer", "explain", "cheatsheet"] as const,
    {
      description: "SF Docs action to run.",
    },
  ),
  query: Type.Optional(Type.String({ description: "Search or answer/explain query." })),
  collection: Type.Optional(Type.String({ description: "Docs collection, e.g. developer." })),
  version: Type.Optional(
    Type.String({ description: "Collection version. Defaults to settings/current." }),
  ),
  locale: Type.Optional(Type.String({ description: "Docs locale. Defaults to settings/en-us." })),
  page: Type.Optional(Type.Number({ description: "Search page number. Defaults to 1." })),
  pageSize: Type.Optional(
    Type.Number({ description: "Search result count. Defaults to settings." }),
  ),
  format: Type.Optional(
    StringEnum(["text", "markdown", "html"] as const, { description: "Fetch/search body format." }),
  ),
  ids: Type.Optional(Type.Array(Type.String(), { description: "Document IDs for fetch." })),
  urls: Type.Optional(
    Type.Array(Type.String(), { description: "Document URLs for fetch/explain." }),
  ),
  id: Type.Optional(Type.String({ description: "Single document id for explain." })),
  url: Type.Optional(Type.String({ description: "Single document URL for explain." })),
  cite: Type.Optional(
    Type.Boolean({ description: "Include citations for answer/explain. Defaults to settings." }),
  ),
  refresh: Type.Optional(Type.Boolean({ description: "Bypass catalog cache for collections." })),
});

type Params = {
  action: string;
  query?: string;
  collection?: string;
  version?: string;
  locale?: string;
  page?: number;
  pageSize?: number;
  format?: "text" | "markdown" | "html";
  ids?: string[];
  urls?: string[];
  id?: string;
  url?: string;
  cite?: boolean;
  refresh?: boolean;
};

export function registerSfDocsTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof Params>({
    name: TOOL_NAME,
    label: "SF Docs",
    description:
      "Search, fetch, and answer from Salesforce documentation through one family tool. Returns visible citations and bounded summaries.",
    promptSnippet: "Search and fetch official Salesforce documentation with visible citations.",
    promptGuidelines: [
      "Use sf_docs for Salesforce documentation lookup when official docs are needed; do not use it as generic web search.",
      "For implementation-sensitive Salesforce guidance, prefer sf_docs action='search' then action='fetch' for the most relevant results before finalizing.",
      "Use sf_docs action='answer' for quick cited synthesis or broad explanatory questions; cite returned source URLs in the final response when relevant.",
      "Use sf_docs action='collections' to learn valid collections, versions, locales, and formats before guessing non-default slices.",
      "Use sf_docs action='cheatsheet' only when SF Docs workflow guidance is needed; the cheatsheet is not always-on context.",
    ],
    parameters: Params,
    renderCall: (args, theme) => renderToolCall(args as Params, theme),
    renderResult: (result, opts, theme) =>
      renderToolResult(
        result as { details?: Record<string, unknown>; content?: unknown[] },
        opts,
        theme,
      ),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const input = params as Params;
      const prefs = readEffectiveDocsPreferences(ctx.cwd);
      if (input.action === "status") {
        return ok("status", buildStatus(ctx.cwd), {
          status: buildStatus(ctx.cwd),
          displayDensity: prefs.displayDensity,
        });
      }
      if (input.action === "cheatsheet") return cheatsheetResult(prefs.displayDensity);

      const auth = await getDocsToken(ctx);
      if (auth.ok === false) {
        return fail(input.action, auth.message, {
          reason: "missing_auth",
          recover_via: { command: "/sf-docs connect", action: "status" },
        });
      }
      const endpoint = resolveEndpoint();
      const client = new DocsClient({
        endpoint: endpoint.endpoint,
        token: auth.token,
        timeoutMs: timeoutForAction(input.action),
      });
      const collectionResolution = resolveCollectionName(
        input.collection ?? prefs.defaultCollection,
      );
      const slice = {
        collection: collectionResolution.collection,
        version: input.version ?? prefs.defaultVersion,
        locale: input.locale ?? prefs.defaultLocale,
      };
      if (versionLooksLikeSalesforceRelease(slice.version)) {
        return fail(
          input.action,
          `SF Docs collection version '${slice.version}' is not a docs collection version. Use version='current' and put Salesforce seasonal releases in the query, for example '+release:${normalizeReleaseValue(slice.version)}'.`,
          {
            ...slice,
            reason: "invalid_docs_version",
            recover_via: {
              version: "current",
              query_filter: `+release:${normalizeReleaseValue(slice.version)}`,
            },
          },
        );
      }

      try {
        if (input.action === "collections") {
          const cache = readCatalogCache();
          if (
            prefs.cacheCatalog &&
            !input.refresh &&
            cache.hit &&
            !cache.stale &&
            cache.collections
          ) {
            const collections = input.collection
              ? cache.collections.filter((collection) => collection.collection === slice.collection)
              : cache.collections;
            return collectionsResult(
              collections,
              `hit · ${formatCacheAge(cache.fetchedAt)}`,
              prefs.displayDensity,
              collectionResolution.alias,
            );
          }
          const listArgs: Record<string, unknown> = {};
          if (input.collection) listArgs.collections = [slice.collection];
          const response = (await client.callTool("list", listArgs, signal)) as {
            collections?: DocsCollection[];
          };
          const collections = response.collections ?? [];
          if (prefs.cacheCatalog && !input.collection) writeCatalogCache(collections);
          return collectionsResult(
            collections,
            input.refresh ? "refreshed" : "miss/refreshed",
            prefs.displayDensity,
            collectionResolution.alias,
          );
        }

        if (input.action === "search") {
          if (!input.query?.trim()) {
            return fail("search", "sf_docs search requires query.", {
              reason: "missing_query",
              recover_via: { ask: "Provide a concise Salesforce documentation search query." },
            });
          }
          const pageSize = clamp(input.pageSize ?? prefs.defaultPageSize, 1, 60);
          const distilled = distillDocsQuery(input.query, {
            defaultCollection: slice.collection,
            explicitCollection: input.collection ? slice.collection : undefined,
          });
          if (distilled) {
            const distilledSearch = await runDistilledSearch(
              client,
              distilled,
              {
                version: slice.version,
                locale: slice.locale,
                page: input.page ?? 1,
                pageSize,
                format: input.format,
              },
              signal,
            );
            const response = {
              results: distilledSearch.ranked.slice(0, pageSize),
              totalCount: distilledSearch.ranked.length,
            };
            const queryPlan = buildQueryPlanSummary(distilled, distilledSearch, {
              version: slice.version,
              locale: slice.locale,
            });
            const text = [
              formatQueryPlanText(queryPlan),
              "",
              formatSearchToolText(input.query, response),
            ].join("\n");
            return ok("search", text, {
              ...slice,
              collection: distilled.collectionCandidates[0] ?? slice.collection,
              query: input.query,
              ...response,
              retrieval_status: queryPlan.evidenceStatus,
              queryPlan,
              displayDensity: prefs.displayDensity,
              resolution: buildDistillationResolution(distilled, distilledSearch, {
                evidenceStatus: queryPlan.evidenceStatus,
              }),
            });
          }

          const args: Record<string, unknown> = {
            ...slice,
            query: input.query,
            page: input.page ?? 1,
            pageSize,
          };
          if (input.format) args.format = input.format;
          const response = asSearchResponse(await client.callTool("search", args, signal));
          const serviceError = docsServiceError(response);
          if (serviceError) {
            return fail("search", serviceError, {
              ...slice,
              query: input.query,
              reason: "docs_service_error",
            });
          }
          const text = formatSearchToolText(input.query, response);
          return ok("search", text, {
            ...slice,
            query: input.query,
            ...response,
            displayDensity: prefs.displayDensity,
          });
        }

        if (input.action === "fetch") {
          const format = input.format ?? prefs.defaultFetchFormat;
          const args: Record<string, unknown> = {
            ...slice,
            format,
          };
          const requested: {
            ids?: string[];
            urls?: string[];
            format: "text" | "markdown" | "html";
          } = {
            format,
          };
          if (input.ids?.length) {
            requested.ids = input.ids.slice(0, 12);
            args.ids = requested.ids;
          } else if (input.urls?.length) {
            requested.urls = input.urls.slice(0, 12);
            args.urls = requested.urls;
          } else {
            return fail("fetch", "sf_docs fetch requires ids or urls.", {
              reason: "missing_ids_or_urls",
              recover_via: { action: "search", required: ["query"] },
            });
          }
          const response = asFetchResponse(await client.callTool("fetch", args, signal));
          const serviceError = docsServiceError(response);
          if (serviceError) {
            return fail("fetch", serviceError, {
              ...slice,
              requested,
              reason: "docs_service_error",
            });
          }
          const docs = response.documents ?? [];
          const recoveryPlan =
            requested.urls?.length === 1
              ? distillDocsQuery(requested.urls[0], {
                  defaultCollection: slice.collection,
                  explicitCollection: input.collection ? slice.collection : undefined,
                })
              : undefined;
          if (recoveryPlan && fetchLooksRecoverable(docs)) {
            const recovery = await recoverFetchByDistilledSearch(
              client,
              recoveryPlan,
              {
                version: slice.version,
                locale: slice.locale,
                format,
              },
              signal,
            );
            if (recovery.recovered) {
              const packet = buildFetchEvidencePacket(recovery.docs, recovery.slice);
              const queryPlan = buildQueryPlanSummary(recoveryPlan, recovery.search, {
                version: slice.version,
                locale: slice.locale,
              });
              const note = `Recovered by searching distilled docs locator: ${recoveryPlan.semanticQuery}`;
              return ok(
                "fetch",
                `${formatQueryPlanText(queryPlan)}\n\n${note}\n\n${packet.text || "No documents returned."}`,
                {
                  ...recovery.slice,
                  requested,
                  recoveredRequest: recovery.recoveredRequest,
                  displayDensity: prefs.displayDensity,
                  queryPlan,
                  documents: packet.documents,
                  totalDocuments: packet.documents.length,
                  totalContentChars: packet.totalContentChars,
                  llmBudget: packet.llmBudget,
                  resolution: buildDistillationResolution(recoveryPlan, recovery.search, {
                    status: "recovered",
                    resolvedId: recovery.resolved?.id,
                    resolvedUrl: recovery.resolved?.url,
                    score: recovery.resolved?.score,
                  }),
                },
              );
            }

            const packet = buildFetchEvidencePacket(docs, slice);
            const queryPlan = buildQueryPlanSummary(recoveryPlan, recovery.search, {
              version: slice.version,
              locale: slice.locale,
            });
            const text = [
              formatQueryPlanText(queryPlan),
              `Direct URL fetch was not usable. Distilled docs locator query was ambiguous: ${recoveryPlan.semanticQuery}`,
              formatRecoveryCandidates(recovery.search.ranked),
              "",
              packet.text || "No documents returned.",
            ]
              .filter(Boolean)
              .join("\n");
            const details = {
              ...slice,
              requested,
              displayDensity: prefs.displayDensity,
              queryPlan,
              documents: packet.documents,
              totalDocuments: packet.documents.length,
              totalContentChars: packet.totalContentChars,
              llmBudget: packet.llmBudget,
              resolution: buildDistillationResolution(recoveryPlan, recovery.search, {
                status: "ambiguous",
                evidenceStatus: queryPlan.evidenceStatus,
              }),
            };
            if (recoveryPlan.releaseHint && recoveryPlan.releaseNoteIntent) {
              return fail("fetch", text, {
                ...details,
                reason: "insufficient_docs_evidence",
                retrieval_status: queryPlan.evidenceStatus,
                recover_via: { action: "search", query: queryPlan.compiledQuery },
              });
            }
            return ok("fetch", text, details);
          }

          const packet = buildFetchEvidencePacket(docs, slice);
          return ok("fetch", packet.text || "No documents returned.", {
            ...slice,
            requested,
            displayDensity: prefs.displayDensity,
            documents: packet.documents,
            totalDocuments: packet.documents.length,
            totalContentChars: packet.totalContentChars,
            llmBudget: packet.llmBudget,
          });
        }

        if (input.action === "answer") {
          if (!input.query?.trim()) {
            return fail("answer", "sf_docs answer requires query.", {
              reason: "missing_query",
              recover_via: { ask: "Provide a concise Salesforce documentation question." },
            });
          }
          const distilled = distillDocsQuery(input.query, {
            defaultCollection: slice.collection,
            explicitCollection: input.collection ? slice.collection : undefined,
          });
          const answerBias = distilled?.releaseHint && distilled.releaseNoteIntent;
          let queryPlan: DocsQueryPlanSummary | undefined;
          if (answerBias) {
            const preflight = await runDistilledSearch(
              client,
              distilled,
              { version: slice.version, locale: slice.locale, pageSize: 5 },
              signal,
            );
            queryPlan = buildQueryPlanSummary(distilled, preflight, {
              version: slice.version,
              locale: slice.locale,
            });
            if (queryPlan.evidenceStatus !== "ok") {
              return fail(
                "answer",
                `${formatQueryPlanText(queryPlan)}\n\nSF Docs could not find sufficient official documentation evidence for this release-specific question.`,
                {
                  ...slice,
                  collection: distilled.collectionCandidates[0] ?? slice.collection,
                  query: input.query,
                  reason: "insufficient_docs_evidence",
                  retrieval_status: queryPlan.evidenceStatus,
                  queryPlan,
                  resolution: buildDistillationResolution(distilled, preflight, {
                    evidenceStatus: queryPlan.evidenceStatus,
                  }),
                  recover_via: { action: "search", query: queryPlan.compiledQuery },
                },
              );
            }
          }
          const answerSlice = answerBias
            ? { ...slice, collection: distilled.collectionCandidates[0] ?? slice.collection }
            : slice;
          const answerQuery = answerBias
            ? (queryPlan?.compiledQuery ?? uniqueAnswerQuery(input.query, distilled.variants))
            : input.query;
          const response = asAnswerResponse(
            await client.callTool(
              "answer",
              {
                ...answerSlice,
                query: answerQuery,
                cite: input.cite ?? prefs.includeCitations,
              },
              signal,
            ),
          );
          const serviceError = docsServiceError(response);
          if (serviceError)
            return fail("answer", serviceError, { ...answerSlice, reason: "docs_service_error" });
          if (answerBias && queryPlan) {
            const citationEvidence = evaluateAnswerCitationEvidence(
              distilled,
              response.citations ?? [],
            );
            if (citationEvidence.status !== "ok") {
              const failedPlan = {
                ...queryPlan,
                evidenceStatus: citationEvidence.status,
                evidenceMessage: citationEvidence.message,
              };
              return fail(
                "answer",
                `${formatQueryPlanText(failedPlan)}\n\nSF Docs answer citations did not satisfy the release-specific evidence gate.`,
                {
                  ...answerSlice,
                  query: input.query,
                  reason: "insufficient_docs_evidence",
                  retrieval_status: citationEvidence.status,
                  queryPlan: failedPlan,
                  citations: response.citations,
                },
              );
            }
          }
          const answer = response.answer ?? response.explanation ?? "";
          return ok(
            "answer",
            `${queryPlan ? `${formatQueryPlanText(queryPlan)}\n\n` : ""}${formatAnswerText(response)}`,
            {
              ...answerSlice,
              ...response,
              retrieval_status: queryPlan?.evidenceStatus,
              queryPlan,
              displayDensity: prefs.displayDensity,
              answerChars: answer.length,
              resolution: answerBias
                ? {
                    kind: "docs_query_distillation",
                    original: distilled.original,
                    source: distilled.source,
                    semanticQuery: distilled.semanticQuery,
                    variantsTried: distilled.variants,
                    collectionsTried: [answerSlice.collection],
                    releaseHint: distilled.releaseHint,
                    status: "answer_biased",
                    evidenceStatus: queryPlan?.evidenceStatus,
                  }
                : undefined,
            },
          );
        }

        if (input.action === "explain") {
          const args: Record<string, unknown> = {
            ...slice,
            query: input.query?.trim() || "Summarize this document.",
            cite: input.cite ?? prefs.includeCitations,
          };
          if (input.id) args.id = input.id;
          else if (input.url) args.url = input.url;
          else {
            return fail("explain", "sf_docs explain requires id or url.", {
              reason: "missing_id_or_url",
              recover_via: { action: "search", then: "explain", required: ["id", "url"] },
            });
          }
          const response = asAnswerResponse(await client.callTool("explain", args, signal));
          const serviceError = docsServiceError(response);
          if (serviceError)
            return fail("explain", serviceError, { ...slice, reason: "docs_service_error" });
          const answer = response.answer ?? response.explanation ?? "";
          return ok("explain", formatAnswerText(response), {
            ...slice,
            ...response,
            displayDensity: prefs.displayDensity,
            answerChars: answer.length,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(input.action, message);
      }

      return fail(input.action, `Unsupported sf_docs action: ${input.action}`, {
        reason: "unsupported_action",
        recover_via: {
          actions: ["status", "collections", "search", "fetch", "answer", "explain", "cheatsheet"],
        },
      });
    },
  });
}

function resolveCollectionName(collection: string): { collection: string; alias?: string } {
  const normalized = collection.trim().toLowerCase();
  if (normalized === "help" || normalized === "salesforce_help") {
    return { collection: "admin", alias: `${collection} → admin` };
  }
  return { collection };
}

async function runDistilledSearch(
  client: DocsClient,
  plan: DocsQueryDistillationPlan,
  base: {
    version: string;
    locale: string;
    page?: number;
    pageSize: number;
    format?: "text" | "markdown" | "html";
  },
  signal?: AbortSignal,
): Promise<DistilledSearchRun> {
  const requests = buildDistilledSearchRequests(plan);
  const batches = await Promise.all(
    requests.map(async (request) => {
      const args: Record<string, unknown> = {
        collection: request.collection,
        version: base.version,
        locale: base.locale,
        query: request.query,
        page: base.page ?? 1,
        pageSize: base.pageSize,
      };
      if (base.format) args.format = base.format;
      const response = asSearchResponse(await client.callTool("search", args, signal));
      const error = docsServiceError(response);
      return {
        request,
        results: error ? [] : (response.results ?? []),
        totalCount: response.totalCount,
      };
    }),
  );
  return { requests, batches, ranked: rankDistilledResults(plan, batches) };
}

async function recoverFetchByDistilledSearch(
  client: DocsClient,
  plan: DocsQueryDistillationPlan,
  base: { version: string; locale: string; format: "text" | "markdown" | "html" },
  signal?: AbortSignal,
): Promise<FetchRecoveryResult> {
  const search = await runDistilledSearch(
    client,
    plan,
    { version: base.version, locale: base.locale, pageSize: 5 },
    signal,
  );
  const best = search.ranked[0];
  if (!best?.id || !isHighConfidenceDistilledResult(best)) {
    return {
      recovered: false,
      search,
      docs: [],
      slice: {
        collection: best?.collection ?? plan.collectionCandidates[0] ?? "developer",
        version: best?.version ?? base.version,
        locale: best?.locale ?? base.locale,
      },
    };
  }

  const recoverySlice = {
    collection: best.collection,
    version: best.version ?? base.version,
    locale: best.locale ?? base.locale,
  };
  const recoveredRequest = { ids: [best.id], format: base.format };
  const response = asFetchResponse(
    await client.callTool(
      "fetch",
      {
        ...recoverySlice,
        ...recoveredRequest,
      },
      signal,
    ),
  );
  return {
    recovered: true,
    search,
    docs: response.documents ?? [],
    slice: recoverySlice,
    recoveredRequest,
    resolved: best,
  };
}

function fetchLooksRecoverable(docs: DocsDocument[]): boolean {
  return docs.length === 0 || docs.every((doc) => Boolean(doc.error) || !doc.content?.trim());
}

function buildQueryPlanSummary(
  plan: DocsQueryDistillationPlan,
  search: DistilledSearchRun,
  slice: { version: string; locale: string },
): DocsQueryPlanSummary {
  const evidence = evaluateEvidence(plan, search.ranked);
  const firstRequest = search.requests[0];
  return {
    original: plan.original,
    compiledQuery: firstRequest?.query ?? plan.variants[0] ?? plan.semanticQuery,
    collection: firstRequest?.collection ?? plan.collectionCandidates[0] ?? "developer",
    version: slice.version,
    locale: slice.locale,
    filters: plan.retrievalFilters,
    boosts: plan.retrievalBoosts,
    evidenceStatus: evidence.status,
    evidenceMessage: evidence.message,
  };
}

function evaluateEvidence(
  plan: DocsQueryDistillationPlan,
  results: DocsSearchResult[],
): DocsEvidenceEvaluation {
  if (!plan.releaseHint?.release || !plan.releaseNoteIntent) {
    return { status: "not_checked" };
  }
  if (!results.length) {
    return {
      status: "no_matches",
      message: `No documents matched release ${plan.releaseHint.release}.`,
    };
  }
  const release = plan.releaseHint.release;
  const hasReleaseMatch = results.some((result) => resultMatchesRelease(result, release));
  if (!hasReleaseMatch) {
    return {
      status: "wrong_release",
      message: `Returned documents did not match release ${plan.releaseHint.release}.`,
    };
  }
  return { status: "ok" };
}

function evaluateAnswerCitationEvidence(
  plan: DocsQueryDistillationPlan,
  citations: DocsCitation[],
): DocsEvidenceEvaluation {
  const releaseEvidence = evaluateEvidence(plan, citations);
  if (releaseEvidence.status !== "ok") return releaseEvidence;
  if (!plan.retrievalBoosts.length) return { status: "ok" };

  const visibleCitations = citations.slice(0, Math.min(5, citations.length));
  const matches = visibleCitations.filter((citation) =>
    plan.retrievalBoosts.some((boost) => resultMatchesGuideBoost(citation, boost)),
  ).length;
  const required = Math.max(1, Math.ceil(visibleCitations.length / 2));
  if (matches < required) {
    return {
      status: "insufficient",
      message: `Only ${matches} of the first ${visibleCitations.length} citations matched product boosts (${plan.retrievalBoosts.join(" ")}).`,
    };
  }
  return { status: "ok" };
}

function versionLooksLikeSalesforceRelease(version: string): boolean {
  const release = normalizeReleaseValue(version);
  return Boolean(
    release && /^\d{3}$/u.test(release) && version !== "current" && version !== "next",
  );
}

function resultMatchesRelease(result: DocsSearchResult, release: string): boolean {
  return (
    normalizeReleaseValue(result.release) === release ||
    Boolean(result.url?.includes(`release=${release}`))
  );
}

function resultMatchesGuideBoost(result: DocsSearchResult, boost: string): boolean {
  const slug = boost
    .replace(/^\+?guides:/u, "")
    .trim()
    .toLowerCase();
  if (!slug) return false;
  const compactSlug = slug.replace(/_/gu, " ");
  const haystack = [
    result.guides,
    result.product,
    result.products,
    result.title,
    typeof result.url === "string" ? result.url.replace(/^https?:\/\/[^/]+/iu, "") : "",
    result.filename,
  ]
    .map((value) => (typeof value === "string" ? value.toLowerCase().replace(/[_-]/gu, " ") : ""))
    .join(" ");
  return haystack.includes(slug.replace(/_/gu, " ")) || haystack.includes(compactSlug);
}

function normalizeReleaseValue(value: unknown): string | undefined {
  if (typeof value === "number") return String(Math.trunc(value));
  if (typeof value !== "string") return undefined;
  return value.match(/^\d+/u)?.[0];
}

function formatQueryPlanText(plan: DocsQueryPlanSummary): string {
  const lines = [
    "Docs Query Plan:",
    `- original: ${plan.original}`,
    `- compiled: ${plan.compiledQuery}`,
    `- slice: ${plan.collection}/${plan.version}/${plan.locale}`,
  ];
  const filters = [...plan.filters, ...plan.boosts];
  if (filters.length) lines.push(`- filters/boosts: ${filters.join(" ")}`);
  lines.push(
    `- evidence: ${plan.evidenceStatus}${plan.evidenceMessage ? ` — ${plan.evidenceMessage}` : ""}`,
  );
  return lines.join("\n");
}

function buildDistillationResolution(
  plan: DocsQueryDistillationPlan,
  search: DistilledSearchRun,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "docs_query_distillation",
    original: plan.original,
    source: plan.source,
    host: plan.host,
    locator: plan.locator,
    semanticQuery: plan.semanticQuery,
    variantsTried: search.requests.map((request) => request.query),
    collectionsTried: [...new Set(search.requests.map((request) => request.collection))],
    retrievalFilters: plan.retrievalFilters,
    retrievalBoosts: plan.retrievalBoosts,
    topCandidates: search.ranked.slice(0, 5).map((result) => ({
      id: result.id,
      title: result.title,
      url: result.url,
      collection: result.collection,
      score: result.score,
      matchedByUrl: result.matchedByUrl,
    })),
    ...extra,
  };
}

function formatRecoveryCandidates(ranked: RankedDistilledResult[]): string {
  if (!ranked.length) return "No recovery candidates found.";
  const lines = ["Recovery candidates:"];
  ranked.slice(0, 3).forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title ?? "Untitled"}`);
    if (result.id) lines.push(`   id: ${result.id}`);
    if (result.url) lines.push(`   url: ${result.url}`);
  });
  return lines.join("\n");
}

function ok(action: string, text: string, details: Record<string, unknown>): ToolResultShape {
  return { content: [{ type: "text", text }], details: { ok: true, action, ...details } };
}

function fail(
  action: string,
  text: string,
  details: Record<string, unknown> = {},
): ToolResultShape {
  return { content: [{ type: "text", text }], details: { ok: false, action, ...details } };
}

function collectionsResult(
  collections: DocsCollection[],
  cache: string,
  displayDensity: SfDocsDisplayDensity,
  collectionAlias?: string,
): ToolResultShape {
  const summaries = collections.map(summarizeCollectionCapabilities);
  const lines: string[] = [];
  if (collectionAlias) lines.push(`Collection alias: ${collectionAlias}`, "");
  for (const summary of summaries) {
    lines.push(
      `${summary.collection}: versions=${summary.versions || "-"}; locales=${summary.locales || "-"}; formats=${summary.formats || "-"}`,
    );
    if (summary.extraFields) lines.push(`  extraFields: ${summary.extraFields}`);
    if (summary.keyFilters) lines.push(`  key filters: ${summary.keyFilters}`);
    if (summary.landmarks) lines.push(`  landmarks: ${summary.landmarks}`);
    if (summary.hintsPreview) lines.push(`  hints: ${summary.hintsPreview}`);
  }
  return ok("collections", lines.join("\n"), {
    collections,
    capabilitySummaries: summaries,
    cache,
    collectionAlias,
    displayDensity,
  });
}

function summarizeCollectionCapabilities(collection: DocsCollection): Record<string, string> {
  const hints = collection.retrievalHints ?? "";
  const keyFilters = [
    hints.includes("+release:") ? "+release:<n>" : "",
    hints.includes("guides:") ? "guides:<slug>" : "",
    hints.includes("+taxonomyIds:") ? "+taxonomyIds:<guid>" : "",
  ].filter(Boolean);
  return {
    collection: collection.collection,
    versions: (collection.versions ?? []).join(","),
    locales: (collection.locales ?? []).join(","),
    formats: (collection.formats ?? []).join(","),
    extraFields: (collection.extraFields ?? []).slice(0, 12).join(","),
    keyFilters: keyFilters.join(", "),
    landmarks: (collection.landmarks ?? [])
      .slice(0, 12)
      .map((landmark) => landmark.slug)
      .filter((slug): slug is string => Boolean(slug))
      .join(", "),
    hintsPreview: previewPlainText(hints, collection.collection === "admin" ? 700 : 420),
  };
}

function cheatsheetResult(displayDensity: SfDocsDisplayDensity): ToolResultShape {
  const file = path.join(import.meta.dirname, "..", "docs", "cheatsheet.md");
  const text = readFileSync(file, "utf8");
  return ok("cheatsheet", clipText(text, 16000), { path: file, displayDensity });
}

interface FetchEvidenceDocument {
  id?: string;
  url?: string;
  title: string;
  product?: string;
  products?: string;
  guides?: string;
  filename?: string;
  status: "ok" | "error";
  error?: string;
  contentChars: number;
  llmReturnedChars: number;
  llmTruncated: boolean;
  metadataOnly: boolean;
  headings: string[];
  humanPreview: string;
}

function buildFetchEvidencePacket(
  docs: DocsDocument[],
  slice: { collection: string; version: string; locale: string },
): {
  text: string;
  documents: FetchEvidenceDocument[];
  totalContentChars: number;
  llmBudget: {
    perDocumentChars: number;
    maxTotalChars: number;
    returnedChars: number;
    truncatedDocuments: number;
    metadataOnlyDocuments: number;
  };
} {
  let remaining = FETCH_TOTAL_CHAR_LIMIT;
  let returnedChars = 0;
  const documents: FetchEvidenceDocument[] = [];
  const bodyLines = [
    `SF Docs fetch returned ${docs.length} document(s) for ${slice.collection}/${slice.version}/${slice.locale}.`,
    `LLM source budget: ${FETCH_PER_DOCUMENT_CHAR_LIMIT} chars per document; ${FETCH_TOTAL_CHAR_LIMIT} chars total.`,
    "",
  ];

  docs.forEach((doc, index) => {
    const title = doc.title ?? doc.id ?? doc.url ?? "Document";
    const source = doc.content ?? "";
    const contentChars = source.length;
    const allowed = doc.error ? 0 : Math.max(0, Math.min(remaining, FETCH_PER_DOCUMENT_CHAR_LIMIT));
    const body = allowed > 0 ? source.slice(0, allowed) : "";
    const metadataOnly = !doc.error && contentChars > 0 && body.length === 0;
    const llmTruncated = !doc.error && body.length < contentChars;
    remaining -= body.length;
    returnedChars += body.length;

    documents.push({
      id: doc.id,
      url: doc.url,
      title,
      product: typeof doc.product === "string" ? doc.product : undefined,
      products: typeof doc.products === "string" ? doc.products : undefined,
      guides: typeof doc.guides === "string" ? doc.guides : undefined,
      filename: typeof doc.filename === "string" ? doc.filename : undefined,
      status: doc.error ? "error" : "ok",
      error: doc.error,
      contentChars,
      llmReturnedChars: body.length,
      llmTruncated,
      metadataOnly,
      headings: extractHeadings(source),
      humanPreview: previewText(source, FETCH_DETAILS_PREVIEW_CHAR_LIMIT),
    });

    bodyLines.push(
      `<document index="${index + 1}" id="${escapeAttribute(doc.id ?? "")}" title="${escapeAttribute(title)}" url="${escapeAttribute(doc.url ?? "")}" contentChars="${contentChars}" returnedChars="${body.length}" truncated="${llmTruncated}" metadataOnly="${metadataOnly}" status="${doc.error ? "error" : "ok"}">`,
    );
    if (doc.url) bodyLines.push(`Source URL: ${doc.url}`);
    if (doc.error) {
      bodyLines.push(`Error: ${doc.error}`);
    } else if (body) {
      bodyLines.push(body);
    } else if (metadataOnly) {
      bodyLines.push(
        "[No body text included because the global Docs Evidence Packet budget was exhausted.]",
      );
    }
    bodyLines.push("</document>", "");
  });

  const truncatedDocuments = documents.filter((doc) => doc.llmTruncated).length;
  const metadataOnlyDocuments = documents.filter((doc) => doc.metadataOnly).length;
  return {
    text: bodyLines.join("\n").trimEnd(),
    documents,
    totalContentChars: documents.reduce((sum, doc) => sum + doc.contentChars, 0),
    llmBudget: {
      perDocumentChars: FETCH_PER_DOCUMENT_CHAR_LIMIT,
      maxTotalChars: FETCH_TOTAL_CHAR_LIMIT,
      returnedChars,
      truncatedDocuments,
      metadataOnlyDocuments,
    },
  };
}

function extractHeadings(value: string): string[] {
  const markdownHeadings = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^#{1,4}\s+\S/.test(line))
    .map((line) => line.replace(/^#{1,4}\s+/, "").trim());
  const htmlHeadings = Array.from(value.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/giu)).map(
    (match) => stripHtml(String(match[1] ?? "")).trim(),
  );
  return [...markdownHeadings, ...htmlHeadings].filter(Boolean).slice(0, 5);
}

function previewText(value: string, max: number): string {
  return stripHtml(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function previewPlainText(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function stripHtml(value: string): string {
  const withoutBlocks = value
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ");
  return decodeHtmlEntities(withoutBlocks.replace(/<[^>]+>/gu, " "));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatAnswerText(response: AnswerResponse): string {
  const answer = response.answer ?? response.explanation ?? "";
  const citations = response.citations ?? [];
  const citationText = citations
    .map((citation, i) => `${i + 1}. ${citation.title ?? "Untitled"}\n   ${citation.url ?? ""}`)
    .join("\n");
  return citationText ? `${answer}\n\nCitations:\n${citationText}` : answer;
}

export function formatSearchToolText(query: string, response: SearchResponse): string {
  const results = response.results ?? [];
  const total = typeof response.totalCount === "number" ? response.totalCount : results.length;
  const lines = [
    `SF Docs search returned ${results.length}${total !== results.length ? ` of ${total}` : ""} result(s) for ${query}.`,
  ];

  if (!results.length) {
    lines.push(
      "Try fewer terms, exact Salesforce product names, or sf_docs collections for valid slices.",
    );
    return lines.join("\n");
  }

  lines.push("", "Results:");
  for (const [index, result] of results.slice(0, 10).entries()) {
    lines.push(`${index + 1}. ${result.title ?? "Untitled"}`);
    if (result.id) lines.push(`   id: ${result.id}`);
    if (result.url) lines.push(`   url: ${result.url}`);
    const snippet = searchSnippet(result);
    if (snippet) lines.push(`   snippet: ${snippet}`);
  }
  lines.push("", "Next: fetch promising ids or urls before implementation-sensitive answers.");
  return clipText(lines.join("\n"), 12000);
}

function searchSnippet(result: DocsSearchResult): string {
  const raw = result.content;
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}

function uniqueAnswerQuery(original: string, variants: string[]): string {
  const canonical = variants.find((variant) =>
    /^Salesforce\s+\w+\s+\d{2}\s+Release Notes$/iu.test(variant),
  );
  if (!canonical || original.toLowerCase().includes(canonical.toLowerCase())) return original;
  return `${original} ${canonical}`;
}

function timeoutForAction(action: string): number {
  return action === "answer" || action === "explain" ? 60000 : 30000;
}

function docsServiceError(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.error !== "string") return undefined;
  const requested = isRecord(value.requested) ? value.requested : undefined;
  const slice = requested
    ? ` (${requested.collection ?? "?"}/${requested.version ?? "?"}/${requested.locale ?? "?"})`
    : "";
  return `Docs service error: ${value.error}${slice}`;
}

function asSearchResponse(value: unknown): SearchResponse {
  return isRecord(value) ? (value as SearchResponse) : {};
}

function asFetchResponse(value: unknown): FetchResponse {
  return isRecord(value) ? (value as FetchResponse) : {};
}

function asAnswerResponse(value: unknown): AnswerResponse {
  return isRecord(value) ? (value as AnswerResponse) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
