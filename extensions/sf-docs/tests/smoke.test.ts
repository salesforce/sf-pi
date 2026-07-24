/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for sf-docs.
 *
 * Verifies the extension module can be imported and exports a default function.
 * This is the starting point for TDD — add specific tests as you build features.
 */
import { describe, it, expect, vi } from "vitest";
import { DocsClient } from "../lib/client.ts";
import { collectManagerDetailActions } from "../../../lib/common/manager-actions.ts";

describe("sf-docs", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("registers flat slash-command completions", async () => {
    const mod = await import("../index.ts");
    const pi = {
      on: vi.fn(),
      registerProvider: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      events: { on: vi.fn() },
    };

    mod.default(pi as never);

    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-docs")?.[1];
    expect(command?.getArgumentCompletions?.("col")?.map((item) => item.value)).toEqual([
      "collections",
    ]);
    expect(command?.getArgumentCompletions?.("status he")).toBeNull();
  });

  it("provides Manager action panels for credential input flows", async () => {
    const mod = await import("../index.ts");
    const listeners = new Map<string, Array<(payload: unknown) => void>>();
    const pi = {
      on: vi.fn(),
      registerProvider: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      events: {
        on: (event: string, handler: (payload: unknown) => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), handler]);
          return () => undefined;
        },
        emit: (event: string, payload: unknown) => {
          for (const handler of listeners.get(event) ?? []) handler(payload);
        },
      },
    };
    mod.default(pi as never);
    const actions = collectManagerDetailActions(pi, "sf-docs");
    expect(typeof actions.find((action) => action.id === "connect")?.createPanel).toBe("function");
    expect(typeof actions.find((action) => action.id === "disconnect")?.createPanel).toBe(
      "function",
    );
  });

  const liveIt = process.env.SF_DOCS_LIVE_SMOKE && process.env.SF_DOCS_MCP_TOKEN ? it : it.skip;
  liveIt("live MCP exposes admin release filters and searchable release-note docs", async () => {
    const client = new DocsClient({
      endpoint: process.env.SF_DOCS_MCP_ENDPOINT || "https://mcp.docs.salesforce.com/",
      token: process.env.SF_DOCS_MCP_TOKEN!,
      timeoutMs: 30000,
    });
    const catalog = (await client.callTool("list", {})) as {
      collections?: Array<Record<string, unknown>>;
    };
    const admin = catalog.collections?.find((collection) => collection.collection === "admin");
    expect(String(admin?.retrievalHints)).toContain("+release:<n>");

    const search = (await client.callTool("search", {
      collection: "admin",
      query: "+release:258 sales cloud",
      pageSize: 3,
    })) as { results?: Array<{ url?: string; release?: string }> };
    expect(
      search.results?.some(
        (result) => result.release === "258" || result.url?.includes("release=258"),
      ),
    ).toBe(true);
  });
});
