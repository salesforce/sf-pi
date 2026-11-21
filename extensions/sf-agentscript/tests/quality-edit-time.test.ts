/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { checkAgentScriptSource, isAgentScriptCompileValid } from "../lib/diagnostics.ts";

describe("Agent Script edit-time quality hardening", () => {
  it("surfaces enabled edit-time High rules without changing compile validity", async () => {
    const result = await checkAgentScriptSource(`system:
    instructions: "Help"
    messages:
        welcome: "Hi"
        error: "Error"
config:
    agent_name: "Edit_Time"
    agent_type: "AgentforceEmployeeAgent"
start_agent main:
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
                with query = ...
`);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "slot-filling-in-deterministic-action",
          severity: 2,
          source: "sf-agentscript-quality",
        }),
      ]),
    );
    // The official compiler also rejects this binding; compile validity is
    // decided by official diagnostics alone, never by a quality projection.
    const official = result.diagnostics.filter(
      (diagnostic) => diagnostic.source !== "sf-agentscript-quality",
    );
    expect(isAgentScriptCompileValid(result.diagnostics)).toBe(isAgentScriptCompileValid(official));
  });

  it("surfaces overlong variable descriptions during compile-on-save", async () => {
    const result = await checkAgentScriptSource(`system:
    instructions: "Help"
    messages:
        welcome: "Hi"
        error: "Error"
config:
    agent_name: "Edit_Time_Description"
    agent_type: "AgentforceEmployeeAgent"
variables:
    current_step: mutable string = "start"
        description: "${"a".repeat(256)}"
start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            | Help
`);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "variable-description-max-length",
          severity: 2,
          source: "sf-agentscript-quality",
        }),
      ]),
    );
    expect(isAgentScriptCompileValid(result.diagnostics)).toBe(true);
  });
});
