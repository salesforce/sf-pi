/* SPDX-License-Identifier: Apache-2.0 */
/** Public agentscript_preview registration and dispatch. */
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderPreviewCall, renderPreviewSendResult } from "./render/timeline.ts";
import { createTimingCollector, withTimings } from "./timings.ts";
import { toolError } from "./tool-types.ts";
import { actionStart, actionSend, actionEnd } from "./preview/actions/session.ts";
import { actionEndAll, actionCleanup } from "./preview/actions/maintenance.ts";
import { actionTrace } from "./preview/actions/trace.ts";

export const PREVIEW_TOOL_NAME = "agentscript_preview";

// Single Type.Object: emits root `type:"object"` so OpenAI's strict tool
// validator accepts it. Per-action required-field checks happen in execute().
const Params = Type.Object({
  action: Type.Union(
    [
      Type.Literal("start"),
      Type.Literal("send"),
      Type.Literal("end"),
      Type.Literal("end_all"),
      Type.Literal("trace"),
      Type.Literal("cleanup"),
    ],
    {
      description:
        "start: open a preview session (agent_file OR agent_api_name). send: post one user utterance. end: finalize a session. end_all: dry-run or end multiple stored preview sessions. trace: ad-hoc planner-trace fetch. cleanup: remove stale .sfdx/agents session dirs.",
    },
  ),
  target_org: Type.Optional(Type.String({ description: "sf CLI alias / username." })),
  agent_file: Type.Optional(
    Type.String({
      description:
        "For action='start': path to a `.agent` file. Local-compiled before the server call. Use this OR agent_api_name.",
    }),
  ),
  agent_api_name: Type.Optional(
    Type.String({
      description:
        "For action='start': converse with a published, activated agent in the org. Use this OR agent_file. Skips local + server compile.",
    }),
  ),
  agent_name: Type.Optional(
    Type.String({
      description:
        "Required for send/end (the agent folder under .sfdx/agents/). Optional for start — defaults to the basename of agent_file or agent_api_name.",
    }),
  ),
  mock_mode: Type.Optional(
    Type.Union([Type.Literal("Mock"), Type.Literal("Live Test")], {
      description: "Optional for action='start' with agent_file. Default 'Mock'.",
    }),
  ),
  version_developer_name: Type.Optional(
    Type.String({
      description:
        "Optional for action='start' with agent_file. Pin agentVersion.developerName (for example 'v3' or 'v0') instead of resolving from bundle-meta / org lookup.",
    }),
  ),
  session_id: Type.Optional(
    Type.String({ description: "Required for send/end/trace. Returned by action='start'." }),
  ),
  message: Type.Optional(
    Type.String({ description: "Required for action='send'. The user utterance to send." }),
  ),
  apex_debug: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='send'. When true, capture the latest ApexLog produced during this turn.",
    }),
  ),
  context_variables: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        type: Type.Optional(Type.String()),
        value: Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
        label: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        isList: Type.Optional(Type.Boolean()),
      }),
      {
        description:
          "Optional for action='start' and action='send'. Deterministic state seeds for mutable/context/linked variables. On start with agent_file, linked-variable bindings are patched from variables.X to state.X and persisted for every turn; send-time variables override persisted values by name.",
      },
    ),
  ),
  plan_id: Type.Optional(
    Type.String({ description: "Required for action='trace'. Plan id to fetch." }),
  ),
  session_kind: Type.Optional(
    Type.Union([Type.Literal("agent_file"), Type.Literal("api_name")], {
      description:
        "Optional for action='end_all'. Restrict to local authoring-bundle sessions or published-agent sessions.",
    }),
  ),
  include_ended: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='end_all'. Include sessions that already have endTime. Default false.",
    }),
  ),
  older_than_days: Type.Optional(
    Type.Number({
      minimum: 0,
      description:
        "Optional for action='cleanup' or action='end_all'. cleanup default 30; end_all has no age filter unless set.",
    }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='cleanup' or action='end_all'. end_all defaults to true; cleanup defaults to false.",
    }),
  ),
});

interface ParamsAny {
  action: "start" | "send" | "end" | "end_all" | "trace" | "cleanup";
  target_org?: string;
  agent_file?: string;
  agent_api_name?: string;
  agent_name?: string;
  mock_mode?: "Mock" | "Live Test";
  version_developer_name?: string;
  session_id?: string;
  message?: string;
  apex_debug?: boolean;
  context_variables?: Array<{
    name: string;
    type?: string;
    value: string | number | boolean;
    label?: string;
    description?: string;
    isList?: boolean;
  }>;
  plan_id?: string;
  session_kind?: "agent_file" | "api_name";
  include_ended?: boolean;
  older_than_days?: number;
  dry_run?: boolean;
}

export function registerPreviewTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: PREVIEW_TOOL_NAME,
    label: "Agent Script preview",
    description:
      "Multi-action live-org preview: start a session for a `.agent` file, send messages, end, or fetch a trace. Sessions stored under .sfdx/agents/<id>/sessions/<sid>/. cleanup removes stale sessions.",
    // Rich rendering for the human-watching surface. The LLM still receives
    // the compact summary in `content[0].text` (unchanged); these renderers
    // only paint the TUI tool row.
    renderCall: renderPreviewCall,
    renderResult: renderPreviewSendResult,
    promptSnippet:
      "Run a single .agent conversation against the live org with full trace capture per turn.",
    promptGuidelines: [
      "Use agentscript_preview for behavioral reproduction before release eval; local-file sessions compile first and persist bounded trace artifacts.",
      "Treat the compact digest as routing/state evidence and fetch the full trace only when diagnosis requires it.",
      "Use the installed Agent Script guide path declared in <sf_engineering_constitution> for linked variables, cleanup, and multi-step preview guidance.",
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
        case "start":
          result = await actionStart(ctx, p, timings, _signal);
          break;
        case "send":
          result = await actionSend(ctx, p, onUpdate, timings, _signal);
          break;
        case "end":
          result = await timings.time("preview.end", () => actionEnd(ctx, p, _signal));
          break;
        case "end_all":
          result = await timings.time("preview.end_all", () => actionEndAll(ctx, p, _signal));
          break;
        case "trace":
          result = await actionTrace(p, timings, _signal);
          break;
        case "cleanup":
          result = await timings.time("preview.cleanup", () => actionCleanup(ctx, p));
          break;
      }
      return withTimings(result, timings, { appendLine: true });
    },
  });
}

// -------------------------------------------------------------------------------------------------
// Per-action required-field validator (the schema is intentionally permissive
// for OpenAI strict-mode compatibility).
// -------------------------------------------------------------------------------------------------

function checkRequired(p: ParamsAny): { ok: true } | { ok: false; error: string } {
  switch (p.action) {
    case "start":
      // exclusivity is enforced inside actionStart for richer messaging.
      return { ok: true };
    case "send":
      if (!p.message) return { ok: false, error: "action='send' requires message." };
      return { ok: true };
    case "end":
      return { ok: true };
    case "end_all":
      return { ok: true };
    case "trace":
      if (!p.session_id) return { ok: false, error: "action='trace' requires session_id." };
      if (!p.plan_id) return { ok: false, error: "action='trace' requires plan_id." };
      return { ok: true };
    case "cleanup":
      return { ok: true };
  }
}
