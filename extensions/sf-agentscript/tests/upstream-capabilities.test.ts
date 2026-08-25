/* SPDX-License-Identifier: Apache-2.0 */
/** Compact integration contracts for the official Agent Script package seam. */
import { describe, expect, test } from "vitest";
import {
  analyzeAgentScriptSource,
  combineAgentScriptDiagnostics,
} from "../lib/agentforce-document.ts";
import { checkAgentScriptSource, isAgentScriptCompileValid } from "../lib/diagnostics.ts";
import { inspectSource } from "../lib/inspect.ts";
import { runAgentScriptQuality } from "../lib/quality/engine.ts";
import { loadAgentforceSDK } from "../lib/sdk.ts";

const HEAD = `config:
  agent_name: "ContractBot"
system:
  instructions: "Help"
`;

describe("upstream Agent Script capability contracts", () => {
  test("retains compiler and language-server results for one source identity", async () => {
    const result = await analyzeAgentScriptSource(`${HEAD}start_agent main:
  description: "Main"
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.compileResult.output).toBeDefined();
    expect(result.analysis.compileResult.document.ast).toBeDefined();
    expect(result.analysis.compileResult.ranges).toBeDefined();
    expect(result.analysis.documentState.ast).toBeDefined();
    expect(result.analysis.documentState.service).toBeDefined();
    expect(result.analysis.documentState.compileOutput).toBeDefined();
  });

  test("defines compile validity by severity-1 errors only", () => {
    expect(isAgentScriptCompileValid([{ severity: 2 }, { severity: 3 }, { severity: 4 }])).toBe(
      true,
    );
    expect(isAgentScriptCompileValid([{ severity: 1 }, { severity: 3 }])).toBe(false);
  });

  test("merges duplicate severity, tags, and complementary data deterministically", () => {
    const range = { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } };
    const result = combineAgentScriptDiagnostics(
      [
        {
          code: "shared",
          severity: 3,
          message: "Shared diagnostic",
          range,
          source: "compiler",
          tags: [1],
          data: { compiler: true, winner: "first" },
        },
      ],
      [
        {
          code: "shared",
          severity: 1,
          message: "Shared diagnostic",
          range,
          source: "language-server",
          tags: [2],
          data: { lsp: true, winner: "second" },
        },
        {
          code: "earlier",
          severity: 2,
          message: "Earlier diagnostic",
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
        },
      ],
    );

    expect(result.map((diagnostic) => diagnostic.code)).toEqual(["earlier", "shared"]);
    expect(result[1]).toMatchObject({
      severity: 1,
      source: "compiler",
      tags: [1, 2],
      data: { compiler: true, lsp: true, winner: "first" },
    });
  });

  test("uses complete diagnostic identity and severity/code ordering ties", () => {
    const range = { start: { line: 4, character: 2 }, end: { line: 4, character: 6 } };
    const widerRange = { start: range.start, end: { line: 4, character: 7 } };
    const result = combineAgentScriptDiagnostics([
      { code: "shared", severity: 3, message: "Message", range },
      { code: "shared", severity: 3, message: "Message", range },
      { code: "other", severity: 3, message: "Message", range },
      { code: "shared", severity: 3, message: "Different", range },
      { code: "shared", severity: 3, message: "Message", range: widerRange },
      { code: "z-code", severity: 2, message: "Z", range },
      { code: "a-code", severity: 2, message: "A", range },
    ]);

    expect(result).toHaveLength(6);
    expect(result.slice(0, 2).map((diagnostic) => diagnostic.code)).toEqual(["a-code", "z-code"]);
    expect(
      result.filter(
        (diagnostic) =>
          diagnostic.code === "shared" &&
          diagnostic.message === "Message" &&
          diagnostic.range.end.character === 6,
      ),
    ).toHaveLength(1);
  });

  test("keeps shared compiler AST projections stable across consumer order", async () => {
    const source = `${HEAD}start_agent main:
  description: "Main"
  actions:
    unused:
      description: "Unused"
      target: "flow://Unused"
`;
    const evaluate = async (qualityFirst: boolean) => {
      const upstream = await analyzeAgentScriptSource(source);
      expect(upstream.ok).toBe(true);
      if (upstream.ok === false) throw new Error(upstream.unavailableReason);
      const quality = () =>
        runAgentScriptQuality(source, {
          document: {
            source,
            ast: upstream.analysis.compileResult.document.ast,
            hasErrors: upstream.analysis.compileResult.document.hasErrors,
          },
          upstreamDiagnostics: upstream.analysis.compileDiagnostics,
        });
      const compile = () => checkAgentScriptSource(source, upstream);
      const inspect = () => inspectSource(source, upstream);
      return qualityFirst
        ? { quality: await quality(), compile: await compile(), inspect: await inspect() }
        : { compile: await compile(), inspect: await inspect(), quality: await quality() };
    };

    expect(await evaluate(true)).toEqual(await evaluate(false));
  });

  test("fails closed when a reused document omits required upstream diagnostics", async () => {
    const source = `${HEAD}start_agent main:\n  description: "Main"\n`;
    const upstream = await analyzeAgentScriptSource(source);
    expect(upstream.ok).toBe(true);
    if (upstream.ok === false) throw new Error(upstream.unavailableReason);

    await expect(
      runAgentScriptQuality(source, {
        document: {
          source,
          ast: upstream.analysis.compileResult.document.ast,
          hasErrors: upstream.analysis.compileResult.document.hasErrors,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "failed",
      failure_reason: "Official Agent Script diagnostics were unavailable for quality analysis.",
    });
  });

  test("rejects mismatched reusable success, failure, and document identities", async () => {
    const sourceA = `${HEAD}variables:\n  stale: mutable string = "x"\nstart_agent main:\n  description: "A"\n`;
    const sourceB = `${HEAD}start_agent main:\n  description: "B"\n`;
    const analysisA = await analyzeAgentScriptSource(sourceA);
    expect(analysisA.ok).toBe(true);
    if (analysisA.ok === false) throw new Error(analysisA.unavailableReason);

    const compileB = await checkAgentScriptSource(sourceB, analysisA);
    expect(compileB.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "unused-variable",
    );
    const inspectB = await inspectSource(sourceB, analysisA);
    expect(inspectB.components?.start_agents?.[0]?.description).toBe("B");

    const failedA = {
      ok: false as const,
      source: sourceA,
      failureKind: "sdk_unavailable" as const,
      unavailableReason: "stale failure",
    };
    await expect(checkAgentScriptSource(sourceB, failedA)).resolves.toMatchObject({ ok: true });
    await expect(inspectSource(sourceB, failedA)).resolves.toMatchObject({ ok: true });

    const qualityWithStaleDocument = await runAgentScriptQuality(sourceB, {
      document: {
        source: sourceA,
        ast: analysisA.analysis.compileResult.document.ast,
        hasErrors: analysisA.analysis.compileResult.document.hasErrors,
      },
    });
    expect(qualityWithStaleDocument).toEqual(await runAgentScriptQuality(sourceB));
  });

  test("deduplicates shared diagnostics while preserving unique dialect diagnostics", async () => {
    const result = await checkAgentScriptSource(`# @dialect: unknown 1.0
${HEAD}variables:
  unused: mutable string = "x"
start_agent main:
  description: "Main"
`);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes.filter((code) => code === "unknown-dialect")).toHaveLength(1);
    expect(codes.filter((code) => code === "unused-variable")).toHaveLength(1);
    expect(codes.indexOf("unknown-dialect")).toBeLessThan(codes.indexOf("unused-variable"));
    expect(isAgentScriptCompileValid(result.diagnostics)).toBe(false);
  });

  test("preserves upstream warnings that have no quick fix", async () => {
    const result = await checkAgentScriptSource(`${HEAD}variables:
  name: mutable string = "x"
start_agent main:
  description: "Main"
  actions:
    check:
      description: "Check"
      target: "flow://Check"
      outputs:
        ok: boolean
  reasoning:
    instructions: ->
      |Do something
    actions:
      do_check: @actions.check
        available when @variables.name
`);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "available-when-non-boolean", severity: 2 }),
      ]),
    );
  });

  test("preserves the ask-for beta-services diagnostic", async () => {
    const result = await checkAgentScriptSource(`${HEAD}variables:
  email: mutable string = None
start_agent main:
  description: "Entry"
  transition to @subagent.gather
subagent gather:
  description: "Gather"
  reasoning:
    instructions: ->
      ask for @variables.email
        instructions: "What is your email?"
`);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ask-for-beta-services", severity: 3 }),
      ]),
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 1)).toBe(false);
  });

  test("treats legacy collect syntax as a compile error", async () => {
    const result = await checkAgentScriptSource(`${HEAD}variables:
  email: mutable string = None
start_agent main:
  description: "Entry"
  transition to @subagent.gather
subagent gather:
  description: "Gather"
  reasoning:
    instructions: ->
      collect @variables.email
        message: "What is your email?"
`);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 1)).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "collect-experimental",
    );
  });

  test("accepts else-if syntax through sf-pi's lazy package adapter", async () => {
    const result = await checkAgentScriptSource(`${HEAD}variables:
  route: mutable string = "a"
start_agent main:
  description: "Entry"
  reasoning:
    instructions: ->
      if @variables.route == "a":
        | A
      else if @variables.route == "b":
        | B
      else:
        | C
`);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 1)).toBe(false);
  });

  test("compiles connected-agent post-response behavior", async () => {
    const sdk = await loadAgentforceSDK();
    expect(sdk).not.toBeNull();
    const result = sdk!.compileSource(`${HEAD}variables:
  done: mutable boolean = False
connected_subagent helper:
  target: "agent://Helper"
  description: "Helper"
  delegate_escalation: False
  after_response:
    set @variables.done = True
start_agent main:
  description: "Entry"
  reasoning:
    instructions: ->
      transition to @connected_subagent.helper
`);
    expect(
      result.diagnostics.some((diagnostic) => (diagnostic as { severity?: number }).severity === 1),
    ).toBe(false);
    const output = JSON.stringify(result.output);
    expect(output).toContain('"after_response"');
    expect(output).toContain('"delegate_escalation":false');
  });
});
