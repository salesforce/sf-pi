/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pin the synthesized-trace contract.
 *
 * Inputs are shaped from a real eval-API response (sanitized — only
 * structural shape kept). The synthesizer's job is:
 *
 *   - read planId from sessionProperties (NOT lastExecution.message)
 *   - flatten the doubly-nested llmEvents shape
 *   - emit one step per (utterance, llm event, invoked action, error,
 *     state-variable diff, planner response)
 *   - filter internal `__*` and `AgentScriptInternal_*` variables
 *   - diff state variables across turns within the same test
 *   - mirror the surface fields (topic, agentResponse, latency,
 *     stateVariables) at the top level so consumers don't have to walk
 *     the timeline for surface info
 */

import { describe, expect, test } from "vitest";
import {
  synthesizeTracesForTest,
  synthesizeTracesFromMerged,
  type SynthesizedTrace,
} from "../lib/eval/synthesize-trace.ts";
import type { EvalApiResponse, TestResult } from "../lib/eval/types.ts";

function sampleTest(): TestResult {
  return {
    id: "trace_probe",
    outputs: [
      {
        type: "agent.create_session",
        id: "session",
        session_id: "SID-1",
      },
      {
        type: "agent.send_message",
        id: "turn1",
        utterance: "hello",
      },
      {
        type: "agent.get_state",
        id: "state1",
        response: {
          planner_response: {
            sessionProperties: { planId: "PID-1", sessionId: "SID-1" },
            lastExecution: {
              topic: "account_validation",
              userUtterance: "hello",
              agentResponse: "I need to verify your account first.",
              latency: 2512,
              invokedActions: [{ name: "verify_customer", inputs: {}, outputs: {} }],
              errors: [],
              llmEvents: [
                [
                  {
                    agent_name: "account_validation",
                    prompt_name: "account_validation_prompt",
                    prompt_content: "system: Specialized Topic Agent...",
                    prompt_response: "I need to verify your account first.",
                    execution_latency: 1943,
                    startExecutionTime: 1778807523703,
                    endExecutionTime: 1778807525646,
                  },
                ],
              ],
              message: {
                messageType: "InformResponseMessage",
                id: "MID-1",
                feedbackId: "FB-1",
                citedReferences: [],
              },
            },
            sessionContext: {
              executionHistory: [{ topic: "account_validation", invokedActions: [] }],
              stateVariables: {
                __resolved_locale__: "en_US",
                AgentScriptInternal_condition: false,
                verified_check: "false",
                customer_name: "Test",
                billing_link_url: "",
              },
            },
          },
        } as never,
      },
    ],
    evaluation_results: [],
    errors: [],
  };
}

describe("synthesizeTracesForTest", () => {
  test("emits one synthesized trace per (send_message, get_state) pair", () => {
    const out = synthesizeTracesForTest(sampleTest());
    expect(out.length).toBe(1);
    const t = out[0];
    expect(t.source).toBe("synthesized-from-eval-api");
    expect(t.planId).toBe("PID-1");
    expect(t.sessionId).toBe("SID-1");
  });

  test("plan timeline includes UserInput, LLMExecution, FunctionStep, VariableUpdate, PlannerResponse", () => {
    const t = synthesizeTracesForTest(sampleTest())[0];
    const types = t.plan.map((s) => s.type);
    expect(types).toContain("UserInputStep");
    expect(types).toContain("LLMExecutionStep");
    expect(types).toContain("FunctionStep");
    expect(types).toContain("VariableUpdateStep");
    expect(types).toContain("PlannerResponseStep");
  });

  test("UserInputStep carries the utterance from the spec", () => {
    const t = synthesizeTracesForTest(sampleTest())[0];
    const step = t.plan.find((s) => s.type === "UserInputStep")!;
    expect(step.data).toEqual({ utterance: "hello" });
  });

  test("LLMExecutionStep flattens the doubly-nested llmEvents shape", () => {
    const t = synthesizeTracesForTest(sampleTest())[0];
    const llm = t.plan.filter((s) => s.type === "LLMExecutionStep");
    expect(llm.length).toBe(1);
    expect(llm[0].data.agent_name).toBe("account_validation");
    expect(llm[0].data.execution_latency).toBe(1943);
  });

  test("VariableUpdateStep filters internal variables and reports 'set' on first turn", () => {
    const t = synthesizeTracesForTest(sampleTest())[0];
    const updates = t.plan.filter((s) => s.type === "VariableUpdateStep");
    const names = updates.map((u) => (u as { data: { variable_name: string } }).data.variable_name);
    // billing_link_url is "" — still a "set" because it's a new key. customer_name + verified_check too.
    // __resolved_locale__ + AgentScriptInternal_condition are filtered out.
    expect(names.sort()).toEqual(["billing_link_url", "customer_name", "verified_check"]);
    for (const u of updates) {
      expect((u as { data: { variable_change_reason: string } }).data.variable_change_reason).toBe(
        "set",
      );
    }
  });

  test("multi-turn: VariableUpdateStep diffs against previous turn", () => {
    const test: TestResult = {
      ...sampleTest(),
      outputs: [
        ...sampleTest().outputs!,
        {
          type: "agent.send_message",
          id: "turn2",
          utterance: "yes",
        },
        {
          type: "agent.get_state",
          id: "state2",
          response: {
            planner_response: {
              sessionProperties: { planId: "PID-2", sessionId: "SID-1" },
              lastExecution: {
                topic: "billing",
                agentResponse: "Here is your link.",
                latency: 1500,
                invokedActions: [],
                errors: [],
                llmEvents: [],
                message: { messageType: "InformResponseMessage", id: "MID-2" },
              },
              sessionContext: {
                executionHistory: [],
                stateVariables: {
                  verified_check: "true", // changed
                  customer_name: "Test", // unchanged → no entry
                  billing_link_url: "https://example.com/pay", // changed
                  // billing_routed: NEW (set)
                  billing_routed: true,
                },
              },
            },
          } as never,
        },
      ],
    };
    const out = synthesizeTracesForTest(test);
    expect(out.length).toBe(2);
    const turn2 = out[1];
    const updates = turn2.plan.filter((s) => s.type === "VariableUpdateStep") as Array<{
      data: { variable_name: string; variable_change_reason: string };
    }>;
    const byName = Object.fromEntries(
      updates.map((u) => [u.data.variable_name, u.data.variable_change_reason]),
    );
    expect(byName).toEqual({
      verified_check: "changed",
      billing_link_url: "changed",
      billing_routed: "set",
    });
    expect(byName.customer_name).toBeUndefined(); // unchanged → no entry
  });

  test("PlannerResponseStep mirrors the final agent message + topic", () => {
    const t = synthesizeTracesForTest(sampleTest())[0];
    const step = t.plan.find((s) => s.type === "PlannerResponseStep")!;
    expect(step.data).toMatchObject({
      message: "I need to verify your account first.",
      topic: "account_validation",
      message_id: "MID-1",
      feedback_id: "FB-1",
    });
  });

  test("surface mirrors are populated at the top level (topic, agentResponse, latency)", () => {
    const t = synthesizeTracesForTest(sampleTest())[0];
    expect(t.topic).toBe("account_validation");
    expect(t.agentResponse).toBe("I need to verify your account first.");
    expect(t.latency).toBe(2512);
    expect(t.userUtterance).toBe("hello");
  });

  test("notes carry the reconstructed-from-eval marker", () => {
    const t = synthesizeTracesForTest(sampleTest())[0];
    expect(t.notes.length).toBeGreaterThan(0);
    expect(t.notes[0]).toMatch(/synthesized-from-eval-api/);
  });

  test("merged-input wrapper keys results by sessionId::planId", () => {
    const merged: EvalApiResponse = { results: [sampleTest()] };
    const map = synthesizeTracesFromMerged(merged);
    expect(map.size).toBe(1);
    expect(map.has("SID-1::PID-1")).toBe(true);
    const entry = map.get("SID-1::PID-1") as SynthesizedTrace;
    expect(entry.planId).toBe("PID-1");
  });

  test("utteranceIndex fills in user input when send_message.utterance is absent", () => {
    const test = sampleTest();
    // strip the inline utterance
    delete (test.outputs![1] as { utterance?: string }).utterance;
    const out = synthesizeTracesForTest(test, {
      utteranceIndex: new Map([["trace_probe::turn1", "from-spec-utterance"]]),
    });
    const userStep = out[0].plan.find((s) => s.type === "UserInputStep");
    expect(userStep).toBeDefined();
    expect((userStep as { data: { utterance: string } }).data.utterance).toBe(
      "from-spec-utterance",
    );
  });

  test("skips turns without a planId on sessionProperties", () => {
    const test: TestResult = {
      ...sampleTest(),
      outputs: [
        sampleTest().outputs![0],
        sampleTest().outputs![1],
        {
          ...sampleTest().outputs![2],
          response: {
            planner_response: {
              // no sessionProperties at all
              lastExecution: {},
              sessionContext: {},
            },
          } as never,
        },
      ],
    };
    expect(synthesizeTracesForTest(test)).toEqual([]);
  });
});
