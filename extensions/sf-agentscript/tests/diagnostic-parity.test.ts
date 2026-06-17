/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Parity map for SF Pi local hardening diagnostics vs upstream AgentScript
 * diagnostics. This is intentionally behavior-neutral: it proves which local
 * diagnostics still exist, records the upstream diagnostic codes for the same
 * fixtures, and prevents future cleanup from deleting Salesforce/pi-specific
 * hardening without evidence.
 */

import { describe, expect, test } from "vitest";
import { analyzeAgentScriptSource } from "../lib/agentforce-document.ts";
import { checkAgentScriptSource } from "../lib/diagnostics.ts";

interface ParityCase {
  name: string;
  source: string;
  localCodes: string[];
  upstreamCodes: string[];
  classification: "upstream-owned" | "sf-pi-owned" | "possible-future-deletion";
}

const baseHead = [
  "system:",
  '    instructions: "You are helpful."',
  "",
  "config:",
  '    agent_name: "Bot"',
  '    default_agent_user: "hello@example.com"',
  "",
];

function agent(lines: string[]): string {
  return [...lines, ""].join("\n");
}

function withStart(body: string[]): string {
  return agent([...baseHead, "start_agent main:", '    description: "Entry."', ...body]);
}

function action(name: string, extra: string[], target = "flow://DoThing"): string[] {
  return [
    "    actions:",
    `        ${name}:`,
    '            description: "Do thing."',
    ...extra,
    `            target: "${target}"`,
    "    reasoning:",
    "        actions:",
    `            call: @actions.${name}`,
  ];
}

const cases: ParityCase[] = [
  {
    name: "target-backed action without outputs",
    localCodes: ["action-missing-outputs"],
    upstreamCodes: [],
    classification: "sf-pi-owned",
    source: withStart(action("lookup", [])),
  },
  {
    name: "Apex target with method suffix",
    localCodes: ["apex-target-method-suffix"],
    upstreamCodes: [],
    classification: "sf-pi-owned",
    source: withStart(
      action(
        "update_order",
        ["            outputs:", "                ok: boolean"],
        "apex://OrderController.updateOrder",
      ),
    ),
  },
  {
    name: "target reference that looks like a Salesforce id",
    localCodes: ["target-ref-looks-like-id"],
    upstreamCodes: [],
    classification: "sf-pi-owned",
    source: withStart(
      action(
        "weather",
        ["            outputs:", "                ok: string"],
        "flow://300WX000001ABCD",
      ),
    ),
  },
  {
    name: "object action I/O without contract hints",
    localCodes: [],
    upstreamCodes: [
      "object-type-missing-schema",
      "object-type-missing-schema",
      "action-missing-input",
    ],
    classification: "upstream-owned",
    source: withStart(
      action("find_order", [
        "            inputs:",
        "                filter: object",
        "            outputs:",
        "                order_data: object",
      ]),
    ),
  },
  {
    name: "bare numeric action inputs and outputs",
    localCodes: ["numeric-action-io"],
    upstreamCodes: ["action-missing-input"],
    classification: "sf-pi-owned",
    source: withStart(
      action(
        "calc",
        [
          "            inputs:",
          "                amount: number",
          "            outputs:",
          "                total: number",
        ],
        "apex://CalculateDiscountAction",
      ),
    ),
  },
  {
    name: "invalid connection messaging route config",
    localCodes: ["connection-messaging-incomplete-route", "connection-messaging-route-name-prefix"],
    upstreamCodes: [],
    classification: "sf-pi-owned",
    source: agent([
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
      "start_agent main:",
      '    description: "Entry."',
      "    reasoning:",
      "        instructions: ->",
      "            | hi",
    ]),
  },
  {
    name: "@inputs reference outside action with-bindings",
    localCodes: ["inputs-out-of-scope"],
    upstreamCodes: ["action-missing-input"],
    classification: "sf-pi-owned",
    source: withStart([
      ...action("get_status", [
        "            inputs:",
        "                station_name: string",
        "            outputs:",
        "                status: string",
      ]),
      "            set @variables.station = @inputs.station_name",
    ]),
  },
  {
    name: "@outputs reference outside post-action set/if statements",
    localCodes: ["outputs-out-of-scope"],
    upstreamCodes: [],
    classification: "sf-pi-owned",
    source: withStart([
      ...action("get_status", [
        "            inputs:",
        "                station_name: string",
        "                previous_status: string",
        "            outputs:",
        "                status: string",
      ]),
      "                with station_name = ...",
      "                with previous_status = @outputs.status",
      "                set @variables.status = @outputs.status",
    ]),
  },
  {
    name: "procedural statements inside literal instructions",
    localCodes: ["literal-mode-procedural-text"],
    upstreamCodes: ["unused-variable"],
    classification: "sf-pi-owned",
    source: agent([
      ...baseHead,
      "variables:",
      "    verified: boolean = False",
      "",
      "start_agent main:",
      '    description: "Entry."',
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
    ]),
  },
  {
    name: "run inside after_reasoning",
    localCodes: ["run-in-after-reasoning"],
    upstreamCodes: [],
    classification: "sf-pi-owned",
    source: withStart([
      ...action(
        "log_turn",
        ["            outputs:", "                logged: boolean"],
        "flow://Log_Turn",
      ),
      "    after_reasoning:",
      "        run @actions.log_turn",
    ]),
  },
  {
    name: "prompt template output without planner/display flags",
    localCodes: ["prompt-template-output-flags"],
    upstreamCodes: [],
    classification: "sf-pi-owned",
    source: withStart(
      action(
        "generate_reply",
        ["            outputs:", "                promptResponse: string"],
        "generatePromptResponse://Generate_Reply",
      ),
    ),
  },
  {
    name: "Employee Agent with Service-Agent-only wiring",
    localCodes: ["employee-agent-connection-messaging", "employee-agent-escalate"],
    upstreamCodes: ["config-ignored-default-agent-user"],
    classification: "upstream-owned",
    source: agent([
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
      "start_agent main:",
      '    description: "Entry."',
      "    reasoning:",
      "        actions:",
      "            escalate: @utils.escalate",
    ]),
  },
];

describe("local hardening diagnostic parity", () => {
  test.each(cases)("$name", async ({ source, localCodes, upstreamCodes }) => {
    const upstream = await analyzeAgentScriptSource(source);
    expect(upstream.ok).toBe(true);
    if (!upstream.ok) return;

    const sfPi = await checkAgentScriptSource(source);
    const allLocalCodes = sfPi.diagnostics.map((diagnostic) => diagnostic.code);

    for (const code of localCodes) {
      expect(allLocalCodes, `expected SF Pi diagnostic ${code}`).toContain(code);
    }

    const actualUpstreamCodes = upstream.analysis.compileDiagnostics.map(
      (diagnostic) => diagnostic.code ?? "(no-code)",
    );
    expect(actualUpstreamCodes).toEqual(upstreamCodes);

    for (const code of localCodes) {
      expect(actualUpstreamCodes, `${code} is not currently an upstream-owned code`).not.toContain(
        code,
      );
    }
  });

  test("classification table covers every remaining local diagnostic code", () => {
    const covered = new Set(cases.flatMap((entry) => entry.localCodes));
    expect([...covered].sort()).toEqual([
      "action-missing-outputs",
      "apex-target-method-suffix",
      "connection-messaging-incomplete-route",
      "connection-messaging-route-name-prefix",
      "employee-agent-connection-messaging",
      "employee-agent-escalate",
      "inputs-out-of-scope",
      "literal-mode-procedural-text",
      "numeric-action-io",
      "outputs-out-of-scope",
      "prompt-template-output-flags",
      "run-in-after-reasoning",
      "target-ref-looks-like-id",
    ]);
  });
});
