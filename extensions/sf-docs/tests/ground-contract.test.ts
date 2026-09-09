/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

describe("sf_docs deterministic ground workflow", () => {
  beforeEach(() => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-ground-"));
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "https://docs.example.test/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(tempAgentDir, { recursive: true, force: true });
  });

  it("registers ground as an explicit family-tool action", async () => {
    const tool = await loadTool(vi.fn() as unknown as typeof fetch);
    const actionSchema = tool.parameters.properties.action;

    expect(JSON.stringify(actionSchema)).toContain("ground");
  });

  it("grounds natural-language queries through catalog, one search, and one fetch", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      const args = body.params.arguments as Record<string, unknown>;
      calls.push({ name, args });
      if (name === "list") return docsResponse(catalog());
      if (name === "search") {
        return docsResponse({
          results: [
            {
              id: "doc-1",
              title: "Apex Callouts",
              url: "https://developer.salesforce.com/docs/example/apex-callouts",
              collection: "developer",
              version: "current",
              locale: "en-us",
            },
          ],
          totalCount: 1,
        });
      }
      if (name === "fetch") {
        return docsResponse({
          documents: [
            {
              id: "doc-1",
              title: "Apex Callouts",
              url: "https://developer.salesforce.com/docs/example/apex-callouts",
              collection: "developer",
              version: "current",
              locale: "en-us",
              content: "# Apex Callouts\n\nGrounded source text.",
            },
          ],
        });
      }
      throw new Error(`Unexpected call: ${name}`);
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, {
      action: "ground",
      query: "How do Apex callouts work?",
      collection: "",
      version: "",
      locale: "",
    });

    expect(calls.map((call) => call.name)).toEqual(["list", "search", "fetch"]);
    expect(calls[1]?.args).toMatchObject({
      collection: "developer",
      query: "How do Apex callouts work?",
      page: 1,
      pageSize: 5,
    });
    expect(calls[2]?.args).toMatchObject({ ids: ["doc-1"], collection: "developer" });
    expect(result.details).toMatchObject({
      ok: true,
      action: "ground",
      verdict: "grounded",
      effectiveSlice: { collection: "developer", version: "current", locale: "auto" },
      retrievalStatus: "complete",
      steps: [
        { action: "catalog", status: "ok" },
        { action: "search", status: "ok" },
        { action: "fetch", status: "ok" },
      ],
    });
    expect(result.content[0].text).toContain("Ground verdict: grounded");
    expect(result.content[0].text).toContain("Grounded source text.");
  });

  it("reports partial grounding when fewer documents are returned than requested", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      if (name === "list") return docsResponse(catalog());
      if (name === "search") {
        return docsResponse({
          results: [
            { id: "one", title: "One", collection: "developer", locale: "en-us" },
            { id: "two", title: "Two", collection: "developer", locale: "en-us" },
          ],
          totalCount: 2,
        });
      }
      if (name === "fetch") {
        return docsResponse({ documents: [{ id: "one", content: "Usable evidence." }] });
      }
      throw new Error(`Unexpected call: ${name}`);
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "ground", query: "Apex evidence" });

    expect(result.details).toMatchObject({
      ok: true,
      verdict: "partial",
      retrievalStatus: "partial",
    });
  });

  it("rejects an explicit collection that conflicts with a known URL host", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, {
      action: "ground",
      collection: "developer",
      query: "https://help.salesforce.com/s/articleView?id=platform.sample_article.htm&type=5",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      ok: false,
      action: "ground",
      reason: "collection_mismatch",
      requestedCollection: "developer",
      suggestedCollection: "admin",
    });
  });

  it("fetches a known URL directly when collection is inferred", async () => {
    const calls: string[] = [];
    const requestedUrl =
      "https://help.salesforce.com/s/articleView?id=platform.sample_article.htm&type=5";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      calls.push(name);
      if (name === "list") return docsResponse(catalog());
      expect(name).toBe("fetch");
      expect(body.params.arguments).toMatchObject({
        urls: [requestedUrl],
        collection: "admin",
      });
      return docsResponse({
        documents: [
          {
            url: requestedUrl,
            title: "Sample Article",
            collection: "admin",
            version: "current",
            locale: "en-us",
            content: "# Sample Article\n\nDirect URL evidence.",
          },
        ],
      });
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "ground", query: requestedUrl });

    expect(calls).toEqual(["list", "fetch"]);
    expect(result.details).toMatchObject({
      ok: true,
      verdict: "grounded",
      effectiveSlice: { collection: "admin" },
    });
  });

  it("performs at most one search and one refetch for URL recovery", async () => {
    const calls: string[] = [];
    const requestedUrl =
      "https://help.salesforce.com/s/articleView?id=platform.sample_article.htm&type=5";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      const args = body.params.arguments as Record<string, unknown>;
      calls.push(name);
      if (name === "list") return docsResponse(catalog());
      if (name === "fetch" && Array.isArray(args.urls)) {
        return docsResponse({ documents: [{ url: requestedUrl, error: "not_found" }] });
      }
      if (name === "search") {
        return docsResponse({
          results: [
            {
              id: "recovered",
              title: "Sample Article",
              url: requestedUrl,
              collection: "admin",
              version: "current",
              locale: "en-us",
            },
          ],
          totalCount: 1,
        });
      }
      if (name === "fetch" && Array.isArray(args.ids)) {
        return docsResponse({
          documents: [
            {
              id: "recovered",
              title: "Sample Article",
              url: requestedUrl,
              content: "# Sample Article\n\nRecovered evidence.",
            },
          ],
        });
      }
      throw new Error(`Unexpected call: ${name}`);
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "ground", query: requestedUrl });

    expect(calls).toEqual(["list", "fetch", "search", "fetch"]);
    expect(result.details).toMatchObject({
      ok: true,
      verdict: "grounded",
      resolution: { status: "recovered" },
    });
  });

  it("uses developer peer fallback only when collection was not explicit", async () => {
    const collections: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      const args = body.params.arguments as Record<string, unknown>;
      if (name === "list") return docsResponse(catalog());
      if (name === "search") {
        collections.push(String(args.collection));
        if (args.collection === "developer") {
          return docsResponse({ results: [], totalCount: 0 });
        }
        return docsResponse({
          results: [
            {
              id: "custom-object",
              title: "CustomObject",
              url: "https://developer.salesforce.com/docs/atlas/example",
              collection: "legacydeveloper",
              version: "current",
              locale: "en-us",
            },
          ],
          totalCount: 1,
        });
      }
      if (name === "fetch") {
        return docsResponse({
          documents: [
            {
              id: "custom-object",
              title: "CustomObject",
              url: "https://developer.salesforce.com/docs/atlas/example",
              content: "# CustomObject\n\nReference evidence.",
            },
          ],
        });
      }
      throw new Error(`Unexpected call: ${name}`);
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const inferred = await execute(tool, {
      action: "ground",
      query: "Metadata API CustomObject reference",
    });
    expect(collections).toEqual(["developer", "legacydeveloper"]);
    expect(inferred.details).toMatchObject({
      ok: true,
      effectiveSlice: { collection: "legacydeveloper" },
    });

    collections.length = 0;
    const explicit = await execute(tool, {
      action: "ground",
      collection: "developer",
      query: "Metadata API CustomObject reference",
    });
    expect(collections).toEqual(["developer"]);
    expect(explicit.details).toMatchObject({
      ok: false,
      reason: "no_matches",
      effectiveSlice: { collection: "developer" },
    });
  });

  it("applies MuleSoft latest policy only inside ground", async () => {
    const queries: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      if (name === "list") return docsResponse(catalog());
      if (name === "search") {
        queries.push(String(body.params.arguments.query));
        return docsResponse({
          results: [
            {
              id: "dw-map",
              title: "DataWeave map",
              url: "https://docs.mulesoft.com/dataweave/latest/dw-core-functions-map",
              collection: "mulesoft",
              version: "current",
              locale: "en-us",
            },
          ],
          totalCount: 1,
        });
      }
      if (name === "fetch") {
        return docsResponse({
          documents: [
            {
              id: "dw-map",
              title: "DataWeave map",
              content: "# map\n\nDataWeave mapping evidence.",
            },
          ],
        });
      }
      throw new Error(`Unexpected call: ${name}`);
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, {
      action: "ground",
      collection: "mulesoft",
      query: "DataWeave map function",
    });

    expect(queries).toEqual(["+latest:true DataWeave map function"]);
    expect(result.details).toMatchObject({ ok: true, verdict: "grounded" });

    await execute(tool, {
      action: "search",
      collection: "mulesoft",
      query: "DataWeave map function",
    });
    expect(queries).toEqual(["+latest:true DataWeave map function", "DataWeave map function"]);
  });

  it("fails closed when seasonal release results are not release-note evidence", async () => {
    const searchQueries: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      if (name === "list") return docsResponse(catalog());
      expect(name).toBe("search");
      searchQueries.push(String(body.params.arguments.query));
      expect(body.params.arguments.collection).toBe("admin");
      return docsResponse({
        results: [
          {
            id: "current-product-doc",
            title: "Lightning Sales Console",
            url: "https://help.salesforce.com/s/articleView?id=service.console_lex_sales_intro.htm&release=260&type=5",
            release: "260",
          },
        ],
        totalCount: 1,
      });
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, {
      action: "ground",
      query: "Sales Cloud Spring '26 release notes",
    });

    expect(searchQueries[0]).toContain("+release:260");
    expect(result.details).toMatchObject({
      ok: false,
      reason: "insufficient_docs_evidence",
      evidenceStatus: "not_release_note_evidence",
      effectiveSlice: { collection: "admin" },
    });
  });

  it("fails when a URL recovery candidate still has no usable body", async () => {
    const requestedUrl =
      "https://help.salesforce.com/s/articleView?id=platform.sample_article.htm&type=5";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      const args = body.params.arguments as Record<string, unknown>;
      if (name === "list") return docsResponse(catalog());
      if (name === "fetch" && Array.isArray(args.urls)) {
        return docsResponse({ documents: [{ url: requestedUrl, error: "not_found" }] });
      }
      if (name === "search") {
        return docsResponse({
          results: [{ id: "candidate", title: "Sample Article", url: requestedUrl }],
          totalCount: 1,
        });
      }
      if (name === "fetch" && Array.isArray(args.ids)) {
        return docsResponse({ documents: [{ id: "candidate", error: "not_found" }] });
      }
      throw new Error(`Unexpected call: ${name}`);
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "ground", query: requestedUrl });

    expect(result.details).toMatchObject({
      ok: false,
      reason: "recovery_fetch_failed",
      retrievalStatus: "failed",
      resolution: { status: "failed" },
    });
  });

  it("keeps primitive search literal and single-call", async () => {
    const query = "https://help.salesforce.com/s/articleView?id=platform.sample_article.htm&type=5";
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("search");
      calls.push(body.params.arguments);
      return docsResponse({ results: [], totalCount: 0 });
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, {
      action: "search",
      collection: "developer",
      query,
    });

    expect(calls).toEqual([expect.objectContaining({ collection: "developer", query })]);
    expect(result.details).toMatchObject({ ok: true, collection: "developer" });
    expect(result.details.collectionOverride).toBeUndefined();
    expect(result.details.resolution).toBeUndefined();
  });

  it("keeps primitive answer literal without search preflight", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push(String(body.params.name));
      expect(body.params.name).toBe("answer");
      expect(body.params.arguments).toMatchObject({
        collection: "developer",
        query: "Sales Cloud Spring '26 release notes",
        cite: true,
      });
      return docsResponse({ answer: "Convenience answer.", citations: [] });
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, {
      action: "answer",
      collection: "developer",
      query: "Sales Cloud Spring '26 release notes",
    });

    expect(calls).toEqual(["answer"]);
    expect(result.details).toMatchObject({ ok: true, collection: "developer" });
  });

  it("keeps primitive URL fetch literal without hidden recovery", async () => {
    const requestedUrl =
      "https://help.salesforce.com/s/articleView?id=platform.sample_article.htm&type=5";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("fetch");
      return docsResponse({ documents: [{ url: requestedUrl, error: "not_found" }] });
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "fetch", urls: [requestedUrl] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      ok: false,
      reason: "no_usable_documents",
      retrievalStatus: "failed",
    });
    expect(result.details.resolution).toBeUndefined();
  });
});

interface TestToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

interface TestTool {
  parameters: { properties: Record<string, unknown> };
  execute(
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: { cwd: string; modelRegistry: Record<string, unknown> },
  ): Promise<TestToolResult>;
}

async function loadTool(fetchMock: typeof fetch): Promise<TestTool> {
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
  const registerTool = vi.fn();
  registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
  return registerTool.mock.calls[0]?.[0] as TestTool;
}

async function execute(tool: TestTool, params: Record<string, unknown>): Promise<TestToolResult> {
  return tool.execute("id", params, undefined, undefined, {
    cwd: process.cwd(),
    modelRegistry: {},
  });
}

function catalog() {
  return {
    collections: [
      {
        collection: "developer",
        versions: ["current"],
        locales: ["en-us"],
        formats: ["text", "markdown"],
      },
      {
        collection: "legacydeveloper",
        versions: ["current"],
        locales: ["en-us"],
        formats: ["text", "markdown"],
      },
      {
        collection: "admin",
        versions: ["current"],
        locales: ["en-us"],
        formats: ["text", "markdown", "html"],
      },
      {
        collection: "mulesoft",
        versions: ["current"],
        locales: ["en-us"],
        formats: ["text", "markdown", "html"],
      },
    ],
  };
}

function docsResponse(payload: unknown): Response {
  return new Response(
    `event: message\ndata: ${JSON.stringify({
      result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
      jsonrpc: "2.0",
      id: 1,
    })}\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}
