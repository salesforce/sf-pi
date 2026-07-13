/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";

import { registerDeferredCodeAnalyzerAutoScan } from "../lib/auto-scan.ts";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "sf-code-analyzer-auto-scan-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;

function harness() {
  const handlers = new Map<string, EventHandler[]>();
  const pi = {
    on: (event: string, handler: EventHandler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
  };
  return { pi, handlers };
}

function ctx(): ExtensionContext {
  return { cwd } as ExtensionContext;
}

function writeResult(file: string): ToolResultEvent {
  return {
    toolName: "write",
    input: { path: file },
    isError: false,
    content: [],
    details: {},
  } as unknown as ToolResultEvent;
}

function readyDeps(overrides: Record<string, unknown> = {}) {
  return {
    readSettings: () => ({
      autoScan: true,
      apexGuruAuto: false,
      sources: { autoScan: "default" as const, apexGuruAuto: "default" as const },
    }),
    readReadiness: () => ({
      status: "ready" as const,
      summary: "ready",
      checkedAt: new Date().toISOString(),
    }),
    isReadyForAutoScan: () => true,
    ...overrides,
  };
}

describe("deferred Code Analyzer auto-scan orchestration", () => {
  it("waits for agent_settled instead of scanning at agent_end", async () => {
    const { pi, handlers } = harness();
    const runCodeAnalyzer = vi.fn();

    registerDeferredCodeAnalyzerAutoScan(
      pi as never,
      vi.fn() as never,
      readyDeps({ runCodeAnalyzer }),
    );

    await handlers.get("tool_result")?.[0]?.(writeResult("src/foo.ts"), ctx());
    expect(handlers.get("agent_end")).toBeUndefined();

    await handlers.get("agent_settled")?.[0]?.({}, ctx());

    expect(runCodeAnalyzer).toHaveBeenCalledOnce();
  });

  it("skips pending files without running scans when readiness is not ready", async () => {
    const { pi, handlers } = harness();
    const runCodeAnalyzer = vi.fn();

    registerDeferredCodeAnalyzerAutoScan(pi as never, vi.fn() as never, {
      readSettings: () => ({
        autoScan: true,
        apexGuruAuto: true,
        sources: { autoScan: "default", apexGuruAuto: "default" },
      }),
      readReadiness: () => ({ status: "not_installed", summary: "missing" }),
      isReadyForAutoScan: () => false,
      runCodeAnalyzer,
    });

    await handlers.get("tool_result")?.[0]?.(writeResult("src/foo.ts"), ctx());
    await handlers.get("agent_settled")?.[0]?.({}, ctx());

    expect(runCodeAnalyzer).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "sf-code-analyzer",
      expect.objectContaining({
        content: expect.stringContaining("deferred scan skipped"),
      }),
    );
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("runs ready local scan groups and sends no follow-up when clean", async () => {
    const { pi, handlers } = harness();
    const runCodeAnalyzer = vi.fn().mockResolvedValue({
      kind: "run",
      ok: true,
      source: "code-analyzer-cli",
      command: "sf code-analyzer run",
      durationMs: 12,
      reportFile: "/tmp/eslint.json",
      exitCode: 0,
      run: { violations: [] },
    });

    registerDeferredCodeAnalyzerAutoScan(
      pi as never,
      vi.fn() as never,
      readyDeps({ runCodeAnalyzer }),
    );

    await handlers.get("tool_result")?.[0]?.(writeResult("src/foo.ts"), ctx());
    await handlers.get("agent_settled")?.[0]?.({}, ctx());

    expect(runCodeAnalyzer).toHaveBeenCalledOnce();
    expect(runCodeAnalyzer.mock.calls[0][2]).toMatchObject({
      rule_selector: ["eslint:Recommended"],
      target: [path.join(cwd, "src/foo.ts")],
    });
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "sf-code-analyzer",
      expect.objectContaining({
        content: expect.stringContaining("Code Analyzer Auto-scan"),
      }),
    );
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "sf-code-analyzer",
      expect.objectContaining({
        content: expect.stringContaining("✓ Clean"),
      }),
    );
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("sends one follow-up when a ready local scan finds violations", async () => {
    const { pi, handlers } = harness();
    const runCodeAnalyzer = vi.fn().mockResolvedValue({
      kind: "run",
      ok: true,
      source: "code-analyzer-cli",
      command: "sf code-analyzer run",
      durationMs: 12,
      reportFile: "/tmp/pmd.json",
      exitCode: 0,
      run: {
        violations: [
          {
            engine: "pmd",
            rule: "ApexCRUDViolation",
            severity: 2,
            primaryLocationIndex: 0,
            locations: [{ file: "classes/Foo.cls", startLine: 1, startColumn: 1 }],
            message: "Validate CRUD",
          },
        ],
      },
    });

    registerDeferredCodeAnalyzerAutoScan(
      pi as never,
      vi.fn() as never,
      readyDeps({
        runCodeAnalyzer,
        buildScanRecipeGuidance: () => ({
          recipes: [],
          suggestions: [],
          herdrHandoffs: [],
          text: "",
        }),
      }),
    );

    await handlers.get("tool_result")?.[0]?.(writeResult("classes/Foo.cls"), ctx());
    await handlers.get("agent_settled")?.[0]?.({}, ctx());

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("ApexCRUDViolation"), {
      deliverAs: "followUp",
    });
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });
});
