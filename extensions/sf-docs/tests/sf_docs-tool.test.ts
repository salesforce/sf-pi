/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempAgentDir: string;
let originalEndpoint: string | undefined;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

describe("sf_docs tool", () => {
  beforeEach(() => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-tool-"));
    originalEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
  });

  afterEach(() => {
    if (originalEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = originalEndpoint;
    vi.unstubAllGlobals();
    rmSync(tempAgentDir, { recursive: true, force: true });
  });

  it("registers one family tool with evidence-workflow guidance", async () => {
    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    expect(registerTool).toHaveBeenCalledTimes(1);
    const tool = registerTool.mock.calls[0]?.[0];
    expect(tool.name).toBe("sf_docs");
    expect(tool.promptGuidelines.join("\n")).toMatch(/search.*fetch/i);
    expect(tool.promptGuidelines.join("\n")).toMatch(
      /seasonal release notes.*admin.*developer separately/i,
    );
    expect(tool.parameters.properties).not.toHaveProperty("cite");
  });

  it("passes thrown-error context through the registered result renderer", async () => {
    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    } as unknown as Theme;

    const component = tool.renderResult(
      { content: [{ type: "text", text: "fetch failed" }], details: {} },
      { expanded: false, isPartial: false },
      theme,
      {
        isError: true,
        args: {
          action: "search",
          collection: "admin",
          version: "current",
          locale: "en-us",
        },
      },
    );
    const text = component.render(120).join("\n");

    expect(text).toContain("SF Docs · search failed");
    expect(text).toContain("admin/current/en-us");
    expect(text).not.toContain("SF Docs · status");
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
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
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

  it("keeps weak modern developer searches in developer", async () => {
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
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

    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.details).toMatchObject({ ok: true, action: "search", collection: "developer" });
    expect(result.details.collectionOverride).toBeUndefined();
  });

  it("returns balanced MCP capability summaries for collections", async () => {
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("list");
      return docsResponse({
        collections: [
          {
            collection: "admin",
            description: "Salesforce administrator and end-user help.",
            versions: ["current"],
            locales: ["en-us"],
            formats: ["text", "markdown"],
            extraFields: ["guides", "release", "product"],
            retrievalHints:
              "Use +release:<n>, guides:_<slug>, +latest:true, +pill:new, +updated:2026*, and +taxonomyIds:<guid>.",
            landmarks: [
              {
                version: "current",
                landmarks: [
                  { slug: "_sales" },
                  { slug: "_service_cloud", members: ["_digital_engagement"] },
                ],
                localeDiffs: [{ locales: ["ja-jp"], removed: [{ slug: "_service_cloud" }] }],
              },
            ],
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

    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.content[0].text).toContain("Collection alias: help → admin");
    expect(result.content[0].text).toContain(
      "description: Salesforce administrator and end-user help.",
    );
    expect(result.content[0].text).toContain(
      "key filters: +release:<n>, guides:_<slug>, +latest:true, +pill:<value>, +updated:<date>, +taxonomyIds:<guid>",
    );
    expect(result.content[0].text).toContain("hints: Use +release:<n>");
    expect(result.content[0].text).toContain("guides:_<slug>");
    expect(result.content[0].text).toContain("landmarks: current: _sales, _service_cloud");
    expect(result.details).toMatchObject({
      ok: true,
      action: "collections",
      collectionAlias: "help → admin",
    });
    expect(result.details).not.toHaveProperty("collectionProfiles");
  });

  it("uses a default summary query for explain by URL", async () => {
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("explain");
      expect(body.params.arguments).toEqual({
        query: "Summarize this document.",
        url: "https://developer.salesforce.com/docs/example",
        cite: true,
      });
      return new Response(
        'event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"answer\\":\\"Summary\\",\\"citations\\":[]}"}]},"jsonrpc":"2.0","id":1}\n\n',
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

    if (oldEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
    else process.env.SF_DOCS_MCP_ENDPOINT = oldEndpoint;
    vi.unstubAllGlobals();

    expect(result.details).toMatchObject({ ok: true, action: "explain" });
    expect(result.content[0].text).toContain("Summary");
  });

  it("builds a bounded fetch evidence packet without duplicating bodies in details", async () => {
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
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
      retrievalStatus: "complete",
      contentStatus: "truncated",
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
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const htmlBody = `<div><h1>The WITH SECURITY_ENFORCED SOQL Clause is Removed&nbsp;</h1><script >window.bad = true;</script\t\n bar><p>Use <code>WITH USER_MODE</code> &amp; explicit access modes.</p><p>Escaped &amp;lt;script&amp;gt; stays text.</p></div>`;
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

  it("fails closed when the configured endpoint is invalid", async () => {
    process.env.SF_DOCS_MCP_ENDPOINT = "not-a-url";
    const fetchMock = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute("id", { action: "collections" }, undefined, undefined, {
      cwd: process.cwd(),
      modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ ok: false, reason: "invalid_endpoint" });
  });

  it("returns setup guidance when the endpoint is missing", async () => {
    delete process.env.SF_DOCS_MCP_ENDPOINT;
    vi.resetModules();
    const { registerSfDocsTool } = await import("../lib/sf_docs-tool.ts");
    const registerTool = vi.fn();
    registerSfDocsTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const result = await tool.execute("id", { action: "collections" }, undefined, undefined, {
      cwd: process.cwd(),
      modelRegistry: { getApiKeyForProvider: vi.fn(async () => undefined) },
    });
    expect(result.details).toMatchObject({
      ok: false,
      action: "collections",
      reason: "missing_endpoint",
      recover_via: { command: "/sf-docs connect", action: "status" },
    });
    expect(result.content[0].text).toMatch(/endpoint is not configured/i);
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
