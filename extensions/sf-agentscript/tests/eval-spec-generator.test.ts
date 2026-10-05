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
  test("generated Voice suites default to strict one-response-per-turn evidence", () => {
    const out = generateSpec({
      inspect: fakeInspect({ modalities: [{ name: "voice", fields: {} }] }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(out.spec.sf_pi).toEqual({
      turn_response_integrity: {
        max_nonempty_llm_contents: 1,
        severity: "error",
      },
    });
    expect(out.spec.tests.map((test) => test.id)).toEqual(["voice_greeting", "voice_distress"]);
    expect(out.summary.voice_tests).toBe(2);
    for (const test of out.spec.tests) {
      expect(test.steps.some((step) => step.type === "agent.get_state")).toBe(true);
      expect(test.steps.some((step) => step.type === "evaluator.bot_response_rating")).toBe(true);
    }
  });

  test("non-Voice generated suites remain policy-neutral", () => {
    expect(generateSpec({ inspect: fakeInspect() }).spec.sf_pi).toBeUndefined();
  });

  test("empty agent → only safety + guardrail rows by default", () => {
    const out = generateSpec({ inspect: fakeInspect() });
    expect(out.summary.subagent_tests).toBe(0);
    expect(out.summary.topic_tests).toBe(0);
    expect(out.summary.routing_tests).toBe(0);
    expect(out.summary.action_tests).toBe(0);
    expect(out.summary.connected_agent_tests).toBe(0);
    expect(out.summary.multi_turn_tests).toBe(0);
    expect(out.summary.skipped_multi_turn).toEqual([]);
    expect(out.summary.guardrail_tests).toBe(1);
    expect(out.summary.safety_tests).toBe(SAFETY_PROBES.length);
    // Total = guardrail (1) + safety probes
    expect(out.spec.tests.length).toBe(1 + SAFETY_PROBES.length);
  });

  test("skips subagents that are not directly reachable from the start agent", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        start_agents: [
          {
            name: "agent_router",
            subagent_refs: ["billing"],
          },
        ],
        subagents: [
          { name: "billing", description: "Handles billing." },
          { name: "farewell", description: "Ends after feedback." },
        ],
      }),
      includeActionTests: false,
      includeSafetyProbes: false,
      includeGuardrail: false,
    });

    expect(out.spec.tests.map((test) => test.id)).toEqual(["subagent_billing"]);
    expect(out.summary.skipped_subagents).toContain("farewell");

    const noDirectRefs = generateSpec({
      inspect: fakeInspect({
        start_agents: [{ name: "agent_router", subagent_refs: [] }],
        subagents: [{ name: "billing", description: "Handles billing." }],
      }),
      includeActionTests: false,
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(noDirectRefs.spec.tests).toEqual([]);
    expect(noDirectRefs.summary.skipped_subagents).toEqual(["billing"]);
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
        subagents: [{ name: "billing", description: "Handle billing." }],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    const test = out.spec.tests[0];
    const send = test.steps.find((s) => s.type === "agent.send_message")!;
    expect(send.session_id).toBe("$.outputs[0].session_id");
    expect(send.utterance).toContain("I need help with billing");

    const assert = test.steps.find((s) => s.type === "evaluator.string_assertion")!;
    expect(assert.actual).toBe("{state1.response.planner_response.lastExecution.topic}");
    expect(assert.expected).toBe("billing");
    expect(assert.operator).toBe("equals");
    expect(test.steps.some((step) => step.type === "evaluator.bot_response_rating")).toBe(false);
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

  test("skips inline actions even when their local names are duplicated", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        actions: [
          {
            name: "update_session",
            parent: "subagent.billing",
            target: "flow://UpdateSession",
            description: "Update billing routing.",
          },
          {
            name: "update_session",
            parent: "subagent.shipping",
            target: "flow://UpdateSession",
            description: "Update shipping routing.",
          },
        ],
      }),
      includeSubagentTests: false,
      includeSafetyProbes: false,
      includeGuardrail: false,
    });

    expect(out.spec.tests).toEqual([]);
    expect(out.summary.skipped_actions).toEqual(["update_session", "update_session"]);
  });

  test("action probes include only top-level zero-input actions with a target", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        subagents: [],
        actions: [
          {
            name: "lookup_balance",
            description: "Look up the customer's current balance.",
            target: "apex://LookupBalance",
          },
          // Inline action — requires owning-subagent context, so it is skipped.
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
    expect(out.summary.action_tests).toBe(1);
    expect(out.summary.skipped_actions).toEqual(["send_email", "describe_thing"]);
    expect(out.spec.tests.map((t) => t.id)).toEqual(["action_lookup_balance"]);
    expect(out.spec.tests[0].steps).toContainEqual({
      type: "evaluator.list_assertion",
      id: "eval_action_lookup_balance",
      actual: "{state1.response.planner_response.lastExecution.invokedActions}",
      expected: ["lookup_balance"],
      operator: "contains",
    });
    expect(out.spec.tests[0].steps.some((s) => s.type === "evaluator.bot_response_rating")).toBe(
      false,
    );
  });

  test("skips one-turn action probes that require internal inputs", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        actions: [
          {
            name: "shipment_context",
            description: "Retrieve shipment context.",
            target: "prompt://Shipment_Context",
            input_names: ["Input:WorkOrder"],
          },
        ],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });

    expect(out.spec.tests).toEqual([]);
    expect(out.summary.skipped_actions).toEqual(["shipment_context"]);
  });

  test("connected agents receive functional invocation probes", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        connected_subagents: [
          {
            name: "release_helper",
            description: "Return the release-lab acknowledgement.",
            target: "agent://Release_Helper",
            line: 12,
            has_after_response: false,
          },
        ],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(out.summary.connected_agent_tests).toBe(1);
    expect(out.summary.multi_turn_tests).toBe(0);
    expect(out.summary.skipped_multi_turn).toEqual([]);
    expect(out.spec.tests.map((test) => test.id)).toEqual(["connected_agent_release_helper"]);
    const send = out.spec.tests[0].steps.find((step) => step.type === "agent.send_message")!;
    expect(send.utterance).toContain("return the release-lab acknowledgement");
    const rating = out.spec.tests[0].steps.find(
      (step) => step.type === "evaluator.bot_response_rating",
    )!;
    expect(rating.expected).toMatch(/connected agent/i);
  });

  test("generates a state-grounded two-turn connected-agent scenario", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        variables: [
          { name: "completed", type: "boolean", mutable: true, default: false },
          { name: "attempts", type: "number", mutable: true, default: 0 },
        ],
        start_agents: [
          {
            name: "main",
            state_branches: [
              {
                variable: "completed",
                operator: "truthy",
                expected: true,
                instructions: "Report that the helper completed successfully.",
              },
            ],
          },
        ],
        connected_subagents: [
          {
            name: "release_helper",
            description: "Return the release-lab acknowledgement.",
            target: "agent://Release_Helper",
            line: 12,
            has_after_response: true,
            after_response_updates: [
              { variable: "completed", operation: "set", value: true },
              { variable: "attempts", operation: "increment", amount: 1 },
            ],
          },
        ],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(out.summary.connected_agent_tests).toBe(1);
    expect(out.summary.multi_turn_tests).toBe(1);
    expect(out.summary.skipped_multi_turn).toEqual([]);
    const steps = out.spec.tests[0].steps;
    expect(steps.filter((step) => step.type === "agent.send_message")).toHaveLength(2);
    expect(steps.filter((step) => step.type === "agent.get_state")).toHaveLength(2);
    expect(steps.filter((step) => step.type === "evaluator.numeric_assertion")).toHaveLength(4);
    expect(
      steps.find((step) => step.id === "eval_response_connected_agent_release_helper"),
    ).toBeUndefined();
    expect(
      steps.find((step) => step.id === "eval_second_turn_connected_agent_release_helper"),
    ).toMatchObject({
      actual: "{turn2.response}",
      expected: expect.stringContaining("Report that the helper completed successfully"),
    });
  });

  test("reports an after_response block with no provable update as skipped", () => {
    const out = generateSpec({
      inspect: fakeInspect({
        connected_subagents: [
          {
            name: "dynamic_helper",
            description: "Run dynamic work.",
            target: "agent://Dynamic_Helper",
            line: 12,
            has_after_response: true,
          },
        ],
      }),
      includeSafetyProbes: false,
      includeGuardrail: false,
    });
    expect(out.summary.multi_turn_tests).toBe(0);
    expect(out.summary.skipped_multi_turn).toEqual([
      { component: "dynamic_helper", reason: "no_provable_state_update" },
    ]);
  });

  test("regulated-advice probes accept safe refusal without requiring domain-specific disclaimer wording", () => {
    const regulated = SAFETY_PROBES.filter((probe) => probe.category === "regulated_advice");
    expect(regulated).toHaveLength(2);
    for (const probe of regulated) {
      expect(probe.expected_behavior).toMatch(/safe refusal or redirect/i);
      expect(probe.expected_behavior).toMatch(/does not give specific/i);
    }
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

  test("bot_response_rating carries every required wire field and reads direct send_message response", () => {
    // Live examples showed `agent.get_state.lastExecution.message` can lag
    // behind tool/user-input handoff turns and return the welcome message;
    // `turn1.response` carries the actual response to the generated utterance.
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
          actual: "{turn1.response}",
          expected: expect.any(String),
          threshold: 3,
        });
        expect((step as unknown as { utterance: string }).utterance.length).toBeGreaterThan(0);
        // operator is intentionally omitted — API defaults greater_than_or_equal.
        expect((step as unknown as { operator?: unknown }).operator).toBeUndefined();
      }
    }
  });

  test("safety probes include a get_state step for debugging parity", () => {
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
