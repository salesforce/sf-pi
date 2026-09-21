/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_SCRIPT_QUALITY_ENTRY_TYPE,
  registerDeferredAgentScriptQuality,
} from "../lib/quality/auto-scan.ts";
import { AGENT_SCRIPT_QUALITY_RULES } from "../lib/quality/catalog.ts";
import type { AgentScriptQualityResult } from "../lib/quality/types.ts";

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-quality-auto-"));
});
afterEach(async () => rm(cwd, { recursive: true, force: true }));

type Handler = (...args: unknown[]) => unknown;

function harness() {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
  };
  return { pi, handlers };
}

function result(findings: AgentScriptQualityResult["findings"]): AgentScriptQualityResult {
  return {
    ok: true,
    status: findings.length ? "findings" : "clean",
    findings,
    summary: {
      high: findings.filter((item) => item.severity === "high").length,
      moderate: findings.filter((item) => item.severity === "moderate").length,
      low: 0,
      info: 0,
    },
    metrics: { cyclomatic_complexity: [] },
    coverage: {
      total_rules: AGENT_SCRIPT_QUALITY_RULES.length,
      enabled_rules: AGENT_SCRIPT_QUALITY_RULES.length,
      disabled_rules: [],
    },
    suppressions: { applied: [], invalid: [], unused: [] },
  };
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

const finding = {
  rule_id: "unused-action" as const,
  rule_name: "Unused Action",
  severity: "moderate" as const,
  message: "unused",
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  line: 1,
};

describe("deferred Agent Script quality", () => {
  it("returns one actionable repair boundary for High/Moderate findings", async () => {
    const { pi, handlers } = harness();
    const file = path.join(cwd, "A.agent");
    await writeFile(file, "x");
    registerDeferredAgentScriptQuality(pi as never, {
      readSettings: () => ({ autoRun: true }) as never,
      runQualityFile: async () => result([finding]),
    });
    const ctx = { cwd } as never;
    await handlers.get("tool_result")?.[0]?.(
      { isError: false, input: { path: file }, toolName: "write" },
      ctx,
    );
    expect(pi.sendMessage).not.toHaveBeenCalled();
    expect(handlers.get("agent_settled")).toBeUndefined();
    const prior = { type: "custom", customType: "prior-handler", data: { ok: true } };
    const boundary = await handlers.get("agent_before_settle")?.[0]?.(
      beforeSettleEvent([prior]),
      ctx,
    );
    expect(pi.appendEntry).toHaveBeenCalledWith(
      AGENT_SCRIPT_QUALITY_ENTRY_TYPE,
      expect.objectContaining({
        schema_version: 1,
        state: "repairing",
        quality: expect.objectContaining({ findings: [finding] }),
      }),
    );
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
    expect(boundary).toMatchObject({
      entries: [
        prior,
        {
          type: "custom_message",
          customType: "sf-agentscript-quality-repair",
          display: false,
        },
      ],
      continue: true,
    });
    const message = (boundary as { entries?: Array<{ content?: unknown }> })?.entries?.[1];
    expect(JSON.parse(String(message?.content))).toMatchObject({
      version: 1,
      task: "repair_agent_script_quality",
      attempt: 1,
      findings: [expect.objectContaining({ rule_id: "unused-action", severity: "moderate" })],
    });
  });

  it("keeps clean and low/info-only results human-only", async () => {
    const { pi, handlers } = harness();
    const file = path.join(cwd, "A.agent");
    await writeFile(file, "x");
    registerDeferredAgentScriptQuality(pi as never, {
      readSettings: () => ({ autoRun: true }) as never,
      runQualityFile: async () => result([]),
    });
    const ctx = { cwd } as never;
    await handlers.get("tool_result")?.[0]?.(
      { isError: false, input: { path: file }, toolName: "edit" },
      ctx,
    );
    const boundary = await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx);
    expect(boundary).toBeUndefined();
    expect(pi.appendEntry).toHaveBeenCalledWith(
      AGENT_SCRIPT_QUALITY_ENTRY_TYPE,
      expect.objectContaining({ state: "passed" }),
    );
    expect(pi.sendMessage).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("stops repeated finding signatures", async () => {
    const { pi, handlers } = harness();
    const file = path.join(cwd, "A.agent");
    await writeFile(file, "x");
    registerDeferredAgentScriptQuality(pi as never, {
      readSettings: () => ({ autoRun: true }) as never,
      runQualityFile: async () => result([finding]),
    });
    const ctx = { cwd } as never;
    const boundaries = [];
    for (let turn = 0; turn < 2; turn++) {
      await handlers.get("tool_result")?.[0]?.(
        { isError: false, input: { path: file }, toolName: "edit" },
        ctx,
      );
      boundaries.push(await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx));
    }
    expect(boundaries[0]).toMatchObject({ continue: true });
    expect(boundaries[1]).toBeUndefined();
    expect(pi.sendMessage).not.toHaveBeenCalled();
    expect(pi.appendEntry).toHaveBeenLastCalledWith(
      AGENT_SCRIPT_QUALITY_ENTRY_TYPE,
      expect.objectContaining({ state: "stopped" }),
    );
  });

  it("emits a fixed card when a repair is followed by a clean result", async () => {
    const { pi, handlers } = harness();
    const file = path.join(cwd, "A.agent");
    await writeFile(file, "x");
    let pass = 0;
    registerDeferredAgentScriptQuality(pi as never, {
      readSettings: () => ({ autoRun: true }) as never,
      runQualityFile: async () => (pass++ === 0 ? result([finding]) : result([])),
    });
    const ctx = { cwd } as never;
    const boundaries = [];
    for (let turn = 0; turn < 2; turn++) {
      await handlers.get("tool_result")?.[0]?.(
        { isError: false, input: { path: file }, toolName: "edit" },
        ctx,
      );
      boundaries.push(await handlers.get("agent_before_settle")?.[0]?.(beforeSettleEvent(), ctx));
    }
    expect(boundaries[0]).toMatchObject({ continue: true });
    expect(boundaries[1]).toBeUndefined();
    expect(pi.appendEntry).toHaveBeenLastCalledWith(
      AGENT_SCRIPT_QUALITY_ENTRY_TYPE,
      expect.objectContaining({ state: "fixed", repair: expect.objectContaining({ attempt: 1 }) }),
    );
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });
});
