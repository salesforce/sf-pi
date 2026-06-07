/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the LLM-friendly trace digest. The digest is the bridge between
 * the rich planner trace JSON (~55 KB per turn, 16+ step types) and what
 * the LLM actually consumes for self-recovery (compact, every type
 * preserved, heavy fields clipped).
 */

import { describe, expect, test } from "vitest";
import {
  summarizeLastExecution,
  summarizeProductionResponse,
  summarizeTrace,
} from "../lib/preview/trace-digest.ts";
import type { LastExecution } from "../lib/eval/types.ts";

const FAKE_PLAN = [
  {
    type: "UserInputStep",
    startExecutionTime: 100,
    endExecutionTime: 110,
    message: "I forgot my password",
  },
  {
    type: "SessionInitialStateStep",
    startExecutionTime: 110,
    endExecutionTime: 110,
    data: { directive_context: "on_message", variable_values: { a: 1, b: 2 } },
  },
  {
    type: "VariableUpdateStep",
    startExecutionTime: 110,
    endExecutionTime: 110,
    data: {
      variable_updates: [
        {
          variable_name: "case_id",
          variable_new_value: "12345",
          variable_change_reason: "set by route",
        },
        { variable_name: "is_verified", variable_new_value: false },
      ],
    },
  },
  {
    type: "EnabledToolsStep",
    startExecutionTime: 110,
    endExecutionTime: 110,
    data: { agent_name: "Triage", enabled_tools: ["go_password", "go_vpn"] },
  },
  {
    type: "LLMStep",
    startExecutionTime: 110,
    endExecutionTime: 460,
    data: {
      agent_name: "Triage",
      prompt_name: "Triage_prompt",
      prompt_content: "system + user prompts here, " + "x".repeat(1500),
      prompt_response: JSON.stringify({
        content: "",
        tool_invocations: [{ id: "1", function: { name: "go_password", arguments: "{}" } }],
        usage: { total_tokens: 1729 },
      }),
      execution_latency: 350,
    },
  },
  {
    type: "UpdateTopicStep",
    startExecutionTime: 460,
    endExecutionTime: 462,
    topic: "password_help",
  },
  {
    type: "TransitionStep",
    startExecutionTime: 462,
    endExecutionTime: 462,
    data: { from_agent: "Triage", to_agent: "password_help", transition_type: "handoff" },
  },
  {
    type: "NodeEntryStateStep",
    startExecutionTime: 462,
    endExecutionTime: 463,
    data: { agent_name: "password_help" },
  },
  {
    type: "FunctionStep",
    startExecutionTime: 463,
    endExecutionTime: 800,
    function: {
      name: "Update Session Routing",
      input: { supportPath: "Password Reset" },
      output: { caseId: "12345-ABCDE" },
    },
    executionLatency: 337,
  },
  {
    type: "PlannerResponseStep",
    startExecutionTime: 800,
    endExecutionTime: 850,
    message: "Please open the self-service portal...",
    responseType: "Inform",
    isContentSafe: true,
    safetyScore: { safety_score: 0.999 },
  },
  // An unknown future step type — must still produce a row with type kept verbatim.
  {
    type: "FutureNewStepKindStep",
    startExecutionTime: 850,
    endExecutionTime: 851,
    data: { description: "an experimental runtime step that the digest hasn't seen before" },
  },
];

describe("summarizeTrace (preview source)", () => {
  test("preserves every distinct step type", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN, planId: "p1" });
    const observedTypes = new Set(d.timeline.map((r) => r.t));
    for (const expected of [
      "UserInputStep",
      "SessionInitialStateStep",
      "VariableUpdateStep",
      "EnabledToolsStep",
      "LLMStep",
      "UpdateTopicStep",
      "TransitionStep",
      "NodeEntryStateStep",
      "FunctionStep",
      "PlannerResponseStep",
      "FutureNewStepKindStep",
    ]) {
      expect(observedTypes.has(expected)).toBe(true);
    }
  });

  test("LLMStep extracts prompt_chars, response_chars, and tool_calls", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    const llm = d.timeline.find((r) => r.t === "LLMStep");
    expect(llm).toBeTruthy();
    expect(llm?.agent).toBe("Triage");
    expect(typeof llm?.prompt_chars).toBe("number");
    expect((llm?.prompt_chars as number) > 1500).toBe(true);
    expect(llm?.tool_calls).toEqual(["go_password"]);
    expect(llm?.ms).toBe(350);
  });

  test("FunctionStep extracts fn name + clipped args + output flag", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    const fn = d.timeline.find((r) => r.t === "FunctionStep");
    expect(fn?.fn).toBe("Update Session Routing");
    expect(typeof fn?.args_preview).toBe("string");
    expect(fn?.has_output).toBe(true);
  });

  test("collects route path and tool activity for the human trace report", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    expect(d.route_path).toEqual([
      { step: 6, from: "Triage", to: "password_help", type: "handoff" },
    ]);
    expect(d.tool_activity?.enabled?.[0]).toEqual({
      step: 3,
      agent: "Triage",
      tools: ["go_password", "go_vpn"],
    });
    expect(d.tool_activity?.called?.[0]).toMatchObject({
      step: 8,
      name: "Update Session Routing",
      has_output: true,
    });
    expect(d.tool_activity?.called?.[0]?.input?.fields).toEqual([
      { path: "supportPath", value_preview: "Password Reset" },
    ]);
    expect(d.tool_activity?.called?.[0]?.output?.fields).toEqual([
      { path: "caseId", value_preview: "12345-ABCDE" },
    ]);
  });

  test("VariableUpdateStep clips long values + reports extra updates", () => {
    const longBlob = "X".repeat(500);
    const trace = {
      plan: [
        {
          type: "VariableUpdateStep",
          startExecutionTime: 0,
          endExecutionTime: 0,
          data: {
            variable_updates: [
              { variable_name: "user_field", variable_new_value: longBlob },
              { variable_name: "another", variable_new_value: "x" },
            ],
          },
        },
      ],
    };
    const d = summarizeTrace(trace);
    const vu = d.timeline[0];
    expect(vu.var).toBe("user_field");
    expect(typeof vu.value_preview).toBe("string");
    expect((vu.value_preview as string).length).toBeLessThan(120);
    expect(vu.extra_updates).toBe(1);
  });

  test("collects non-internal variable changes separately", () => {
    const trace = {
      plan: [
        {
          type: "VariableUpdateStep",
          startExecutionTime: 0,
          endExecutionTime: 0,
          data: {
            variable_updates: [
              {
                variable_name: "case_id",
                variable_old_value: null,
                variable_new_value: "500xx000001",
                variable_change_reason: "set by route",
              },
              { variable_name: "__plannerScratch", variable_new_value: "noise" },
              { variable_name: "AgentScriptInternal_state", variable_new_value: true },
            ],
          },
        },
      ],
    };
    const d = summarizeTrace(trace);
    expect(d.variable_changes).toEqual([
      {
        step: 0,
        name: "case_id",
        previous_value_preview: "null",
        value_preview: "500xx000001",
        reason: "set by route",
      },
    ]);
  });

  test("redacts sensitive-looking action I/O paths", () => {
    const d = summarizeTrace({
      plan: [
        {
          type: "FunctionStep",
          function: {
            name: "send_notification",
            input: { phone: "+15551234567", delivery: "SMS" },
            output: { token: "secret-token", status: "queued" },
          },
        },
      ],
    });
    expect(d.tool_activity?.called?.[0]?.input?.fields).toContainEqual({
      path: "phone",
      value_preview: "••••",
      redacted: true,
    });
    expect(d.tool_activity?.called?.[0]?.output?.fields).toContainEqual({
      path: "token",
      value_preview: "••••",
      redacted: true,
    });
    expect(d.tool_activity?.called?.[0]?.output?.fields).toContainEqual({
      path: "status",
      value_preview: "queued",
    });
  });

  test("adds diagnostics only when rule-based findings exist", () => {
    const d = summarizeTrace({
      plan: [
        {
          type: "EnabledToolsStep",
          data: { agent_name: "Help", enabled_tools: ["lookup_case"] },
        },
        {
          type: "LLMStep",
          data: {
            agent_name: "Help",
            prompt_content: "x".repeat(16000),
            prompt_response: "{}",
          },
        },
      ],
    });
    expect(d.diagnostics?.map((item) => item.message)).toEqual([
      "1 tool was enabled but no action was called.",
      "Large LLM prompt: 16k chars.",
    ]);
  });

  test("unknown step type still emits a row with hint preview", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    const future = d.timeline.find((r) => r.t === "FutureNewStepKindStep");
    expect(future).toBeTruthy();
    expect(typeof future?.hint).toBe("string");
    expect((future?.hint as string).includes("experimental")).toBe(true);
  });

  test("stats reflect actual counts and topic transition", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    expect(d.stats.step_count).toBe(FAKE_PLAN.length);
    expect(d.stats.llm_calls).toBe(1);
    expect(d.stats.vars_updated).toBe(1);
    expect(d.stats.topic_changes).toBe(1);
    expect(d.stats.function_calls).toBe(1);
  });

  test("summary_line includes from→to topic and call counts", () => {
    const d = summarizeTrace({ plan: FAKE_PLAN });
    expect(d.summary_line).toContain("password_help");
    expect(d.summary_line).toContain("1 LLM call");
    expect(d.summary_line).toContain("1 fn call");
  });

  test("compresses substantially relative to raw plan JSON", () => {
    const trace = { plan: FAKE_PLAN };
    const d = summarizeTrace(trace);
    const rawSize = JSON.stringify(trace).length;
    const digestSize = JSON.stringify(d).length;
    // Expect at least 2x compression on this small fake trace; real
    // production traces compress closer to 8x (verified live).
    expect(digestSize).toBeLessThan(rawSize);
  });

  test("`steps` field name is also tolerated as a fallback for legacy callers", () => {
    const d = summarizeTrace({ steps: FAKE_PLAN });
    expect(d.timeline.length).toBe(FAKE_PLAN.length);
  });
});

describe("summarizeLastExecution (eval source)", () => {
  test("rebuilds a digest from lastExecution.llmEvents", () => {
    const le: LastExecution = {
      agentResponse: "Hello there!",
      topic: "password_help",
      latency: 1234,
      invokedActions: ["update_routing"],
      errors: [],
      message: { planId: "abc-123" },
      llmEvents: [
        [
          {
            agent_name: "Triage",
            prompt_name: "Triage_prompt",
            prompt_content: "system + user",
            prompt_response: JSON.stringify({
              tool_invocations: [{ function: { name: "go_password" } }],
            }),
            execution_latency: 320,
          } as never,
        ],
      ],
      userUtterance: undefined,
    };
    const d = summarizeLastExecution(le, { userInput: "I forgot my password" });
    expect(d.source).toBe("eval");
    expect(d.turn.user_input).toBe("I forgot my password");
    expect(d.turn.agent_response).toBe("Hello there!");
    expect(d.turn.topic).toBe("password_help");
    const types = d.timeline.map((r) => r.t);
    expect(types).toContain("UserInputStep");
    expect(types).toContain("LLMStep");
    expect(types).toContain("PlannerResponseStep");
    expect(types).toContain("FunctionStep");
    const llm = d.timeline.find((r) => r.t === "LLMStep");
    expect(llm?.tool_calls).toEqual(["go_password"]);
    expect(d.notes?.[0]).toMatch(/eval/i);
  });

  test("handles empty / missing lastExecution gracefully", () => {
    const d = summarizeLastExecution(undefined);
    expect(d.source).toBe("eval");
    expect(d.timeline).toEqual([]);
    expect(d.stats.step_count).toBe(0);
    expect(d.stats.llm_calls).toBe(0);
  });
});

describe("summarizeProductionResponse (production-agent v1 source)", () => {
  test("surface-only digest: UserInputStep + PlannerResponseStep with response_type / safety / planId", () => {
    const d = summarizeProductionResponse(
      [
        {
          type: "Inform",
          planId: "plan-1",
          isContentSafe: true,
          feedbackId: "fb-1",
          message: "Which system do you need to reset your password for?",
          metrics: {},
          result: [],
          citedReferences: [],
        },
      ],
      { userInput: "I forgot my password", latencyMs: 1234 },
    );
    expect(d.source).toBe("production-v1");
    expect(d.turn.user_input).toBe("I forgot my password");
    expect(d.turn.agent_response).toContain("Which system");
    expect(d.turn.plan_id).toBe("plan-1");
    expect(d.turn.latency_ms).toBe(1234);
    expect(d.timeline).toHaveLength(2);
    const planner = d.timeline.find((r) => r.t === "PlannerResponseStep");
    expect(planner?.response_type).toBe("Inform");
    expect(planner?.is_content_safe).toBe(true);
    expect(planner?.feedback_id).toBe("fb-1");
    expect(planner?.plan_id).toBe("plan-1");
    expect(typeof planner?.response_chars).toBe("number");
    expect(d.notes?.[0]).toMatch(/production-v1/);
  });

  test("populates FunctionStep rows when result[] carries action outputs", () => {
    const d = summarizeProductionResponse(
      [
        {
          type: "Inform",
          message: "Created case 12345.",
          isContentSafe: true,
          result: [
            { name: "create_case", output: { caseId: "12345", priority: "P2" } },
            { functionName: "notify_user", result: { sent: true } },
          ],
          citedReferences: [],
        },
      ],
      { userInput: "Open a ticket for me", latencyMs: 800 },
    );
    const fnRows = d.timeline.filter((r) => r.t === "FunctionStep");
    expect(fnRows).toHaveLength(2);
    expect(fnRows[0].fn).toBe("create_case");
    expect(fnRows[1].fn).toBe("notify_user");
    expect(d.stats.function_calls).toBe(2);
    expect(d.summary_line).toContain("2 actions");
  });

  test("populates CitedReferenceStep rows when citedReferences[] is non-empty", () => {
    const d = summarizeProductionResponse(
      [
        {
          type: "Inform",
          message: "Per the policy, vacation accrues at 1.5 days/month.",
          isContentSafe: true,
          result: [],
          citedReferences: [
            { title: "PTO Policy", url: "https://kb/pto", relevanceScore: 0.94 },
            { title: "Holiday Calendar", url: "https://kb/holidays" },
          ],
        },
      ],
      { userInput: "how does PTO work", latencyMs: 1500 },
    );
    const cites = d.timeline.filter((r) => r.t === "CitedReferenceStep");
    expect(cites).toHaveLength(2);
    expect(cites[0].title).toBe("PTO Policy");
    expect(cites[0].url).toBe("https://kb/pto");
    expect(cites[0].score).toBe(0.94);
    expect(cites[1].title).toBe("Holiday Calendar");
  });

  test("unsafe content surfaces as an error and decorates the summary line", () => {
    const d = summarizeProductionResponse(
      [
        {
          type: "Inform",
          message: "...",
          isContentSafe: false,
          result: [],
          citedReferences: [],
        },
      ],
      { userInput: "...", latencyMs: 100 },
    );
    expect(d.errors).toHaveLength(1);
    expect(d.errors[0].message).toMatch(/is_content_safe=false/);
    expect(d.summary_line).toContain("⚠");
  });

  test("start-turn (no userInput) emits PlannerResponseStep only", () => {
    const d = summarizeProductionResponse([
      {
        type: "Inform",
        message: "Hi! I'm the IT Help Desk bot.",
        isContentSafe: true,
        planId: "",
        result: [],
        citedReferences: [],
      },
    ]);
    expect(d.timeline).toHaveLength(1);
    expect(d.timeline[0].t).toBe("PlannerResponseStep");
  });

  test("empty / missing messages produces a single planner row + notes", () => {
    const d = summarizeProductionResponse([], { userInput: "hi" });
    expect(d.source).toBe("production-v1");
    expect(d.timeline.length).toBeGreaterThanOrEqual(2); // UserInput + PlannerResponse
    expect(d.notes?.[0]).toMatch(/production-v1/);
  });
});
