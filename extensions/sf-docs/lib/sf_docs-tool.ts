/* SPDX-License-Identifier: Apache-2.0 */
/** The single SF Docs family tool. */
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDocsEndpoint } from "./auth.ts";
import { DocsClient } from "./client.ts";
import { runGroundWorkflow } from "./ground-workflow.ts";
import { formatCacheAge, readCatalogCache, writeCatalogCache } from "./catalog-cache.ts";
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
  TOOL_NAME,
  type DocsCollection,
  type DocsSearchResult,
  type SfDocsDisplayDensity,
  type ToolResultShape,
} from "./types.ts";
import { normalizeReleaseValue } from "./release-notes.ts";

const Params = Type.Object({
  action: StringEnum(
    [
      "status",
      "collections",
      "ground",
      "search",
      "fetch",
      "answer",
      "explain",
      "cheatsheet",
    ] as const,
    {
      description: "SF Docs action to run.",
    },
  ),
  query: Type.Optional(
    Type.String({ description: "Ground, search, answer, or explain query or documentation URL." }),
  ),
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
      "Ground, search, fetch, and answer from Salesforce documentation through one family tool. Ground records deterministic search/fetch evidence; primitives remain literal.",
    promptSnippet:
      "Ground implementation guidance or run literal Salesforce documentation actions with visible citations.",
    promptGuidelines: [
      "Use sf_docs for official Salesforce documentation, not generic web search; use action='ground' for implementation-sensitive guidance that needs deterministic search and fetched evidence.",
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
        if (input.action === "ground") {
          if (!input.query?.trim()) {
            return fail("ground", "sf_docs ground requires query.", {
              reason: "missing_query",
              recover_via: { ask: "Provide a Salesforce documentation question or URL." },
            });
          }
          const result = await runGroundWorkflow({
            client,
            endpoint: endpoint.endpoint,
            input: {
              query: input.query,
              collection: slice.collection,
              collectionExplicit: Boolean(input.collection),
              version: slice.version,
              locale: slice.locale,
              pageSize: clamp(input.pageSize ?? prefs.defaultPageSize, 1, 60),
              format: input.format ?? prefs.defaultFetchFormat,
            },
            signal,
          });
          return result.ok
            ? ok("ground", result.text, {
                ...result.details,
                displayDensity: prefs.displayDensity,
              })
            : fail("ground", result.text, {
                ...result.details,
                displayDensity: prefs.displayDensity,
              });
        }

        if (input.action === "collections") {
          const cache = readCatalogCache(Date.now(), endpoint.endpoint);
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
          if (prefs.cacheCatalog && !input.collection) {
            writeCatalogCache(collections, Date.now(), endpoint.endpoint);
          }
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
          const args = buildSearchRequest({
            ...slice,
            query: input.query,
            page: input.page ?? 1,
            pageSize,
            format: input.format,
          });
          const response = parseSearchResponse(await client.callTool("search", args, signal));
          const serviceError = docsServiceError(response);
          if (serviceError) {
            return fail("search", serviceError, {
              ...slice,
              query: input.query,
              reason: "docs_service_error",
              requested: response.requested,
              available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
            });
          }
          return ok("search", formatSearchToolText(input.query, response), {
            ...slice,
            query: input.query,
            ...response,
            displayDensity: prefs.displayDensity,
          });
        }

        if (input.action === "fetch") {
          const format = input.format ?? prefs.defaultFetchFormat;
          const requested = input.ids?.length
            ? { ids: input.ids.slice(0, 12) }
            : input.urls?.length
              ? { urls: input.urls.slice(0, 12) }
              : undefined;
          if (!requested) {
            return fail("fetch", "sf_docs fetch requires ids or urls.", {
              reason: "missing_ids_or_urls",
              recover_via: { action: "search", required: ["query"] },
            });
          }
          const response = parseFetchResponse(
            await client.callTool(
              "fetch",
              buildFetchRequest({ ...slice, ...requested, format }),
              signal,
            ),
          );
          const serviceError = docsServiceError(response);
          if (serviceError) {
            return fail("fetch", serviceError, {
              ...slice,
              requested: response.requested ?? { ...requested, format },
              available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
              reason: "docs_service_error",
            });
          }
          const docs = response.documents ?? [];
          const requestedCount = requested.ids?.length ?? requested.urls?.length ?? 0;
          const outcome = classifyFetchDocuments(docs, requestedCount);
          const packet = buildFetchEvidencePacket(docs, slice);
          const contentStatus = fetchContentStatus(packet);
          const text = [
            formatFetchOutcome(outcome.retrievalStatus, contentStatus),
            packet.text || "No documents returned.",
          ].join("\n\n");
          const details = {
            ...slice,
            requested: { ...requested, format },
            displayDensity: prefs.displayDensity,
            documents: packet.documents,
            totalDocuments: packet.documents.length,
            totalContentChars: packet.totalContentChars,
            llmBudget: packet.llmBudget,
            retrievalStatus: outcome.retrievalStatus,
            contentStatus,
          };
          return outcome.retrievalStatus === "failed"
            ? fail("fetch", text, { ...details, reason: "no_usable_documents" })
            : ok("fetch", text, details);
        }

        if (input.action === "answer") {
          if (!input.query?.trim()) {
            return fail("answer", "sf_docs answer requires query.", {
              reason: "missing_query",
              recover_via: { ask: "Provide a concise Salesforce documentation question." },
            });
          }
          const response = parseAnswerResponse(
            "answer",
            await client.callTool(
              "answer",
              buildAnswerRequest({ ...slice, query: input.query, cite: true }),
              signal,
            ),
          );
          const serviceError = docsServiceError(response);
          if (serviceError) {
            return fail("answer", serviceError, {
              ...slice,
              reason: "docs_service_error",
              requested: response.requested,
              available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
            });
          }
          const packet = buildAnswerEvidencePacket("answer", response);
          return ok("answer", packet.text, {
            ...slice,
            ...packet.details,
            displayDensity: prefs.displayDensity,
            answerChars: packet.answerChars,
            answerReturnedChars: packet.answerReturnedChars,
            answerTruncated: packet.answerTruncated,
            citationsTruncated: packet.citationsTruncated,
          });
        }

        if (input.action === "explain") {
          const locator = input.id ? { id: input.id } : input.url ? { url: input.url } : undefined;
          if (!locator) {
            return fail("explain", "sf_docs explain requires id or url.", {
              reason: "missing_id_or_url",
              recover_via: { action: "search", then: "explain", required: ["id", "url"] },
            });
          }
          const response = parseAnswerResponse(
            "explain",
            await client.callTool(
              "explain",
              buildExplainRequest({
                query: input.query?.trim() || "Summarize this document.",
                ...locator,
                cite: true,
              }),
              signal,
            ),
          );
          const serviceError = docsServiceError(response);
          if (serviceError) {
            return fail("explain", serviceError, {
              ...slice,
              reason: "docs_service_error",
              requested: response.requested,
              available: structuredPreview(response.available, EVIDENCE_PREVIEW_CHAR_LIMIT),
            });
          }
          const packet = buildAnswerEvidencePacket("explain", response);
          return ok("explain", packet.text, {
            ...slice,
            ...packet.details,
            displayDensity: prefs.displayDensity,
            answerChars: packet.answerChars,
            answerReturnedChars: packet.answerReturnedChars,
            answerTruncated: packet.answerTruncated,
            citationsTruncated: packet.citationsTruncated,
          });
        }
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }

      return fail(input.action, `Unsupported sf_docs action: ${input.action}`, {
        reason: "unsupported_action",
        recover_via: {
          actions: [
            "status",
            "collections",
            "ground",
            "search",
            "fetch",
            "answer",
            "explain",
            "cheatsheet",
          ],
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

function versionLooksLikeSalesforceRelease(version: string): boolean {
  const release = normalizeReleaseValue(version);
  return Boolean(
    release && /^\d{3}$/u.test(release) && version !== "current" && version !== "next",
  );
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
      `${summary.collection}: versions=${summary.versions || "-"}; locales=${summary.locales || "-"}; formats=${summary.formats || "-"}${summary.status ? `; status=${summary.status}` : ""}`,
    );
    if (summary.description) lines.push(`  description: ${summary.description}`);
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
