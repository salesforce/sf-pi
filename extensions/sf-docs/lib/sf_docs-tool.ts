/* SPDX-License-Identifier: Apache-2.0 */
/** The single SF Docs family tool. */
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDocsEndpoint } from "./auth.ts";
import { DocsClient } from "./client.ts";
import { formatCacheAge, readCatalogCache, writeCatalogCache } from "./catalog-cache.ts";
import {
  docsCollectionProfilesFor,
  summarizeDocsCollectionProfile,
} from "./collection-profiles.ts";
import {
  compileCollectionQuery,
  runSearchWithDeveloperPeerFallback,
  type CollectionQueryCompilation,
  type SearchOperationArgs,
} from "./collection-retrieval.ts";
import {
  planDeveloperReferenceRouting,
  type DeveloperReferenceRoutingPlan,
} from "./developer-reference.ts";
import {
  EVIDENCE_PREVIEW_CHAR_LIMIT,
  buildAnswerEvidencePacket,
  buildFetchEvidencePacket,
  classifyFetchDocuments,
  fetchContentStatus,
  formatFetchOutcome,
  previewPlainText,
  structuredPreview,
} from "./evidence.ts";
import { readEffectiveDocsPreferences } from "./preferences.ts";
import {
  buildAnswerRequest,
  buildFetchRequest,
  buildExplainRequest,
  buildSearchRequest,
  parseAnswerResponse,
  parseFetchResponse,
  parseListResponse,
  parseSearchResponse,
  type SearchResponse,
} from "./protocol.ts";
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
import {
  evaluateReleaseNoteEvidence,
  normalizeReleaseValue,
  resultHasReleaseNoteMarkers,
  resultMatchesRelease,
} from "./release-notes.ts";

interface DistilledServiceError {
  error: string;
  requested?: Record<string, unknown>;
  available?: string;
}

interface DistilledSearchRun {
  requests: DistilledSearchRequest[];
  batches: DistilledSearchBatch[];
  ranked: RankedDistilledResult[];
  serviceErrors: DistilledServiceError[];
}

type DocsEvidenceStatus =
  | "ok"
  | "no_matches"
  | "wrong_release"
  | "not_release_note_evidence"
  | "insufficient"
  | "coverage_gap"
  | "not_checked";

interface DocsQueryPlanSummary {
  original: string;
  compiledQuery: string;
  collection: string;
  version: string;
  locale: string;
  filters: string[];
  boosts: string[];
  evidenceStatus: DocsEvidenceStatus;
  intent?: string;
  reason?: string;
  collectionOverride?: { from: string; to: string; reason: string };
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
  failureReason?: "no_recovery_candidate" | "recovery_fetch_failed" | "docs_service_error";
  failureMessage?: string;
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
  locale: Type.Optional(
    Type.String({ description: "Docs locale. Defaults to settings/auto-detection." }),
  ),
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
      "Use sf_docs for official Salesforce documentation, not generic web search; implementation-sensitive guidance should be grounded by search then fetch.",
      "Cite returned source URLs and report evidence gaps instead of substituting unrelated current documentation.",
      "Read extensions/sf-docs/AGENT_GUIDE.md for collection, release-note, and query-distillation guidance.",
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

      const endpoint = await getDocsEndpoint(ctx);
      if (endpoint.ok === false) {
        return fail(input.action, endpoint.message, {
          reason: endpoint.reason,
          recover_via: { command: "/sf-docs connect", action: "status" },
        });
      }
      const client = new DocsClient({
        endpoint: endpoint.endpoint,
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
          const response = parseListResponse(await client.callTool("list", listArgs, signal));
          const serviceError = docsServiceError(response);
          if (serviceError) {
            return fail("collections", serviceError, {
              reason: "docs_service_error",
              requested: response.requested,
              available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
            });
          }
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
          const referencePlan = planDeveloperReferenceRouting({
            collection: slice.collection,
            query: input.query,
          });
          const actionSlice = applyDeveloperReferenceRouting(slice, referencePlan);
          const compilation = compileCollectionQuery(
            actionSlice.collection,
            referencePlan?.compiledQuery ?? input.query,
          );
          const actionQuery = compilation.query;
          const queryPlan = referencePlan
            ? buildDeveloperReferenceQueryPlan(input.query, actionQuery, actionSlice, referencePlan)
            : compilation.changed
              ? buildCollectionQueryPlan(input.query, actionQuery, actionSlice, compilation)
              : undefined;
          const distilled = distillDocsQuery(actionQuery, {
            defaultCollection: actionSlice.collection,
            explicitCollection: input.collection ? actionSlice.collection : undefined,
          });
          if (distilled) {
            const distilledSearch = await runDistilledSearch(
              client,
              distilled,
              {
                version: actionSlice.version,
                locale: actionSlice.locale,
                page: input.page ?? 1,
                pageSize,
                format: input.format,
              },
              signal,
            );
            if (allDistilledSearchesFailed(distilledSearch)) {
              const serviceError = distilledSearch.serviceErrors[0];
              return fail("search", formatDistilledServiceError(serviceError), {
                ...actionSlice,
                query: input.query,
                reason: "docs_service_error",
                requested: serviceError?.requested,
                available: serviceError?.available,
                resolution: buildDistillationResolution(distilled, distilledSearch, {
                  status: "service_error",
                }),
              });
            }
            const response = {
              results: distilledSearch.ranked.slice(0, pageSize),
              totalCount: distilledSearch.ranked.length,
            };
            const distilledQueryPlan = buildQueryPlanSummary(distilled, distilledSearch, {
              version: actionSlice.version,
              locale: actionSlice.locale,
            });
            if (referencePlan)
              applyDeveloperReferencePlanToQueryPlan(distilledQueryPlan, referencePlan);
            const text = [
              formatQueryPlanText(distilledQueryPlan),
              "",
              formatSearchToolText(input.query, response),
            ].join("\n");
            return ok("search", text, {
              ...actionSlice,
              collection: distilled.collectionCandidates[0] ?? actionSlice.collection,
              query: input.query,
              ...response,
              retrieval_status: distilledQueryPlan.evidenceStatus,
              queryPlan: distilledQueryPlan,
              collectionOverride: referencePlan?.collectionOverride,
              displayDensity: prefs.displayDensity,
              resolution: buildDistillationResolution(distilled, distilledSearch, {
                evidenceStatus: distilledQueryPlan.evidenceStatus,
              }),
            });
          }

          const searchArgs: SearchOperationArgs = {
            query: actionQuery,
            page: input.page ?? 1,
            pageSize,
          };
          if (input.format) searchArgs.format = input.format;
          const searchRun = await runSearchWithDeveloperPeerFallback(
            client,
            searchArgs,
            actionSlice,
            referencePlan?.fallbackCollection,
            signal,
          );
          const { response, slice: resultSlice } = searchRun;
          const collectionOverride =
            searchRun.collectionOverride ?? referencePlan?.collectionOverride;
          if (searchRun.collectionOverride && queryPlan) {
            queryPlan.collection = resultSlice.collection;
            queryPlan.collectionOverride = searchRun.collectionOverride;
          }

          const serviceError = docsServiceError(response);
          if (serviceError) {
            return fail("search", serviceError, {
              ...resultSlice,
              query: input.query,
              reason: "docs_service_error",
              requested: response.requested,
              available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
            });
          }
          const text = [
            queryPlan ? formatQueryPlanText(queryPlan) : "",
            formatSearchToolText(input.query, response),
          ]
            .filter(Boolean)
            .join("\n\n");
          return ok("search", text, {
            ...resultSlice,
            query: input.query,
            compiledQuery: actionQuery !== input.query ? actionQuery : undefined,
            ...response,
            queryPlan,
            collectionOverride,
            displayDensity: prefs.displayDensity,
          });
        }

        if (input.action === "fetch") {
          const format = input.format ?? prefs.defaultFetchFormat;
          const requested: {
            ids?: string[];
            urls?: string[];
            format: "text" | "markdown" | "html";
          } = {
            format,
          };
          if (input.ids?.length) {
            requested.ids = input.ids.slice(0, 12);
          } else if (input.urls?.length) {
            requested.urls = input.urls.slice(0, 12);
          } else {
            return fail("fetch", "sf_docs fetch requires ids or urls.", {
              reason: "missing_ids_or_urls",
              recover_via: { action: "search", required: ["query"] },
            });
          }
          const referencePlan = planDeveloperReferenceRouting({
            collection: slice.collection,
            urls: requested.urls,
          });
          const actionSlice = applyDeveloperReferenceRouting(slice, referencePlan);
          const referenceQueryPlan = referencePlan
            ? buildDeveloperReferenceQueryPlan(
                requested.urls?.[0] ?? requested.ids?.[0] ?? "fetch",
                requested.urls?.[0] ?? requested.ids?.[0] ?? "fetch",
                actionSlice,
                referencePlan,
              )
            : undefined;
          const args = buildFetchRequest({
            ...actionSlice,
            format,
            ids: requested.ids,
            urls: requested.urls,
          });
          const response = parseFetchResponse(await client.callTool("fetch", args, signal));
          const serviceError = docsServiceError(response);
          if (serviceError) {
            return fail("fetch", serviceError, {
              ...actionSlice,
              requested: response.requested ?? requested,
              available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
              reason: "docs_service_error",
            });
          }
          const docs = response.documents ?? [];
          const requestedCount = requested.ids?.length ?? requested.urls?.length ?? 0;
          const directOutcome = classifyFetchDocuments(docs, requestedCount);
          const recoveryPlan =
            requested.urls?.length === 1
              ? distillDocsQuery(requested.urls[0], {
                  defaultCollection: actionSlice.collection,
                  explicitCollection: input.collection ? actionSlice.collection : undefined,
                })
              : undefined;
          if (recoveryPlan && directOutcome.retrievalStatus === "failed") {
            const recovery = await recoverFetchByDistilledSearch(
              client,
              recoveryPlan,
              {
                version: actionSlice.version,
                locale: actionSlice.locale,
                format,
              },
              signal,
            );
            if (recovery.recovered) {
              const packet = buildFetchEvidencePacket(recovery.docs, recovery.slice);
              const recoveryOutcome = classifyFetchDocuments(
                recovery.docs,
                recovery.recoveredRequest?.ids?.length ?? 1,
              );
              const contentStatus = fetchContentStatus(packet);
              const queryPlan = buildQueryPlanSummary(recoveryPlan, recovery.search, {
                version: actionSlice.version,
                locale: actionSlice.locale,
              });
              const note = `Recovered by searching distilled docs locator: ${recoveryPlan.semanticQuery}`;
              return ok(
                "fetch",
                `${formatQueryPlanText(queryPlan)}\n\n${note}\n${formatFetchOutcome(recoveryOutcome.retrievalStatus, contentStatus)}\n\n${packet.text || "No documents returned."}`,
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
                  retrievalStatus: recoveryOutcome.retrievalStatus,
                  contentStatus,
                  resolution: buildDistillationResolution(recoveryPlan, recovery.search, {
                    status: "recovered",
                    resolvedId: recovery.resolved?.id,
                    resolvedUrl: recovery.resolved?.url,
                    score: recovery.resolved?.score,
                  }),
                },
              );
            }

            const failureDocs = recovery.docs.length ? recovery.docs : docs;
            const failureSlice = recovery.docs.length ? recovery.slice : actionSlice;
            const packet = buildFetchEvidencePacket(failureDocs, failureSlice);
            const contentStatus = fetchContentStatus(packet);
            const queryPlan = buildQueryPlanSummary(recoveryPlan, recovery.search, {
              version: actionSlice.version,
              locale: actionSlice.locale,
            });
            const recoveryFailed = recovery.failureReason === "recovery_fetch_failed";
            const recoveryServiceError = recovery.failureReason === "docs_service_error";
            const text = [
              formatQueryPlanText(queryPlan),
              recovery.failureMessage ??
                (recoveryFailed || recoveryServiceError
                  ? `Direct URL fetch and recovery fetch were not usable: ${recoveryPlan.semanticQuery}`
                  : `Direct URL fetch was not usable. Distilled docs locator query was ambiguous: ${recoveryPlan.semanticQuery}`),
              formatRecoveryCandidates(recovery.search.ranked),
              formatFetchOutcome("failed", contentStatus),
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
              retrievalStatus: "failed" as const,
              contentStatus,
              recoveryError: recovery.failureMessage,
              resolution: buildDistillationResolution(recoveryPlan, recovery.search, {
                status: recoveryFailed || recoveryServiceError ? "failed" : "ambiguous",
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
            return fail("fetch", text, {
              ...details,
              reason: recoveryFailed
                ? "recovery_fetch_failed"
                : recoveryServiceError
                  ? "docs_service_error"
                  : "no_usable_documents",
            });
          }

          const packet = buildFetchEvidencePacket(docs, actionSlice);
          const contentStatus = fetchContentStatus(packet);
          const text = [
            referenceQueryPlan ? formatQueryPlanText(referenceQueryPlan) : "",
            formatFetchOutcome(directOutcome.retrievalStatus, contentStatus),
            packet.text || "No documents returned.",
          ]
            .filter(Boolean)
            .join("\n\n");
          const details = {
            ...actionSlice,
            requested,
            queryPlan: referenceQueryPlan,
            collectionOverride: referencePlan?.collectionOverride,
            displayDensity: prefs.displayDensity,
            documents: packet.documents,
            totalDocuments: packet.documents.length,
            totalContentChars: packet.totalContentChars,
            llmBudget: packet.llmBudget,
            retrievalStatus: directOutcome.retrievalStatus,
            contentStatus,
          };
          if (directOutcome.retrievalStatus === "failed") {
            return fail("fetch", text, { ...details, reason: "no_usable_documents" });
          }
          return ok("fetch", text, details);
        }

        if (input.action === "answer") {
          if (!input.query?.trim()) {
            return fail("answer", "sf_docs answer requires query.", {
              reason: "missing_query",
              recover_via: { ask: "Provide a concise Salesforce documentation question." },
            });
          }
          const referencePlan = planDeveloperReferenceRouting({
            collection: slice.collection,
            query: input.query,
          });
          const initialActionSlice = applyDeveloperReferenceRouting(slice, referencePlan);
          const compilation = compileCollectionQuery(
            initialActionSlice.collection,
            referencePlan?.compiledQuery ?? input.query,
          );
          const actionQuery = compilation.query;
          let actionSlice = initialActionSlice;
          let collectionOverride = referencePlan?.collectionOverride;
          let queryPlan = referencePlan
            ? buildDeveloperReferenceQueryPlan(
                input.query,
                actionQuery,
                initialActionSlice,
                referencePlan,
              )
            : compilation.changed
              ? buildCollectionQueryPlan(input.query, actionQuery, initialActionSlice, compilation)
              : undefined;

          if (referencePlan?.fallbackCollection) {
            const preflight = await runSearchWithDeveloperPeerFallback(
              client,
              { query: actionQuery, page: 1, pageSize: 1 },
              initialActionSlice,
              referencePlan.fallbackCollection,
              signal,
            );
            actionSlice = preflight.slice;
            if (preflight.collectionOverride) {
              collectionOverride = preflight.collectionOverride;
              if (queryPlan) {
                queryPlan.collection = actionSlice.collection;
                queryPlan.collectionOverride = collectionOverride;
              }
            }
          }

          const distilled = distillDocsQuery(actionQuery, {
            defaultCollection: actionSlice.collection,
            explicitCollection: input.collection ? actionSlice.collection : undefined,
          });
          const answerBias = distilled?.releaseHint && distilled.releaseNoteIntent;
          if (answerBias) {
            const preflight = await runDistilledSearch(
              client,
              distilled,
              { version: actionSlice.version, locale: actionSlice.locale, pageSize: 5 },
              signal,
            );
            if (allDistilledSearchesFailed(preflight)) {
              const serviceError = preflight.serviceErrors[0];
              return fail("answer", formatDistilledServiceError(serviceError), {
                ...actionSlice,
                query: input.query,
                reason: "docs_service_error",
                requested: serviceError?.requested,
                available: serviceError?.available,
                resolution: buildDistillationResolution(distilled, preflight, {
                  status: "service_error",
                }),
              });
            }
            queryPlan = buildQueryPlanSummary(distilled, preflight, {
              version: actionSlice.version,
              locale: actionSlice.locale,
            });
            if (queryPlan.evidenceStatus !== "ok") {
              return fail(
                "answer",
                `${formatQueryPlanText(queryPlan)}\n\nSF Docs could not find sufficient official documentation evidence for this release-specific question.`,
                {
                  ...actionSlice,
                  collection: distilled.collectionCandidates[0] ?? actionSlice.collection,
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
            ? {
                ...actionSlice,
                collection: distilled.collectionCandidates[0] ?? actionSlice.collection,
              }
            : actionSlice;
          const answerQuery = answerBias
            ? (queryPlan?.compiledQuery ?? uniqueAnswerQuery(actionQuery, distilled.variants))
            : actionQuery;
          const response = parseAnswerResponse(
            "answer",
            await client.callTool(
              "answer",
              buildAnswerRequest({
                ...answerSlice,
                query: answerQuery,
                cite: true,
              }),
              signal,
            ),
          );
          const serviceError = docsServiceError(response);
          if (serviceError)
            return fail("answer", serviceError, {
              ...answerSlice,
              reason: "docs_service_error",
              requested: response.requested,
              available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
            });
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
          const answerPacket = buildAnswerEvidencePacket("answer", response);
          return ok(
            "answer",
            `${queryPlan ? `${formatQueryPlanText(queryPlan)}\n\n` : ""}${answerPacket.text}`,
            {
              ...answerSlice,
              ...answerPacket.details,
              retrieval_status: queryPlan?.evidenceStatus,
              queryPlan,
              collectionOverride,
              displayDensity: prefs.displayDensity,
              answerChars: answerPacket.answerChars,
              answerReturnedChars: answerPacket.answerReturnedChars,
              answerTruncated: answerPacket.answerTruncated,
              citationsTruncated: answerPacket.citationsTruncated,
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
          const referencePlan = planDeveloperReferenceRouting({
            collection: slice.collection,
            query: input.query,
            url: input.url,
          });
          const actionSlice = applyDeveloperReferenceRouting(slice, referencePlan);
          const referenceQueryPlan = referencePlan
            ? buildDeveloperReferenceQueryPlan(
                input.url ?? input.id ?? input.query ?? "explain",
                input.query?.trim() || "Summarize this document.",
                actionSlice,
                referencePlan,
              )
            : undefined;
          let locator: { id: string } | { url: string };
          if (input.id) locator = { id: input.id };
          else if (input.url) locator = { url: input.url };
          else {
            return fail("explain", "sf_docs explain requires id or url.", {
              reason: "missing_id_or_url",
              recover_via: { action: "search", then: "explain", required: ["id", "url"] },
            });
          }
          const args = buildExplainRequest({
            query: input.query?.trim() || "Summarize this document.",
            ...locator,
            cite: true,
          });
          const response = parseAnswerResponse(
            "explain",
            await client.callTool("explain", args, signal),
          );
          const serviceError = docsServiceError(response);
          if (serviceError)
            return fail("explain", serviceError, {
              ...actionSlice,
              reason: "docs_service_error",
              requested: response.requested,
              available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
            });
          const answerPacket = buildAnswerEvidencePacket("explain", response);
          return ok(
            "explain",
            `${referenceQueryPlan ? `${formatQueryPlanText(referenceQueryPlan)}\n\n` : ""}${answerPacket.text}`,
            {
              ...actionSlice,
              ...answerPacket.details,
              queryPlan: referenceQueryPlan,
              collectionOverride: referencePlan?.collectionOverride,
              displayDensity: prefs.displayDensity,
              answerChars: answerPacket.answerChars,
              answerReturnedChars: answerPacket.answerReturnedChars,
              answerTruncated: answerPacket.answerTruncated,
              citationsTruncated: answerPacket.citationsTruncated,
            },
          );
        }
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
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

function buildCollectionQueryPlan(
  original: string,
  compiledQuery: string,
  slice: { collection: string; version: string; locale: string },
  compilation: CollectionQueryCompilation,
): DocsQueryPlanSummary {
  return {
    original,
    compiledQuery,
    ...slice,
    filters: compilation.changed ? ["+latest:true"] : [],
    boosts: [],
    evidenceStatus: "not_checked",
    intent: compilation.intent,
    reason: compilation.reason,
  };
}

function applyDeveloperReferenceRouting(
  slice: { collection: string; version: string; locale: string },
  plan: DeveloperReferenceRoutingPlan | undefined,
): { collection: string; version: string; locale: string } {
  return plan ? { ...slice, collection: plan.collection } : slice;
}

function applyDeveloperReferencePlanToQueryPlan(
  queryPlan: DocsQueryPlanSummary,
  plan: DeveloperReferenceRoutingPlan,
): void {
  queryPlan.intent = plan.intent;
  queryPlan.reason = plan.reason;
  queryPlan.collectionOverride = plan.collectionOverride;
}

function buildDeveloperReferenceQueryPlan(
  original: string,
  compiledQuery: string,
  slice: { collection: string; version: string; locale: string },
  plan: DeveloperReferenceRoutingPlan,
): DocsQueryPlanSummary {
  const guideBoost = compiledQuery.match(/\bguides:[a-z0-9_]+\b/iu)?.[0];
  return {
    original,
    compiledQuery,
    collection: slice.collection,
    version: slice.version,
    locale: slice.locale,
    filters: [],
    boosts: guideBoost ? [guideBoost] : [],
    evidenceStatus: "not_checked",
    intent: plan.intent,
    reason: plan.reason,
    collectionOverride: plan.collectionOverride,
  };
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
  const runs = await Promise.all(
    requests.map(async (request) => {
      const args = buildSearchRequest({
        collection: request.collection,
        version: base.version,
        locale: base.locale,
        query: request.query,
        page: base.page ?? 1,
        pageSize: base.pageSize,
        format: base.format,
      });
      const response = parseSearchResponse(await client.callTool("search", args, signal));
      const serviceError = response.error
        ? {
            error: response.error,
            requested: response.requested,
            available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
          }
        : undefined;
      return {
        batch: {
          request,
          results: serviceError ? [] : (response.results ?? []),
          totalCount: response.totalCount,
        },
        serviceError,
      };
    }),
  );
  const batches = runs.map((run) => run.batch);
  return {
    requests,
    batches,
    ranked: rankDistilledResults(plan, batches),
    serviceErrors: runs.flatMap((run) => (run.serviceError ? [run.serviceError] : [])),
  };
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
  if (allDistilledSearchesFailed(search)) {
    return {
      recovered: false,
      search,
      docs: [],
      slice: {
        collection: plan.collectionCandidates[0] ?? "developer",
        version: base.version,
        locale: base.locale,
      },
      failureReason: "docs_service_error",
    };
  }
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
      failureReason: "no_recovery_candidate",
    };
  }

  const recoverySlice = {
    collection: best.collection,
    version: best.version ?? base.version,
    locale: best.locale ?? base.locale,
  };
  const recoveredRequest = { ids: [best.id], format: base.format };
  const response = parseFetchResponse(
    await client.callTool(
      "fetch",
      buildFetchRequest({
        ...recoverySlice,
        ...recoveredRequest,
      }),
      signal,
    ),
  );
  const serviceError = docsServiceError(response);
  if (serviceError) {
    return {
      recovered: false,
      search,
      docs: [],
      slice: recoverySlice,
      recoveredRequest,
      resolved: best,
      failureReason: "docs_service_error",
      failureMessage: serviceError,
    };
  }
  const docs = response.documents ?? [];
  const outcome = classifyFetchDocuments(docs, 1);
  return {
    recovered: outcome.retrievalStatus !== "failed",
    search,
    docs,
    slice: recoverySlice,
    recoveredRequest,
    resolved: best,
    failureReason: outcome.retrievalStatus === "failed" ? "recovery_fetch_failed" : undefined,
  };
}

function buildQueryPlanSummary(
  plan: DocsQueryDistillationPlan,
  search: DistilledSearchRun,
  slice: { version: string; locale: string },
): DocsQueryPlanSummary {
  const firstRequest = search.requests[0];
  const evidence = evaluateEvidence(plan, search.ranked, firstRequest?.collection);
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
  collection?: string,
): DocsEvidenceEvaluation {
  return evaluateReleaseNoteEvidence({
    release: plan.releaseHint?.release,
    releaseNoteIntent: plan.releaseNoteIntent,
    collection,
    results,
  });
}

function evaluateAnswerCitationEvidence(
  plan: DocsQueryDistillationPlan,
  citations: DocsCitation[],
): DocsEvidenceEvaluation {
  const releaseEvidence = evaluateEvidence(
    plan,
    citations,
    citations[0]?.collection ?? plan.collectionCandidates[0],
  );
  if (releaseEvidence.status !== "ok") return releaseEvidence;

  const visibleCitations = citations.slice(0, Math.min(5, citations.length));
  if (plan.releaseHint?.release && plan.releaseNoteIntent && visibleCitations.length) {
    const release = plan.releaseHint.release;
    const releaseNoteMatches = visibleCitations.filter(
      (citation) =>
        resultMatchesRelease(citation, release) && resultHasReleaseNoteMarkers(citation),
    ).length;
    const requiredReleaseNotes = Math.max(1, Math.ceil(visibleCitations.length / 2));
    const firstCitation = visibleCitations[0];
    const firstIsReleaseNoteEvidence = Boolean(
      firstCitation &&
      resultMatchesRelease(firstCitation, release) &&
      resultHasReleaseNoteMarkers(firstCitation),
    );
    if (!firstIsReleaseNoteEvidence || releaseNoteMatches < requiredReleaseNotes) {
      return {
        status: "not_release_note_evidence",
        message: `Only ${releaseNoteMatches} of the first ${visibleCitations.length} citations were release-note evidence for release ${release}.`,
      };
    }
  }

  if (!plan.retrievalBoosts.length) return { status: "ok" };

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

function formatQueryPlanText(plan: DocsQueryPlanSummary): string {
  const lines = ["Docs Query Plan:", `- original: ${plan.original}`];
  if (plan.intent) lines.push(`- intent: ${plan.intent}`);
  if (plan.collectionOverride) {
    lines.push(
      `- collection override: ${plan.collectionOverride.from} → ${plan.collectionOverride.to} (${plan.collectionOverride.reason})`,
    );
  }
  if (plan.reason) lines.push(`- reason: ${plan.reason}`);
  lines.push(
    `- compiled: ${plan.compiledQuery}`,
    `- slice: ${plan.collection}/${plan.version}/${plan.locale}`,
  );
  const filters = [...plan.filters, ...plan.boosts];
  if (filters.length) lines.push(`- filters/boosts: ${filters.join(" ")}`);
  lines.push(
    `- evidence: ${plan.evidenceStatus}${plan.evidenceMessage ? ` — ${plan.evidenceMessage}` : ""}`,
  );
  return lines.join("\n");
}

function allDistilledSearchesFailed(search: DistilledSearchRun): boolean {
  return search.requests.length > 0 && search.serviceErrors.length === search.requests.length;
}

function formatDistilledServiceError(error: DistilledServiceError | undefined): string {
  return `Docs service error: ${error?.error ?? "unknown error"}${error?.available ? `\nAvailable: ${error.available}` : ""}`;
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
    serviceErrors: search.serviceErrors,
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
  const collectionProfiles = docsCollectionProfilesFor(
    collections.map((collection) => collection.collection),
  ).map(summarizeDocsCollectionProfile);
  const profileByCollection = new Map(
    collectionProfiles.map((profile) => [profile.collection, profile]),
  );
  const lines: string[] = [];
  if (collectionAlias) lines.push(`Collection alias: ${collectionAlias}`, "");
  for (const summary of summaries) {
    lines.push(
      `${summary.collection}: versions=${summary.versions || "-"}; locales=${summary.locales || "-"}; formats=${summary.formats || "-"}${summary.status ? `; status=${summary.status}` : ""}`,
    );
    if (summary.description) lines.push(`  description: ${summary.description}`);
    const profile = profileByCollection.get(summary.collection);
    if (profile?.coverage) lines.push(`  coverage: ${profile.coverage}`);
    if (profile?.releaseNotes) lines.push(`  release notes: ${profile.releaseNotes}`);
    if (profile?.references) lines.push(`  references: ${profile.references}`);
    if (summary.extraFields) lines.push(`  extraFields: ${summary.extraFields}`);
    if (summary.keyFilters) lines.push(`  key filters: ${summary.keyFilters}`);
    if (summary.landmarks) lines.push(`  landmarks: ${summary.landmarks}`);
    if (summary.hintsPreview) lines.push(`  hints: ${summary.hintsPreview}`);
  }
  return ok("collections", lines.join("\n"), {
    collections,
    capabilitySummaries: summaries,
    collectionProfiles,
    cache,
    collectionAlias,
    displayDensity,
  });
}

export function summarizeCollectionCapabilities(
  collection: DocsCollection,
): Record<string, string> {
  const hints = collection.retrievalHints ?? "";
  const keyFilters = [
    hints.includes("+release:") ? "+release:<n>" : "",
    hints.includes("guides:") ? "guides:_<slug>" : "",
    hints.includes("+latest:") ? "+latest:true" : "",
    hints.includes("+pill:") ? "+pill:<value>" : "",
    hints.includes("+updated:") ? "+updated:<date>" : "",
    hints.includes("+taxonomyIds:") ? "+taxonomyIds:<guid>" : "",
  ].filter(Boolean);
  return {
    collection: collection.collection,
    description: collection.description ?? "",
    status: collection.status ?? "",
    versions: (collection.versions ?? []).join(","),
    locales: (collection.locales ?? []).join(","),
    formats: (collection.formats ?? []).join(","),
    extraFields: (collection.extraFields ?? []).slice(0, 12).join(","),
    keyFilters: keyFilters.join(", "),
    landmarks: (collection.landmarks ?? [])
      .slice(0, 4)
      .map((slice) => {
        const slugs = (slice.landmarks ?? [])
          .slice(0, 12)
          .map((landmark) => landmark.slug)
          .filter((slug): slug is string => Boolean(slug));
        return slugs.length ? `${slice.version ?? "all"}: ${slugs.join(", ")}` : "";
      })
      .filter(Boolean)
      .join("; "),
    hintsPreview: previewPlainText(hints, collection.collection === "admin" ? 700 : 420),
  };
}

function cheatsheetResult(displayDensity: SfDocsDisplayDensity): ToolResultShape {
  const file = path.join(import.meta.dirname, "..", "docs", "cheatsheet.md");
  const text = readFileSync(file, "utf8");
  return ok("cheatsheet", clipText(text, 16000), { path: file, displayDensity });
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
  const available = structuredPreview(value.available, EVIDENCE_PREVIEW_CHAR_LIMIT);
  return `Docs service error: ${value.error}${slice}${available ? `\nAvailable: ${available}` : ""}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
