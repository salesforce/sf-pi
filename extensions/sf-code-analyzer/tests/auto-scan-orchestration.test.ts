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

type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

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

function beforeSettleEvent(entries: unknown[] = []) {
  return {
    type: "agent_before_settle",
    entries,
    continue: false,
    outcome: "completed",
    context: {
      contextEntries: [],
      contextMessages: [],
      llmMessages: [],
      pendingMessages: [],
      canContinue: true,
    },
  };
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
  it("waits for agent_before_settle instead of scanning at agent_end", async () => {
    const { pi, handlers } = harness();
    const runCodeAnalyzer = vi.fn();

    registerDeferredCodeAnalyzerAutoScan(
      pi as never,
      vi.fn() as never,
      readyDeps({ runCodeAnalyzer }),
    );

    await handlers.get("tool_result")?.[0]?.(writeResult("src/foo.ts"), ctx());
    expect(handlers.get("agent_end")).toBeUndefined();
    expect(handlers.get("agent_settled")).toBeUndefined();

    await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx());

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
    const boundary = await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx());

    expect(boundary).toBeUndefined();
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
    const boundary = await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx());

    expect(boundary).toBeUndefined();
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
    const prior = { type: "custom", customType: "prior-handler", data: { ok: true } };
    const boundary = await handlers.get("agent_before_settle")?.[0]?.(
      beforeSettleEvent([prior]),
      ctx(),
    );

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
    expect(boundary).toEqual({
      entries: [
        prior,
        expect.objectContaining({
          type: "custom_message",
          customType: "sf-code-analyzer-auto-scan-repair",
          content: expect.stringContaining("ApexCRUDViolation"),
          display: false,
        }),
      ],
      continue: true,
    });
  });

  it("preserves successful group findings and report paths when another group fails", async () => {
    const { pi, handlers } = harness();
    const runCodeAnalyzer = vi.fn().mockImplementation(async (_exec, _ctx, input) => {
      const selector = input.rule_selector[0];
      if (selector === "eslint:Recommended") throw new Error("eslint unavailable");
      return scanSummary("/tmp/pmd-partial.json", "ApexCRUDViolation");
    });

    registerDeferredCodeAnalyzerAutoScan(
      pi as never,
      vi.fn() as never,
      readyDeps({
        runCodeAnalyzer,
        buildScanRecipeGuidance: emptyGuidance,
      }),
    );

    await handlers.get("tool_result")?.[0]?.(writeResult("src/foo.ts"), ctx());
    await handlers.get("tool_result")?.[0]?.(writeResult("classes/Foo.cls"), ctx());
    const boundary = await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx());

    expect(runCodeAnalyzer).toHaveBeenCalledTimes(2);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "sf-code-analyzer",
      expect.objectContaining({ content: expect.stringContaining("eslint unavailable") }),
    );
    const followUp = String(
      (boundary as { entries?: Array<{ content?: unknown }> })?.entries?.[0]?.content,
    );
    expect(followUp).toContain("ApexCRUDViolation");
    expect(followUp).toContain("/tmp/pmd-partial.json");
  });

  it("runs ApexGuru after local groups when readiness is enabled", async () => {
    const { pi, handlers } = harness();
    const order: string[] = [];
    const runCodeAnalyzer = vi.fn().mockImplementation(async () => {
      order.push("local");
      return cleanSummary("/tmp/pmd-clean.json");
    });
    const runApexGuru = vi.fn().mockImplementation(async () => {
      order.push("apexguru");
      return scanSummary("/tmp/apexguru.json", "AvoidExpensiveApex");
    });

    registerDeferredCodeAnalyzerAutoScan(
      pi as never,
      vi.fn() as never,
      readyDeps({
        readSettings: () => ({
          autoScan: true,
          apexGuruAuto: true,
          sources: { autoScan: "default", apexGuruAuto: "default" },
        }),
        runCodeAnalyzer,
        isApexGuruReadyForAutoInsight: () => true,
        runApexGuru,
        nextReportPath: () => "/tmp/apexguru.json",
        buildScanRecipeGuidance: emptyGuidance,
      }),
    );

    await handlers.get("tool_result")?.[0]?.(writeResult("classes/Foo.cls"), ctx());
    const boundary = await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx());

    expect(order).toEqual(["local", "apexguru"]);
    expect(boundary).toMatchObject({
      entries: [
        expect.objectContaining({ content: expect.stringContaining("AvoidExpensiveApex") }),
      ],
      continue: true,
    });
  });

  it("records an explicit ApexGuru skip when readiness is stale", async () => {
    const { pi, handlers } = harness();
    const runApexGuru = vi.fn();

    registerDeferredCodeAnalyzerAutoScan(
      pi as never,
      vi.fn() as never,
      readyDeps({
        readSettings: () => ({
          autoScan: true,
          apexGuruAuto: true,
          sources: { autoScan: "default", apexGuruAuto: "default" },
        }),
        runCodeAnalyzer: vi.fn().mockResolvedValue(cleanSummary("/tmp/pmd-clean.json")),
        isApexGuruReadyForAutoInsight: () => false,
        readApexGuruReadiness: () => ({
          access: "enabled",
          checkedAt: "2020-01-01T00:00:00.000Z",
          message: "Cached readiness is stale.",
        }),
        runApexGuru,
        buildScanRecipeGuidance: emptyGuidance,
      }),
    );

    await handlers.get("tool_result")?.[0]?.(writeResult("classes/Foo.cls"), ctx());
    const boundary = await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx());

    expect(boundary).toBeUndefined();
    expect(runApexGuru).not.toHaveBeenCalled();
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "sf-code-analyzer",
      expect.objectContaining({
        content: expect.stringMatching(
          /ApexGuru auto insight skipped[\s\S]*Cached readiness is stale/,
        ),
      }),
    );
  });

  it("stops the repair loop when the violation signature is unchanged", async () => {
    const { pi, handlers } = harness();
    const runCodeAnalyzer = vi
      .fn()
      .mockResolvedValue(scanSummary("/tmp/repeated.json", "RepeatedViolation"));

    registerDeferredCodeAnalyzerAutoScan(
      pi as never,
      vi.fn() as never,
      readyDeps({ runCodeAnalyzer, buildScanRecipeGuidance: emptyGuidance }),
    );

    await handlers.get("tool_result")?.[0]?.(writeResult("src/foo.ts"), ctx());
    const firstBoundary = await handlers.get("agent_before_settle")?.[0]?.(
      beforeSettleEvent(),
      ctx(),
    );
    await handlers.get("tool_result")?.[0]?.(writeResult("src/foo.ts"), ctx());
    const secondBoundary = await handlers.get("agent_before_settle")?.[0]?.(
      beforeSettleEvent(),
      ctx(),
    );

    expect(runCodeAnalyzer).toHaveBeenCalledTimes(2);
    expect(firstBoundary).toMatchObject({ continue: true });
    expect(secondBoundary).toBeUndefined();
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "sf-code-analyzer",
      expect.objectContaining({ content: expect.stringContaining("repair loop stopped") }),
    );
  });

  it("propagates broader validation guidance from group execution into the follow-up", async () => {
    const { pi, handlers } = harness();
    const guidance = "Broader scan suggestions (not run automatically): security";

    registerDeferredCodeAnalyzerAutoScan(
      pi as never,
      vi.fn() as never,
      readyDeps({
        runCodeAnalyzer: vi
          .fn()
          .mockResolvedValue(scanSummary("/tmp/guidance.json", "GuidedViolation")),
        buildScanRecipeGuidance: () => ({
          recipes: [],
          suggestions: ["security"],
          herdrHandoffs: [],
          text: guidance,
        }),
      }),
    );

    await handlers.get("tool_result")?.[0]?.(writeResult("src/foo.ts"), ctx());
    const boundary = await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx());

    const followUp = String(
      (boundary as { entries?: Array<{ content?: unknown }> })?.entries?.[0]?.content,
    );
    expect(followUp).toContain("Optional broader validation:");
    expect(followUp).toContain(guidance);
  });
});

function cleanSummary(reportFile: string) {
  return {
    kind: "run",
    ok: true,
    source: "code-analyzer-cli",
    command: "sf code-analyzer run",
    durationMs: 12,
    reportFile,
    exitCode: 0,
    run: { violations: [] },
  };
}

function scanSummary(reportFile: string, rule: string) {
  return {
    ...cleanSummary(reportFile),
    run: {
      violations: [
        {
          engine: rule.includes("Apex") ? "apexguru" : "pmd",
          rule,
          severity: 2,
          primaryLocationIndex: 0,
          locations: [{ file: "classes/Foo.cls", startLine: 1, startColumn: 1 }],
          message: `Finding for ${rule}`,
        },
      ],
    },
  };
}

function emptyGuidance() {
  return { recipes: [], suggestions: [], herdrHandoffs: [], text: "" };
}
