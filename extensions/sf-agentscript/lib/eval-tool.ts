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

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "./agent-api-auth.ts";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import {
  runEval,
  recordRunInIndex,
  readFailures,
  readMetadata,
  type RunEvalResult,
} from "./eval/orchestrator.ts";
import { resolveActiveIds, resolveAgentIds, type StatusFilter } from "./eval/active-ids.ts";
import { fetchTrace } from "./eval/trace-client.ts";
import { generateSpec } from "./eval/spec-generator.ts";
import { inspectFile } from "./inspect.ts";
import { isAgentScriptFile } from "./file-classify.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "./tool-types.ts";
import type { EvalSpec, FailureRecord, RunMetadata } from "./eval/types.ts";

import { renderEvalCall, renderEvalRunResult, renderEvalGetFailureResult } from "./render/eval.ts";

export const EVAL_TOOL_NAME = "agentscript_eval";

// -------------------------------------------------------------------------------------------------
// Schema
//
// Single Type.Object: emits root `type:"object"` so OpenAI's strict tool
// validator accepts it. Per-action required-field checks happen in execute().
// -------------------------------------------------------------------------------------------------

const Params = Type.Object({
  action: Type.Union(
    [
      Type.Literal("run"),
      Type.Literal("get_failure"),
      Type.Literal("trace"),
      Type.Literal("resolve_active"),
      Type.Literal("generate_spec"),
    ],
    {
      description:
        "run: full multi-turn regression. get_failure: drill into a previous run's failure. trace: fetch a planner trace by (session_id, plan_id). resolve_active: look up Active BotVersion ids for $active_* placeholders. generate_spec: synthesize a starter eval spec from a `.agent` file (subagent routing + action probes + safety/guardrail block).",
    },
  ),
  target_org: Type.Optional(Type.String({ description: "sf CLI alias / username." })),
  // run
  spec_path: Type.Optional(
    Type.String({
      description: "For action='run'. Path to a JSON eval spec. Use this OR spec.",
    }),
  ),
  spec: Type.Optional(
    Type.Any({
      description: "For action='run'. Inline spec object. Use this OR spec_path.",
    }),
  ),
  agent_api_name: Type.Optional(
    Type.String({
      description:
        "Required for resolve_active. For run, only required when the spec uses $active_* placeholders.",
    }),
  ),
  traces_mode: Type.Optional(
    Type.Union([Type.Literal("failed"), Type.Literal("all"), Type.Literal("off")], {
      description: "Optional for action='run'. Default 'failed'.",
    }),
  ),
  concurrency: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 32,
      description: "Optional for action='run'. Default 8.",
    }),
  ),
  prompt_chars: Type.Optional(
    Type.Number({
      minimum: 100,
      maximum: 4000,
      description: "Optional for action='run'. Max chars of llmEvents.prompt_content per turn.",
    }),
  ),
  inline_threshold: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 100,
      description:
        "Optional for action='run'. Inline failure records when total <= threshold; otherwise summarize. Default 5.",
    }),
  ),
  acknowledge_inactive_version: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='run'. Confirms you intend to regression-test a non-Active BotVersion. Required when $latest_* placeholders resolve to an Inactive / InDevelopment version. Catches the 'I thought v12 was active but it's still v11' foot-gun.",
    }),
  ),
  // resolve_active extras
  version: Type.Optional(
    Type.Number({
      minimum: 0,
      description:
        "Optional for action='resolve_active'. Pin to a specific BotVersion.VersionNumber (any Status). Use to look up ids for an old or non-Active version, then bake into the spec.",
    }),
  ),
  status: Type.Optional(
    Type.Union([Type.Literal("Active"), Type.Literal("any")], {
      description:
        "Optional for action='resolve_active'. 'Active' (default) returns the latest Active BotVersion; 'any' returns the latest version regardless of state. Ignored when `version` is set.",
    }),
  ),
  // get_failure
  run_id: Type.Optional(
    Type.String({
      description:
        "Required for action='get_failure'. Run id from a previous agentscript_eval run.",
    }),
  ),
  test_id: Type.Optional(
    Type.String({
      description: "Optional for action='get_failure'. Restrict to one failure.",
    }),
  ),
  // trace
  session_id: Type.Optional(Type.String({ description: "Required for action='trace'." })),
  plan_id: Type.Optional(Type.String({ description: "Required for action='trace'." })),
  timeout_ms: Type.Optional(
    Type.Number({ minimum: 1000, description: "Optional for action='trace'. Default 60000." }),
  ),
  // generate_spec
  agent_file: Type.Optional(
    Type.String({
      description:
        "Required for action='generate_spec'. Path to the `.agent` file to derive tests from.",
    }),
  ),
  output_path: Type.Optional(
    Type.String({
      description:
        "Optional for action='generate_spec'. When set, write the generated spec to this path (relative paths resolve against cwd). Default: return inline.",
    }),
  ),
  context_variables: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        type: Type.Optional(Type.String()),
        value: Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
      }),
      {
        description:
          "Optional for action='generate_spec'. Default context_variables attached to every generated send_message step (eval-spec shape: [{name, type?, value}]). Use for auth-bypass seeds (verified_check, RoutableId, etc.) so generated tests reach the post-auth flows.",
      },
    ),
  ),
  include_subagent_tests: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include one routing test per non-start subagent. Default true.",
    }),
  ),
  include_action_tests: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include one invocation probe per top-level action with a target. Default true.",
    }),
  ),
  include_guardrail: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include the curated off-topic guardrail probe. Default true.",
    }),
  ),
  include_safety_probes: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include the curated safety / adversarial probe block. Default true.",
    }),
  ),
  max_functional_tests: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 200,
      description:
        "Optional for action='generate_spec'. Cap the subagent + action test count. Default 25.",
    }),
  ),
});

interface ParamsAny {
  action: "run" | "get_failure" | "trace" | "resolve_active" | "generate_spec";
  target_org?: string;
  spec_path?: string;
  spec?: unknown;
  agent_api_name?: string;
  traces_mode?: "failed" | "all" | "off";
  concurrency?: number;
  prompt_chars?: number;
  inline_threshold?: number;
  acknowledge_inactive_version?: boolean;
  version?: number;
  status?: "Active" | "any";
  run_id?: string;
  test_id?: string;
  session_id?: string;
  plan_id?: string;
  timeout_ms?: number;
  agent_file?: string;
  output_path?: string;
  context_variables?: Array<{
    name: string;
    type?: string;
    value: string | number | boolean;
  }>;
  include_subagent_tests?: boolean;
  include_action_tests?: boolean;
  include_guardrail?: boolean;
  include_safety_probes?: boolean;
  max_functional_tests?: number;
}

function checkRequired(p: ParamsAny): { ok: true } | { ok: false; error: string } {
  switch (p.action) {
    case "run":
      if (!p.spec_path && !p.spec) {
        return {
          ok: false,
          error: "action='run' requires either spec_path or spec.",
        };
      }
      return { ok: true };
    case "get_failure":
      if (!p.run_id) return { ok: false, error: "action='get_failure' requires run_id." };
      return { ok: true };
    case "trace":
      if (!p.session_id) return { ok: false, error: "action='trace' requires session_id." };
      if (!p.plan_id) return { ok: false, error: "action='trace' requires plan_id." };
      return { ok: true };
    case "resolve_active":
      if (!p.agent_api_name)
        return { ok: false, error: "action='resolve_active' requires agent_api_name." };
      return { ok: true };
    case "generate_spec":
      if (!p.agent_file) return { ok: false, error: "action='generate_spec' requires agent_file." };
      return { ok: true };
  }
}

// -------------------------------------------------------------------------------------------------
// Registration
// -------------------------------------------------------------------------------------------------

export function registerEvalTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: EVAL_TOOL_NAME,
    label: "Agent Script eval",
    description:
      "Multi-action eval surface: run a regression spec, drill into a failure, fetch a planner trace, or resolve $active_* placeholders. Single Connection-based transport, sandbox-safe SFAP fallback, streamed progress on long runs.",
    renderCall: renderEvalCall,
    renderResult: (result, opts, theme) => {
      // Dispatch on action recovered from the parameters slot. The pi-tui
      // renderResult signature receives the merged tool row but not the
      // call args directly; we use the embedded `details.action` (which we
      // set in actionRun/actionGetFailure) for routing.
      const details =
        (result as { details?: { action?: string; run_id?: string; failure?: unknown } }).details ??
        {};
      // Run results carry run_id at the top level; failure results carry
      // either a single `failure` or a `failures[]` array.
      if (details.failure || (details as { failures?: unknown[] }).failures) {
        return renderEvalGetFailureResult(result, opts, theme);
      }
      if (details.run_id) {
        return renderEvalRunResult(result, opts, theme);
      }
      // resolve_active / trace fall through to the default text rendering
      // (their single-line summaries already read well).
      return renderEvalRunResult(result, opts, theme);
    },
    promptSnippet:
      "Run / debug / introspect Agent Script regression specs against the Salesforce Evaluation API.",
    promptGuidelines: [
      "action='run' — full multi-turn regression. Pass agent_api_name when the spec uses $active_* OR $latest_* placeholders. Default traces_mode='failed'. Pass acknowledge_inactive_version=true when $latest_* should resolve a non-Active version (the ship→eval→activate loop).",
      "action='get_failure' — after a run returned a summary (large run with failures_truncated=true), drill into one test_id or all failures by run_id.",
      "action='trace' — fetch a planner trace for one (session_id, plan_id). Use when inline llmEvents isn't enough.",
      "action='resolve_active' — look up BotVersion + planner ids by agent_api_name. Default returns the Active version; pass status='any' for the latest regardless of state, or version=N for a specific historical version.",
      "action='generate_spec' — synthesize a starter spec from a `.agent` file. Pass context_variables for auth-bypass seeds. Pass output_path to write the spec; otherwise it is returned inline. Chain into action='run' once you've reviewed it.",
      "Errors carry recover_via when applicable — chain the next tool call directly without parsing prose.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, onUpdate, ctx) {
      const p = params as ParamsAny;
      const reqOk = checkRequired(p);
      if (reqOk.ok === false) return toolError("INVALID_PARAMS", reqOk.error);
      switch (p.action) {
        case "run":
          return await actionRun(ctx, p, onUpdate);
        case "get_failure":
          return await actionGetFailure(ctx, p);
        case "trace":
          return await actionTrace(p);
        case "resolve_active":
          return await actionResolveActive(p);
        case "generate_spec":
          return await actionGenerateSpec(ctx, p);
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
  input: ParamsAny,
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
    let traceConn;
    if ((input.traces_mode ?? "failed") !== "off") {
      try {
        ({ conn: traceConn } = await connForAgentApi(input.target_org));
      } catch {
        // Trace fetches are a debugging aid and already non-fatal; run eval even
        // when the named-user JWT bootstrap is unavailable.
      }
    }
    result = await runEval({
      conn,
      traceConn,
      targetOrg: input.target_org ?? conn.getUsername() ?? "<default>",
      spec,
      agentApiName: input.agent_api_name,
      tracesMode: input.traces_mode ?? "failed",
      concurrency: input.concurrency ?? 8,
      promptChars: input.prompt_chars ?? 600,
      acknowledgeInactiveVersion: input.acknowledge_inactive_version,
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
  input: ParamsAny,
): { content: { type: "text"; text: string }[]; details: ToolError } {
  const msg = err instanceof Error ? err.message : String(err);
  // If the error is "spec uses $active_* / $latest_* but no agent_api_name",
  // point the LLM at resolve_active so it can bake values directly.
  if ((msg.includes("$active_") || msg.includes("$latest_")) && !input.agent_api_name) {
    return toolError(msg, "Pass agent_api_name to resolve placeholders.", {
      tool: EVAL_TOOL_NAME,
      params: { action: "resolve_active", agent_api_name: "<name>" },
    });
  }
  // If $latest_* resolved to a non-Active version and the user didn't
  // acknowledge, surface the explicit recover_via with the flag set.
  if (msg.includes("acknowledge_inactive_version")) {
    return toolError(msg, "Pass acknowledge_inactive_version=true to confirm.", {
      tool: EVAL_TOOL_NAME,
      params: {
        action: "run",
        spec_path: input.spec_path ?? "<path>",
        agent_api_name: input.agent_api_name ?? "<name>",
        acknowledge_inactive_version: true,
      },
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

async function loadSpec(input: ParamsAny, cwd: string): Promise<EvalSpec | null> {
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
  input: ParamsAny,
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

async function actionTrace(input: ParamsAny): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const { conn } = await connForAgentApi(input.target_org);
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

async function actionResolveActive(input: ParamsAny): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const conn = await connFromAlias(input.target_org);
    // Pin a specific version (any state) when `version` is provided.
    // Otherwise honor the `status` filter (default Active).
    const status: StatusFilter = input.status ?? "Active";
    const ids =
      typeof input.version === "number"
        ? await resolveAgentIds(conn, input.agent_api_name, { version: input.version })
        : status === "Active"
          ? await resolveActiveIds(conn, input.agent_api_name)
          : await resolveAgentIds(conn, input.agent_api_name, { status: "any" });

    // The placeholder-shaped fields ($active_* / $latest_*) reflect the
    // resolution mode so an LLM consumer can copy-paste the right token
    // into a spec without remembering which family applies. When `version`
    // is pinned, neither placeholder family applies cleanly — we surface
    // both shapes so the LLM picks the right one for its workflow.
    const placeholderShapes: Record<string, string | null> = {};
    if (typeof input.version === "number" || status === "any") {
      placeholderShapes.$latest_bot_version_id = ids.bot_version_id;
      placeholderShapes.$latest_planner_id = ids.planner_id;
    }
    if (typeof input.version !== "number" && status === "Active") {
      placeholderShapes.$active_bot_version_id = ids.bot_version_id;
      placeholderShapes.$active_planner_id = ids.planner_id;
    }
    placeholderShapes.$active_bot_id = ids.bot_id;

    return toolOk({
      ok: true as const,
      agent_api_name: input.agent_api_name,
      target_org: input.target_org ?? conn.getUsername() ?? "<default>",
      resolution_mode: typeof input.version === "number" ? `version=${input.version}` : status,
      bot_id: ids.bot_id,
      bot_version_id: ids.bot_version_id,
      version_number: ids.version_number,
      bot_version_status: ids.status,
      planner_id: ids.planner_id,
      ...placeholderShapes,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = generate_spec
//
// Read a `.agent` file via the existing inspect machinery, derive a starter
// regression spec covering subagent routing + action probes + safety/guardrail
// rows, optionally write it to disk. The output spec uses `$active_*`
// placeholders so it runs against whichever BotVersion is Active at run time.
// -------------------------------------------------------------------------------------------------

async function actionGenerateSpec(
  ctx: ExtensionContext,
  input: ParamsAny,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  // Resolve + validate the .agent path before doing any work.
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const agentFile = resolved.absPath;
  if (!isAgentScriptFile(agentFile)) {
    return toolError(`Not an Agent Script file: ${agentFile}`, "Pass a path ending in `.agent`.");
  }

  // Inspect locally; refuse if the file has parse errors (the structural
  // surface is incomplete and would emit nonsense).
  const inspect = await inspectFile(agentFile);
  if (!inspect.ok) {
    return toolError(
      `inspect failed: ${inspect.reason ?? "unknown"}${inspect.reason_detail ? ` — ${inspect.reason_detail}` : ""}`,
      "Run agentscript_compile to see and fix the underlying issue.",
      { tool: "agentscript_compile", params: { path: agentFile } },
    );
  }
  if (inspect.has_parse_errors) {
    return toolError(
      `Agent has ${inspect.parse_error_count} severity-1 parse error(s). The structural surface is incomplete; refusing to generate a spec from it.`,
      "Fix the parse errors first via agentscript_compile / agentscript_mutate.",
      { tool: "agentscript_compile", params: { path: agentFile } },
    );
  }

  let result;
  try {
    result = generateSpec({
      inspect,
      contextVariables: input.context_variables,
      includeSubagentTests: input.include_subagent_tests,
      includeActionTests: input.include_action_tests,
      includeGuardrail: input.include_guardrail,
      includeSafetyProbes: input.include_safety_probes,
      maxFunctionalTests: input.max_functional_tests,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }

  // Persist when output_path is set. Resolve relative to cwd; create parents.
  let writtenPath: string | undefined;
  if (input.output_path) {
    const abs = path.isAbsolute(input.output_path)
      ? input.output_path
      : path.resolve(ctx.cwd, input.output_path);
    try {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, JSON.stringify(result.spec, null, 2) + "\n", "utf-8");
      writtenPath = abs;
    } catch (err) {
      return toolError(
        `Failed to write generated spec to ${abs}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const summary = result.summary;
  const totals = `${summary.total_tests} test(s): ${summary.subagent_tests} subagent, ${summary.action_tests} action, ${summary.guardrail_tests} guardrail, ${summary.safety_tests} safety`;
  const head = `✨ spec generated for ${path.basename(agentFile)}\n${totals}${writtenPath ? `\nWritten: ${writtenPath}` : ""}`;

  // Hand back the next-step hint so the LLM chains directly into a run.
  // We don't execute it here so the user can edit the spec first if they
  // want to refine wording or add multi-turn scenarios.
  const nextStep = writtenPath
    ? `\n\n→ Next: agentscript_eval action='run' spec_path='${writtenPath}'`
    : "";

  return {
    content: [
      {
        type: "text",
        text: head + nextStep + "\n\n" + JSON.stringify({ summary, spec: result.spec }, null, 2),
      },
    ],
    details: {
      ok: true,
      agent_file: agentFile,
      output_path: writtenPath,
      summary,
    },
  };
}
