/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression: inspect.collectAtRefs walks the AST recursively without
 * cycle detection. AST nodes that carry parent back-references (or any
 * shared object reused in multiple positions) caused a stack overflow on
 * `inspect structure`.
 *
 * Live evidence: the deep-dive `agentscript.agent` example from
 * salesforce/agentscript and the `090_shipping_logistics` fixture both
 * triggered "Maximum call stack size exceeded" through the LLM-callable
 * agentscript_inspect tool surface.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { inspectFile } from "../lib/inspect.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-cycle-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const RICH_AGENT = `system:
    instructions: "You are a triage agent."

config:
    agent_name: "Cycle_Safe_Test"
    agent_label: "Cycle Safe Test"
    description: "Probes the AST walker against deep, repeating structures."
    agent_type: "AgentforceEmployeeAgent"

variables:
    case_id: mutable string = ""
        description: "Open case id."
    is_verified: mutable boolean = False
        description: "User verified flag."

start_agent triage:
    label: "Triage"
    description: "Routes to a specialized topic."
    reasoning:
        instructions: ->
            | Decide where to route. Reference @variables.case_id and @variables.is_verified.
        actions:
            go_a: @utils.transition to @topic.alpha
                description: "Go to alpha."
            go_b: @utils.transition to @topic.beta
                description: "Go to beta."

topic alpha:
    label: "Alpha"
    description: "Touches @variables.case_id and routes to beta."
    reasoning:
        instructions: ->
            | Mention @variables.case_id and consider @variables.is_verified.
        actions:
            to_beta: @utils.transition to @topic.beta
                description: "Hand off to beta."
            back_to_triage: @utils.transition to @topic.triage
                description: "Climb back to triage."

topic beta:
    label: "Beta"
    description: "Touches @variables.is_verified and loops back to alpha."
    reasoning:
        instructions: ->
            | If @variables.is_verified is False, suggest verifying.
        actions:
            to_alpha: @utils.transition to @topic.alpha
                description: "Hand back to alpha."
            back_to_triage: @utils.transition to @topic.triage
                description: "Climb back to triage."
`;

describe("inspect cycle safety", () => {
  test("does not stack overflow on a clean topic graph with reciprocal transitions", async () => {
    const file = path.join(workDir, "Cycle_Safe_Test.agent");
    await writeFile(file, RICH_AGENT, "utf8");
    const out = await inspectFile(file);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.stats?.topics).toBe(2);
      expect(out.stats?.variables).toBe(2);
      // Topic graph must record `@variables.*` and `@topic.*` refs without
      // recursing forever through any AST back-references.
      const alpha = out.components?.topics?.find((t) => t.name === "alpha");
      expect(alpha).toBeTruthy();
      // The walker catches `@topic.X` references through `transition to`
      // AST nodes (MemberExpression). Refs embedded inside `|` template
      // scalars use a different AST shape and aren't surfaced here.
      expect(alpha?.subagent_refs).toContain("beta");
    }
  });

  test("collectAtRefs is robust to a self-referential synthetic graph", async () => {
    // The minimal repro is a real `.agent` file; the SDK builds the AST.
    // We can't easily hand-craft a synthetic AST that uses the SDK's
    // private __kind tags, so we lean on a shape that historically caused
    // the overflow: many topics + many cross-references.
    const lines = ["system:", '    instructions: "x"', "", "topic root:"];
    for (let i = 0; i < 20; i++) {
      lines.push(`topic t${i}:`);
      lines.push(`    description: "Loops via @topic.t${(i + 1) % 20}."`);
      lines.push(`    reasoning:`);
      lines.push(`        instructions: ->`);
      lines.push(`            | Mention @topic.t${(i + 1) % 20}.`);
      lines.push(`        actions:`);
      lines.push(`            go_next: @utils.transition to @topic.t${(i + 1) % 20}`);
    }
    const file = path.join(workDir, "Wide_Cycle.agent");
    await writeFile(file, lines.join("\n") + "\n", "utf8");
    const out = await inspectFile(file);
    expect(out.ok).toBe(true);
  });
});
