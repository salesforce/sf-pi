/* SPDX-License-Identifier: Apache-2.0 */
/**
 * End-to-end tests for the diagnostics layer.
 *
 * These hit the real vendored SDK so we prove:
 *  - the bundle is loadable
 *  - our filter + code-action layer produces the shapes we expect on real
 *    SDK output
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkAgentScriptFile } from "../lib/diagnostics.ts";

function writeTempAgent(contents: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sf-agentscript-"));
  const file = path.join(dir, "sample.agent");
  writeFileSync(file, contents, "utf8");
  return file;
}

describe("checkAgentScriptFile (integration)", () => {
  it("returns ok with no diagnostics for a well-formed agent", async () => {
    // Shape cribbed from upstream compiler test fixtures — minimal, valid,
    // agentforce dialect by default.
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are a helpful assistant."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    reasoning:",
        "        instructions: ->",
        "            | respond to whatever the user says.",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.dialect?.name).toBe("agentforce");
  });

  it("surfaces errors on a broken agent", async () => {
    const file = writeTempAgent(
      ["# @dialect: agentforce 2.5", "system:", '  instructions: "hi"', ""].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.severity === 1)).toBe(true);
  });

  it("includes unused-variable as a severity-2 actionable warning with a fix", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "variables:",
        '    case_id: mutable string = ""',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    reasoning:",
        "        instructions: ->",
        "            | respond to whatever the user says.",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const unused = result.diagnostics.find((d) => d.code === "unused-variable");
    expect(unused, "expected unused-variable diagnostic").toBeDefined();

    const unusedFix = result.quickFixes.find((f) => f.diagnosticCode === "unused-variable");
    expect(unusedFix, "expected unused-variable fix").toBeDefined();
    expect(unusedFix?.edits[0].newText).toBe("");
  });

  it("flags target-backed actions that omit outputs", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        lookup_order:",
        '            description: "Look up order details."',
        '            target: "flow://Lookup_Order"',
        "    reasoning:",
        "        actions:",
        "            lookup: @actions.lookup_order",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const missing = result.diagnostics.find((d) => d.code === "action-missing-outputs");
    expect(missing, "expected action-missing-outputs diagnostic").toBeDefined();
    expect(missing?.severity).toBe(1);
  });

  it("does not flag 15-character action target names that are not Salesforce ids", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        email:",
        '            description: "Send email."',
        "            outputs:",
        "                ok: string",
        '            target: "standardInvocableAction://SendEmailAction"',
        "    reasoning:",
        "        actions:",
        "            send: @actions.email",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    expect(result.diagnostics.filter((d) => d.code === "target-ref-looks-like-id")).toHaveLength(0);
  });

  it("flags target references that look like Salesforce record ids", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        weather:",
        '            description: "Get weather."',
        "            outputs:",
        "                ok: string",
        '            target: "flow://300WX000001ABCD"',
        "    reasoning:",
        "        actions:",
        "            get_weather: @actions.weather",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const refs = result.diagnostics.filter((d) => d.code === "target-ref-looks-like-id");
    expect(refs).toHaveLength(1);
    expect(refs[0].severity).toBe(2);
  });

  it("flags object action I/O without complex_data_type_name or schema", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        find_order:",
        '            description: "Find an order."',
        "            inputs:",
        "                filter: object",
        "            outputs:",
        "                order_data: object",
        '            target: "flow://FindOrder"',
        "    reasoning:",
        "        actions:",
        "            find: @actions.find_order",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const complex = result.diagnostics.filter((d) => d.code === "complex-action-io");
    expect(complex).toHaveLength(2);
    expect(complex.every((d) => d.severity === 2)).toBe(true);
  });

  it("does not flag object action I/O when a contract hint is present", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        find_order:",
        '            description: "Find an order."',
        "            inputs:",
        "                filter: object",
        '                    complex_data_type_name: "OrderFilter"',
        "            outputs:",
        "                order_data: object",
        '                    complex_data_type_name: "OrderRecord"',
        '            target: "flow://FindOrder"',
        "    reasoning:",
        "        actions:",
        "            find: @actions.find_order",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    expect(result.diagnostics.filter((d) => d.code === "complex-action-io")).toHaveLength(0);
  });

  it("flags bare numeric action inputs and outputs", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "HelloWorldBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        calculate_discount:",
        '            description: "Calculate discount."',
        "            inputs:",
        "                orderAmount: number",
        "            outputs:",
        "                finalAmount: number",
        '            target: "apex://CalculateDiscountAction"',
        "    reasoning:",
        "        actions:",
        "            calculate: @actions.calculate_discount",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const numeric = result.diagnostics.filter((d) => d.code === "numeric-action-io");
    expect(numeric).toHaveLength(2);
    expect(numeric.every((d) => d.severity === 2)).toBe(true);
  });

  it("flags invalid connection messaging route config", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "ServiceBot"',
        '    agent_type: "AgentforceServiceAgent"',
        '    default_agent_user: "service@example.com"',
        "",
        "connection messaging:",
        '    outbound_route_type: "OmniChannelFlow"',
        '    outbound_route_name: "Route_To_Agent"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    reasoning:",
        "        instructions: ->",
        "            | respond to whatever the user says.",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const codes = new Set(result.diagnostics.map((d) => d.code));
    expect(codes.has("connection-messaging-incomplete-route")).toBe(true);
    expect(codes.has("connection-messaging-route-name-prefix")).toBe(true);
  });

  it("flags @inputs references outside action with-bindings", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "InputScopeBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        get_status:",
        '            description: "Get station status."',
        "            inputs:",
        "                station_name: string",
        "            outputs:",
        "                status: string",
        '            target: "flow://Get_Station_Status"',
        "    reasoning:",
        "        instructions: ->",
        "            run @actions.get_status",
        "                with station_name = ...",
        "                set @variables.station = @inputs.station_name",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const inputsScope = result.diagnostics.find((d) => d.code === "inputs-out-of-scope");
    expect(inputsScope, "expected inputs-out-of-scope diagnostic").toBeDefined();
    expect(inputsScope?.severity).toBe(1);
  });

  it("does not flag @inputs references inside action with-bindings or literal text", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "InputScopeBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        get_status:",
        '            description: "Get station status."',
        "            inputs:",
        "                station_name: string",
        "            outputs:",
        "                status: string",
        '            target: "flow://Get_Station_Status"',
        "    reasoning:",
        "        instructions: ->",
        "            | Literal docs may mention @inputs.station_name without executing it.",
        "            run @actions.get_status",
        "                with station_name = @inputs.station_name",
        "                set @variables.status = @outputs.status",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    expect(result.diagnostics.some((d) => d.code === "inputs-out-of-scope")).toBe(false);
  });

  it("flags @outputs references outside set/if post-action statements", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "OutputScopeBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        get_status:",
        '            description: "Get station status."',
        "            inputs:",
        "                station_name: string",
        "            outputs:",
        "                status: string",
        '            target: "flow://Get_Station_Status"',
        "    reasoning:",
        "        instructions: ->",
        "            | Literal docs should not rely on @outputs.status.",
        "            run @actions.get_status",
        "                with station_name = ...",
        "                with previous_status = @outputs.status",
        "                set @variables.status = @outputs.status",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const outputScope = result.diagnostics.filter((d) => d.code === "outputs-out-of-scope");
    expect(outputScope).toHaveLength(2);
    expect(outputScope.some((d) => d.severity === 1)).toBe(true);
    expect(outputScope.some((d) => d.severity === 2)).toBe(true);
  });

  it("flags procedural statements inside literal instructions", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "LiteralModeBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    reasoning:",
        "        instructions: |",
        "            if @variables.verified == True:",
        "                transition to @subagent.done",
        "",
        "subagent done:",
        '    description: "Done."',
        "    reasoning:",
        "        instructions: ->",
        "            | Done.",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const literal = result.diagnostics.filter((d) => d.code === "literal-mode-procedural-text");
    expect(literal.length).toBeGreaterThanOrEqual(1);
    expect(literal.every((d) => d.severity === 2)).toBe(true);
  });

  it("warns on run inside after_reasoning", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "AfterReasoningBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        log_turn:",
        '            description: "Log turn."',
        "            outputs:",
        "                logged: boolean",
        '            target: "flow://Log_Turn"',
        "    reasoning:",
        "        instructions: ->",
        "            | Help the user.",
        "    after_reasoning:",
        "        run @actions.log_turn",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const runAfter = result.diagnostics.find((d) => d.code === "run-in-after-reasoning");
    expect(runAfter, "expected run-in-after-reasoning diagnostic").toBeDefined();
    expect(runAfter?.severity).toBe(2);
  });

  it("warns when prompt template promptResponse lacks planner/display flags", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "PromptTemplateBot"',
        '    default_agent_user: "hello@world.com"',
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    actions:",
        "        generate_reply:",
        '            description: "Generate a reply."',
        "            outputs:",
        "                promptResponse: string",
        '            target: "generatePromptResponse://Generate_Reply"',
        "    reasoning:",
        "        actions:",
        "            reply: @actions.generate_reply",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const promptFlags = result.diagnostics.find((d) => d.code === "prompt-template-output-flags");
    expect(promptFlags, "expected prompt-template-output-flags diagnostic").toBeDefined();
    expect(promptFlags?.severity).toBe(2);
  });

  it("does not flag adaptive-only connection messaging config", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "ServiceBot"',
        '    agent_type: "AgentforceServiceAgent"',
        '    default_agent_user: "service@example.com"',
        "",
        "connection messaging:",
        "    adaptive_response_allowed: True",
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    reasoning:",
        "        instructions: ->",
        "            | respond to whatever the user says.",
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const codes = new Set(result.diagnostics.map((d) => d.code));
    expect(codes.has("connection-messaging-incomplete-route")).toBe(false);
    expect(codes.has("connection-messaging-route-name-prefix")).toBe(false);
  });

  it("flags Employee Agent config that uses Service-Agent-only wiring", async () => {
    const file = writeTempAgent(
      [
        "system:",
        '    instructions: "You are helpful."',
        "",
        "config:",
        '    agent_name: "EmployeeBot"',
        '    agent_type: "AgentforceEmployeeAgent"',
        '    default_agent_user: "service@example.com"',
        "",
        "connection messaging:",
        "    adaptive_response_allowed: True",
        "",
        "start_agent hello_world:",
        '    description: "Entry topic."',
        "    reasoning:",
        "        actions:",
        '            escalate: @utils.escalate description="Escalate to a human"',
        "",
      ].join("\n"),
    );

    const result = await checkAgentScriptFile(file);
    const codes = new Set(result.diagnostics.map((d) => d.code));
    expect(codes.has("employee-agent-default-user")).toBe(true);
    expect(codes.has("employee-agent-connection-messaging")).toBe(true);
    expect(codes.has("employee-agent-escalate")).toBe(true);

    const defaultUserFix = result.quickFixes.find(
      (f) => f.diagnosticCode === "employee-agent-default-user",
    );
    expect(defaultUserFix?.title).toBe("Remove default_agent_user from Employee Agent config");
    expect(defaultUserFix?.edits[0].newText).toBe("");

    expect(
      result.quickFixes.some((f) => f.diagnosticCode === "employee-agent-connection-messaging"),
    ).toBe(false);
    expect(result.quickFixes.some((f) => f.diagnosticCode === "employee-agent-escalate")).toBe(
      false,
    );
  });
});
