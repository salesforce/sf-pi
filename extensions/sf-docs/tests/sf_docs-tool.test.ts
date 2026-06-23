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
