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
    });
    expect(result.content[0].text).toMatch(/not connected/i);
  });
});
