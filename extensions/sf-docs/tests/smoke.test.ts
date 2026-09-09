/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for sf-docs.
 *
 * Verifies the extension module can be imported and exports a default function.
 * This is the starting point for TDD — add specific tests as you build features.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

  it("publishes a cache-first DevBar pill from local configuration only", async () => {
    const previousToken = process.env.SF_DOCS_MCP_TOKEN;
    const previousEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-footer-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    delete process.env.SF_DOCS_MCP_TOKEN;
    delete process.env.SF_DOCS_MCP_ENDPOINT;
    try {
      const mod = await import("../index.ts");
      type SessionHandler = (event: unknown, ctx: unknown) => Promise<void> | void;
      const listeners = new Map<string, SessionHandler[]>();
      const pi = {
        on: (event: string, handler: SessionHandler) => {
          listeners.set(event, [...(listeners.get(event) ?? []), handler]);
        },
        registerProvider: vi.fn(),
        registerTool: vi.fn(),
        registerCommand: vi.fn(),
        events: { on: vi.fn() },
      };
      mod.default(pi as never);
      const sessionStart = listeners.get("session_start")?.[0];
      const setStatus = vi.fn();
      await sessionStart?.(
        {},
        {
          hasUI: true,
          cwd: "/tmp/sf-pi-test",
          mode: "tui",
          ui: {
            setStatus,
            theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
          },
        },
      );
      expect(setStatus).toHaveBeenCalledWith("sf-docs-status", undefined);

      process.env.SF_DOCS_MCP_TOKEN = "test-token";
      process.env.SF_DOCS_MCP_ENDPOINT = "https://docs.example.test/";
      await sessionStart?.(
        {},
        {
          hasUI: true,
          cwd: "/tmp/sf-pi-test",
          mode: "tui",
          ui: {
            setStatus,
            theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
          },
        },
      );
      expect(setStatus).toHaveBeenCalledWith("sf-docs-status", expect.stringContaining("Docs ✓"));
    } finally {
      if (previousToken === undefined) delete process.env.SF_DOCS_MCP_TOKEN;
      else process.env.SF_DOCS_MCP_TOKEN = previousToken;
      if (previousEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
      else process.env.SF_DOCS_MCP_ENDPOINT = previousEndpoint;
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  const liveIt =
    process.env.SF_DOCS_LIVE_SMOKE &&
    process.env.SF_DOCS_MCP_TOKEN &&
    process.env.SF_DOCS_MCP_ENDPOINT
      ? it
      : it.skip;
  liveIt("live docs service preserves the catalog and search protocol", async () => {
    const client = new DocsClient({
      endpoint: process.env.SF_DOCS_MCP_ENDPOINT!,
      token: process.env.SF_DOCS_MCP_TOKEN!,
      timeoutMs: 30000,
    });
    const catalog = (await client.callTool("list", {})) as {
      collections?: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(catalog.collections)).toBe(true);
    expect(catalog.collections?.some((collection) => collection.collection === "developer")).toBe(
      true,
    );

    const search = (await client.callTool("search", {
      collection: "developer",
      version: "current",
      locale: "en-us",
      query: '"Named Credentials"',
      pageSize: 1,
    })) as { results?: unknown[] };
    expect(Array.isArray(search.results)).toBe(true);
  });
});
