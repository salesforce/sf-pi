/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression: the eval API's response shape doesn't echo the user's
 * `utterance` back in EvalOutput. Without cross-referencing the spec we'd
 * write `utterance: null` into transcript.jsonl + the FailureRecord, which
 * is actively misleading when reading the artifacts later.
 *
 * This pins the fix that builds an utteranceIndex from the spec and feeds
 * it into both the transcript writer (via PersistInput.spec) and the
 * FailureRecord builder (via BuildOptions.utteranceIndex).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writeRun } from "../lib/eval/persist.ts";
import { buildFailureRecord } from "../lib/eval/render.ts";
import type { EvalApiResponse, EvalSpec, RunMetadata, TestResult } from "../lib/eval/types.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-utt-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const SPEC: EvalSpec = {
  tests: [
    {
      id: "t1",
      steps: [
        { type: "agent.create_session", id: "cs", agent_id: "0Xx" },
        {
          type: "agent.send_message",
          id: "sm",
          session_id: "x",
          utterance: "I forgot my password",
        },
      ],
    },
  ],
};

// EvalApiResponse where the API does NOT echo `utterance` (the live behavior).
const MERGED: EvalApiResponse = {
  results: [
    {
      id: "t1",
      outputs: [
        { type: "agent.create_session", id: "cs", session_id: "abc" },
        {
          type: "agent.send_message",
          id: "sm",
          response: "Sure, let me reset that for you.",
          // utterance intentionally omitted (matches live API)
        },
      ],
      evaluation_results: [],
      errors: [],
    },
  ],
};

describe("transcript.jsonl utterance cross-referencing", () => {
  test("writeRun pulls utterance from spec when API response omits it", async () => {
    const metadata: RunMetadata = {
      run_id: "test",
      org: "x",
      started: new Date().toISOString(),
      completed: new Date().toISOString(),
      duration_ms: 0,
      tests_count: 1,
      batches: 1,
      concurrency: 1,
      traces_mode: "off",
      traces_fetched: 0,
      totals: { tests: 1, test_pass: 1, test_fail: 0, evals: 0, ev_pass: 0, ev_fail: 0, errors: 0 },
      latency_summary: { count: 0 },
    };
    await writeRun({
      runDir: workDir,
      merged: MERGED,
      traces: new Map(),
      metadata,
      failures: [],
      spec: SPEC,
    });
    const transcript = await readFile(path.join(workDir, "transcript.jsonl"), "utf8");
    const line = JSON.parse(transcript.trim().split("\n")[0]);
    expect(line.utterance).toBe("I forgot my password");
    expect(line.agent_response).toBe("Sure, let me reset that for you.");
  });

  test("writeRun without spec falls back to null (legacy behavior is preserved when caller doesn't pass spec)", async () => {
    const metadata: RunMetadata = {
      run_id: "test",
      org: "x",
      started: new Date().toISOString(),
      completed: new Date().toISOString(),
      duration_ms: 0,
      tests_count: 1,
      batches: 1,
      concurrency: 1,
      traces_mode: "off",
      traces_fetched: 0,
      totals: { tests: 1, test_pass: 1, test_fail: 0, evals: 0, ev_pass: 0, ev_fail: 0, errors: 0 },
      latency_summary: { count: 0 },
    };
    await writeRun({
      runDir: workDir,
      merged: MERGED,
      traces: new Map(),
      metadata,
      failures: [],
    });
    const transcript = await readFile(path.join(workDir, "transcript.jsonl"), "utf8");
    const line = JSON.parse(transcript.trim().split("\n")[0]);
    expect(line.utterance).toBeNull();
  });
});

describe("buildFailureRecord utterance cross-referencing", () => {
  test("buildTurnSummary fills utterance from utteranceIndex when API output is empty", () => {
    const utteranceIndex = new Map<string, string>([["t1::sm", "I forgot my password"]]);
    const test: TestResult = MERGED.results![0];
    const failure = buildFailureRecord(test, [], { utteranceIndex });
    expect(failure.turns).toHaveLength(1);
    expect(failure.turns[0].utterance).toBe("I forgot my password");
  });

  test("does not override an utterance the API actually returned", () => {
    const utteranceIndex = new Map<string, string>([["t1::sm", "from-spec"]]);
    const testResult: TestResult = {
      id: "t1",
      outputs: [
        {
          type: "agent.send_message",
          id: "sm",
          utterance: "from-api",
          response: "ack",
        },
      ],
    };
    const failure = buildFailureRecord(testResult, [], { utteranceIndex });
    expect(failure.turns[0].utterance).toBe("from-api");
  });
});
