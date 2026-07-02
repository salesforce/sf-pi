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
    expect(result.content[0].text).toContain(
      "Distilled docs locator query: agent connect rep other voice calls sample",
    );
    expect(result.details).toMatchObject({
      ok: true,
      action: "search",
      resolution: { kind: "docs_query_distillation", collectionsTried: ["admin"] },
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

  it("biases seasonal release-note answers to the admin collection", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("answer");
      expect(body.params.arguments).toMatchObject({
        collection: "admin",
        version: "current",
        locale: "en-us",
      });
      expect(String(body.params.arguments.query)).toContain(
        "Whats new with Spring '26 release notes",
      );
      expect(String(body.params.arguments.query)).toContain("Salesforce Spring 26 Release Notes");
      return docsResponse({ answer: "Spring summary", citations: [] });
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
                      url: "https://help.salesforce.com/docs/apex",
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
    expect(result.content[0].text).toContain("# Apex");
    expect(result.details).toMatchObject({
      ok: true,
      action: "fetch",
      displayDensity: "balanced",
      llmBudget: { perDocumentChars: 12000, maxTotalChars: 48000 },
    });
    const documents = result.details.documents as Array<Record<string, unknown>>;
    expect(documents[0]?.content).toBeUndefined();
    expect(documents[0]?.humanPreview).toContain("Apex");
    expect(JSON.stringify(result.details)).not.toContain("UNIQUE_DETAILS_BODY_TAIL");
  });

  it("normalizes html headings and previews for fetch details", async () => {
    const oldToken = process.env.SF_DOCS_MCP_TOKEN;
    const oldEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    process.env.SF_DOCS_MCP_TOKEN = "test-token";
    process.env.SF_DOCS_MCP_ENDPOINT = "https://example.test/";
    const htmlBody = `<div><h1>The WITH SECURITY_ENFORCED SOQL Clause is Removed&nbsp;</h1><p>Use <code>WITH USER_MODE</code> &amp; explicit access modes.</p></div>`;
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
