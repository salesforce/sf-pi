/* SPDX-License-Identifier: Apache-2.0 */
/** Public agentscript_eval registration and dispatch. */
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderEvalCall, renderEvalGetFailureResult, renderEvalRunResult } from "./render/eval.ts";
import { createTimingCollector, withTimings } from "./timings.ts";
import { toolError } from "./tool-types.ts";
import { actionRun, actionRunRelease } from "./eval/actions/run.ts";
import { actionGetFailure, actionTrace } from "./eval/actions/evidence.ts";
import { actionGenerateSpec, actionResolveActive } from "./eval/actions/generation.ts";

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
      Type.Literal("run_release"),
      Type.Literal("get_failure"),
      Type.Literal("trace"),
      Type.Literal("resolve_active"),
      Type.Literal("generate_spec"),
    ],
    {
      description:
        "run: full multi-turn regression. run_release: generate and run the exact-version release baseline plus tests/agentforce/<AgentApiName>.eval.json when present. get_failure: drill into a previous run's failure. trace: fetch a planner trace by (session_id, plan_id). resolve_active: look up Active BotVersion ids for $active_* placeholders. generate_spec: synthesize a starter eval spec from a `.agent` file.",
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
  release_spec_path: Type.Optional(
    Type.String({
      description:
        "Optional for action='run_release'. Explicit designated release eval spec; defaults to tests/agentforce/<AgentApiName>.eval.json when present.",
    }),
  ),
  agent_api_name: Type.Optional(
    Type.String({
      description:
        "Required for resolve_active and run_release. For run, resolves and injects missing agent.create_session ids; also required when the spec uses $active_* / $latest_* placeholders.",
    }),
  ),
  version_resolution: Type.Optional(
    Type.Union([Type.Literal("active"), Type.Literal("latest"), Type.Literal("version")], {
      description:
        "Optional for action='run' with agent_api_name. Default 'active' injects the production-serving Active BotVersion. 'latest' uses the newest version and requires acknowledge_inactive_version=true when non-Active. 'version' requires version=N.",
    }),
  ),
  overwrite_agent_ids: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='run' with agent_api_name. When true, overwrite explicit agent_id / agent_version_id fields in agent.create_session steps. Default false.",
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
  batch_timeout_ms: Type.Optional(
    Type.Number({
      minimum: 1000,
      description:
        "Optional for action='run'. Per Evaluation API batch POST timeout. Default 300000. Client-side timeouts are not retried.",
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
  // resolve_active extras; for action='run', also used when version_resolution='version'.
  version: Type.Optional(
    Type.Number({
      minimum: 0,
      description:
        "Optional for action='resolve_active' or action='run' with version_resolution='version'. Pin to a specific BotVersion.VersionNumber (any Status). Use to look up ids for an old or non-Active version, then bake into the spec.",
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
        "Required for action='generate_spec' and action='run_release'. Path to the `.agent` file used to derive the generated baseline.",
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
        "Optional for action='generate_spec'. Include one invocation probe per targeted action and connected agent. Default true.",
    }),
  ),
  include_multi_turn_tests: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include evidence-backed same-session scenarios for provable after_response state and branch behavior. Default true.",
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
        "Optional for action='generate_spec'. Cap the subagent + action + connected-agent test count. Default 25.",
    }),
  ),
});

interface ParamsAny {
  action: "run" | "run_release" | "get_failure" | "trace" | "resolve_active" | "generate_spec";
  target_org?: string;
  spec_path?: string;
  spec?: unknown;
  release_spec_path?: string;
  agent_api_name?: string;
  traces_mode?: "failed" | "all" | "off";
  concurrency?: number;
  prompt_chars?: number;
  batch_timeout_ms?: number;
  inline_threshold?: number;
  acknowledge_inactive_version?: boolean;
  version_resolution?: "active" | "latest" | "version";
  overwrite_agent_ids?: boolean;
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
  include_multi_turn_tests?: boolean;
  include_guardrail?: boolean;
  include_safety_probes?: boolean;
  max_functional_tests?: number;
  /** Internal marker set only by run_release. */
  release_contract_kind?: "generated_baseline" | "designated";
}

function checkRequired(p: ParamsAny): { ok: true } | { ok: false; error: string } {
  switch (p.action) {
    case "run":
      return { ok: true };
    case "run_release":
      if (!p.agent_file) return { ok: false, error: "action='run_release' requires agent_file." };
      if (!p.agent_api_name)
        return { ok: false, error: "action='run_release' requires agent_api_name." };
      return { ok: true };
    case "get_failure":
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
      "Multi-action Agent Script eval surface: run specs, run the exact-version release contract, drill into failures, fetch traces, generate specs, or resolve BotVersion ids.",
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
      "Use agentscript_eval action='run_release' after inactive publication to run the generated baseline and the current designated suite against the exact latest BotVersion.",
      "Use EvalSpec seed_profiles for scenarios that need dynamic target-org IDs; query only dedicated test fixtures with bounded read-only SOQL.",
      "Incomplete batches, missing tests, evaluator failures, and step errors are failed evidence; never treat an empty or partial run as green.",
      "Use the installed Agent Script guide path declared in <sf_engineering_constitution> for spec generation, failure drill-down, and version-resolution guidance.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, onUpdate, ctx) {
      const timings = createTimingCollector();
      const p = params as ParamsAny;
      const reqOk = checkRequired(p);
      if (reqOk.ok === false) {
        return withTimings(toolError("INVALID_PARAMS", reqOk.error), timings, { appendLine: true });
      }
      let result;
      switch (p.action) {
        case "run":
          result = await actionRun(ctx, p, onUpdate, timings, _signal);
          break;
        case "run_release":
          result = await actionRunRelease(ctx, p, onUpdate, timings, _signal);
          break;
        case "get_failure":
          result = await timings.time("eval.get_failure", () => actionGetFailure(ctx, p));
          break;
        case "trace":
          result = await actionTrace(p, timings, _signal);
          break;
        case "resolve_active":
          result = await timings.time("eval.resolve_active", () => actionResolveActive(p, _signal));
          break;
        case "generate_spec":
          result = await timings.time("eval.generate_spec", () => actionGenerateSpec(ctx, p));
          break;
      }
      return withTimings(result, timings, { appendLine: true });
    },
  });
}
