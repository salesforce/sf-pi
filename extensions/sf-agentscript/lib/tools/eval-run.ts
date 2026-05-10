/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_eval_run
 *
 * Runs a multi-turn regression spec against the Salesforce Evaluation API and
 * returns a hybrid LLM-shaped result:
 *   - small runs (≤ inline_threshold failures, default 5): full failures inline
 *   - larger runs: summary + run_id pointer; LLM follows up via
 *     agentscript_eval_get_failure(run_id, test_id) to drill in
 */

import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../../../../lib/common/exec-adapter.ts";
import { runEval, recordRunInIndex, type RunEvalResult } from "../eval/orchestrator.ts";
import type { EvalSpec } from "../eval/types.ts";

export const EVAL_RUN_TOOL_NAME = "agentscript_eval_run";

const EvalRunParams = Type.Object({
  spec_path: Type.Optional(
    Type.String({
      description:
        "Path to a JSON spec file. Either spec_path OR spec must be provided. Path resolves against cwd.",
    }),
  ),
  spec: Type.Optional(
    Type.Any({
      description:
        "Inline spec object ({ tests: [...] }). Useful when generating specs programmatically.",
    }),
  ),
  target_org: Type.Optional(
    Type.String({
      description: "Salesforce org alias / username. Defaults to the active sf-pi target org.",
    }),
  ),
  agent_api_name: Type.Optional(
    Type.String({
      description:
        "Bot DeveloperName for resolving $active_bot_id / $active_bot_version_id / $active_planner_id placeholders. Required when the spec uses placeholders.",
    }),
  ),
  traces_mode: Type.Optional(
    Type.Union([Type.Literal("failed"), Type.Literal("all"), Type.Literal("off")], {
      description:
        "Planner trace fetch policy. failed=on failures only (default), all=every turn, off=skip the trace endpoint entirely.",
    }),
  ),
  concurrency: Type.Optional(
    Type.Number({
      description: "Max concurrent batch POSTs and trace GETs. Default 8.",
      minimum: 1,
      maximum: 32,
    }),
  ),
  prompt_chars: Type.Optional(
    Type.Number({
      description: "Max chars of llmEvents.prompt_content shown per turn. Default 600.",
      minimum: 100,
      maximum: 4000,
    }),
  ),
  inline_threshold: Type.Optional(
    Type.Number({
      description:
        "If failed_count <= this value, return all failures inline. Otherwise return a summary + run_id and require agentscript_eval_get_failure for drill-in. Default 5.",
      minimum: 0,
      maximum: 100,
    }),
  ),
});

export interface EvalRunInput {
  spec_path?: string;
  spec?: unknown;
  target_org?: string;
  agent_api_name?: string;
  traces_mode?: "failed" | "all" | "off";
  concurrency?: number;
  prompt_chars?: number;
  inline_threshold?: number;
}

export function registerEvalRunTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);

  pi.registerTool({
    name: EVAL_RUN_TOOL_NAME,
    label: "Agent Script eval — run",
    description:
      "Run a multi-turn Agent Script regression spec against the Salesforce Evaluation API. Returns LLM-shaped failures inline for small runs, or a summary + run_id pointer for large runs (drill in via agentscript_eval_get_failure).",
    promptSnippet:
      "Run multi-turn .agent regression tests against /einstein/evaluation/v1/tests with full LLM-debug context.",
    promptGuidelines: [
      "Use agentscript_eval_run after editing a `.agent` file to verify the change end-to-end against a regression spec.",
      "Pass agent_api_name when the spec uses $active_bot_id / $active_bot_version_id / $active_planner_id placeholders.",
      "Default traces_mode is 'failed' — fetches full planner traces only for failing tests. Set 'all' only when you need traces for every turn (cost: extra round-trips).",
      "When a run returns a summary + run_id (large run), use agentscript_eval_get_failure(run_id, test_id) to drill into one failure at a time.",
      "Failed batches indicate transient platform issues; the run continues and returns whatever batches succeeded.",
    ],
    parameters: EvalRunParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as EvalRunInput;
      return await executeEvalRun(exec, ctx, input);
    },
  });
}

export async function executeEvalRun(
  exec: ReturnType<typeof buildExecFn>,
  ctx: ExtensionContext,
  input: EvalRunInput,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}> {
  const targetOrg = input.target_org ?? (await getDefaultOrg(exec, ctx.cwd));
  if (!targetOrg) {
    return errorResult(
      "No target org. Suggested fix: pass target_org explicitly or run `sf config set target-org=<alias>`.",
    );
  }

  const spec = await loadSpec(input, ctx.cwd);
  if (!spec) {
    return errorResult(
      "Either spec_path or spec must be provided. Suggested fix: pass spec_path: '<file.json>'.",
    );
  }

  let result: RunEvalResult;
  try {
    result = await runEval(exec, {
      spec,
      targetOrg,
      agentApiName: input.agent_api_name,
      tracesMode: input.traces_mode ?? "failed",
      concurrency: input.concurrency ?? 8,
      promptChars: input.prompt_chars ?? 600,
      cwd: ctx.cwd,
      specPath: input.spec_path,
      log: () => {
        /* runs may be long; we let the caller poll the run_dir for progress */
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(msg);
  }

  await recordRunInIndex(ctx.cwd, result.run_id);

  const inlineThreshold = input.inline_threshold ?? 5;
  const passed = result.totals.test_fail === 0 && result.totals.errors === 0;
  const head = headline(result, passed);

  const summaryPayload = {
    run_id: result.run_id,
    run_dir: result.run_dir,
    ok: passed,
    totals: result.metadata.totals,
    latency: result.latency,
    failed_batches: result.failed_batches,
  };

  const failureCount = result.failures.length;
  const inline = failureCount <= inlineThreshold;
  const failuresPayload = inline ? result.failures : result.failures.slice(0, 3);

  const text =
    head +
    "\n\n" +
    JSON.stringify(
      {
        ...summaryPayload,
        failures: failuresPayload,
        ...(inline
          ? {}
          : {
              failures_truncated: true,
              total_failures: failureCount,
              hint: `Showing 3/${failureCount}. Use agentscript_eval_get_failure(run_id="${result.run_id}", test_id="<id>") to drill in.`,
            }),
      },
      null,
      2,
    );

  return {
    content: [{ type: "text", text }],
    details: {
      ok: passed,
      run_id: result.run_id,
      run_dir: result.run_dir,
      totals: result.metadata.totals,
      latency: result.latency,
      failed_test_ids: result.failures.map((f) => f.test_id),
    },
  };
}

function headline(result: RunEvalResult, passed: boolean): string {
  const t = result.metadata.totals;
  const lat = result.latency;
  const latPart = lat.count > 0 ? `  |  latency p50=${lat.p50_ms}ms p95=${lat.p95_ms}ms` : "";
  const marker = passed ? "✅" : "❌";
  return (
    `${marker} eval run ${result.run_id}\n` +
    `Tests: ${t.test_pass}/${t.tests} passed  |  ` +
    `Evaluators: ${t.ev_pass}/${t.evals} passed  |  ` +
    `Step errors: ${t.errors}${latPart}` +
    (result.failed_batches > 0
      ? `\n⚠ ${result.failed_batches} batch(es) returned non-200 (some tests may be missing)`
      : "")
  );
}

function errorResult(message: string): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: `❌ ${message}` }],
    details: { ok: false, error: message },
  };
}

async function loadSpec(input: EvalRunInput, cwd: string): Promise<EvalSpec | null> {
  if (input.spec_path) {
    const path = await import("node:path");
    const abs = path.isAbsolute(input.spec_path)
      ? input.spec_path
      : path.resolve(cwd, input.spec_path);
    const raw = await readFile(abs, "utf-8");
    return JSON.parse(raw) as EvalSpec;
  }
  if (input.spec && typeof input.spec === "object") {
    return input.spec as EvalSpec;
  }
  return null;
}

async function getDefaultOrg(
  exec: ReturnType<typeof buildExecFn>,
  _cwd: string,
): Promise<string | undefined> {
  // Defer to sf CLI's notion of the default target org.
  try {
    const r = await exec("sf", ["config", "get", "target-org", "--json"], { timeout: 10_000 });
    if (r.code !== 0) return undefined;
    const parsed = JSON.parse(r.stdout) as {
      result?: Array<{ name?: string; value?: string }>;
    };
    const e = parsed.result?.find((x) => x.name === "target-org");
    return typeof e?.value === "string" && e.value ? e.value : undefined;
  } catch {
    return undefined;
  }
}
