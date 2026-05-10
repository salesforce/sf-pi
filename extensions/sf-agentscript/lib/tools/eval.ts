/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_eval — multi-action eval surface.
 *
 * Replaces the four single-purpose tools (eval_run, eval_get_failure,
 * eval_trace, eval_resolve) with one tool dispatched on `action`. Schema
 * is a typebox discriminated union so per-action required fields are
 * enforced statically.
 *
 * Actions:
 *   run             Run a multi-turn regression spec.
 *                   Streams progress via onUpdate. Returns inline failures
 *                   for small runs, summary + run_id pointer for big runs.
 *   get_failure     Drill into one (or all) failures from a previous run.
 *   trace           Fetch a single planner trace by (session_id, plan_id).
 *   resolve_active  Resolve $active_* placeholders from the org's
 *                   Active BotVersion + matching planner definition.
 *
 * Auth: @salesforce/core Connection (no subprocess).
 */

import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connFromAlias } from "../connection.ts";
import {
  runEval,
  recordRunInIndex,
  readFailures,
  readMetadata,
  type RunEvalResult,
} from "../eval/orchestrator.ts";
import { resolveActiveIds } from "../eval/active-ids.ts";
import { fetchTrace } from "../eval/trace-client.ts";
import { toolError, toolOk, type ToolError } from "../tool-types.ts";
import type { EvalSpec, FailureRecord, RunMetadata } from "../eval/types.ts";

export const EVAL_TOOL_NAME = "agentscript_eval";

// -------------------------------------------------------------------------------------------------
// Discriminated-union schema
// -------------------------------------------------------------------------------------------------

const Params = Type.Union([
  // action = run
  Type.Object({
    action: Type.Literal("run"),
    spec_path: Type.Optional(Type.String()),
    spec: Type.Optional(Type.Any()),
    target_org: Type.Optional(Type.String()),
    agent_api_name: Type.Optional(Type.String()),
    traces_mode: Type.Optional(
      Type.Union([Type.Literal("failed"), Type.Literal("all"), Type.Literal("off")]),
    ),
    concurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 32 })),
    prompt_chars: Type.Optional(Type.Number({ minimum: 100, maximum: 4000 })),
    inline_threshold: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  }),
  // action = get_failure
  Type.Object({
    action: Type.Literal("get_failure"),
    run_id: Type.String(),
    test_id: Type.Optional(Type.String()),
  }),
  // action = trace
  Type.Object({
    action: Type.Literal("trace"),
    session_id: Type.String(),
    plan_id: Type.String(),
    target_org: Type.Optional(Type.String()),
    timeout_ms: Type.Optional(Type.Number({ minimum: 1000 })),
  }),
  // action = resolve_active
  Type.Object({
    action: Type.Literal("resolve_active"),
    agent_api_name: Type.String(),
    target_org: Type.Optional(Type.String()),
  }),
]);

type ParamsAny =
  | {
      action: "run";
      spec_path?: string;
      spec?: unknown;
      target_org?: string;
      agent_api_name?: string;
      traces_mode?: "failed" | "all" | "off";
      concurrency?: number;
      prompt_chars?: number;
      inline_threshold?: number;
    }
  | { action: "get_failure"; run_id: string; test_id?: string }
  | {
      action: "trace";
      session_id: string;
      plan_id: string;
      target_org?: string;
      timeout_ms?: number;
    }
  | { action: "resolve_active"; agent_api_name: string; target_org?: string };

// -------------------------------------------------------------------------------------------------
// Registration
// -------------------------------------------------------------------------------------------------

export function registerEvalTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: EVAL_TOOL_NAME,
    label: "Agent Script eval",
    description:
      "Multi-action eval surface: run a regression spec, drill into a failure, fetch a planner trace, or resolve $active_* placeholders. Single Connection-based transport, sandbox-safe SFAP fallback, streamed progress on long runs.",
    promptSnippet:
      "Run / debug / introspect Agent Script regression specs against the Salesforce Evaluation API.",
    promptGuidelines: [
      "action='run' — full multi-turn regression. Pass agent_api_name when the spec uses $active_* placeholders. Default traces_mode='failed'.",
      "action='get_failure' — after a run returned a summary (large run with failures_truncated=true), drill into one test_id or all failures by run_id.",
      "action='trace' — fetch a planner trace for one (session_id, plan_id). Use when inline llmEvents isn't enough.",
      "action='resolve_active' — look up the Active BotVersion + planner ids by agent_api_name. Bake into a spec or verify which version a run hits.",
      "Errors carry recover_via when applicable — chain the next tool call directly without parsing prose.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, onUpdate, ctx) {
      const p = params as ParamsAny;
      switch (p.action) {
        case "run":
          return await actionRun(ctx, p, onUpdate);
        case "get_failure":
          return await actionGetFailure(ctx, p);
        case "trace":
          return await actionTrace(p);
        case "resolve_active":
          return await actionResolveActive(p);
      }
    },
  });
}

// -------------------------------------------------------------------------------------------------
// action = run
// -------------------------------------------------------------------------------------------------

type OnUpdateFn = (partial: { content: { type: "text"; text: string }[]; details: never }) => void;

async function actionRun(
  ctx: ExtensionContext,
  input: Extract<ParamsAny, { action: "run" }>,
  onUpdate?: OnUpdateFn,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const log = (msg: string): void => {
    try {
      onUpdate?.({
        content: [{ type: "text", text: msg }],
        details: { progress: msg } as never,
      });
    } catch {
      /* best-effort */
    }
  };

  const spec = await loadSpec(input, ctx.cwd);
  if (!spec) {
    return toolError(
      "Either spec_path or spec must be provided.",
      "Pass spec_path: '<file.json>' or an inline spec object.",
    );
  }

  let result: RunEvalResult;
  try {
    const conn = await connFromAlias(input.target_org);
    result = await runEval({
      conn,
      targetOrg: input.target_org ?? conn.getUsername() ?? "<default>",
      spec,
      agentApiName: input.agent_api_name,
      tracesMode: input.traces_mode ?? "failed",
      concurrency: input.concurrency ?? 8,
      promptChars: input.prompt_chars ?? 600,
      cwd: ctx.cwd,
      specPath: input.spec_path,
      log,
    });
  } catch (err) {
    return classifyRunError(err, input);
  }

  await recordRunInIndex(ctx.cwd, result.run_id);

  const inlineThreshold = input.inline_threshold ?? 5;
  const passed = result.totals.test_fail === 0 && result.totals.errors === 0;
  const head = headline(result, passed);

  const summary = {
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
        ...summary,
        failures: failuresPayload,
        ...(inline
          ? {}
          : {
              failures_truncated: true,
              total_failures: failureCount,
              hint: `Showing 3/${failureCount}. Use agentscript_eval action='get_failure' run_id='${result.run_id}' test_id='<id>' to drill in.`,
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

function classifyRunError(
  err: unknown,
  input: Extract<ParamsAny, { action: "run" }>,
): { content: { type: "text"; text: string }[]; details: ToolError } {
  const msg = err instanceof Error ? err.message : String(err);
  // If the error is "spec uses $active_* but no agent_api_name", point the
  // LLM at resolve_active so it can bake values directly.
  if (msg.includes("$active_") && !input.agent_api_name) {
    return toolError(msg, "Pass agent_api_name to resolve placeholders.", {
      tool: EVAL_TOOL_NAME,
      params: { action: "resolve_active", agent_api_name: "<name>" },
    });
  }
  // If the error mentions an Agent not found, suggest resolve_active to discover it.
  if (/Agent .* not found/i.test(msg)) {
    return toolError(msg, "Verify the DeveloperName.", {
      tool: EVAL_TOOL_NAME,
      params: { action: "resolve_active", agent_api_name: input.agent_api_name ?? "<name>" },
    });
  }
  return toolError(msg);
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

async function loadSpec(
  input: Extract<ParamsAny, { action: "run" }>,
  cwd: string,
): Promise<EvalSpec | null> {
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

// -------------------------------------------------------------------------------------------------
// action = get_failure
// -------------------------------------------------------------------------------------------------

async function actionGetFailure(
  ctx: ExtensionContext,
  input: Extract<ParamsAny, { action: "get_failure" }>,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  let all: FailureRecord[];
  let meta: RunMetadata | null;
  try {
    all = await readFailures(ctx.cwd, input.run_id);
    meta = await readMetadata(ctx.cwd, input.run_id);
  } catch (err) {
    return toolError(
      err instanceof Error ? err.message : String(err),
      "Confirm the run id from a previous agentscript_eval action='run' result.",
    );
  }

  if (input.test_id) {
    const found = all.find((f) => f.test_id === input.test_id);
    if (!found) {
      return toolError(
        `No failure with test_id='${input.test_id}' in run ${input.run_id}.`,
        `Available test_ids: ${all.map((f) => f.test_id).join(", ") || "(none)"}.`,
        {
          tool: EVAL_TOOL_NAME,
          params: { action: "get_failure", run_id: input.run_id },
        },
      );
    }
    return toolOk({ ok: true as const, run_id: input.run_id, failure: found, run_metadata: meta });
  }

  return toolOk({
    ok: true as const,
    run_id: input.run_id,
    total_failures: all.length,
    failures: all,
    run_metadata: meta,
  });
}

// -------------------------------------------------------------------------------------------------
// action = trace
// -------------------------------------------------------------------------------------------------

async function actionTrace(
  input: Extract<ParamsAny, { action: "trace" }>,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const conn = await connFromAlias(input.target_org);
    const trace = await fetchTrace(conn, input.session_id, input.plan_id, {
      timeoutMs: input.timeout_ms ?? 60_000,
    });
    if (trace == null) {
      return toolError(
        `Trace not found for session=${input.session_id} plan=${input.plan_id}.`,
        "Confirm both ids and that the session is still resident on the planner.",
      );
    }
    return toolOk({
      ok: true as const,
      session_id: input.session_id,
      plan_id: input.plan_id,
      trace_hint:
        "PlannerResponse with steps[]: UserInputStep, UpdateTopicStep, " +
        "LLMExecutionStep (promptContent, promptResponse, executionLatency), " +
        "FunctionCallStep, ValidationPromptStep, EventStep.",
      trace,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = resolve_active
// -------------------------------------------------------------------------------------------------

async function actionResolveActive(
  input: Extract<ParamsAny, { action: "resolve_active" }>,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const conn = await connFromAlias(input.target_org);
    const ids = await resolveActiveIds(conn, input.agent_api_name);
    return toolOk({
      ok: true as const,
      agent_api_name: input.agent_api_name,
      target_org: input.target_org ?? conn.getUsername() ?? "<default>",
      bot_id: ids.bot_id,
      bot_version_id: ids.bot_version_id,
      version_number: ids.version_number,
      planner_id: ids.planner_id,
      $active_bot_id: ids.bot_id,
      $active_bot_version_id: ids.bot_version_id,
      $active_planner_id: ids.planner_id,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}
