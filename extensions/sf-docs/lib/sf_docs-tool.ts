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
      const slice = {
        collection: input.collection ?? prefs.defaultCollection,
        version: input.version ?? prefs.defaultVersion,
        locale: input.locale ?? prefs.defaultLocale,
      };

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
            return collectionsResult(
              cache.collections,
              `hit · ${formatCacheAge(cache.fetchedAt)}`,
              prefs.displayDensity,
            );
          }
          const response = (await client.callTool("list", {}, signal)) as {
            collections?: DocsCollection[];
          };
          const collections = response.collections ?? [];
          if (prefs.cacheCatalog) writeCatalogCache(collections);
          return collectionsResult(
            collections,
            input.refresh ? "refreshed" : "miss/refreshed",
            prefs.displayDensity,
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
          const args: Record<string, unknown> = {
            ...slice,
            query: input.query,
            page: input.page ?? 1,
            pageSize,
          };
          if (input.format) args.format = input.format;
          const response = asSearchResponse(await client.callTool("search", args, signal));
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
          const docs = response.documents ?? [];
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
          const response = asAnswerResponse(
            await client.callTool(
              "answer",
              { ...slice, query: input.query, cite: input.cite ?? prefs.includeCitations },
              signal,
            ),
          );
          const answer = response.answer ?? response.explanation ?? "";
          return ok("answer", formatAnswerText(response), {
            ...slice,
            ...response,
            displayDensity: prefs.displayDensity,
            answerChars: answer.length,
          });
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
): ToolResultShape {
  return ok(
    "collections",
    collections
      .map(
        (c) =>
          `${c.collection}: versions=${(c.versions ?? []).join(",") || "-"}; locales=${(c.locales ?? []).join(",") || "-"}; formats=${(c.formats ?? []).join(",") || "-"}`,
      )
      .join("\n"),
    { collections, cache, displayDensity },
  );
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

function timeoutForAction(action: string): number {
  return action === "answer" || action === "explain" ? 60000 : 30000;
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
