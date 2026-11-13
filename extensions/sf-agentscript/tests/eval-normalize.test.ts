/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Per-pass tests for the eval-spec normalizer.
 *
 * Each pass is exercised individually so a regression in one pass shows up
 * in one test, not in a composition snapshot. The composition test at the
 * end pins the pass order and the no-strip behavior (context_variables
 * survives on agent.send_message).
 */

import { describe, expect, test } from "vitest";
import {
  autoCorrectFields,
  convertShorthandRefs,
  injectDefaults,
  normalizeCamelCase,
  normalizeEvaluatorFields,
  normalizeMcpShorthand,
  normalizeSpec,
} from "../lib/eval/normalize.ts";
import type { EvalSpec, EvalStep } from "../lib/eval/types.ts";

describe("normalizeMcpShorthand", () => {
  test("merges evaluator_type into type and rewrites field → actual", () => {
    const out = normalizeMcpShorthand([
      {
        type: "evaluator",
        id: "",
        evaluator_type: "string_assertion",
        field: "sm.response",
      },
    ]);
    expect(out[0]).toMatchObject({
      type: "evaluator.string_assertion",
      actual: "{sm.response}",
      id: "eval_0",
    });
    expect("field" in out[0]).toBe(false);
    expect("evaluator_type" in out[0]).toBe(false);
  });

  test("maps planner_state.topic via MCP_FIELD_MAP", () => {
    const out = normalizeMcpShorthand([
      {
        type: "evaluator",
        id: "x",
        evaluator_type: "string_assertion",
        field: "gs.planner_state.topic",
      },
    ]);
    expect(out[0].actual).toBe("{gs.response.planner_response.lastExecution.topic}");
  });

  test("leaves non-evaluator steps untouched", () => {
    const step: EvalStep = { type: "agent.send_message", id: "sm", utterance: "hi" };
    expect(normalizeMcpShorthand([step])).toEqual([step]);
  });
});

describe("autoCorrectFields", () => {
  test("agent.* corrections", () => {
    const out = autoCorrectFields([
      { type: "agent.send_message", id: "sm", text: "hi", agentId: "0Xx", sessionId: "abc" },
    ]);
    expect(out[0]).toMatchObject({ utterance: "hi", agent_id: "0Xx", session_id: "abc" });
    expect("text" in out[0]).toBe(false);
    expect("agentId" in out[0]).toBe(false);
  });

  test("evaluator.* corrections", () => {
    const out = autoCorrectFields([
      {
        type: "evaluator.string_assertion",
        id: "e",
        subject: "x",
        expectedValue: "y",
        comparator: "EQUALS",
      },
    ]);
    expect(out[0]).toMatchObject({ actual: "x", expected: "y", operator: "EQUALS" });
  });

  test("never overwrites an existing canonical key", () => {
    const out = autoCorrectFields([
      { type: "agent.send_message", id: "sm", text: "wrong", utterance: "right" },
    ]);
    expect(out[0].utterance).toBe("right");
    expect("text" in out[0]).toBe(false);
  });
});

describe("normalizeCamelCase", () => {
  test("agent.create_session: useAgentApi → use_agent_api", () => {
    const out = normalizeCamelCase([{ type: "agent.create_session", id: "cs", useAgentApi: true }]);
    expect(out[0]).toMatchObject({ use_agent_api: true });
    expect("useAgentApi" in out[0]).toBe(false);
  });

  test("planner alias variants collapse to planner_id", () => {
    const out = normalizeCamelCase([
      { type: "agent.create_session", id: "cs", plannerVersionId: "0Yp" },
    ]);
    expect(out[0].planner_id).toBe("0Yp");
    expect("plannerVersionId" in out[0]).toBe(false);
  });

  test("does not touch non-create_session steps", () => {
    const step: EvalStep = { type: "agent.send_message", id: "sm", useAgentApi: true };
    expect(normalizeCamelCase([step])).toEqual([step]);
  });
});

describe("normalizeEvaluatorFields", () => {
  test("scoring evaluator: actual/expected → generated_output/reference_answer + default metric_name", () => {
    const out = normalizeEvaluatorFields([
      {
        type: "evaluator.text_alignment",
        id: "ta",
        actual: "x",
        expected: "y",
        threshold: 0.8,
      },
    ]);
    expect(out[0]).toMatchObject({
      generated_output: "x",
      reference_answer: "y",
      metric_name: "base.cosine_similarity",
    });
    expect("actual" in out[0]).toBe(false);
  });

  test("assertion evaluator: lowercases operator + injects metric_name", () => {
    const out = normalizeEvaluatorFields([
      {
        type: "evaluator.string_assertion",
        id: "sa",
        actual: "x",
        expected: "y",
        operator: "EQUALS",
      },
    ]);
    expect(out[0]).toMatchObject({
      operator: "equals",
      metric_name: "string_assertion",
    });
  });

  test("numeric assertion normalizes aliases and operator", () => {
    const out = normalizeEvaluatorFields(
      autoCorrectFields([
        {
          type: "evaluator.numeric_assertion",
          id: "na",
          actualValue: "{state.value}",
          expectedValue: 1,
          comparator: "EQUALS",
        },
      ]),
    );
    expect(out[0]).toMatchObject({
      actual: "{state.value}",
      expected: 1,
      operator: "equals",
    });
    expect("metric_name" in out[0]).toBe(false);
  });

  test("accepts each live operator for list, string, and numeric assertions", () => {
    const listOps = [
      "exact_match_with_order",
      "exact_match_without_order",
      "includes_items",
      "superset",
      "item_in",
      "not_equals",
      "not_contains",
    ];
    const stringOps = [
      "equals",
      "contains",
      "startswith",
      "endswith",
      "regex_match",
      "not_contains",
      "not_equals",
    ];
    const numericOps = [
      "equals",
      "greater_than_or_equal",
      "greater_than",
      "less_than",
      "less_than_or_equal",
      "not_equals",
    ];
    const steps: EvalStep[] = [
      ...listOps.map((operator) => ({
        type: "evaluator.list_assertion",
        id: `l_${operator}`,
        actual: "x",
        expected: ["y"],
        operator: operator.toUpperCase(),
      })),
      ...stringOps.map((operator) => ({
        type: "evaluator.string_assertion",
        id: `s_${operator}`,
        actual: "x",
        expected: "y",
        operator,
      })),
      ...numericOps.map((operator) => ({
        type: "evaluator.numeric_assertion",
        id: `n_${operator}`,
        actual: "x",
        expected: 1,
        operator,
      })),
    ];
    const out = normalizeEvaluatorFields(steps);
    expect(out.map((step) => step.operator)).toEqual([...listOps, ...stringOps, ...numericOps]);
  });

  test("rejects list_assertion `contains` before a network call, naming the allowed operators", () => {
    expect(() =>
      normalizeEvaluatorFields([
        {
          type: "evaluator.list_assertion",
          id: "eval_action_lookup",
          actual: "x",
          expected: ["lookup"],
          operator: "contains",
        },
      ]),
    ).toThrow(
      'evaluator.list_assertion operator "contains" (step "eval_action_lookup") is not accepted by the live Evaluation API. ' +
        "Allowed operators: exact_match_with_order, exact_match_without_order, includes_items, superset, item_in, not_equals, not_contains.",
    );
  });

  test("rejects invalid string and numeric operators, and non-string operators", () => {
    const assertion = (type: string, operator: unknown): EvalStep => ({
      type,
      id: "a",
      actual: "x",
      expected: "y",
      operator,
    });
    expect(() =>
      normalizeEvaluatorFields([assertion("evaluator.string_assertion", "includes_items")]),
    ).toThrow(/string_assertion operator "includes_items".*Allowed operators: equals, contains,/);
    expect(() =>
      normalizeEvaluatorFields([assertion("evaluator.numeric_assertion", "contains")]),
    ).toThrow(
      /numeric_assertion operator "contains".*Allowed operators: equals, greater_than_or_equal,/,
    );
    expect(() => normalizeEvaluatorFields([assertion("evaluator.list_assertion", 1)])).toThrow(
      /list_assertion operator 1 .*Allowed operators/,
    );
  });

  test("leaves a missing operator for the API to report", () => {
    const out = normalizeEvaluatorFields([
      { type: "evaluator.list_assertion", id: "l", actual: "x", expected: ["y"] },
    ]);
    expect("operator" in out[0]).toBe(false);
  });

  test("normalizeSpec fails the whole spec locally on an invalid operator", () => {
    const spec: EvalSpec = {
      tests: [
        {
          id: "t",
          steps: [
            {
              type: "evaluator.list_assertion",
              id: "l",
              actual: "x",
              expected: ["y"],
              operator: "contains",
            },
          ],
        },
      ],
    };
    expect(() => normalizeSpec(spec)).toThrow(/Allowed operators: exact_match_with_order/);
  });

  test("unknown evaluator types are left alone (no metric_name injection)", () => {
    const step: EvalStep = {
      type: "evaluator.bot_response_rating",
      id: "br",
      actual: "x",
      expected: "y",
      threshold: 3,
    };
    const out = normalizeEvaluatorFields([step]);
    expect("metric_name" in out[0]).toBe(false);
  });
});

describe("convertShorthandRefs", () => {
  test("rewrites {stepId.field} to JSONPath using non-evaluator output indices", () => {
    const out = convertShorthandRefs([
      { type: "agent.create_session", id: "cs" },
      { type: "agent.send_message", id: "sm", session_id: "{cs.session_id}", utterance: "hi" },
      {
        type: "evaluator.string_assertion",
        id: "check",
        actual: "{sm.response}",
        expected: "ok",
        operator: "contains",
      },
    ]);
    expect(out[1].session_id).toBe("$.outputs[0].session_id");
    expect(out[2].actual).toBe("$.outputs[1].response");
  });

  test("collapses legacy response.messages prefix to flat response", () => {
    const out = convertShorthandRefs([
      { type: "agent.send_message", id: "sm", session_id: "x", utterance: "hi" },
      {
        type: "evaluator.string_assertion",
        id: "e",
        actual: "{sm.response.messages.0.text}",
        expected: "ok",
        operator: "contains",
      },
    ]);
    expect(out[1].actual).toBe("$.outputs[0].response");
  });

  test("leaves unknown step-ids untouched", () => {
    const out = convertShorthandRefs([
      {
        type: "evaluator.string_assertion",
        id: "e",
        actual: "{ghost.field}",
        expected: "ok",
        operator: "contains",
      },
    ]);
    expect(out[0].actual).toBe("{ghost.field}");
  });
});

describe("injectDefaults", () => {
  test("sets use_agent_api=true when neither use_agent_api nor planner_id is set", () => {
    const out = injectDefaults([{ type: "agent.create_session", id: "cs" }]);
    expect(out[0].use_agent_api).toBe(true);
  });

  test("does not override an explicit use_agent_api=false", () => {
    const out = injectDefaults([{ type: "agent.create_session", id: "cs", use_agent_api: false }]);
    expect(out[0].use_agent_api).toBe(false);
  });

  test("does not inject when planner_id is provided", () => {
    const out = injectDefaults([{ type: "agent.create_session", id: "cs", planner_id: "0Yp" }]);
    expect("use_agent_api" in out[0]).toBe(false);
  });
});

describe("normalizeSpec composition", () => {
  test("rejects unsupported json_assertion before a network call", () => {
    const spec: EvalSpec = {
      tests: [
        {
          id: "bad",
          steps: [
            {
              type: "evaluator.json_assertion",
              id: "json",
              actual: "$.value",
              expected: true,
            },
          ],
        },
      ],
    };
    expect(() => normalizeSpec(spec)).toThrow(/json_assertion.*not supported/i);
  });

  test("runs all six passes in order on a realistic spec", () => {
    const spec: EvalSpec = {
      tests: [
        {
          id: "t1",
          steps: [
            { type: "agent.create_session", id: "cs", useAgentApi: true },
            {
              type: "agent.send_message",
              id: "sm",
              sessionId: "{cs.session_id}",
              text: "what's my balance?",
              context_variables: { is_verified: false },
            },
            {
              type: "evaluator",
              id: "",
              evaluator_type: "string_assertion",
              field: "sm.response",
              expectedValue: "balance",
              comparator: "CONTAINS",
            },
          ],
        },
      ],
    };

    const out = normalizeSpec(spec);
    const steps = out.tests[0].steps;

    // Pass 3: useAgentApi → use_agent_api
    expect(steps[0]).toMatchObject({ use_agent_api: true });

    // Pass 2: text → utterance, sessionId → session_id
    // Pass 5: {cs.session_id} → $.outputs[0].session_id
    expect(steps[1]).toMatchObject({
      utterance: "what's my balance?",
      session_id: "$.outputs[0].session_id",
      // Mutable-seed workaround: context_variables survives.
      context_variables: { is_verified: false },
    });

    // Pass 1: evaluator + evaluator_type → evaluator.string_assertion + actual
    // Pass 2: expectedValue → expected, comparator → operator
    // Pass 4: lowercase operator + metric_name inject
    // Pass 5: {sm.response} → $.outputs[1].response (since sm is the 2nd non-evaluator step)
    expect(steps[2]).toMatchObject({
      type: "evaluator.string_assertion",
      actual: "$.outputs[1].response",
      expected: "balance",
      operator: "contains",
      metric_name: "string_assertion",
    });
  });

  test("preserves context_variables on agent.send_message (no stripUnrecognizedFields)", () => {
    const spec: EvalSpec = {
      tests: [
        {
          id: "t1",
          steps: [
            {
              type: "agent.send_message",
              id: "sm",
              session_id: "x",
              utterance: "hi",
              context_variables: { foo: "bar" },
            },
          ],
        },
      ],
    };
    const out = normalizeSpec(spec);
    expect(out.tests[0].steps[0].context_variables).toEqual({ foo: "bar" });
  });
});
