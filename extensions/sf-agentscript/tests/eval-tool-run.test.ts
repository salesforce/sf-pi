/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvalOptions, RunEvalResult } from "../lib/eval/orchestrator.ts";

const mocks = vi.hoisted(() => ({
  runEval: vi.fn(),
  recordRunInIndex: vi.fn(async () => undefined),
  recordReleaseEvidence: vi.fn(async () => undefined),
  connFromAlias: vi.fn(async () => ({
    getUsername: () => "test@example.invalid",
  })),
  inspectFile: vi.fn(async () => ({
    ok: true,
    has_parse_errors: false,
    components: [],
  })),
  generateSpec: vi.fn(() => ({
    spec: {
      tests: [
        {
          id: "generated",
          steps: [{ type: "evaluator.string_assertion", id: "response_ok" }],
        },
      ],
    },
    summary: {
      total_tests: 1,
      subagent_tests: 0,
      action_tests: 0,
      connected_agent_tests: 0,
      multi_turn_tests: 0,
      guardrail_tests: 1,
      safety_tests: 0,
    },
  })),
  resolveAgentIds: vi.fn(async () => ({
    bot_id: "0Xx",
    bot_version_id: "0X9",
    planner_id: "0Xb",
    version_number: 1,
    status: "Inactive",
  })),
}));

vi.mock("../lib/eval/orchestrator.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eval/orchestrator.ts")>();
  return {
    ...actual,
    runEval: mocks.runEval,
    recordRunInIndex: mocks.recordRunInIndex,
  };
});

vi.mock("../../../lib/common/sf-conn/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/common/sf-conn/index.ts")>();
  return { ...actual, connFromAlias: mocks.connFromAlias };
});

vi.mock("../lib/release-contract.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/release-contract.ts")>();
  return { ...actual, recordReleaseEvidence: mocks.recordReleaseEvidence };
});

vi.mock("../lib/inspect.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/inspect.ts")>();
  return { ...actual, inspectFile: mocks.inspectFile };
});

vi.mock("../lib/eval/spec-generator.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eval/spec-generator.ts")>();
  return { ...actual, generateSpec: mocks.generateSpec };
});

vi.mock("../lib/eval/active-ids.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eval/active-ids.ts")>();
  return { ...actual, resolveAgentIds: mocks.resolveAgentIds };
});

import { registerEvalTool } from "../lib/eval-tool.ts";

const spec = {
  tests: [
    {
      id: "scenario",
      steps: [
        { type: "agent.create_session", id: "session" },
        { type: "agent.send_message", id: "turn", utterance: "hello" },
        { type: "evaluator.string_assertion", id: "response_ok" },
      ],
    },
  ],
};

function result(): RunEvalResult {
  return {
    run_id: "run-public",
    run_dir: "/tmp/run-public",
    totals: {
      tests: 1,
      test_pass: 1,
      test_fail: 0,
      evals: 1,
      ev_pass: 1,
      ev_fail: 0,
      errors: 0,
      latencies: [],
    },
    latency: { count: 0 },
    failures: [],
    merged: { results: [] },
    metadata: {
      run_id: "run-public",
      execution_state: "completed",
      evidence_verdict: "passed",
      verdict_semantics_version: 1,
      tests_count: 1,
      returned_tests_count: 1,
      missing_test_ids: [],
      failed_batches: 0,
      batches: 1,
      concurrency: 3,
      traces_mode: "off",
      traces_fetched: 0,
      totals: {
        tests: 1,
        test_pass: 1,
        test_fail: 0,
        evals: 1,
        ev_pass: 1,
        ev_fail: 0,
        errors: 0,
      },
      latency_summary: { count: 0 },
      started: "2026-08-03T00:00:00.000Z",
      completed: "2026-08-03T00:00:01.000Z",
      duration_ms: 1000,
    },
    failed_batches: 0,
    batch_failures: [],
    response_integrity: {
      turns_total: 0,
      turns_pass: 0,
      turns_warning: 0,
      turns_unavailable: 0,
      max_non_empty_content_count: 0,
      observations: [],
    },
  };
}

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-eval-tool-run-"));
  vi.clearAllMocks();
  mocks.runEval.mockImplementation(async (options: RunEvalOptions) => {
    options.log?.("batch progress");
    return result();
  });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

interface CapturedEvalTool {
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: unknown) => void) | undefined,
    context: { cwd: string },
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
}

function captureEvalTool(): CapturedEvalTool {
  let registered: CapturedEvalTool | undefined;
  registerEvalTool({
    registerTool(tool: unknown) {
      registered = tool as CapturedEvalTool;
    },
  } as never);
  return registered!;
}

describe("registered agentscript_eval run", () => {
  it("forwards timing, cancellation, batch controls, progress, and records the Run index", async () => {
    const controller = new AbortController();
    const updates: unknown[] = [];

    const response = await captureEvalTool().execute(
      "eval-public",
      {
        action: "run",
        target_org: "test-org",
        spec,
        traces_mode: "off",
        concurrency: 3,
        batch_timeout_ms: 1234,
      },
      controller.signal,
      (update: unknown) => updates.push(update),
      { cwd },
    );

    expect(mocks.runEval).toHaveBeenCalledOnce();
    expect(mocks.runEval.mock.calls[0]?.[0]).toMatchObject({
      targetOrg: "test-org",
      spec,
      tracesMode: "off",
      concurrency: 3,
      batchTimeoutMs: 1234,
      signal: controller.signal,
      cwd,
    });
    expect(mocks.runEval.mock.calls[0]?.[0].timings).toBeDefined();
    expect(updates).toEqual([
      expect.objectContaining({
        content: [{ type: "text", text: "batch progress" }],
      }),
    ]);
    expect(mocks.recordRunInIndex).toHaveBeenCalledWith(cwd, "run-public");
    expect(response.details).toMatchObject({
      ok: true,
      run_id: "run-public",
      execution_state: "completed",
      evidence_verdict: "passed",
      timings: expect.any(Object),
    });
  });

  it("records release authority through the public run_release action", async () => {
    const agentFile = path.join(cwd, "Release.agent");
    await writeFile(agentFile, "config:\n  agent_name: Release\n", "utf8");

    const response = await captureEvalTool().execute(
      "eval-release",
      {
        action: "run_release",
        target_org: "test-org",
        agent_api_name: "Release",
        agent_file: agentFile,
      },
      undefined,
      undefined,
      { cwd },
    );

    expect(mocks.runEval).toHaveBeenCalledOnce();
    expect(mocks.runEval.mock.calls[0]?.[0].releaseContract).toMatchObject({
      kind: "generated_baseline",
      spec_digest: expect.any(String),
    });
    expect(mocks.recordRunInIndex).toHaveBeenCalledWith(cwd, "run-public");
    expect(mocks.recordReleaseEvidence).toHaveBeenCalledWith(cwd, "run-public");
    expect(response.details).toMatchObject({ ok: true, evidence_verdict: "passed" });
    expect(response.content[0].text).toContain("release contract passed");
  });
});
