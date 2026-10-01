/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import {
  assertConnectedDxContract,
  buildSfMcpE2ePolicy,
  buildSfMcpInvocationPolicy,
  parseSfMcpE2eArgs,
  summarizeAgentProbe,
} from "../e2e/sf-mcp-e2e.ts";

const DX_TOOLS = [
  "get_username",
  "resume_tool_operation",
  "list_all_orgs",
  "run_soql_query",
  "assign_permission_set",
  "deploy_metadata",
  "retrieve_metadata",
  "run_agent_test",
  "run_apex_test",
];

describe("SF MCP E2E harness", () => {
  it("requires explicit org and model arguments", () => {
    expect(parseSfMcpE2eArgs(["--org", "developer-org", "--model", "provider/model"])).toEqual({
      org: "developer-org",
      model: "provider/model",
      keepWorkspace: false,
    });
    expect(() => parseSfMcpE2eArgs(["--model", "provider/model"])).toThrow(/--org requires/i);
    expect(() => parseSfMcpE2eArgs(["--org", "developer-org"])).toThrow(/--model requires/i);
    expect(() =>
      parseSfMcpE2eArgs(["--org", "developer-org", "--model", "provider/model", "--mutate"]),
    ).toThrow(/unknown argument/i);
  });

  it("builds a read-only policy with every mutation or mixed tool hidden", () => {
    const policy = buildSfMcpE2ePolicy();
    expect(policy.profile).toBe("custom");
    expect(policy.exposures).toEqual({
      get_username: "codemode",
      resume_tool_operation: "hidden",
      list_all_orgs: "codemode",
      run_soql_query: "codemode",
      assign_permission_set: "hidden",
      deploy_metadata: "hidden",
      retrieve_metadata: "hidden",
      run_agent_test: "hidden",
      run_apex_test: "hidden",
    });
    expect(buildSfMcpInvocationPolicy().exposures).toEqual({
      ...policy.exposures,
      get_username: "direct",
      run_soql_query: "direct",
    });
  });

  it("accepts only a connected exact Salesforce DX contract", () => {
    expect(
      assertConnectedDxContract(
        {
          servers: [
            {
              name: "salesforce-dx",
              state: "connected",
              tools: DX_TOOLS,
              toolExposure: {
                get_username: "codemode",
                list_all_orgs: "codemode",
                run_soql_query: "codemode",
              },
            },
          ],
          errors: [],
        },
        DX_TOOLS,
      ),
    ).toEqual({
      state: "connected",
      toolCount: 9,
      callableTools: ["get_username", "list_all_orgs", "run_soql_query"],
    });
    expect(() =>
      assertConnectedDxContract(
        {
          servers: [
            { name: "salesforce-dx", state: "connected", tools: [...DX_TOOLS, "new_tool"] },
          ],
          errors: [],
        },
        DX_TOOLS,
      ),
    ).toThrow(/contract drift/i);
  });

  it("requires successful nested username and SOQL calls with no hidden execution", () => {
    const events = [
      {
        type: "tool_execution_start",
        toolCallId: "probe",
        toolName: "sf_mcp_e2e_probe",
        args: {},
      },
      {
        type: "tool_execution_start",
        toolCallId: "probe/1",
        parentToolCallId: "probe",
        toolName: "mcp__salesforce_dx__get_username",
        args: {},
      },
      {
        type: "tool_execution_end",
        toolCallId: "probe/1",
        parentToolCallId: "probe",
        toolName: "mcp__salesforce_dx__get_username",
        isError: false,
      },
      {
        type: "tool_execution_start",
        toolCallId: "probe/2",
        parentToolCallId: "probe",
        toolName: "mcp__salesforce_dx__run_soql_query",
        args: {},
      },
      {
        type: "tool_execution_end",
        toolCallId: "probe/2",
        parentToolCallId: "probe",
        toolName: "mcp__salesforce_dx__run_soql_query",
        isError: false,
      },
      {
        type: "tool_execution_end",
        toolCallId: "probe",
        toolName: "sf_mcp_e2e_probe",
        isError: false,
        result: { content: [{ type: "text", text: "SF_MCP_E2E_PASS" }] },
      },
      { type: "agent_settled" },
    ];

    expect(summarizeAgentProbe(events)).toEqual({
      probeCalled: true,
      usernameCallPassed: true,
      queryCallPassed: true,
      hiddenToolCalls: [],
      settled: true,
    });

    expect(() =>
      summarizeAgentProbe([
        ...events,
        {
          type: "tool_execution_start",
          toolCallId: "unexpected",
          toolName: "mcp__salesforce_dx__deploy_metadata",
          args: {},
        },
      ]),
    ).toThrow(/hidden tool/i);
  });
});
