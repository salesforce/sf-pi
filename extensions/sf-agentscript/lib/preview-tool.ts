/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_preview — multi-action live-org preview surface.
 *
 * Wraps the lib/preview/* client. Streams progress on send. Sessions live
 * under .sfdx/agents/<agentName>/sessions/<sessionId>/ (Salesforce-standard;
 * sf-guardrail allows .sfdx/agents/** specifically).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "./agent-api-auth.ts";
import {
  cleanupSessions,
  endPreview,
  loadSession,
  sendMessage,
  startPreview,
  startPreviewByApiName,
} from "./preview/client.ts";
import { fetchTrace } from "./eval/trace-client.ts";
import { isAgentScriptFile } from "./file-classify.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "./tool-types.ts";
import {
  previewSendMarkdown,
  renderPreviewCall,
  renderPreviewSendResult,
} from "./render/timeline.ts";
import { previewReportPath, reportHeader, writeMarkdownReport } from "./render/report-writer.ts";

export const PREVIEW_TOOL_NAME = "agentscript_preview";

// Single Type.Object: emits root `type:"object"` so OpenAI's strict tool
// validator accepts it. Per-action required-field checks happen in execute().
const Params = Type.Object({
  action: Type.Union(
    [
      Type.Literal("start"),
      Type.Literal("send"),
      Type.Literal("end"),
      Type.Literal("trace"),
      Type.Literal("cleanup"),
    ],
    {
      description:
        "start: open a preview session (agent_file OR agent_api_name). send: post one user utterance. end: finalize a session. trace: ad-hoc planner-trace fetch. cleanup: remove stale .sfdx/agents session dirs.",
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
  plan_id: Type.Optional(
    Type.String({ description: "Required for action='trace'. Plan id to fetch." }),
  ),
  older_than_days: Type.Optional(
    Type.Number({
      minimum: 0,
      description: "Optional for action='cleanup'. Default 30.",
    }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description: "Optional for action='cleanup'. Preview deletions without removing files.",
    }),
  ),
});

interface ParamsAny {
  action: "start" | "send" | "end" | "trace" | "cleanup";
  target_org?: string;
  agent_file?: string;
  agent_api_name?: string;
  agent_name?: string;
  mock_mode?: "Mock" | "Live Test";
  session_id?: string;
  message?: string;
  apex_debug?: boolean;
  plan_id?: string;
  older_than_days?: number;
  dry_run?: boolean;
}

type StreamPartial = { content: { type: "text"; text: string }[]; details: never };
type OnUpdateFn = (partial: StreamPartial) => void;

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
      "action='start' — local-compiles the .agent file first; only hits /authoring/scripts on success. Returns session_id and the initial agent message.",
      "action='send' — POSTs one user utterance, fetches the planner trace per turn, returns a compact `digest` of every planner step (topic transitions, LLM calls, variable updates, tool invocations, errors), and writes everything to the session store. Full trace JSON lives at `trace_file` for deep dives.",
      "action='end' — finalizes metadata (sets endTime).",
      "action='trace' — ad-hoc trace fetch by (session_id, plan_id) when you need to revisit a specific turn.",
      "action='cleanup' — removes session dirs older than older_than_days (default 30). Use dry_run=true to see what would be deleted.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, onUpdate, ctx) {
      const p = params as ParamsAny;
      const reqOk = checkRequired(p);
      if (reqOk.ok === false) return toolError("INVALID_PARAMS", reqOk.error);
      switch (p.action) {
        case "start":
          return await actionStart(ctx, p);
        case "send":
          return await actionSend(ctx, p, onUpdate);
        case "end":
          return await actionEnd(ctx, p);
        case "trace":
          return await actionTrace(p);
        case "cleanup":
          return await actionCleanup(ctx, p);
      }
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
      if (!p.agent_name) return { ok: false, error: "action='send' requires agent_name." };
      if (!p.session_id) return { ok: false, error: "action='send' requires session_id." };
      if (!p.message) return { ok: false, error: "action='send' requires message." };
      return { ok: true };
    case "end":
      if (!p.agent_name) return { ok: false, error: "action='end' requires agent_name." };
      if (!p.session_id) return { ok: false, error: "action='end' requires session_id." };
      return { ok: true };
    case "trace":
      if (!p.session_id) return { ok: false, error: "action='trace' requires session_id." };
      if (!p.plan_id) return { ok: false, error: "action='trace' requires plan_id." };
      return { ok: true };
    case "cleanup":
      return { ok: true };
  }
}

// -------------------------------------------------------------------------------------------------
// action = start
// -------------------------------------------------------------------------------------------------

async function actionStart(
  ctx: ExtensionContext,
  input: ParamsAny,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  // Validate exclusivity — exactly one of agent_file / agent_api_name.
  if (input.agent_file && input.agent_api_name) {
    return toolError(
      "Pass agent_file OR agent_api_name, not both.",
      "agent_file = preview a local `.agent` (compiles + uploads). agent_api_name = converse with an already-published agent.",
    );
  }
  if (!input.agent_file && !input.agent_api_name) {
    return toolError(
      "Pass agent_file or agent_api_name.",
      "agent_file = local `.agent` path. agent_api_name = an already-published agent's DeveloperName.",
    );
  }

  // Path A — published agent (no local file, no compile).
  if (input.agent_api_name) {
    const agentName = input.agent_name ?? input.agent_api_name;
    try {
      const { conn } = await connForAgentApi(input.target_org);
      const result = await startPreviewByApiName({
        conn,
        cwd: ctx.cwd,
        agentApiName: input.agent_api_name,
      });
      return toolOk(
        {
          ok: true as const,
          session_id: result.sessionId,
          agent_response: result.agentResponse,
          started_at: result.startedAt,
          session_dir: result.sessionDir,
          agent_name: agentName,
          via: "api_name" as const,
          digest: result.digest,
        },
        [
          `🎬 Preview started against published ${input.agent_api_name}`,
          `session_id: ${result.sessionId}`,
          result.digest?.summary_line ? `→ ${result.digest.summary_line}` : null,
          result.agentResponse,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found in the org/i.test(msg)) {
        return toolError(msg, undefined, {
          tool: "agentscript_lifecycle",
          params: { action: "list_versions", agent_api_name: input.agent_api_name },
        });
      }
      return toolError(msg);
    }
  }

  // Path B — local .agent file.
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (err) {
    return toolError(
      `Cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const agentName = input.agent_name ?? path.basename(filePath, ".agent");

  try {
    const { conn } = await connForAgentApi(input.target_org);
    const result = await startPreview({
      conn,
      cwd: ctx.cwd,
      agentName,
      agentSource: source,
      mockMode: input.mock_mode ?? "Mock",
    });
    return toolOk(
      {
        ok: true as const,
        session_id: result.sessionId,
        agent_response: result.agentResponse,
        started_at: result.startedAt,
        session_dir: result.sessionDir,
        agent_name: agentName,
        via: "agent_file" as const,
      },
      `🎬 Preview started\nsession_id: ${result.sessionId}\n${result.agentResponse}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Local compile rejected")) {
      return toolError(msg, undefined, {
        tool: "agentscript_compile",
        params: { path: filePath },
      });
    }
    return toolError(msg);
  }
}

// -------------------------------------------------------------------------------------------------
// action = send
// -------------------------------------------------------------------------------------------------

async function actionSend(
  ctx: ExtensionContext,
  input: ParamsAny,
  onUpdate?: OnUpdateFn,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const stream = (msg: string): void => {
    try {
      onUpdate?.({
        content: [{ type: "text", text: msg }],
        details: { progress: msg } as never,
      });
    } catch {
      /* best-effort */
    }
  };
  stream("Sending message…");

  try {
    const { conn } = await connForAgentApi(input.target_org);
    const result = await sendMessage({
      conn,
      cwd: ctx.cwd,
      agentName: input.agent_name,
      sessionId: input.session_id,
      message: input.message,
      apexDebug: input.apex_debug,
    });
    stream("Trace captured");

    // Best-effort: write a Markdown report alongside the trace JSON so the
    // user can re-open the rendered timeline later. Failure here never
    // breaks the tool result.
    let reportFile: string | undefined;
    try {
      if (result.digest && result.traceFile) {
        const sessionDir = path.dirname(path.dirname(result.traceFile));
        // <session>/traces/<plan_id>.json -> session dir is parent.parent
        const md =
          reportHeader({
            kind: "preview",
            title: `Preview turn ${result.planId.slice(0, 8)}…`,
            meta: {
              agent_name: input.agent_name,
              session_id: input.session_id,
              plan_id: result.planId,
              latency_ms: result.latencyMs,
            },
          }) +
          previewSendMarkdown(result.digest, {
            ok: true,
            agent_response: result.agentResponse,
            topic: result.topic,
            latency_ms: result.latencyMs,
            plan_id: result.planId,
            trace_file: result.traceFile,
          });
        const written = await writeMarkdownReport(previewReportPath(sessionDir, result.planId), md);
        reportFile = written.path;
      }
    } catch {
      // Best-effort — swallow and continue.
    }

    return toolOk(
      {
        ok: true as const,
        agent_response: result.agentResponse,
        topic: result.topic,
        invoked_actions: result.invokedActions,
        latency_ms: result.latencyMs,
        plan_id: result.planId,
        trace_file: result.traceFile,
        report_file: reportFile,
        digest: result.digest,
        ...(result.apexDebugLog ? { apex_debug_log: result.apexDebugLog } : {}),
      },
      [
        `🤖 ${result.agentResponse}`,
        result.digest?.summary_line ? `→ ${result.digest.summary_line}` : null,
        result.digest && result.digest.errors.length > 0
          ? `⚠️ errors: ${result.digest.errors.length}`
          : null,
        `plan=${result.planId.slice(0, 8)}… trace_file=${result.traceFile ?? "<none>"}`,
        reportFile ? `report_file=${reportFile}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = end
// -------------------------------------------------------------------------------------------------

async function actionEnd(
  ctx: ExtensionContext,
  input: ParamsAny,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    let conn;
    try {
      ({ conn } = await connForAgentApi(input.target_org));
    } catch {
      // Local metadata end should still work if remote auth/bootstrap is unavailable.
    }
    const result = await endPreview({
      conn,
      cwd: ctx.cwd,
      agentName: input.agent_name,
      sessionId: input.session_id,
    });
    return toolOk(
      {
        ok: true as const,
        ended_at: result.endedAt,
        summary: result.summary,
        metadata: result.metadata,
        remote_ended: result.remoteEnded,
        remote_end_error: result.remoteEndError,
      },
      [
        `🏁 session ${input.session_id.slice(0, 8)}… ended (${result.summary.turns} turns, ${result.summary.plans} plans)`,
        result.remoteEnded === false ? `⚠️ ${result.remoteEndError}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
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
    const trace = await fetchTrace(conn, input.session_id, input.plan_id);
    if (trace == null) {
      return toolError(
        `Trace not found for session=${input.session_id} plan=${input.plan_id}.`,
        "Confirm both ids and that the session is still resident on the planner.",
      );
    }
    const { summarizeTrace } = await import("./preview/trace-digest.ts");
    const digest = summarizeTrace(trace, {
      planId: input.plan_id,
    });
    return toolOk({
      ok: true as const,
      session_id: input.session_id,
      plan_id: input.plan_id,
      digest,
      trace_hint:
        "`digest.timeline[]` keeps every step type the runtime emitted (UserInputStep, LLMStep, UpdateTopicStep, TransitionStep, VariableUpdateStep, FunctionStep, NodeEntryStateStep, EnabledToolsStep, BeforeReasoningIterationStep, AfterReasoningStep, PlannerResponseStep, OutputEvaluationStep, PlatformNotificationStep, ReasoningStep, etc.). Heavy fields (full prompts, full variable maps) are clipped — the full trace JSON is in `trace`.",
      trace,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = cleanup
// -------------------------------------------------------------------------------------------------

async function actionCleanup(
  ctx: ExtensionContext,
  input: ParamsAny,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const days = input.older_than_days ?? 30;
  const dryRun = input.dry_run ?? false;
  try {
    const result = await cleanupSessions(ctx.cwd, days, dryRun);
    return toolOk(
      {
        ok: true as const,
        older_than_days: days,
        dry_run: dryRun,
        removed: result.removed,
        kept_count: result.kept_count,
      },
      `🧹 cleanup: ${dryRun ? "would remove" : "removed"} ${result.removed.length} session(s) older than ${days} day(s); kept ${result.kept_count}.`,
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// Allow the unused-import linter to keep loadSession for downstream readers.
void loadSession;
