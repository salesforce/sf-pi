/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the preview send timeline renderer.
 *
 * We assert the Markdown emitter (theme=undefined) since the ANSI-colored
 * renderer depends on a live theme; the structure and ordering are
 * identical, so testing the plain-text path covers correctness for both.
 */

import { describe, expect, it } from "vitest";
import { previewSendMarkdown } from "../lib/render/timeline.ts";
import type { TraceDigest } from "../lib/preview/trace-digest.ts";
import {
  fmtMs,
  fmtChars,
  rowDetail,
  rowSubRow,
  styleForStep,
  stepLabel,
  visibleWidth,
  padRightVisible,
  clipLine,
} from "../lib/render/shared.ts";

function fixtureDigest(): TraceDigest {
  return {
    source: "preview",
    turn: {
      user_input: "I think someone broke into my account, can you help",
      agent_response: "I'm sorry to hear that. Let me help you secure your account.",
      topic: "AccountSecurity",
      topic_changed_from: "Triage",
      latency_ms: 1400,
      plan_id: "8a3f7d1e-aaaa-bbbb-cccc-dddddddddddd",
      trace_file: ".sfdx/agents/AS/sessions/8a3f.../t3.json",
    },
    state_variables: {
      verified_check: true,
      CustomerName: "Example Customer",
    },
    tool_activity: {
      enabled: [{ step: 2, agent: "Triage", tools: ["transition_topic", "reset_password"] }],
      called: [
        {
          step: 5,
          name: "reset_password",
          latency_ms: 350,
          input: { fields: [{ path: "user_id", value_preview: "u_42" }] },
          output: { fields: [{ path: "status", value_preview: "started" }] },
          has_output: true,
        },
      ],
    },
    timeline: [
      { i: 0, t: "UserInputStep", user: "I think someone broke into my account…" },
      { i: 1, t: "BeforeReasoningIterationStep", ms: 12, agent: "Triage" },
      {
        i: 2,
        t: "LLMStep",
        ms: 488,
        agent: "Triage",
        prompt_chars: 7183,
        response_chars: 406,
        tool_calls: ["transition_topic"],
      },
      { i: 3, t: "TransitionStep", ms: 14, from: "Triage", to: "AccountSecurity" },
      {
        i: 4,
        t: "LLMStep",
        ms: 342,
        agent: "AccountSecurity",
        prompt_chars: 4128,
        response_chars: 298,
        tool_calls: ["reset_password"],
      },
      {
        i: 5,
        t: "FunctionStep",
        ms: 350,
        fn: "reset_password",
        args_preview: '{"user_id":"u_42"}',
        has_output: true,
      },
      {
        i: 6,
        t: "VariableUpdateStep",
        ms: 12,
        var: "verified_check",
        value_preview: "true",
      },
      {
        i: 7,
        t: "PlannerResponseStep",
        ms: 19,
        response_chars: 312,
        response_type: "Inform",
        is_content_safe: true,
        safety_score: 0.999,
      },
      { i: 8, t: "OutputEvaluationStep", ms: 30 },
      { i: 9, t: "GuardrailsStep", ms: 40 },
    ],
    errors: [],
    stats: {
      step_count: 10,
      llm_calls: 2,
      vars_updated: 1,
      topic_changes: 1,
      function_calls: 1,
      errors: 0,
    },
    summary_line: "Triage → AccountSecurity · 2 LLM calls · 1.4s · 1 fn call",
  };
}

describe("previewSendMarkdown", () => {
  it("renders the header with topic, plan, and latency", () => {
    const md = previewSendMarkdown(fixtureDigest(), {
      ok: true,
      latency_ms: 1400,
      plan_id: "8a3f7d1e-aaaa-bbbb-cccc-dddddddddddd",
    });
    expect(md).toMatch(/AccountSecurity/);
    expect(md).toMatch(/plan=8a3f7d1e/);
    expect(md).toMatch(/1\.4s/);
  });

  it("includes the user/agent conversation card", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    expect(md).toMatch(/👤/);
    expect(md).toMatch(/I think someone broke into my account/);
    expect(md).toMatch(/🤖/);
    expect(md).toMatch(/secure your account/);
  });

  it("includes selected state variables when the digest provides them", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    expect(md).toMatch(/🧪 Key State Snapshot/);
    expect(md).toMatch(/verified_check\s+true/);
    expect(md).toMatch(/CustomerName\s+Example Customer/);
  });

  it("summarizes changed variables above the timeline", () => {
    const digest = fixtureDigest();
    digest.variable_changes = [
      {
        step: 6,
        name: "verified_check",
        previous_value_preview: "false",
        value_preview: "true",
      },
    ];
    const md = previewSendMarkdown(digest, { ok: true });
    expect(md).toMatch(/🧬 State Changes/);
    expect(md).toMatch(/verified_check\s+false → true/);
  });

  it("hides internal variable rows from the human timeline", () => {
    const digest = fixtureDigest();
    digest.timeline.splice(6, 0, {
      i: 99,
      t: "VariableUpdateStep",
      var: "__plannerScratch",
      value_preview: "noise",
      internal: true,
    });
    digest.stats.step_count = digest.timeline.length;
    digest.stats.vars_updated = 2;
    const md = previewSendMarkdown(digest, { ok: true });
    expect(md).toMatch(/11 steps raw/);
    expect(md).toMatch(/10 shown/);
    expect(md).toMatch(/1 internal hidden/);
    expect(md).not.toMatch(/__plannerScratch/);
  });

  it("renders one row per timeline step in order", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    // The renderer strips the "Step" suffix and uses overrides from the
    // styles table (TransitionStep stays as 'Transition'). Verify the
    // resulting display labels appear in order.
    const labels = [
      "UserInput",
      "Reasoning",
      "LLM",
      "Transition",
      "Function",
      "Variable",
      "Response",
    ];
    let cursor = 0;
    for (const label of labels) {
      const idx = md.indexOf(label, cursor);
      expect(idx, `expected ${label} after offset ${cursor}`).toBeGreaterThan(-1);
      cursor = idx;
    }
  });

  it("accumulates time offsets across the timeline", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    // First row at +0ms, then +12ms, +500ms, +514ms, +856ms, +1.2s
    expect(md).toMatch(/\+0ms/);
    expect(md).toMatch(/\+12ms/);
    // After 12 + 488 = 500ms
    expect(md).toMatch(/\+500ms/);
  });

  it("surfaces tool activity and LLM tool calls", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    expect(md).toMatch(/🛠 Tool Activity/);
    expect(md).toMatch(/enabled\s+transition_topic, reset_password/);
    expect(md).toMatch(/called\s+reset_password/);
    expect(md).toMatch(/calls transition_topic/);
  });

  it("renders a screenshot-friendly action I/O appendix", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    expect(md).toMatch(/🛠 Action I\/O Appendix/);
    expect(md).toMatch(/reset_password/);
    expect(md).toMatch(/input/);
    expect(md).toMatch(/user_id\s+u_42/);
    expect(md).toMatch(/output/);
    expect(md).toMatch(/status\s+started/);
  });

  it("renders evaluations separately from the timeline", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    expect(md).toMatch(/🛡 Evaluations/);
    expect(md).toMatch(/response safety\s+pass/);
    expect(md).toMatch(/safety score\s+0\.999/);
    expect(md).toMatch(/output eval\s+observed/);
    expect(md).toMatch(/guardrails\s+1 step observed/);
  });

  it("renders the stats line", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    expect(md).toMatch(/10 steps/);
    expect(md).toMatch(/2 LLM calls/);
    expect(md).toMatch(/1 action/);
    expect(md).toMatch(/1 var update/);
    expect(md).toMatch(/1 transition/);
  });

  it("includes the trace_file pointer", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    expect(md).toMatch(/trace_file/);
    expect(md).toMatch(/t3\.json/);
  });

  it("emits the drill-down recover_via hint", () => {
    const md = previewSendMarkdown(fixtureDigest(), { ok: true });
    expect(md).toMatch(/agentscript_preview trace plan_id=/);
  });

  it("notes are emitted when the digest reports them", () => {
    const digest = fixtureDigest();
    digest.notes = ["source=eval — no fine-grained step timeline"];
    const md = previewSendMarkdown(digest, { ok: true });
    expect(md).toMatch(/no fine-grained step timeline/);
  });

  it("renders an Errors section when errors are present", () => {
    const digest = fixtureDigest();
    digest.errors = [{ step: 4, type: "LLMStep", message: "rate limited by upstream model" }];
    digest.stats.errors = 1;
    const md = previewSendMarkdown(digest, { ok: true });
    expect(md).toMatch(/Errors/);
    expect(md).toMatch(/rate limited/);
    expect(md).toMatch(/1 error/);
  });

  it("works when the digest has no LLM calls at all (eval source path)", () => {
    const digest: TraceDigest = {
      source: "eval",
      turn: { user_input: "hello", agent_response: "hi", topic: "Welcome", latency_ms: 200 },
      timeline: [{ i: 0, t: "UserInputStep", user: "hello" }],
      errors: [],
      stats: {
        step_count: 1,
        llm_calls: 0,
        vars_updated: 0,
        topic_changes: 0,
        function_calls: 0,
        errors: 0,
      },
      summary_line: "Welcome · 0 LLM calls · 0.2s · no fn calls",
      notes: ["source=eval"],
    };
    const md = previewSendMarkdown(digest, { ok: true });
    expect(md).toMatch(/Welcome/);
    expect(md).toMatch(/0 LLM calls/);
    expect(md).toMatch(/source=eval/);
  });
});

describe("shared helpers", () => {
  it("fmtMs renders ms vs seconds", () => {
    expect(fmtMs(0)).toBe("0ms");
    expect(fmtMs(999)).toBe("999ms");
    expect(fmtMs(1000)).toBe("1.0s");
    expect(fmtMs(1400)).toBe("1.4s");
    expect(fmtMs(undefined)).toBe("");
  });

  it("fmtChars renders thousands suffix", () => {
    expect(fmtChars(7183)).toBe("7.2k");
    expect(fmtChars(406)).toBe("406");
    expect(fmtChars(undefined)).toBe("");
  });

  it("visibleWidth treats common emoji as width 2", () => {
    expect(visibleWidth("abc")).toBe(3);
    expect(visibleWidth("🤖")).toBe(2);
    expect(visibleWidth("🤖 hi")).toBe(5);
  });

  it("padRightVisible pads to target width", () => {
    expect(padRightVisible("ab", 5)).toBe("ab   ");
    expect(padRightVisible("🤖", 4)).toBe("🤖  ");
  });

  it("clipLine truncates with ellipsis", () => {
    expect(clipLine("hello world", 100)).toBe("hello world");
    expect(clipLine("hello world", 5)).toBe("hell…");
  });

  it("styleForStep returns a known glyph for known step types", () => {
    expect(styleForStep("LLMStep").glyph).toBe("🧠");
    expect(styleForStep("TransitionStep").glyph).toBe("🔀");
    expect(styleForStep("FunctionStep").glyph).toBe("🛠");
    // Unknown falls back to ❔ via DEFAULT_STYLE
    expect(styleForStep("MysteryStep").glyph).toBe("❔");
  });

  it("stepLabel uses overrides and strips Step suffix otherwise", () => {
    expect(stepLabel("VariableUpdateStep")).toBe("Variable");
    expect(stepLabel("TransitionStep")).toBe("TransitionStep".replace(/Step$/, ""));
  });

  it("rowDetail formats per-step type contents (no theme)", () => {
    expect(rowDetail({ i: 0, t: "TransitionStep", from: "A", to: "B" })).toMatch(/A → B/);
    expect(rowDetail({ i: 0, t: "VariableUpdateStep", var: "x", value_preview: "1" })).toMatch(
      /x = 1/,
    );
    expect(
      rowDetail({
        i: 0,
        t: "LLMStep",
        agent: "Triage",
        prompt_chars: 7183,
        response_chars: 406,
      }),
    ).toMatch(/7\.2k → 406 chars/);
  });

  it("rowSubRow surfaces tool_calls and function output", () => {
    expect(rowSubRow({ i: 0, t: "LLMStep", tool_calls: ["fn_a", "fn_b"] })).toMatch(/fn_a, fn_b/);
    expect(rowSubRow({ i: 0, t: "FunctionStep", has_output: true })).toMatch(/result captured/);
    expect(rowSubRow({ i: 0, t: "FunctionStep", has_output: false })).toBeNull();
  });
});
