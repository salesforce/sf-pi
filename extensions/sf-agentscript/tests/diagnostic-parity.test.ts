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
import { buildQuickFixes } from "../lib/code-actions.ts";
import { checkAgentScriptSource } from "../lib/diagnostics.ts";

interface ParityCase {
  name: string;
  source: string;
  localCodes: string[];
  upstreamCodes: string[];
  decision: "retain-local" | "completed-upstream-handoff" | "historical-no-local-projection";
  executionContext: string;
}

const baseHead = [
  "system:",
  '    instructions: "You are helpful."',
  "",
  "config:",
  '    agent_name: "Bot"',
  "",
  "access:",
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
    name: "Apex target with method suffix",
    localCodes: ["apex-target-method-suffix"],
    upstreamCodes: [],
    decision: "retain-local",
    executionContext: "Apex action target declaration",
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
    decision: "retain-local",
    executionContext: "Flow action target declaration",
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
    upstreamCodes: ["object-type-missing-schema", "object-type-missing-schema"],
    decision: "completed-upstream-handoff",
    executionContext: "planner-selected object action binding",
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
    localCodes: [],
    upstreamCodes: [],
    decision: "historical-no-local-projection",
    executionContext: "planner-selected numeric action binding",
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
    name: "@inputs reference outside action with-bindings",
    localCodes: ["inputs-out-of-scope"],
    upstreamCodes: ["(no-code)"],
    decision: "retain-local",
    executionContext: "@inputs reference in deterministic post-action set",
    source: withStart([
      ...action("get_status", [
        "            inputs:",
        "                station_name: string",
        "            outputs:",
        "                status: string",
      ]),
      "                set @variables.station = @inputs.station_name",
    ]),
  },
  {
    name: "@outputs reference outside post-action set/if statements",
    localCodes: ["outputs-out-of-scope"],
    upstreamCodes: [],
    decision: "retain-local",
    executionContext: "@outputs reference in deterministic action with-binding",
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
    localCodes: [],
    upstreamCodes: ["unused-variable", "instruction-template-syntax"],
    decision: "completed-upstream-handoff",
    executionContext: "procedural-looking content in literal instructions",
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
];

describe("local hardening diagnostic parity", () => {
  test.each(cases)(
    "$name",
    async ({ source, localCodes, upstreamCodes, decision, executionContext }) => {
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
        expect(
          actualUpstreamCodes,
          `${code} is not currently an upstream-owned code`,
        ).not.toContain(code);
      }

      const quickFixes = await buildQuickFixes(
        source,
        upstream.analysis.compileDiagnostics,
        upstream.analysis.documentState,
      );
      expect({
        decision,
        execution_context: executionContext,
        local: sfPi.diagnostics
          .filter((diagnostic) => localCodes.includes(String(diagnostic.code ?? "")))
          .map((diagnostic) => ({
            code: diagnostic.code,
            severity: diagnostic.severity,
            source: diagnostic.source,
            message: diagnostic.message,
            range: diagnostic.range,
            data: diagnostic.data,
          })),
        upstream: upstream.analysis.compileDiagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          severity: diagnostic.severity,
          source: diagnostic.source,
          message: diagnostic.message,
          range: diagnostic.range,
          data: diagnostic.data,
        })),
        upstream_quick_fixes: quickFixes.map((fix) => ({
          title: fix.title,
          preferred: fix.preferred,
          diagnostic_line: fix.diagnosticLine,
          diagnostic_code: fix.diagnosticCode,
          edits: fix.edits,
        })),
      }).toMatchSnapshot();
    },
  );

  test("classification table covers every remaining local diagnostic code", () => {
    const covered = new Set(cases.flatMap((entry) => entry.localCodes));
    expect([...covered].sort()).toEqual([
      "apex-target-method-suffix",
      "inputs-out-of-scope",
      "outputs-out-of-scope",
      "target-ref-looks-like-id",
    ]);
  });
});
