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

describe("sf_docs remote and evidence contracts", () => {
  beforeEach(() => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-contract-"));
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "https://docs.example.test/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(tempAgentDir, { recursive: true, force: true });
  });

  it("omits locale for auto-detected searches", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("search");
      expect(body.params.arguments).toMatchObject({
        collection: "developer",
        version: "current",
        query: "Apex callouts",
      });
      expect(body.params.arguments).not.toHaveProperty("locale");
      return docsResponse({ results: [], totalCount: 0 });
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "search", query: "Apex callouts" });

    expect(result.details).toMatchObject({ ok: true, locale: "auto" });
  });

  it("sends only documented explain parameters and always requests citations", async () => {
    const url = "https://developer.salesforce.com/docs/example";
    const fetchMock = vi.fn(async (_endpoint: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("explain");
      expect(body.params.arguments).toEqual({
        query: "Summarize this document.",
        url,
        cite: true,
      });
      return docsResponse({
        explanation: "Summary",
        citations: [{ title: "Example", url }],
      });
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "explain", url });

    expect(result.details).toMatchObject({ ok: true, action: "explain" });
  });

  it("surfaces service errors from every distilled search attempt", async () => {
    const query = "https://help.salesforce.com/s/articleView?id=platform.sample_article.htm&type=5";
    const fetchMock = vi.fn(async () =>
      docsResponse({
        error: "slice_not_available",
        requested: { collection: "admin" },
        available: { locales: ["en-us"] },
      }),
    ) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "search", query });

    expect(result.details).toMatchObject({
      ok: false,
      reason: "docs_service_error",
      available: '{"locales":["en-us"]}',
    });
    expect(result.content[0].text).toContain('Available: {"locales":["en-us"]}');
  });

  it("throws on a malformed successful search payload", async () => {
    const fetchMock = vi.fn(async () => docsResponse({ totalCount: 0 })) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    await expect(execute(tool, { action: "search", query: "Apex" })).rejects.toThrow(/results/i);
  });

  it("fails when a fetch returns no usable documents and preserves recovery metadata", async () => {
    const fetchMock = vi.fn(async () =>
      docsResponse({
        documents: [
          {
            id: "missing-doc",
            error: "not_found",
            available: { locales: ["en-us"], versions: ["current"] },
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "fetch", ids: ["missing-doc"] });

    expect(result.details).toMatchObject({
      ok: false,
      reason: "no_usable_documents",
      retrievalStatus: "failed",
      contentStatus: "complete",
      documents: [{ status: "error" }],
    });
    expect(result.content[0].text).toContain('"locales":["en-us"]');
  });

  it("reports mixed fetch results as partial", async () => {
    const fetchMock = vi.fn(async () =>
      docsResponse({
        documents: [
          { id: "ok", title: "Apex", content: "# Apex\n\nUsable evidence." },
          { id: "missing", error: "not_found" },
        ],
      }),
    ) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "fetch", ids: ["ok", "missing"] });

    expect(result.details).toMatchObject({
      ok: true,
      retrievalStatus: "partial",
      contentStatus: "complete",
    });
  });

  it("bounds answer content and citations while retaining source URLs", async () => {
    const longAnswer = `${"A".repeat(20_000)}UNIQUE_ANSWER_TAIL`;
    const citations = Array.from({ length: 15 }, (_, index) => ({
      title: `Source ${index + 1}`,
      url: `https://developer.salesforce.com/docs/source-${index + 1}`,
    }));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.params.name).toBe("answer");
      expect(body.params.arguments.cite).toBe(true);
      return docsResponse({ answer: longAnswer, citations });
    }) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, { action: "answer", query: "Explain Apex" });

    expect(result.content[0].text).toContain("answer truncated");
    expect(result.content[0].text).not.toContain("UNIQUE_ANSWER_TAIL");
    expect(result.content[0].text).toContain("https://developer.salesforce.com/docs/source-12");
    expect(result.content[0].text).not.toContain("https://developer.salesforce.com/docs/source-13");
    expect(result.details).toMatchObject({
      ok: true,
      answerChars: longAnswer.length,
      answerReturnedChars: 16_000,
      answerTruncated: true,
      citationsTruncated: true,
    });
    expect((result.details.citations as unknown[]).length).toBe(12);
  });

  it("bounds explain content through the same evidence contract", async () => {
    const explanation = `${"E".repeat(18_000)}UNIQUE_EXPLANATION_TAIL`;
    const fetchMock = vi.fn(async () =>
      docsResponse({
        explanation,
        citations: [{ title: "Apex", url: "https://developer.salesforce.com/docs/apex" }],
      }),
    ) as unknown as typeof fetch;
    const tool = await loadTool(fetchMock);

    const result = await execute(tool, {
      action: "explain",
      url: "https://developer.salesforce.com/docs/apex",
    });

    expect(result.content[0].text).toContain("explanation truncated");
    expect(result.content[0].text).not.toContain("UNIQUE_EXPLANATION_TAIL");
    expect(result.details).toMatchObject({
      answerReturnedChars: 16_000,
      answerTruncated: true,
    });
    expect(String(result.details.explanation)).toHaveLength(16_000);
  });
});

interface TestToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

interface TestTool {
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

async function execute(tool: TestTool, params: Record<string, unknown>) {
  return tool.execute("id", params, undefined, undefined, {
    cwd: process.cwd(),
    modelRegistry: {},
  });
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
