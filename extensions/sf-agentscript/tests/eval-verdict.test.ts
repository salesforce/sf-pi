/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { compileEvalScenario } from "../lib/eval/scenario.ts";
import { deriveEvalVerdict } from "../lib/eval/verdict.ts";
import type { EvalApiResponse, EvalSpec } from "../lib/eval/types.ts";

function spec(
  evaluators: Array<{ id: string; type?: string }> = [{ id: "response_ok" }],
): EvalSpec {
  return {
    tests: [
      {
        id: "scenario",
        steps: [
          { type: "agent.create_session", id: "session" },
          { type: "agent.send_message", id: "turn1", utterance: "hello" },
          ...evaluators.map((entry) => ({
            type: entry.type ?? "evaluator.string_assertion",
            id: entry.id,
          })),
        ],
      },
    ],
  };
}

function response(results: EvalApiResponse["results"]): EvalApiResponse {
  return { results };
}

describe("deriveEvalVerdict", () => {
  it("passes only when every expected scenario and evaluator returns effectively true", () => {
    const result = deriveEvalVerdict(
      spec(),
      response([
        {
          id: "scenario",
          evaluation_results: [
            { id: "response_ok", type: "evaluator.string_assertion", is_pass: true },
          ],
        },
      ]),
    );

    expect(result.verdict).toBe("passed");
    expect(result.scenarios[0]?.verdict).toBe("passed");
  });

  it("fails a generated action check on a turn that invoked no action", () => {
    // The evaluation result below is the live Evaluation API's shape for a
    // turn with no action: the name projection resolves to [] and
    // includes_items scores 0, so a missing action is never a pass.
    const generated = compileEvalScenario({
      id: "scenario",
      turns: [
        {
          utterance: "What can you help me with?",
          action: { id: "eval_action", expected: "lookup_balance" },
        },
      ],
    });
    const check = generated.steps.find((step) => step.id === "eval_action");
    expect(check).toMatchObject({
      type: "evaluator.list_assertion",
      operator: "includes_items",
      expected: ["lookup_balance"],
    });

    const result = deriveEvalVerdict(
      { tests: [generated] },
      response([
        {
          id: "scenario",
          evaluation_results: [
            {
              id: "eval_action",
              type: "evaluator.list_assertion",
              is_pass: false,
              score: 0,
              actual_value: [] as unknown as string,
              expected_value: ["lookup_balance"] as unknown as string,
            },
          ],
        },
      ]),
    );

    expect(result.verdict).toBe("failed");
  });

  it("marks missing scenario or evaluator evidence incomplete", () => {
    expect(deriveEvalVerdict(spec(), response([])).verdict).toBe("incomplete");
    expect(
      deriveEvalVerdict(spec(), response([{ id: "scenario", evaluation_results: [] }])).verdict,
    ).toBe("incomplete");
  });

  it("uses Incomplete before Failed before Unverified before Passed", () => {
    const mixed = spec([
      { id: "failed" },
      { id: "missing" },
      { id: "unknown", type: "evaluator.future_metric" },
    ]);
    const result = deriveEvalVerdict(
      mixed,
      response([
        {
          id: "scenario",
          evaluation_results: [
            { id: "failed", type: "evaluator.string_assertion", is_pass: false },
            { id: "unknown", type: "evaluator.future_metric", is_pass: null },
          ],
        },
      ]),
    );
    expect(result.verdict).toBe("incomplete");

    const failed = deriveEvalVerdict(
      spec([{ id: "failed" }, { id: "unknown", type: "evaluator.future_metric" }]),
      response([
        {
          id: "scenario",
          evaluation_results: [
            { id: "failed", type: "evaluator.string_assertion", is_pass: false },
            { id: "unknown", type: "evaluator.future_metric", is_pass: null },
          ],
        },
      ]),
    );
    expect(failed.verdict).toBe("failed");
  });

  it("keeps candidate passes unverified but preserves explicit candidate failure", () => {
    const result = deriveEvalVerdict(
      spec([{ id: "candidate", type: "evaluator.future_metric" }]),
      response([
        {
          id: "scenario",
          evaluation_results: [{ id: "candidate", type: "evaluator.future_metric", is_pass: true }],
        },
      ]),
    );
    expect(result.verdict).toBe("unverified");
    const failed = deriveEvalVerdict(
      spec([{ id: "candidate", type: "evaluator.future_metric" }]),
      response([
        {
          id: "scenario",
          evaluation_results: [
            { id: "candidate", type: "evaluator.future_metric", is_pass: false },
          ],
        },
      ]),
    );
    expect(failed.verdict).toBe("failed");
  });

  it("implements the complete any-of truth table", () => {
    const anyOf = spec([{ id: "intent__opt0" }, { id: "intent__opt1" }]);
    const run = (
      members: Array<{ id: string; is_pass?: boolean | null; error_message?: string }>,
    ) =>
      deriveEvalVerdict(
        anyOf,
        response([
          {
            id: "scenario",
            evaluation_results: members.map((member) => ({
              ...member,
              type: "evaluator.string_assertion",
            })),
          },
        ]),
      ).verdict;

    expect(
      run([
        { id: "intent__opt0", is_pass: true },
        { id: "intent__opt1", is_pass: null },
      ]),
    ).toBe("passed");
    expect(
      run([
        { id: "intent__opt0", is_pass: false },
        { id: "intent__opt1", is_pass: null },
      ]),
    ).toBe("unverified");
    expect(
      run([
        { id: "intent__opt0", is_pass: false },
        { id: "intent__opt1", error_message: "evaluator unavailable" },
      ]),
    ).toBe("incomplete");
    expect(
      run([
        { id: "intent__opt0", is_pass: false },
        { id: "intent__opt1", is_pass: false },
      ]),
    ).toBe("failed");
  });

  it("keeps generated bot response rating evidence release-capable", () => {
    const generated = compileEvalScenario({
      id: "generated",
      turns: [
        {
          utterance: "Show the next step",
          response: { id: "rating", rubric: "Explains the next step clearly" },
        },
      ],
    });
    const result = deriveEvalVerdict(
      { tests: [generated] },
      response([
        {
          id: "generated",
          evaluation_results: [
            { id: "rating", type: "evaluator.bot_response_rating", is_pass: true },
          ],
        },
      ]),
    );
    expect(result.verdict).toBe("passed");
  });

  it("enforces deterministic turn response integrity when suite severity is error", () => {
    const strict: EvalSpec = {
      ...spec(),
      sf_pi: {
        turn_response_integrity: {
          max_nonempty_llm_contents: 1,
          severity: "error",
        },
      },
    };
    strict.tests[0].steps.splice(2, 0, { type: "agent.get_state", id: "state1" });
    const result = deriveEvalVerdict(
      strict,
      response([
        {
          id: "scenario",
          outputs: [
            { type: "agent.send_message", id: "turn1", response: "Final" },
            {
              type: "agent.get_state",
              id: "state1",
              response: {
                planner_response: {
                  lastExecution: {
                    agentResponse: "Final",
                    llmEvents: [
                      [
                        { prompt_response: JSON.stringify({ content: "Intermediate" }) },
                        { prompt_response: JSON.stringify({ content: "Final" }) },
                      ],
                    ],
                  },
                },
              },
            },
          ],
          evaluation_results: [
            { id: "response_ok", type: "evaluator.string_assertion", is_pass: true },
          ],
        },
      ]),
    );

    expect(result.verdict).toBe("failed");
    expect(result.response_integrity).toMatchObject({
      verdict: "failed",
      policy: { max_nonempty_llm_contents: 1, severity: "error" },
    });
    expect(result.response_integrity?.summary.turns_warning).toBe(1);
  });

  it("marks missing strict response-integrity evidence incomplete", () => {
    const strict: EvalSpec = {
      ...spec(),
      sf_pi: {
        turn_response_integrity: {
          max_nonempty_llm_contents: 1,
          severity: "error",
        },
      },
    };
    const result = deriveEvalVerdict(
      strict,
      response([
        {
          id: "scenario",
          outputs: [{ type: "agent.send_message", id: "turn1", response: "Final" }],
          evaluation_results: [
            { id: "response_ok", type: "evaluator.string_assertion", is_pass: true },
          ],
        },
      ]),
    );

    expect(result.verdict).toBe("incomplete");
    expect(result.response_integrity?.verdict).toBe("incomplete");
  });

  it("keeps warning response-integrity policy advisory", () => {
    const advisory: EvalSpec = {
      ...spec(),
      sf_pi: {
        turn_response_integrity: {
          max_nonempty_llm_contents: 1,
          severity: "warning",
        },
      },
    };
    const result = deriveEvalVerdict(
      advisory,
      response([
        {
          id: "scenario",
          outputs: [
            { type: "agent.send_message", id: "turn1", response: "Final" },
            {
              type: "agent.get_state",
              id: "state1",
              response: {
                planner_response: {
                  lastExecution: {
                    agentResponse: "Final",
                    llmEvents: [
                      [
                        { prompt_response: JSON.stringify({ content: "Intermediate" }) },
                        { prompt_response: JSON.stringify({ content: "Final" }) },
                      ],
                    ],
                  },
                },
              },
            },
          ],
          evaluation_results: [
            { id: "response_ok", type: "evaluator.string_assertion", is_pass: true },
          ],
        },
      ]),
    );

    expect(result.response_integrity?.verdict).toBe("failed");
    expect(result.verdict).toBe("passed");
  });

  it("marks duplicate/extra results and failed batches incomplete", () => {
    const duplicate = response([
      {
        id: "scenario",
        evaluation_results: [
          { id: "response_ok", type: "evaluator.string_assertion", is_pass: true },
          { id: "response_ok", type: "evaluator.string_assertion", is_pass: true },
        ],
      },
    ]);
    expect(deriveEvalVerdict(spec(), duplicate).verdict).toBe("incomplete");
    expect(deriveEvalVerdict(spec(), duplicate, { failedBatches: 1 }).verdict).toBe("incomplete");
  });
});
