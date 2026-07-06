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

describe("sf_docs tool", () => {
  beforeEach(() => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-tool-"));
  });

  afterEach(() => rmSync(tempAgentDir, { recursive: true, force: true }));

  it("registers one family tool with evidence-workflow guidance", async () => {
    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    expect(registerTool).toHaveBeenCalledTimes(1);
    const tool = registerTool.mock.calls[0]?.[0];
    expect(tool.name).toBe("sf_docs");
    expect(tool.promptGuidelines.join("\n")).toMatch(/search.*fetch/i);
  });

  it("includes search result ids and URLs in tool content", async () => {
    vi.resetModules();
    const { formatSearchToolText } = await import("../lib/sf_docs-tool.ts");
    const text = formatSearchToolText("Named Credentials", {
      totalCount: 1,
      results: [
        {
          id: "developer-current-en-us-named-credentials",
          title: "Use the Named Credential in a Callout",
          url: "https://developer.salesforce.com/docs/example",
          content: "Use a named credential to authenticate an Apex callout.",
        },
      ],
    });

    expect(text).toContain("Use the Named Credential in a Callout");
    expect(text).toContain("developer-current-en-us-named-credentials");
    expect(text).toContain("https://developer.salesforce.com/docs/example");
    expect(text).toMatch(/fetch promising ids or urls/i);
  });

  it("rejects Salesforce release numbers in the docs version field", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "search", query: "Sales Cloud", collection: "admin", version: "252.0.0" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      ok: false,
      action: "search",
      reason: "invalid_docs_version",
      recover_via: { version: "current", query_filter: "+release:252" },
    });
    expect(result.content[0].text).toContain("Use version='current'");
  });

  it("distills Salesforce Help URLs before search", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const searchCalls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("search");
      searchCalls.push(body.params.arguments);
      return docsResponse({
        results: [
          {
            id: "help-doc-1",
            title: "Sample Voice Call Connection Configuration in Genesys",
            url: "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&release=262.0.0&type=5",
            content: "Connect a Rep voice call record with an Agent voice call record.",
          },
        ],
        totalCount: 1,
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      {
        action: "search",
        query:
          "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&type=5",
      },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(searchCalls.map((call) => call.collection)).toEqual(["admin", "admin", "admin"]);
    expect(searchCalls.map((call) => call.query)).toContain(
      "agent connect rep other voice calls sample",
    );
    expect(searchCalls.map((call) => call.query)).not.toContain(
      "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&type=5",
    );
    expect(result.content[0].text).toContain("Docs Query Plan:");
    expect(result.content[0].text).toContain(
      "compiled: ai.agent_connect_rep_other_voice_calls_sample",
    );
    expect(result.details).toMatchObject({
      ok: true,
      action: "search",
      resolution: { kind: "docs_query_distillation", collectionsTried: ["admin"] },
    });
  });

  it("routes high-confidence developer reference searches to legacydeveloper", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("search");
      expect(body.params.arguments).toMatchObject({
        collection: "legacydeveloper",
        query: "guides:api_meta Metadata API CustomObject reference",
      });
      return docsResponse({
        results: [
          {
            id: "custom-object",
            title: "CustomObject",
            url: "https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customobject.htm",
          },
        ],
        totalCount: 1,
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "search", collection: "developer", query: "Metadata API CustomObject reference" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.content[0].text).toContain("intent: developer_reference");
    expect(result.content[0].text).toContain(
      "collection override: developer → legacydeveloper (developer_reference_coverage)",
    );
    expect(result.details).toMatchObject({
      ok: true,
      action: "search",
      collection: "legacydeveloper",
      compiledQuery: "guides:api_meta Metadata API CustomObject reference",
      collectionOverride: {
        from: "developer",
        to: "legacydeveloper",
        reason: "developer_reference_coverage",
      },
    });
  });

  it("keeps weak modern developer searches in developer", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("search");
      expect(body.params.arguments).toMatchObject({
        collection: "developer",
        query: "LWC wire adapters record",
      });
      return docsResponse({ results: [], totalCount: 0 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "search", collection: "developer", query: "LWC wire adapters record" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.details).toMatchObject({ ok: true, action: "search", collection: "developer" });
    expect(result.details.collectionOverride).toBeUndefined();
  });

  it("returns balanced MCP capability summaries for collections", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("list");
      return docsResponse({
        collections: [
          {
            collection: "admin",
            versions: ["current"],
            locales: ["en-us"],
            formats: ["text", "markdown"],
            extraFields: ["guides", "release", "product"],
            retrievalHints:
              "Use +release:<n> for Salesforce release notes and guides:<slug> for product boosts. Use +taxonomyIds:<guid> for taxonomy filters.",
            landmarks: [{ slug: "sales" }, { slug: "service_cloud" }],
          },
        ],
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "collections", collection: "help", refresh: true },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.content[0].text).toContain("Collection alias: help → admin");
    expect(result.content[0].text).toContain("coverage: Latest Salesforce product documentation");
    expect(result.content[0].text).toContain(
      "release notes: Salesforce release notes are available for the latest three release-note releases.",
    );
    expect(result.content[0].text).toContain(
      "key filters: +release:<n>, guides:<slug>, +taxonomyIds:<guid>",
    );
    expect(result.content[0].text).toContain("hints: Use +release:<n>");
    expect(result.content[0].text).toContain("guides:<slug>");
    expect(result.content[0].text).toContain("landmarks: sales, service_cloud");
    expect(result.details).toMatchObject({
      ok: true,
      action: "collections",
      collectionAlias: "help → admin",
      collectionProfiles: [
        {
          collection: "admin",
          releaseNotes:
            "Salesforce release notes are available for the latest three release-note releases.",
        },
      ],
    });
  });

  it("recovers failed Help URL fetches through distilled search and indexed ids", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      const args = body.params.arguments as Record<string, unknown>;
      calls.push({ name, args });
      if (name === "fetch" && Array.isArray(args.urls)) {
        return docsResponse({
          documents: [
            {
              url: "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&type=5",
              error: "not_found",
            },
          ],
        });
      }
      if (name === "search") {
        return docsResponse({
          results: [
            {
              id: "help-doc-1",
              title: "Sample Voice Call Connection Configuration in Genesys",
              url: "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&release=262.0.0&type=5",
              content: "Connect a Rep voice call record with an Agent voice call record.",
            },
          ],
          totalCount: 1,
        });
      }
      if (name === "fetch" && Array.isArray(args.ids)) {
        expect(args).toMatchObject({ collection: "admin", ids: ["help-doc-1"] });
        return docsResponse({
          documents: [
            {
              id: "help-doc-1",
              title: "Sample Voice Call Connection Configuration in Genesys",
              url: "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&release=262.0.0&type=5",
              content:
                "# Sample Voice Call Connection Configuration in Genesys\n\nRecovered content.",
            },
          ],
        });
      }
      throw new Error(`Unexpected docs call: ${name}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      {
        action: "fetch",
        urls: [
          "https://help.salesforce.com/s/articleView?id=ai.agent_connect_rep_other_voice_calls_sample.htm&type=5",
        ],
        format: "markdown",
      },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(calls.map((call) => call.name)).toEqual([
      "fetch",
      "search",
      "search",
      "search",
      "fetch",
    ]);
    expect(result.content[0].text).toContain(
      "Recovered by searching distilled docs locator: agent connect rep other voice calls sample",
    );
    expect(result.content[0].text).toContain("Recovered content.");
    expect(result.details).toMatchObject({
      ok: true,
      action: "fetch",
      collection: "admin",
      recoveredRequest: { ids: ["help-doc-1"], format: "markdown" },
      resolution: { status: "recovered", resolvedId: "help-doc-1" },
    });
  });

  it("preserves release filters when recovering failed release-note URL fetches", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const searchQueries: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = String(body.params.name);
      const args = body.params.arguments as Record<string, unknown>;
      if (name === "fetch" && Array.isArray(args.urls)) {
        return docsResponse({
          documents: [
            {
              url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_sales.htm&release=252&type=5",
              error: "not_found",
            },
          ],
        });
      }
      if (name === "search") {
        searchQueries.push(String(args.query));
        return docsResponse({ results: [], totalCount: 0 });
      }
      throw new Error(`Unexpected docs call: ${name}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      {
        action: "fetch",
        urls: [
          "https://help.salesforce.com/s/articleView?id=release-notes.rn_sales.htm&release=252&type=5",
        ],
      },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(searchQueries[0]).toContain("+release:252");
    expect(result.content[0].text).toContain("evidence: coverage_gap");
    expect(result.details).toMatchObject({
      ok: false,
      action: "fetch",
      reason: "insufficient_docs_evidence",
      retrieval_status: "coverage_gap",
      queryPlan: { evidenceStatus: "coverage_gap" },
    });
  });

  it("keeps release-note searches as discovery when only current docs match release metadata", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("search");
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
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "search", query: "Sales Cloud Spring '26 release notes" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.content[0].text).toContain("evidence: not_release_note_evidence");
    expect(result.content[0].text).toContain("Lightning Sales Console");
    expect(result.details).toMatchObject({
      ok: true,
      action: "search",
      retrieval_status: "not_release_note_evidence",
      queryPlan: { evidenceStatus: "not_release_note_evidence" },
    });
  });

  it("fails release-note answers when citations are mostly current docs, not release-note evidence", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.params.name === "search") {
        return docsResponse({
          results: [
            {
              id: "summer-release",
              title: "Summer '26 Release Notes",
              url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=262&type=5",
              release: "262",
            },
          ],
          totalCount: 1,
        });
      }
      expect(body.params.name).toBe("answer");
      return docsResponse({
        answer: "Noisy answer",
        citations: [
          {
            title: "Salesforce Spiff Release Notes",
            url: "https://help.salesforce.com/s/articleView?id=sales.rn_spiff.htm&release=262&type=5",
            release: "262",
            guides: "sales",
          },
          {
            title: "Create a Release in Trailmaker Release",
            url: "https://help.salesforce.com/s/articleView?id=sales.mth_create_release_in_tm_release.htm&release=262&type=5",
            release: "262",
            guides: "sales",
          },
          {
            title: "Preview a Release in Trailmaker Release",
            url: "https://help.salesforce.com/s/articleView?id=sales.mth_preview_content_on_mytrailhead.htm&release=262&type=5",
            release: "262",
            guides: "sales",
          },
        ],
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "answer", query: "Sales Cloud Summer '26 release notes" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.details).toMatchObject({
      ok: false,
      action: "answer",
      reason: "insufficient_docs_evidence",
      retrieval_status: "not_release_note_evidence",
    });
    expect(result.content[0].text).toContain("did not satisfy the release-specific evidence gate");
  });

  it("biases seasonal release-note answers to the admin collection", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.params.name === "search") {
        expect(body.params.arguments).toMatchObject({
          collection: "admin",
          version: "current",
          locale: "en-us",
        });
        expect(String(body.params.arguments.query)).toContain("+release:260");
        return docsResponse({
          results: [
            {
              id: "spring-release",
              title: "Salesforce Spring ’26 Release Notes",
              url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=260&type=5",
              release: "260",
            },
          ],
          totalCount: 1,
        });
      }
      expect(body.params.name).toBe("answer");
      expect(body.params.arguments).toMatchObject({
        collection: "admin",
        version: "current",
        locale: "en-us",
      });
      expect(String(body.params.arguments.query)).toContain("+release:260");
      return docsResponse({
        answer: "Spring summary",
        citations: [
          {
            id: "spring-release",
            title: "Salesforce Spring ’26 Release Notes",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=260&type=5",
            release: "260",
          },
        ],
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "answer", query: "Whats new with Spring '26 release notes" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.content[0].text).toContain("Spring summary");
    expect(result.details).toMatchObject({
      ok: true,
      action: "answer",
      collection: "admin",
      resolution: { status: "answer_biased", releaseHint: { release: "260" } },
    });
  });

  it("fails release-note answers when top citations match release but not product scope", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.params.name === "search") {
        return docsResponse({
          results: [
            {
              id: "sales-release",
              title: "Sales",
              url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_sales.htm&release=260&type=5",
              release: "260",
            },
          ],
          totalCount: 1,
        });
      }
      expect(body.params.name).toBe("answer");
      return docsResponse({
        answer: "Noisy answer",
        citations: [
          {
            title: "Insurance Billing",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_insurance_billing.htm&release=260&type=5",
            release: "260",
            guides: "insurance",
          },
          {
            title: "Flow Update",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_flow.htm&release=260&type=5",
            release: "260",
            guides: "flow_builder",
          },
          {
            title: "Point of Sale",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_pos.htm&release=260&type=5",
            release: "260",
            guides: "commerce",
          },
          {
            title: "Sales",
            url: "https://help.salesforce.com/s/articleView?id=release-notes.rn_sales.htm&release=260&type=5",
            release: "260",
            guides: "cross_portfolio",
          },
        ],
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "answer", query: "Top Sales Cloud Spring '26 release notes" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.details).toMatchObject({
      ok: false,
      action: "answer",
      reason: "insufficient_docs_evidence",
      retrieval_status: "insufficient",
    });
    expect(result.content[0].text).toContain("did not satisfy the release-specific evidence gate");
  });

  it("fails release-note answers when the MCP evidence gate has no matches", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("search");
      expect(String(body.params.arguments.query)).toContain("+release:252");
      return docsResponse({ results: [], totalCount: 0 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "answer", query: "Top Sales Cloud Winter '25 release notes" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.details).toMatchObject({
      ok: false,
      action: "answer",
      reason: "insufficient_docs_evidence",
      retrieval_status: "coverage_gap",
    });
    expect(result.content[0].text).toContain("Docs Query Plan:");
    expect(result.content[0].text).toContain("+release:252");
  });

  it("uses a default summary query for explain by URL", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("explain");
      expect(body.params.arguments).toMatchObject({
        collection: "developer",
        version: "current",
        locale: "en-us",
        query: "Summarize this document.",
        url: "https://developer.salesforce.com/docs/example",
      });
      return new Response(
        'event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"answer\\":\\"Summary\\"}"}]},"jsonrpc":"2.0","id":1}\n\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "explain", url: "https://developer.salesforce.com/docs/example" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.details).toMatchObject({ ok: true, action: "explain" });
    expect(result.content[0].text).toContain("Summary");
  });

  it("builds a bounded fetch evidence packet without duplicating bodies in details", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const longBody = `# Apex\n\n${"Source text. ".repeat(2000)}UNIQUE_DETAILS_BODY_TAIL`;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("fetch");
      expect(body.params.arguments).toMatchObject({ ids: ["doc-1"], format: "markdown" });
      return new Response(
        `event: message\ndata: ${JSON.stringify({
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  documents: [
                    {
                      id: "doc-1",
                      title: "Apex",
                      description: "Apex metadata description for the evidence packet.",
                      url: "https://help.salesforce.com/docs/apex",
                      filename: "release-notes/rn_apex.htm",
                      sourcePath: "release-notes",
                      baseUrl: "help.salesforce.com/s/articleView",
                      locale: "en-us",
                      product: "Platform",
                      products: "Platform",
                      guides: "salesforce_platform",
                      release: "260",
                      taxonomyIds: ["tax-1", "tax-2"],
                      contentHash: "abcdef1234567890fedcba",
                      content: longBody,
                    },
                  ],
                }),
              },
            ],
          },
          jsonrpc: "2.0",
          id: 1,
        })}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "fetch", ids: ["doc-1"] },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.content[0].text).toContain('<document index="1"');
    expect(result.content[0].text).toContain("Source URL: https://help.salesforce.com/docs/apex");
    expect(result.content[0].text).toContain('filename="release-notes/rn_apex.htm"');
    expect(result.content[0].text).toContain('sourcePath="release-notes"');
    expect(result.content[0].text).toContain('baseUrl="help.salesforce.com/s/articleView"');
    expect(result.content[0].text).toContain('product="Platform"');
    expect(result.content[0].text).toContain('guides="salesforce_platform"');
    expect(result.content[0].text).toContain('release="260"');
    expect(result.content[0].text).toContain(
      "Description: Apex metadata description for the evidence packet.",
    );
    expect(result.content[0].text).not.toContain("abcdef1234567890fedcba");
    expect(result.content[0].text).toContain("# Apex");
    expect(result.details).toMatchObject({
      ok: true,
      action: "fetch",
      displayDensity: "balanced",
      llmBudget: { perDocumentChars: 12000, maxTotalChars: 48000 },
    });
    const documents = result.details.documents as Array<Record<string, unknown>>;
    expect(documents[0]?.content).toBeUndefined();
    expect(documents[0]).toMatchObject({
      filename: "release-notes/rn_apex.htm",
      sourcePath: "release-notes",
      baseUrl: "help.salesforce.com/s/articleView",
      release: "260",
      contentHash: "abcdef1234567890fedcba",
      taxonomyIds: ["tax-1", "tax-2"],
    });
    expect(documents[0]?.humanPreview).toContain("Apex");
    expect(JSON.stringify(result.details)).not.toContain("UNIQUE_DETAILS_BODY_TAIL");
  });

  it("normalizes html headings and previews for fetch details", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const htmlBody = `<div><h1>The WITH SECURITY_ENFORCED SOQL Clause is Removed&nbsp;</h1><script >window.bad = true;</script ><p>Use <code>WITH USER_MODE</code> &amp; explicit access modes.</p><p>Escaped &amp;lt;script&amp;gt; stays text.</p></div>`;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          `event: message\ndata: ${JSON.stringify({
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    documents: [
                      {
                        id: "doc-html",
                        title: "HTML Doc",
                        url: "https://help.salesforce.com/docs/html",
                        content: htmlBody,
                      },
                    ],
                  }),
                },
              ],
            },
            jsonrpc: "2.0",
            id: 1,
          })}\n\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute(
      "id",
      { action: "fetch", ids: ["doc-html"], format: "html" },
      undefined,
      undefined,
      {
        cwd: process.cwd(),
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
      },
    );

    if (oldToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = oldToken;
    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    const documents = result.details.documents as Array<Record<string, unknown>>;
    expect(documents[0]?.headings).toEqual(["The WITH SECURITY_ENFORCED SOQL Clause is Removed"]);
    expect(documents[0]?.humanPreview).toContain("Use WITH USER_MODE & explicit access modes.");
    expect(documents[0]?.humanPreview).toContain("Escaped &lt;script&gt; stays text.");
    expect(String(documents[0]?.humanPreview)).not.toContain("window.bad");
    expect(String(documents[0]?.humanPreview)).not.toContain("<code>");
  });

  it("returns setup guidance when auth is missing", async () => {
    const old = process.env.SF_DOCS_MCP_TOKEN;
    delete process.env.SF_DOCS_MCP_TOKEN;
    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute("id", { action: "collections" }, undefined, undefined, {
      cwd: process.cwd(),
      modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
    });
    if (old === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
    else process.env.SF_DOCS_MCP_TOKEN = old;
    expect(result.details).toMatchObject({
      ok: false,
      action: "collections",
      reason: "missing_auth",
      recover_via: { command: "/sf-docs connect", action: "status" },
    });
    expect(result.content[0].text).toMatch(/not connected/i);
  });
});

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
