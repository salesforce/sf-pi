/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { AGENT_SCRIPT_QUALITY_RULES } from "../lib/quality/catalog.ts";
import { runAgentScriptQuality } from "../lib/quality/engine.ts";

function source(body: string, variables = ""): string {
  return `system:
    instructions: "Help the user."
    messages:
        welcome: "Hello"
        error: "Error"

config:
    agent_name: "Quality_Test"
    agent_type: "AgentforceEmployeeAgent"
${variables ? `\nvariables:\n${variables}\n` : ""}
${body.trim()}
`;
}

function codes(result: Awaited<ReturnType<typeof runAgentScriptQuality>>): string[] {
  return result.findings.map((finding) => finding.rule_id);
}

describe("Agent Script quality engine", () => {
  it("returns clean coverage for a simple agent", async () => {
    const result = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Help the user"
    reasoning:
        instructions: ->
            | Respond helpfully.`),
    );
    expect(result.status).toBe("clean");
    expect(result.coverage).toMatchObject({
      total_rules: AGENT_SCRIPT_QUALITY_RULES.length,
      enabled_rules: AGENT_SCRIPT_QUALITY_RULES.length,
    });
  });

  it("does not report empty or header-only source as quality-clean", async () => {
    await expect(runAgentScriptQuality("")).resolves.toMatchObject({
      ok: true,
      status: "partial",
    });
    await expect(runAgentScriptQuality('system:\n    instructions: "Help"')).resolves.toMatchObject(
      {
        ok: true,
        status: "partial",
      },
    );
  });

  it("detects deterministic slot filling", async () => {
    const result = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Main"
    actions:
        lookup:
            description: "Lookup"
            inputs:
                query: string
            outputs:
                result: string
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            run @actions.lookup
                with query = ...`),
    );
    expect(codes(result)).toContain("slot-filling-in-deterministic-action");
  });

  it("validates deterministic action input names, required inputs, and types", async () => {
    const result = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Main"
    actions:
        lookup:
            description: "Lookup"
            inputs:
                query: string
                    is_required: True
            outputs:
                result: string
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            run @actions.lookup
                with qury = 42`),
    );
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "deterministic-action-unknown-input",
        "deterministic-action-missing-input",
      ]),
    );
  });

  it("detects deterministic action input and output type mismatches", async () => {
    const result = await runAgentScriptQuality(
      source(
        `start_agent main:
    description: "Main"
    actions:
        score:
            description: "Score"
            inputs:
                query: string
            outputs:
                score: number
            target: "flow://Score"
    reasoning:
        instructions: ->
            run @actions.score
                with query = 42
                set @variables.name = @outputs.score`,
        `    name: mutable string = ""
        description: "Name"`,
      ),
    );
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "deterministic-action-input-type-mismatch",
        "deterministic-action-output-type-mismatch",
      ]),
    );
  });

  it("detects action chains deeper than one follow-up", async () => {
    const result = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Main"
    actions:
        first:
            description: "First"
            outputs:
                ok: string
            target: "flow://First"
        second:
            description: "Second"
            outputs:
                ok: string
            target: "flow://Second"
        third:
            description: "Third"
            outputs:
                ok: string
            target: "flow://Third"
    reasoning:
        actions:
            first: @actions.first
                run @actions.second
                    run @actions.third`),
    );
    expect(codes(result)).toContain("action-chain-too-deep");
  });

  it("finds unconditional and conditional transition cycles separately", async () => {
    const unconditional = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Main"
    before_reasoning:
        transition to @subagent.a
subagent a:
    description: "A"
    before_reasoning:
        transition to @subagent.b
subagent b:
    description: "B"
    before_reasoning:
        transition to @subagent.a`),
    );
    expect(codes(unconditional)).toContain("unconditional-transition-cycle");

    const conditional = await runAgentScriptQuality(
      source(
        `start_agent main:
    description: "Main"
    before_reasoning:
        transition to @subagent.a
subagent a:
    description: "A"
    before_reasoning:
        if @variables.go_b == True:
            transition to @subagent.b
subagent b:
    description: "B"
    before_reasoning:
        if @variables.go_a == True:
            transition to @subagent.a`,
        `    go_a: mutable boolean = False
        description: "Go A"
    go_b: mutable boolean = False
        description: "Go B"`,
      ),
    );
    expect(codes(conditional)).toContain("conditional-transition-cycle");
    expect(codes(conditional)).not.toContain("unconditional-transition-cycle");
  });

  it("finds unreachable subagents and returning delegation cycles", async () => {
    const result = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Main"
    reasoning:
        actions:
            consult_a: @subagent.a
                description: "Consult A"
subagent a:
    description: "A"
    reasoning:
        actions:
            consult_main: @subagent.main
                description: "Consult main"
subagent orphan:
    description: "Orphan"
    reasoning:
        instructions: ->
            | Orphan`),
    );
    expect(codes(result)).toEqual(
      expect.arrayContaining(["unreachable-subagent", "subagent-delegation-cycle"]),
    );
  });

  it("finds unused scoped action definitions", async () => {
    const result = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Main"
    actions:
        unused:
            description: "Unused"
            outputs:
                ok: string
            target: "flow://Unused"
    reasoning:
        instructions: ->
            | Help`),
    );
    expect(codes(result)).toContain("unused-action");
  });

  it("distinguishes discarded prompts, actions, and state before transitions", async () => {
    const result = await runAgentScriptQuality(
      source(
        `start_agent main:
    description: "Main"
    actions:
        audit:
            description: "Audit"
            outputs:
                ok: string
            target: "flow://Audit"
    reasoning:
        instructions: ->
            | This prompt is discarded.
            run @actions.audit
            set @variables.ready = True
            transition to @subagent.next
subagent next:
    description: "Next"
    reasoning:
        instructions: ->
            | Next`,
        `    ready: mutable boolean = False
        description: "Ready"`,
      ),
    );
    expect(codes(result)).toEqual(
      expect.arrayContaining(["discarded-prompt-before-transition", "action-before-transition"]),
    );
  });

  it("validates literal list element types and list indexes", async () => {
    const result = await runAgentScriptQuality(
      source(
        `start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            if @variables.names["first"] is not None:
                | Help`,
        `    names: mutable list[string] = ["Ada", 42]
        description: "Names"`,
      ),
    );
    expect(codes(result)).toEqual(
      expect.arrayContaining(["list-element-type-mismatch", "non-numeric-list-index"]),
    );
  });

  it("requires descriptions only for slot-filled setVariables targets", async () => {
    const result = await runAgentScriptQuality(
      source(
        `start_agent main:
    description: "Main"
    reasoning:
        actions:
            capture: @utils.setVariables
                with reference = ...`,
        `    reference: mutable string`,
      ),
    );
    expect(codes(result)).toContain("slot-filled-variable-missing-description");
  });

  it("rejects variable descriptions over 255 characters at the exact boundary", async () => {
    const atLimit = await runAgentScriptQuality(
      source(
        `start_agent main:
    description: "Main"`,
        `    reference: mutable string
        description: "${"a".repeat(255)}"`,
      ),
    );
    const overLimit = await runAgentScriptQuality(
      source(
        `start_agent main:
    description: "Main"`,
        `    reference: mutable string
        description: "${"a".repeat(256)}"`,
      ),
    );

    expect(codes(atLimit)).not.toContain("variable-description-max-length");
    expect(overLimit.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: "variable-description-max-length",
          severity: "high",
          message: expect.stringContaining("256"),
        }),
      ]),
    );
  });

  it("projects official instruction syntax diagnostics and honors rule overrides", async () => {
    const instructionSource = source(
      `start_agent main:
    description: "Main"
    reasoning:
        instructions: |
            Use @variables.current_step to decide what to do next.`,
      `    current_step: mutable string = "start"
        description: "Current step"`,
    );
    const enabled = await runAgentScriptQuality(instructionSource);
    const disabled = await runAgentScriptQuality(instructionSource, {
      ruleOverrides: { "instruction-template-syntax": false },
    });

    expect(enabled.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: "instruction-template-syntax",
          severity: "moderate",
        }),
      ]),
    );
    expect(codes(disabled)).not.toContain("instruction-template-syntax");
    expect(disabled.coverage.disabled_rules).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "instruction-template-syntax" })]),
    );
  });

  it("advises on prompt response flags", async () => {
    const result = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Main"
    actions:
        generate:
            description: "Generate"
            outputs:
                promptResponse: string
            target: "generatePromptResponse://Generate"
    reasoning:
        actions:
            generate: @actions.generate`),
    );
    expect(codes(result)).toContain("prompt-template-output-flags");
  });

  it("reports per-procedure cyclomatic complexity without creating a finding", async () => {
    const result = await runAgentScriptQuality(
      source(
        `start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            if @variables.a and (@variables.b or @variables.c):
                | Help`,
        `    a: mutable boolean = False
        description: "A"
    b: mutable boolean = False
        description: "B"
    c: mutable boolean = False
        description: "C"`,
      ),
    );
    expect(result.metrics.cyclomatic_complexity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ procedure: "start_agent.main.reasoning.instructions", value: 4 }),
      ]),
    );
    expect(codes(result)).not.toContain("cyclomatic-complexity");
  });

  it("honors disabled rules and exposes coverage", async () => {
    const result = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Main"
    actions:
        unused:
            description: "Unused"
            outputs:
                ok: string
            target: "flow://Unused"`),
      { ruleOverrides: { "unused-action": false } },
    );
    expect(codes(result)).not.toContain("unused-action");
    expect(result.coverage.disabled_rules).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "unused-action" })]),
    );
  });

  it("applies exact next-line suppressions to non-High findings", async () => {
    const result = await runAgentScriptQuality(
      source(`start_agent main:
    description: "Main"
    actions:
        # sf-agentscript-ignore-next-line unused-action: retained for rollout
        retained:
            description: "Retained"
            outputs:
                ok: string
            target: "flow://Retained"`),
    );
    expect(codes(result)).not.toContain("unused-action");
    expect(result.suppressions.applied).toHaveLength(1);
  });
});
