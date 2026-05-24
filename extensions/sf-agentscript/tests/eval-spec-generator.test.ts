/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Spec generator unit tests. Inputs are synthesized inspect results so we
 * pin behavior independently of SDK parsing — the spec generator's job is
 * shape, not parse.
 */

import { describe, expect, test } from "vitest";
import { generateSpec, type GenerateSpecOptions } from "../lib/eval/spec-generator.ts";
import type { InspectResult } from "../lib/inspect.ts";
import { SAFETY_PROBES, GUARDRAIL_PROBE } from "../lib/eval/safety-probes.ts";

function fakeInspect(overrides: Partial<InspectResult["components"]> = {}): InspectResult {
  return {
    ok: true,
    components: {
      topics: [],
      subagents: [],
      variables: [],
      actions: [],
      ...overrides,
    },
    stats: {
      topics: 0,
      subagents: (overrides.subagents ?? []).length,
      variables: 0,
      actions: (overrides.actions ?? []).length,
    },
  };
}

describe("generateSpec", () => {
  test("empty agent → only safety + guardrail rows by default", () => {
    const out = generateSpec({ inspect: fakeInspect() });
    expect(out.summary.subagent_tests).toBe(0);
    expect(out.summary.topic_tests).toBe(0);
    expect(out.summary.routing_tests).toBe(0);
    expect(out.summary.action_tests).toBe(0);
    expect(out.summary.guardrail_tests).toBe(1);
    expect(out.summary.safety_tests).toBe(SAFETY_PROBES.length);
    // Total = guardrail (1) + safety probes
    expect(out.spec.tests.length).toBe(1 + SAFETY_PROBES.length);
  });

  test("emits one routing test per non-start subagent and legacy topic", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        topics: [{ name: "orders", description: "Tracks orders." }],
        subagents: [
          { name: "start_agent", description: "Routing dispatcher." },
          { name: "billing", description: "Handles billing inquiries." },
          { name: "appointments", description: "Books and reschedules service appointments." },
        ],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(out.summary.subagent_tests).toBe(2);
    expect(out.summary.topic_tests).toBe(1);
    expect(out.summary.routing_tests).toBe(3);
    expect(out.summary.skipped_subagents).toEqual(["start_agent"]);
    expect(out.spec.tests.map((t) => t.id)).toEqual([
      "subagent_billing",
      "subagent_appointments",
      "topic_orders",
    ]);
  });

  test("subagent send_message uses session JSONPath; topic assertion uses state output", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        subagents: [{ name: "billing", description: "Handles billing." }],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    const test = out.spec.tests[0];
    const send = test.steps.find((s) => s.type === "agent.send_message")!;
    expect(send.session_id).toBe("$.outputs[0].session_id");
    expect(send.utterance).toContain("route me to the billing path");
    expect(send.utterance).toContain("handles billing");

    const assert = test.steps.find((s) => s.type === "evaluator.string_assertion")!;
    expect(assert.actual).toBe("{state1.response.planner_response.lastExecution.topic}");
    expect(assert.expected).toBe("billing");
    expect(assert.operator).toBe("equals");
  });

  test("uses $active_* placeholders on agent.create_session (no hardcoded ids)", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        subagents: [{ name: "billing", description: "Handles billing." }],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    const session = out.spec.tests[0].steps[0];
    expect(session.type).toBe("agent.create_session");
    expect(session.planner_id).toBe("$active_planner_id");
    const tags = (session.setupSessionContext as { tags?: Record<string, string> }).tags ?? {};
    expect(tags.botId).toBe("$active_bot_id");
    expect(tags.botVersionId).toBe("$active_bot_version_id");
  });

  test("attaches default context_variables to every send_message when provided", () => {
    const opts: GenerateSpecOptions = {
      inspect: fakeInspect({
        subagents: [{ name: "billing", description: "Handles billing." }],
      }),
      contextVariables: [
        { name: "verified_check", value: "true" },
        { name: "RoutableId", type: "Text", value: "0Mwbb00000ABCDEF" },
      ],
    };
    const out = generateSpec(opts);
    for (const test of out.spec.tests) {
      const sendSteps = test.steps.filter((s) => s.type === "agent.send_message");
      for (const send of sendSteps) {
        expect(send.context_variables).toEqual([
          { name: "verified_check", type: "Text", value: "true" },
          { name: "RoutableId", type: "Text", value: "0Mwbb00000ABCDEF" },
        ]);
      }
    }
  });

  test("no context_variables key when seeds are empty (keeps generated specs minimal)", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        subagents: [{ name: "billing", description: "Handles billing." }],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    const send = out.spec.tests[0].steps.find((s) => s.type === "agent.send_message")!;
    expect("context_variables" in send).toBe(false);
  });

  test("legacy topic probes omit exact topic assertions", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        topics: [{ name: "orders", description: "Tracks orders." }],
      }),
      includeActionTests: false,
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(out.spec.tests[0].id).toBe("topic_orders");
    expect(out.spec.tests[0].steps.some((s) => s.type === "evaluator.string_assertion")).toBe(
      false,
    );
    expect(out.spec.tests[0].steps.some((s) => s.type === "evaluator.bot_response_rating")).toBe(
      true,
    );
  });

  test("action probes include inline and top-level actions with a target", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        subagents: [],
        actions: [
          {
            name: "lookup_balance",
            description: "Look up the customer's current balance.",
            target: "apex://LookupBalance",
          },
          // Inline action — still useful as a direct action-invocation smoke row.
          {
            name: "send_email",
            description: "Send confirmation email.",
            target: "flow://SendEmail",
            parent: "subagent.notifications",
          },
          // No target → skipped.
          { name: "describe_thing", description: "No target." },
        ],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(out.summary.action_tests).toBe(2);
    expect(out.summary.skipped_actions).toEqual(["describe_thing"]);
    expect(out.spec.tests.map((t) => t.id)).toEqual(["action_lookup_balance", "action_send_email"]);
    expect(out.spec.tests[0].steps.some((s) => s.type === "evaluator.string_assertion")).toBe(
      false,
    );
    const rating = out.spec.tests[0].steps.find((s) => s.type === "evaluator.bot_response_rating")!;
    expect(rating.expected).toMatch(/attempt the "lookup_balance" action/);
  });

  test("safety probes are included by default and use bot_response_rating", () => {
    const out = generateSpec({ inspect: fakeInspect() });
    const safetyIds = SAFETY_PROBES.map((p) => p.id);
    const generatedIds = out.spec.tests.map((t) => t.id);
    for (const id of safetyIds) {
      expect(generatedIds).toContain(id);
    }
    // Each safety test has exactly one bot_response_rating evaluator.
    for (const t of out.spec.tests.filter((t) => safetyIds.includes(t.id))) {
      const evals = t.steps.filter((s) => s.type === "evaluator.bot_response_rating");
      expect(evals.length).toBe(1);
    }
  });

  test("bot_response_rating carries every required wire field (regression: API rejects without actual + utterance, scores 0 with the wrong actual path)", () => {
    // Verified against the live eval API on Example_Service_Assistant:
    //   - omitting actual + utterance → HTTP 422 'Field required'
    //   - `actual: {turnId.response}` → HTTP 200 but score 0 with
    //     'bot response is not provided'
    //   - `actual: {stateId.response.planner_response.lastExecution.message.message}`
    //     → HTTP 200 with a real LLM-judge score (5.0 polite/relevant)
    const out = generateSpec({
      inspect: fakeInspect({
        subagents: [{ name: "billing", description: "Handles billing." }],
      }),
    });
    for (const test of out.spec.tests) {
      for (const step of test.steps) {
        if (step.type !== "evaluator.bot_response_rating") continue;
        expect(step).toMatchObject({
          type: "evaluator.bot_response_rating",
          utterance: expect.any(String),
          actual: expect.stringMatching(
            /^\{state\d+\.response\.planner_response\.lastExecution\.message\.message\}$/,
          ),
          expected: expect.any(String),
          threshold: 3,
        });
        expect((step as unknown as { utterance: string }).utterance.length).toBeGreaterThan(0);
        // operator is intentionally omitted — API defaults greater_than_or_equal.
        expect((step as unknown as { operator?: unknown }).operator).toBeUndefined();
      }
    }
  });

  test("safety probes include a get_state step (so bot_response_rating has a state ref to read from)", () => {
    const out = generateSpec({
      inspect: fakeInspect(),
      includeGuardrail: false,
      includeSafetyProbes: true,
    });
    for (const t of out.spec.tests) {
      const types = t.steps.map((s) => s.type);
      expect(types).toContain("agent.create_session");
      expect(types).toContain("agent.send_message");
      expect(types).toContain("agent.get_state");
      expect(types).toContain("evaluator.bot_response_rating");
    }
  });

  test("max_functional_tests caps subagent + action rows", () => {
    const subagents = Array.from({ length: 30 }, (_, i) => ({
      name: `sa_${i}`,
      description: `Subagent ${i}.`,
    }));
    const out = generateSpec({
      inspect: fakeInspect({ subagents }),
      maxFunctionalTests: 5,
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(out.summary.subagent_tests).toBe(5);
  });

  test("refuses to generate when inspect failed", () => {
    expect(() =>
      generateSpec({
        inspect: { ok: false, reason: "parse_failed" },
      }),
    ).toThrow(/inspect result is not OK/);
  });

  test("guardrail probe is the curated GUARDRAIL_PROBE", () => {
    const out = generateSpec({
      inspect: fakeInspect(),
      includeSafetyProbes: false,
    });
    expect(out.spec.tests.length).toBe(1);
    expect(out.spec.tests[0].id).toBe(GUARDRAIL_PROBE.id);
  });

  test("subagent ids are stable (slugified once)", () => {
    const out1 = generateSpec({
      inspect: fakeInspect({
        subagents: [{ name: "BillingTopic", description: "Billing." }],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    const out2 = generateSpec({
      inspect: fakeInspect({
        subagents: [{ name: "BillingTopic", description: "Billing." }],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(out1.spec.tests[0].id).toBe("subagent_billing_topic");
    expect(out1.spec.tests[0].id).toBe(out2.spec.tests[0].id);
  });
});
