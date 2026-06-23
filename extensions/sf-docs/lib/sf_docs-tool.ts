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
        return ok("status", buildStatus(ctx.cwd), { status: buildStatus(ctx.cwd) });
      }
      if (input.action === "cheatsheet") return cheatsheetResult();

      const auth = await getDocsToken(ctx);
      if (auth.ok === false) return fail(input.action, auth.message, { reason: "missing_auth" });
      const endpoint = resolveEndpoint();
      const client = new DocsClient({ endpoint: endpoint.endpoint, token: auth.token });
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
            return collectionsResult(cache.collections, `hit · ${formatCacheAge(cache.fetchedAt)}`);
          }
          const response = (await client.callTool("list", {}, signal)) as {
            collections?: DocsCollection[];
          };
          const collections = response.collections ?? [];
          if (prefs.cacheCatalog) writeCatalogCache(collections);
          return collectionsResult(collections, input.refresh ? "refreshed" : "miss/refreshed");
        }

        if (input.action === "search") {
          if (!input.query?.trim()) return fail("search", "sf_docs search requires query.");
          const pageSize = clamp(input.pageSize ?? prefs.defaultPageSize, 1, 60);
          const args: Record<string, unknown> = {
            ...slice,
            query: input.query,
            page: input.page ?? 1,
            pageSize,
          };
          if (input.format) args.format = input.format;
          const response = asSearchResponse(await client.callTool("search", args, signal));
          const text = `SF Docs search returned ${(response.results ?? []).length} result(s) for ${input.query}. Fetch promising ids before implementation-sensitive answers.`;
          return ok("search", text, { ...slice, query: input.query, ...response });
        }

        if (input.action === "fetch") {
          const args: Record<string, unknown> = {
            ...slice,
            format: input.format ?? prefs.defaultFetchFormat,
          };
          if (input.ids?.length) args.ids = input.ids.slice(0, 12);
          else if (input.urls?.length) args.urls = input.urls.slice(0, 12);
          else return fail("fetch", "sf_docs fetch requires ids or urls.");
          const response = asFetchResponse(await client.callTool("fetch", args, signal));
          const docs = response.documents ?? [];
          const text = docs
            .map((doc) =>
              [
                `# ${doc.title ?? doc.id ?? doc.url ?? "Document"}`,
                doc.url,
                clipText(doc.content ?? doc.error ?? "", 12000),
              ]
                .filter(Boolean)
                .join("\n\n"),
            )
            .join("\n\n---\n\n");
          return ok("fetch", text || "No documents returned.", { ...slice, ...response });
        }

        if (input.action === "answer") {
          if (!input.query?.trim()) return fail("answer", "sf_docs answer requires query.");
          const response = asAnswerResponse(
            await client.callTool(
              "answer",
              { ...slice, query: input.query, cite: input.cite ?? prefs.includeCitations },
              signal,
            ),
          );
          return ok("answer", formatAnswerText(response), { ...slice, ...response });
        }

        if (input.action === "explain") {
          if (!input.query?.trim()) return fail("explain", "sf_docs explain requires query.");
          const args: Record<string, unknown> = {
            query: input.query,
            cite: input.cite ?? prefs.includeCitations,
          };
          if (input.id) args.id = input.id;
          else if (input.url) args.url = input.url;
          else return fail("explain", "sf_docs explain requires id or url.");
          const response = asAnswerResponse(await client.callTool("explain", args, signal));
          return ok("explain", formatAnswerText(response), { ...slice, ...response });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(input.action, message);
      }

      return fail(input.action, `Unsupported sf_docs action: ${input.action}`);
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

function collectionsResult(collections: DocsCollection[], cache: string): ToolResultShape {
  return ok(
    "collections",
    collections
      .map(
        (c) =>
          `${c.collection}: versions=${(c.versions ?? []).join(",") || "-"}; locales=${(c.locales ?? []).join(",") || "-"}; formats=${(c.formats ?? []).join(",") || "-"}`,
      )
      .join("\n"),
    { collections, cache },
  );
}

function cheatsheetResult(): ToolResultShape {
  const file = path.join(import.meta.dirname, "..", "docs", "cheatsheet.md");
  const text = readFileSync(file, "utf8");
  return ok("cheatsheet", clipText(text, 16000), { path: file });
}

function formatAnswerText(response: AnswerResponse): string {
  const answer = response.answer ?? response.explanation ?? "";
  const citations = response.citations ?? [];
  const citationText = citations
    .map((citation, i) => `${i + 1}. ${citation.title ?? "Untitled"}\n   ${citation.url ?? ""}`)
    .join("\n");
  return citationText ? `${answer}\n\nCitations:\n${citationText}` : answer;
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
