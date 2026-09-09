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
import { runGroundWorkflow } from "../lib/ground-workflow.ts";
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

  it("provides Manager action panels for endpoint configuration flows", async () => {
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
    const previousEndpoint = process.env.SF_DOCS_MCP_ENDPOINT;
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-footer-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
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
      if (previousEndpoint === undefined) delete process.env.SF_DOCS_MCP_ENDPOINT;
      else process.env.SF_DOCS_MCP_ENDPOINT = previousEndpoint;
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  const liveIt = process.env.SF_DOCS_LIVE_SMOKE && process.env.SF_DOCS_MCP_ENDPOINT ? it : it.skip;
  liveIt(
    "live docs service preserves the unauthenticated tool protocol",
    async () => {
      const client = new DocsClient({
        endpoint: process.env.SF_DOCS_MCP_ENDPOINT!,
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
        query: '"Named Credentials"',
        pageSize: 1,
      })) as {
        results?: Array<{
          id?: string;
          url?: string;
          collection?: string;
          version?: string;
          locale?: string;
        }>;
      };
      const candidate = search.results?.[0];
      expect(candidate?.id).toBeTruthy();
      expect(candidate?.url).toBeTruthy();

      const fetched = (await client.callTool("fetch", {
        ids: [candidate!.id],
        collection: candidate!.collection ?? "developer",
        version: candidate!.version ?? "current",
        locale: candidate!.locale,
        format: "markdown",
      })) as { documents?: Array<{ content?: string }> };
      expect(fetched.documents?.[0]?.content).toBeTruthy();

      const answered = (await client.callTool("answer", {
        query: "What is a Salesforce named credential used for?",
        collection: "developer",
        version: "current",
        cite: true,
      })) as { answer?: string; citations?: unknown[] };
      expect(answered.answer).toBeTruthy();
      expect(answered.citations?.length).toBeGreaterThan(0);

      const explained = (await client.callTool("explain", {
        query: "Summarize this document.",
        url: candidate!.url,
        cite: true,
      })) as { answer?: string; explanation?: string; citations?: unknown[] };
      expect(explained.answer ?? explained.explanation).toBeTruthy();
      expect(explained.citations?.length).toBeGreaterThan(0);

      const grounded = await runGroundWorkflow({
        client,
        endpoint: process.env.SF_DOCS_MCP_ENDPOINT!,
        input: {
          query: "How are named credentials used in Apex callouts?",
          collection: "developer",
          collectionExplicit: false,
          version: "current",
          locale: "auto",
          pageSize: 3,
          format: "markdown",
        },
      });
      expect(grounded).toMatchObject({
        ok: true,
        details: { verdict: expect.stringMatching(/grounded|partial/) },
      });
    },
    120_000,
  );
});
