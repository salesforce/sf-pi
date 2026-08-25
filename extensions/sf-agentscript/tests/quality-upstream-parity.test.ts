/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Strict fixture parity for the 20-rule native quality catalog.
 *
 * Similar diagnostic names are not sufficient for deletion. These snapshots
 * pin code, source, severity, complete range, message, data, quick fixes, and
 * execution context for the installed official packages and SF Pi projection.
 */
import { agentforceSchemaContext, parse } from "@sf-agentscript/agentforce";
import { LintEngine, type AstRoot, type SchemaContext } from "@sf-agentscript/language";
import { describe, expect, test } from "vitest";
import { analyzeAgentScriptSource } from "../lib/agentforce-document.ts";
import { buildQuickFixes } from "../lib/code-actions.ts";
import {
  AGENT_SCRIPT_QUALITY_RULE_IDS,
  AGENT_SCRIPT_QUALITY_RULES,
  type AgentScriptQualityRuleId,
} from "../lib/quality/catalog.ts";
import { runAgentScriptQuality } from "../lib/quality/engine.ts";
import { QUALITY_SOURCE, QualityFactsPass, createQualityRulePass } from "../lib/quality/rules.ts";

interface ParityCase {
  name: string;
  ruleIds: AgentScriptQualityRuleId[];
  executionContext: string;
  source: string;
}

function agentSource(body: string, variables = ""): string {
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

const actionHead = `start_agent main:
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
        instructions: ->`;

const cases: ParityCase[] = [
  {
    name: "deterministic missing input",
    ruleIds: ["deterministic-action-missing-input"],
    executionContext: "deterministic run in reasoning.instructions",
    source: agentSource(`${actionHead}
            run @actions.lookup`),
  },
  {
    name: "deterministic unknown input",
    ruleIds: ["deterministic-action-missing-input", "deterministic-action-unknown-input"],
    executionContext: "deterministic run with misspelled with-binding",
    source: agentSource(`${actionHead}
            run @actions.lookup
                with qury = "x"`),
  },
  {
    name: "deterministic input type mismatch",
    ruleIds: ["deterministic-action-input-type-mismatch"],
    executionContext: "deterministic run with known literal input type",
    source: agentSource(`${actionHead}
            run @actions.lookup
                with query = 42`),
  },
  {
    name: "deterministic slot filling",
    ruleIds: ["slot-filling-in-deterministic-action"],
    executionContext: "deterministic run with ellipsis input",
    source: agentSource(`${actionHead}
            run @actions.lookup
                with query = ...`),
  },
  {
    name: "deterministic output type mismatch",
    ruleIds: ["deterministic-action-output-type-mismatch"],
    executionContext: "deterministic run output assigned to mutable variable",
    source: agentSource(
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
                with query = "ok"
                set @variables.name = @outputs.score`,
      `    name: mutable string = ""
        description: "Name"`,
    ),
  },
  {
    name: "deep deterministic action chain",
    ruleIds: ["action-chain-too-deep"],
    executionContext: "second nested deterministic follow-up",
    source: agentSource(`start_agent main:
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
  },
  {
    name: "unconditional transition cycle",
    ruleIds: ["unconditional-transition-cycle"],
    executionContext: "component graph with unconditional deterministic transitions",
    source: agentSource(`start_agent main:
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
  },
  {
    name: "conditional transition cycle",
    ruleIds: ["conditional-transition-cycle"],
    executionContext: "component graph with conditional deterministic transitions",
    source: agentSource(
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
  },
  {
    name: "delegation cycle and unreachable subagent",
    ruleIds: ["unreachable-subagent", "subagent-delegation-cycle"],
    executionContext: "returning subagent graph plus orphan declaration",
    source: agentSource(`start_agent main:
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
  },
  {
    name: "unused action",
    ruleIds: ["unused-action"],
    executionContext: "scoped action declaration without invocation",
    source: agentSource(`start_agent main:
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
  },
  {
    name: "prompt and action before transition",
    ruleIds: ["discarded-prompt-before-transition", "action-before-transition"],
    executionContext: "procedure statements before guaranteed transition",
    source: agentSource(`start_agent main:
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
            transition to @subagent.next
subagent next:
    description: "Next"
    reasoning:
        instructions: ->
            | Next`),
  },
  {
    name: "list element and index types",
    ruleIds: ["list-element-type-mismatch", "non-numeric-list-index"],
    executionContext: "typed list literal and statically nonnumeric subscript",
    source: agentSource(
      `start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            if @variables.names["first"] is not None:
                | Help`,
      `    names: mutable list[string] = ["Ada", 42]
        description: "Names"`,
    ),
  },
  {
    name: "slot-filled variable description",
    ruleIds: ["slot-filled-variable-missing-description"],
    executionContext: "planner-selected setVariables binding",
    source: agentSource(
      `start_agent main:
    description: "Main"
    reasoning:
        actions:
            capture: @utils.setVariables
                with reference = ...`,
      `    reference: mutable string`,
    ),
  },
  {
    name: "variable description max length",
    ruleIds: ["variable-description-max-length"],
    executionContext: "variable declaration with a description over the publish limit",
    source: agentSource(
      `start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            | Help`,
      `    current_step: mutable string = "start"
        description: "${"a".repeat(256)}"`,
    ),
  },
  {
    name: "instruction template syntax",
    ruleIds: ["instruction-template-syntax"],
    executionContext: "official instruction interpolation diagnostic projected into quality",
    source: agentSource(
      `start_agent main:
    description: "Main"
    reasoning:
        instructions: |
            Use @variables.current_step to decide what to do next.`,
      `    current_step: mutable string = "start"
        description: "Current step"`,
    ),
  },
  {
    name: "prompt template output flags",
    ruleIds: ["prompt-template-output-flags"],
    executionContext: "prompt-response action output declaration",
    source: agentSource(`start_agent main:
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
  },
  {
    name: "cyclomatic complexity",
    ruleIds: ["cyclomatic-complexity"],
    executionContext: "procedure with if and short-circuit expressions",
    source: agentSource(
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
  },
];

const plannerActionCases = [
  {
    name: "planner action unknown input",
    absentLocalRule: "deterministic-action-unknown-input" as const,
    expectedUpstreamCode: "action-unknown-input",
    source: agentSource(`start_agent main:
    description: "Main"
    actions:
        lookup:
            description: "Lookup"
            inputs:
                query: string
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            | Help
        actions:
            check: @actions.lookup
                with qury = "x"`),
  },
  {
    name: "planner action missing input",
    absentLocalRule: "deterministic-action-missing-input" as const,
    expectedUpstreamCode: "action-missing-input",
    source: agentSource(`start_agent main:
    description: "Main"
    actions:
        lookup:
            description: "Lookup"
            inputs:
                query: string
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            | Help
        actions:
            check: @actions.lookup`),
  },
  {
    name: "planner action input type mismatch",
    absentLocalRule: "deterministic-action-input-type-mismatch" as const,
    expectedUpstreamCode: "type-mismatch",
    source: agentSource(
      `start_agent main:
    description: "Main"
    actions:
        lookup:
            description: "Lookup"
            inputs:
                query: string
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            | Help
        actions:
            check: @actions.lookup
                with query = @variables.is_valid`,
      `    is_valid: mutable boolean = False
        description: "Whether valid"`,
    ),
  },
];

function rawQualityDiagnostics(source: string) {
  const document = parse(source);
  const engine = new LintEngine({
    source: QUALITY_SOURCE,
    passes: [
      new QualityFactsPass(),
      ...AGENT_SCRIPT_QUALITY_RULES.filter(
        (definition) => definition.severity !== "metric" && !definition.upstreamDiagnosticCode,
      ).map((definition) => createQualityRulePass(definition.id)),
    ],
  });
  return engine
    .run(document.ast as unknown as AstRoot, agentforceSchemaContext as unknown as SchemaContext)
    .diagnostics.filter((diagnostic) => diagnostic.source === QUALITY_SOURCE);
}

function compactDiagnostic(diagnostic: {
  code?: string | number;
  severity: number;
  source?: string;
  message: string;
  range: unknown;
  data?: unknown;
}) {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    source: diagnostic.source,
    message: diagnostic.message,
    range: diagnostic.range,
    data: diagnostic.data,
  };
}

function compactQuickFix(fix: Awaited<ReturnType<typeof buildQuickFixes>>[number]) {
  return {
    title: fix.title,
    preferred: fix.preferred,
    diagnostic_line: fix.diagnosticLine,
    diagnostic_code: fix.diagnosticCode,
    edits: fix.edits,
  };
}

describe("quality upstream strict parity", () => {
  test.each(cases)("$name", async (fixture) => {
    const upstream = await analyzeAgentScriptSource(fixture.source);
    expect(upstream.ok).toBe(true);
    if (!upstream.ok) return;
    const local = await runAgentScriptQuality(fixture.source, {
      upstreamDiagnostics: upstream.analysis.compileDiagnostics,
    });

    for (const ruleId of fixture.ruleIds) {
      if (ruleId === "cyclomatic-complexity") {
        expect(local.metrics.cyclomatic_complexity.length).toBeGreaterThan(0);
      } else {
        expect(local.findings.map((finding) => finding.rule_id)).toContain(ruleId);
      }
    }

    const quickFixes = await buildQuickFixes(
      fixture.source,
      upstream.analysis.compileDiagnostics,
      upstream.analysis.documentState,
    );
    expect({
      execution_context: fixture.executionContext,
      local_diagnostics: rawQualityDiagnostics(fixture.source).map(compactDiagnostic),
      local_findings: local.findings
        .filter((finding) => fixture.ruleIds.includes(finding.rule_id))
        .map((finding) => ({
          code: finding.rule_id,
          severity: finding.severity,
          message: finding.message,
          range: finding.range,
          suggestion: finding.suggestion,
          evidence: finding.evidence,
        })),
      metrics: fixture.ruleIds.includes("cyclomatic-complexity")
        ? local.metrics.cyclomatic_complexity
        : [],
      upstream: upstream.analysis.compileDiagnostics.map(compactDiagnostic),
      upstream_quick_fixes: quickFixes.map(compactQuickFix),
      strict_parity: false,
      decision: fixture.ruleIds.includes("instruction-template-syntax")
        ? "reuse-upstream"
        : "retain-local",
    }).toMatchSnapshot();
  });

  test.each(plannerActionCases)("$name", async (fixture) => {
    const local = await runAgentScriptQuality(fixture.source);
    const upstream = await analyzeAgentScriptSource(fixture.source);
    expect(local.findings.map((finding) => finding.rule_id)).not.toContain(fixture.absentLocalRule);
    expect(upstream.ok).toBe(true);
    if (!upstream.ok) return;
    expect(upstream.analysis.compileDiagnostics.map((diagnostic) => diagnostic.code)).toContain(
      fixture.expectedUpstreamCode,
    );
    const quickFixes = await buildQuickFixes(
      fixture.source,
      upstream.analysis.compileDiagnostics,
      upstream.analysis.documentState,
    );
    expect({
      execution_context: "planner-selected reasoning.actions binding",
      local_diagnostics: rawQualityDiagnostics(fixture.source).map(compactDiagnostic),
      upstream: upstream.analysis.compileDiagnostics.map(compactDiagnostic),
      upstream_quick_fixes: quickFixes.map(compactQuickFix),
    }).toMatchSnapshot();
  });

  test("covers every current quality rule exactly through an explicit fixture", () => {
    const covered = new Set(cases.flatMap((fixture) => fixture.ruleIds));
    expect([...covered].sort()).toEqual([...AGENT_SCRIPT_QUALITY_RULE_IDS].sort());
  });

  test("disabling a local projection does not hide sibling local findings", async () => {
    const fixture = cases.find((entry) => entry.name === "list element and index types")!;
    const local = await runAgentScriptQuality(fixture.source, {
      ruleOverrides: { "list-element-type-mismatch": false },
    });
    expect(local.findings.map((finding) => finding.rule_id)).not.toContain(
      "list-element-type-mismatch",
    );
    expect(local.findings.map((finding) => finding.rule_id)).toContain("non-numeric-list-index");
  });
});
