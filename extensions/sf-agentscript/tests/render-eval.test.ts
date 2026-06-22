/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { evalRunMarkdown, evalFailureMarkdown, renderEvalRunResult } from "../lib/render/eval.ts";

const plainTheme = {
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
} as never;

describe("evalRunMarkdown", () => {
  it("renders all-passing run with green badges and latency histogram", () => {
    const md = evalRunMarkdown(
      {
        ok: true,
        run_id: "run_3f2a",
        totals: {
          tests: 10,
          test_pass: 10,
          test_fail: 0,
          evals: 30,
          ev_pass: 30,
          ev_fail: 0,
          errors: 0,
        },
        latency: { count: 18, p50_ms: 1240, p95_ms: 2380, p99_ms: 2680, max_ms: 2950 },
      },
      [],
    );
    expect(md).toMatch(/all tests passing/);
    expect(md).toMatch(/run run_3f2a/);
    expect(md).toMatch(/10\/10 tests/);
    expect(md).toMatch(/30\/30 evaluators/);
    expect(md).toMatch(/p50/);
    expect(md).toMatch(/2380/);
    expect(md).toMatch(/█/);
  });

  it("renders failures inline and emits a drill-down hint", () => {
    const md = evalRunMarkdown(
      {
        ok: false,
        run_id: "run_3f2a",
        totals: {
          tests: 10,
          test_pass: 8,
          test_fail: 2,
          evals: 30,
          ev_pass: 24,
          ev_fail: 6,
          errors: 0,
        },
        latency: { count: 18, p50_ms: 1240, p95_ms: 2380, p99_ms: 2680, max_ms: 2950 },
        failed_test_ids: ["test_unauthorized_access", "test_topic_routing"],
      },
      [
        {
          test_id: "test_unauthorized_access",
          failed_evaluators: [
            {
              id: "topic_match",
              score: 0.42,
              expected_value: "Billing",
              actual_value: "NoMatch",
              explainability:
                "Topic was NoMatch but expected Billing because verified_check is false",
            },
          ],
          step_errors: [],
          turns: [
            {
              turn_id: "t1",
              utterance: "Show me last month's bill",
              agent_response: "I can't help with billing without verification…",
              topic: "NoMatch",
              latency_ms: 1280,
              plan_id: "2c4d-0000",
              state_variables: { verified_check: false },
            },
          ],
        },
        {
          test_id: "test_topic_routing",
          failed_evaluators: [{ id: "topic_match", score: 0.5 }],
          step_errors: [],
          turns: [],
        },
      ],
    );
    expect(md).toMatch(/failures detected/);
    expect(md).toMatch(/8\/10 tests/);
    expect(md).toMatch(/❌/);
    expect(md).toMatch(/test_unauthorized_access/);
    expect(md).toMatch(/test_topic_routing/);
    expect(md).toMatch(/topic_match/);
    expect(md).toMatch(/agentscript_eval get_failure/);
  });

  it("renders partial progress text when provided", () => {
    const rendered = renderEvalRunResult(
      { content: [{ type: "text", text: "Running 18 tests across 4 batch(es)" }] },
      { isPartial: true },
      plainTheme,
    ) as unknown as { text: string };

    expect(rendered.text).toContain("Running 18 tests across 4 batch(es)");
  });

  it("collapses passing tests into a count when none failed", () => {
    const md = evalRunMarkdown(
      {
        ok: true,
        run_id: "r",
        totals: {
          tests: 5,
          test_pass: 5,
          test_fail: 0,
          evals: 15,
          ev_pass: 15,
          ev_fail: 0,
          errors: 0,
        },
        latency: { count: 0 },
      },
      [],
    );
    expect(md).toMatch(/5 passing tests/);
  });
});

describe("evalFailureMarkdown", () => {
  it("renders the failure card with evaluators, turn, and traces", () => {
    const md = evalFailureMarkdown({
      test_id: "test_unauthorized_access",
      failed_evaluators: [
        {
          id: "topic_match",
          score: 0.42,
          expected_value: "Billing",
          actual_value: "NoMatch",
          explainability: "topic was NoMatch but expected Billing",
        },
      ],
      step_errors: [{ id: "step_3", error_message: "rate limited" }],
      turns: [
        {
          turn_id: "t1",
          utterance: "Show me last month's bill",
          agent_response: "I can't help…",
          topic: "NoMatch",
          latency_ms: 1280,
          plan_id: "2c4d0000-aaaa-bbbb-cccc-dddddddddddd",
          state_variables: { verified_check: false },
          digest: {
            source: "eval",
            turn: { user_input: "x", agent_response: "y" },
            timeline: [
              { i: 0, t: "UserInputStep", user: "x" },
              { i: 1, t: "LLMStep", agent: "Triage" },
              { i: 2, t: "PlannerResponseStep" },
            ],
            errors: [],
            stats: {
              step_count: 3,
              llm_calls: 1,
              vars_updated: 0,
              topic_changes: 0,
              function_calls: 0,
              errors: 0,
            },
            summary_line: "x",
          },
        },
      ],
      trace_files: [".sfdx/agents/AS/.../traces/2c4d.json"],
    });
    expect(md).toMatch(/test_unauthorized_access/);
    expect(md).toMatch(/Failed evaluators/);
    expect(md).toMatch(/topic_match/);
    expect(md).toMatch(/score=0\.42/);
    expect(md).toMatch(/Step errors/);
    expect(md).toMatch(/rate limited/);
    expect(md).toMatch(/Turn t1/);
    expect(md).toMatch(/2c4d0000/);
    expect(md).toMatch(/1\.3s/); // fmtMs converts 1280ms to '1.3s'
    expect(md).toMatch(/Show me last month/);
    expect(md).toMatch(/verified_check/);
    // mini timeline strip
    expect(md).toMatch(/▶/);
    expect(md).toMatch(/🧠/);
    expect(md).toMatch(/💬/);
    // traces footer
    expect(md).toMatch(/traces:/);
    expect(md).toMatch(/2c4d\.json/);
  });

  it("omits sections that have no data", () => {
    const md = evalFailureMarkdown({
      test_id: "test_x",
      failed_evaluators: [],
      step_errors: [],
      turns: [],
    });
    expect(md).not.toMatch(/Failed evaluators/);
    expect(md).not.toMatch(/Step errors/);
    expect(md).not.toMatch(/Turn /);
    expect(md).not.toMatch(/traces:/);
  });
});
