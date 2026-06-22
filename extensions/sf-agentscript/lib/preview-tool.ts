/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_preview — multi-action live-org preview surface.
 *
 * Wraps the lib/preview/* client. Streams progress on send. Sessions live
 * under .sfdx/agents/<agentName>/sessions/<sessionId>/ (Salesforce-standard;
 * sf-guardrail allows .sfdx/agents/** specifically).
 */

import path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "./agent-api-auth.ts";
import { getAgentScriptAnalysis } from "./analysis-snapshot.ts";
import {
  cleanupSessions,
  endPreview,
  listStoredSessions,
  loadSession,
  sendMessage,
  startPreview,
  startPreviewByApiName,
} from "./preview/client.ts";
import type { PreviewMetadata } from "./preview/session-store.ts";
import { fetchTrace } from "./eval/trace-client.ts";
import { isAgentScriptFile } from "./file-classify.ts";
import {
  resolveActivePreviewSession,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "./branch-state.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "./tool-types.ts";
import {
  previewSendMarkdown,
  renderPreviewCall,
  renderPreviewSendResult,
} from "./render/timeline.ts";
import { previewReportPath, reportHeader, writeMarkdownReport } from "./render/report-writer.ts";
import { createTimingCollector, withTimings, type TimingCollector } from "./timings.ts";

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
      "action='start' — local-compiles the .agent file first; only hits /authoring/scripts on success. Returns session_id and the initial agent message. Pass context_variables here for linked VoiceCall/MessagingSession/context/mutable variable preview; values are persisted for every turn.",
      "action='send' — POSTs one user utterance, fetches the planner trace per turn, returns a compact `digest` of every planner step (topic transitions, LLM calls, variable updates, tool invocations, errors), and writes everything to the session store. Full trace JSON lives at `trace_file` for deep dives.",
      "context_variables — deterministic state seeds [{name, type?, value, label?, description?, isList?}]. On start with agent_file, sf-pi registers stateVariables and rewrites linked boundInputs from variables.X to state.X; on send, values override the persisted start profile by name.",
      "action='end' — finalizes metadata (sets endTime).",
      "action='end_all' — dry-runs by default. Scans .sfdx/agents/*/sessions/*, filters by agent_name/session_kind/target_org/older_than_days, remotely ends api_name sessions when possible, and locally finalizes agent_file sessions. Pass dry_run=false to execute.",
      "action='trace' — ad-hoc trace fetch by (session_id, plan_id) when you need to revisit a specific turn.",
      "action='cleanup' — removes session dirs older than older_than_days (default 30). Use dry_run=true to see what would be deleted.",
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

// -------------------------------------------------------------------------------------------------
// action = start
// -------------------------------------------------------------------------------------------------

async function actionStart(
  ctx: ExtensionContext,
  input: ParamsAny,
  timings?: TimingCollector,
  signal?: AbortSignal,
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
    if (input.context_variables && input.context_variables.length > 0) {
      return toolError(
        "context_variables on preview start are only supported with agent_file.",
        "Published-agent preview uses the production v1 session API and has no compiled AgentJSON payload to patch. Start from the local .agent file when testing linked VoiceCall/MessagingSession variables.",
      );
    }
    if (input.version_developer_name) {
      return toolError(
        "version_developer_name on preview start is only supported with agent_file.",
        "Published-agent preview resolves the active published version from the org. Use agent_file when you need to pin a local Agent Script preview to v0/vN.",
      );
    }
    const agentName = input.agent_name ?? input.agent_api_name;
    try {
      const authPhase = timings?.phase("agent_api_auth");
      const auth = await connForAgentApi(input.target_org, { signal });
      authPhase?.end({ cache: auth.cache });
      const { conn } = auth;
      const result = await startPreviewByApiName({
        conn,
        cwd: ctx.cwd,
        agentApiName: input.agent_api_name,
        targetOrg: input.target_org,
        timings,
        signal,
      });
      return toolOk(
        withAgentScriptBranchState(
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
          previewSessionEvents({
            agentName,
            sessionId: result.sessionId,
            sessionDir: result.sessionDir,
            targetOrg: input.target_org,
            sessionKind: "api_name",
            status: "active",
            source: "preview.start",
          }),
        ),
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
  let analysis;
  try {
    analysis = timings
      ? await timings.time("load_analysis_snapshot", () => getAgentScriptAnalysis(filePath))
      : await getAgentScriptAnalysis(filePath);
  } catch (err) {
    return toolError(
      `Cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const source = analysis.source;
  const agentName = input.agent_name ?? path.basename(filePath, ".agent");

  const localCheck = timings
    ? await timings.time("local_compile", () => analysis.getCompile())
    : await analysis.getCompile();
  if (!localCheck.ok) {
    return toolError(
      localCheck.unavailableReason ?? "Local Agent Script compile failed before preview.",
      "Run agentscript_authoring compile/check to see the full diagnostic details.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      },
    );
  }
  const blocking = localCheck.diagnostics.filter((d) => d.severity === 1);
  if (blocking.length > 0) {
    return toolError(
      `Local diagnostics rejected preview (${blocking.length} severity-1 issue${blocking.length === 1 ? "" : "s"}).`,
      "Run agentscript_authoring compile/check to see and fix the diagnostics before starting preview.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      },
    );
  }

  try {
    const authPhase = timings?.phase("agent_api_auth");
    const auth = await connForAgentApi(input.target_org, { signal });
    authPhase?.end({ cache: auth.cache });
    const { conn } = auth;
    const result = await startPreview({
      conn,
      cwd: ctx.cwd,
      agentName,
      agentSource: source,
      agentFilePath: filePath,
      versionDeveloperName: input.version_developer_name,
      mockMode: input.mock_mode ?? "Mock",
      targetOrg: input.target_org,
      contextVariables: input.context_variables,
      timings,
      signal,
      skipLocalValidation: true,
      // (agentFilePath above is also persisted to metadata.json by
      //  startPreview — used by `end` to suggest the next publish command.)
    });
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          session_id: result.sessionId,
          agent_response: result.agentResponse,
          started_at: result.startedAt,
          session_dir: result.sessionDir,
          agent_name: agentName,
          via: "agent_file" as const,
          context_patch: result.contextPatch,
          version_resolution: result.versionResolution,
          warnings: result.warnings,
        },
        previewSessionEvents({
          agentName,
          sessionId: result.sessionId,
          sessionDir: result.sessionDir,
          targetOrg: input.target_org,
          sessionKind: "agent_file",
          status: "active",
          source: "preview.start",
        }),
      ),
      [
        `🎬 Preview started`,
        `session_id: ${result.sessionId}`,
        result.versionResolution
          ? `agent_version: ${result.versionResolution.developerName} (${result.versionResolution.source})`
          : null,
        result.contextPatch && result.contextPatch.variables.length > 0
          ? `context_variables: ${result.contextPatch.variables.length} seeded · ${result.contextPatch.registeredStateVariables} state slot(s) · ${result.contextPatch.rewrittenBindings} binding rewrite(s)`
          : null,
        ...(result.warnings ?? []).map((w) => `⚠ ${w}`),
        result.agentResponse,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Local compile rejected")) {
      return toolError(msg, undefined, {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
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
  timings?: TimingCollector,
  signal?: AbortSignal,
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

  const resolvedSession = timings
    ? await timings.time("resolve_preview_session", () =>
        resolveActivePreviewSession(ctx, input.agent_name, input.session_id),
      )
    : await resolveActivePreviewSession(ctx, input.agent_name, input.session_id);
  if ("agentName" in resolvedSession === false) return resolvedSession;
  input = {
    ...input,
    agent_name: resolvedSession.agentName,
    session_id: resolvedSession.sessionId,
    target_org: input.target_org ?? resolvedSession.targetOrg,
  };

  // Resolve the target_org from session metadata when the caller didn't
  // pass one (or refuse if it conflicts with what start was called with).
  // Prevents the silent "send hits the wrong org → Session not found" bug.
  const orgResolution = timings
    ? await timings.time("resolve_session_org", () =>
        resolveSessionTargetOrg(ctx.cwd, input.agent_name, input.session_id, input.target_org),
      )
    : await resolveSessionTargetOrg(ctx.cwd, input.agent_name, input.session_id, input.target_org);
  if (orgResolution.kind === "conflict") return toolError(orgResolution.message);

  try {
    const authPhase = timings?.phase("agent_api_auth");
    const auth = await connForAgentApi(orgResolution.targetOrg, { signal });
    authPhase?.end({ cache: auth.cache });
    const { conn } = auth;
    const result = await sendMessage({
      conn,
      cwd: ctx.cwd,
      agentName: input.agent_name,
      sessionId: input.session_id,
      message: input.message,
      apexDebug: input.apex_debug,
      contextVariables: input.context_variables,
      timings,
      signal,
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
        const written = timings
          ? await timings.time("write_preview_report", () =>
              writeMarkdownReport(previewReportPath(sessionDir, result.planId), md),
            )
          : await writeMarkdownReport(previewReportPath(sessionDir, result.planId), md);
        reportFile = written.path;
      }
    } catch {
      // Best-effort — swallow and continue.
    }

    return toolOk(
      withAgentScriptBranchState(
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
          trace_mode: result.traceFile ? "full_v1_1" : "surface_only_production_v1",
          ...(result.digest?.state_variables
            ? { state_variables: result.digest.state_variables }
            : {}),
          ...(result.apexDebugLog ? { apex_debug_log: result.apexDebugLog } : {}),
        },
        previewTurnEvents({
          agentName: input.agent_name,
          sessionId: input.session_id,
          planId: result.planId,
          traceFile: result.traceFile,
          reportFile,
          source: "preview.send",
        }),
      ),
      [
        `🤖 ${result.agentResponse}`,
        result.digest?.summary_line ? `→ ${result.digest.summary_line}` : null,
        result.digest?.variable_changes?.length
          ? `state_changes=${result.digest.variable_changes.length}`
          : null,
        result.digest?.tool_activity?.called?.length
          ? `actions_called=${result.digest.tool_activity.called.length}`
          : null,
        result.digest && result.digest.errors.length > 0
          ? `⚠️ errors=${result.digest.errors.length}`
          : null,
        result.traceFile
          ? `plan=${result.planId.slice(0, 8)}… trace=full_v1_1`
          : `plan=${result.planId.slice(0, 8)}… trace=surface_only (use agent_file preview for full v1.1 traces)`,
        reportFile ? "human_report=written" : null,
        "Use details.digest for compact structured trace; use agentscript_preview trace for full raw trace.",
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
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolvedSession = await resolveActivePreviewSession(
    ctx,
    input.agent_name,
    input.session_id,
  );
  if ("agentName" in resolvedSession === false) return resolvedSession;
  input = {
    ...input,
    agent_name: resolvedSession.agentName,
    session_id: resolvedSession.sessionId,
    target_org: input.target_org ?? resolvedSession.targetOrg,
  };

  // Same target_org resolution as actionSend.
  const orgResolution = await resolveSessionTargetOrg(
    ctx.cwd,
    input.agent_name,
    input.session_id,
    input.target_org,
  );
  if (orgResolution.kind === "conflict") return toolError(orgResolution.message);

  try {
    let conn;
    try {
      ({ conn } = await connForAgentApi(orgResolution.targetOrg));
    } catch {
      // Local metadata end should still work if remote auth/bootstrap is unavailable.
    }
    const result = await endPreview({
      conn,
      cwd: ctx.cwd,
      agentName: input.agent_name,
      sessionId: input.session_id,
      signal,
    });
    // Suggest the obvious next lifecycle step. We only nudge for sessions
    // that have an agent_file on disk — api_name sessions are already
    // running against a published agent.
    const nextStepHint =
      result.metadata.sessionKind === "agent_file" && result.metadata.agentFilePath
        ? `

→ Ready to ship? agentscript_lifecycle action='publish' agent_file='${result.metadata.agentFilePath}' activate=true${
            result.metadata.targetOrg ? ` target_org='${result.metadata.targetOrg}'` : ""
          }`
        : "";
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          ended_at: result.endedAt,
          summary: result.summary,
          metadata: result.metadata,
          remote_ended: result.remoteEnded,
          remote_end_error: result.remoteEndError,
        },
        previewSessionEvents({
          agentName: input.agent_name,
          sessionId: input.session_id,
          sessionDir: result.metadata
            ? path.join(ctx.cwd, ".sfdx", "agents", input.agent_name, "sessions", input.session_id)
            : "",
          targetOrg: result.metadata?.targetOrg,
          sessionKind: result.metadata?.sessionKind,
          status: "ended",
          source: "preview.end",
        }),
      ),
      [
        `🏁 session ${input.session_id.slice(0, 8)}… ended (${result.summary.turns} turns, ${result.summary.plans} plans)`,
        result.remoteEnded === false ? `⚠️ ${result.remoteEndError}` : null,
      ]
        .filter(Boolean)
        .join("\n") + nextStepHint,
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = end_all
// -------------------------------------------------------------------------------------------------

async function actionEndAll(
  ctx: ExtensionContext,
  input: ParamsAny,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const dryRun = input.dry_run ?? true;
  const includeEnded = input.include_ended ?? false;
  try {
    const sessions = await listStoredSessions(ctx.cwd);
    const skipped: Array<{ agent: string; session_id: string; reason: string }> = [];
    const candidates = sessions.filter((s) => {
      if (!s.metadata) {
        skipped.push({ agent: s.agent, session_id: s.session_id, reason: "metadata_unreadable" });
        return false;
      }
      const kind = s.metadata.sessionKind ?? "agent_file";
      if (input.agent_name && s.agent !== input.agent_name) return false;
      if (input.session_kind && kind !== input.session_kind) return false;
      if (input.target_org && s.metadata.targetOrg !== input.target_org) return false;
      if (!includeEnded && s.metadata.endTime) return false;
      if (typeof input.older_than_days === "number" && s.age_days < input.older_than_days) {
        return false;
      }
      return true;
    });

    const candidateRows = candidates.map((s) => ({
      agent: s.agent,
      session_id: s.session_id,
      session_kind: s.metadata?.sessionKind ?? "agent_file",
      target_org: s.metadata?.targetOrg,
      age_days: s.age_days,
      session_dir: s.session_dir,
    }));

    if (dryRun) {
      return toolOk(
        {
          ok: true as const,
          dry_run: true,
          matched: candidateRows.length,
          candidates: candidateRows,
          skipped,
        },
        `🏁 end_all dry run: ${candidateRows.length} session(s) would be ended; skipped ${skipped.length}. Pass dry_run=false to execute.`,
      );
    }

    const ended: Array<Record<string, unknown>> = [];
    const localFinalized: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    const connCache = new Map<string, Awaited<ReturnType<typeof connForAgentApi>>["conn"]>();

    for (const s of candidates) {
      const meta = s.metadata;
      if (!meta) {
        failed.push({ agent: s.agent, session_id: s.session_id, reason: "metadata_unreadable" });
        continue;
      }
      const kind = meta.sessionKind ?? "agent_file";
      try {
        if (kind === "api_name") {
          const orgKey = meta.targetOrg ?? input.target_org ?? "";
          let conn = connCache.get(orgKey);
          if (!conn) {
            try {
              ({ conn } = await connForAgentApi(meta.targetOrg ?? input.target_org));
              connCache.set(orgKey, conn);
            } catch (err) {
              failed.push({
                agent: s.agent,
                session_id: s.session_id,
                session_kind: kind,
                reason: "agent_api_auth_failed",
                error: err instanceof Error ? err.message : String(err),
              });
              continue;
            }
          }
          const result = await endPreview({
            conn,
            cwd: ctx.cwd,
            agentName: s.agent,
            sessionId: s.session_id,
            signal,
          });
          const row = {
            agent: s.agent,
            session_id: s.session_id,
            session_kind: kind,
            ended_at: result.endedAt,
            session_dir: s.session_dir,
            remote_ended: result.remoteEnded,
          };
          if (result.remoteEnded === false) {
            failed.push({ ...row, error: result.remoteEndError ?? "remote_end_failed" });
          } else {
            ended.push(row);
          }
        } else {
          const result = await endPreview({
            cwd: ctx.cwd,
            agentName: s.agent,
            sessionId: s.session_id,
            signal,
          });
          localFinalized.push({
            agent: s.agent,
            session_id: s.session_id,
            session_kind: kind,
            ended_at: result.endedAt,
            session_dir: s.session_dir,
            remote_ended: "not_applicable",
          });
        }
      } catch (err) {
        failed.push({
          agent: s.agent,
          session_id: s.session_id,
          session_kind: kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return toolOk(
      {
        ok: failed.length === 0,
        dry_run: false,
        matched: candidates.length,
        ended,
        local_finalized: localFinalized,
        skipped,
        failed,
      },
      `🏁 end_all: ended ${ended.length} remote session(s), finalized ${localFinalized.length} local session(s), failed ${failed.length}, skipped ${skipped.length}.`,
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = trace
// -------------------------------------------------------------------------------------------------

async function actionTrace(
  input: ParamsAny,
  timings?: TimingCollector,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const authPhase = timings?.phase("agent_api_auth");
    const auth = await connForAgentApi(input.target_org, { signal });
    authPhase?.end({ cache: auth.cache });
    const trace = timings
      ? await timings.time("trace_fetch", () =>
          fetchTrace(auth.conn, input.session_id, input.plan_id, { signal }),
        )
      : await fetchTrace(auth.conn, input.session_id, input.plan_id, { signal });
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

/**
 * Resolve the org alias / username to use for a send/end call. Sessions
 * persist `targetOrg` in their metadata at `start` time; subsequent calls
 * should reuse it so the LLM doesn't have to remember to pass `target_org`
 * on every call. Falls back to the caller-supplied value (or default org
 * resolution) when the session predates this field.
 *
 * Returns a discriminated union so callers can surface a clean conflict
 * error without an exception.
 */
function previewSessionEvents(input: {
  agentName: string;
  sessionId: string;
  sessionDir: string;
  targetOrg?: string;
  sessionKind?: "agent_file" | "api_name";
  status: "active" | "ended";
  source: string;
}): AgentScriptBranchStateEvent[] {
  return [
    {
      schema_version: 1,
      kind: "preview_session",
      status: input.status,
      agent_name: input.agentName,
      session_id: input.sessionId,
      session_dir: input.sessionDir,
      target_org: input.targetOrg,
      session_kind: input.sessionKind,
      source: input.source,
    },
  ];
}

function previewTurnEvents(input: {
  agentName: string;
  sessionId: string;
  planId: string;
  traceFile?: string;
  reportFile?: string;
  source: string;
}): AgentScriptBranchStateEvent[] {
  return [
    {
      schema_version: 1,
      kind: "preview_turn",
      agent_name: input.agentName,
      session_id: input.sessionId,
      plan_id: input.planId,
      trace_file: input.traceFile,
      report_file: input.reportFile,
      source: input.source,
    },
  ];
}

async function resolveSessionTargetOrg(
  cwd: string,
  agentName: string,
  sessionId: string,
  callerTargetOrg: string | undefined,
): Promise<{ kind: "ok"; targetOrg: string | undefined } | { kind: "conflict"; message: string }> {
  let metadata: PreviewMetadata | undefined;
  try {
    const loaded = await loadSession(cwd, agentName, sessionId);
    metadata = loaded.metadata;
  } catch {
    // No metadata on disk — fall back to whatever the caller passed.
    return { kind: "ok", targetOrg: callerTargetOrg };
  }
  const stored = metadata?.targetOrg;
  if (callerTargetOrg && stored && callerTargetOrg !== stored) {
    return {
      kind: "conflict",
      message:
        `target_org mismatch: session was started against '${stored}' but ` +
        `you passed '${callerTargetOrg}'. Re-run with target_org='${stored}' ` +
        `or omit target_org to reuse the session's stored org.`,
    };
  }
  return { kind: "ok", targetOrg: callerTargetOrg ?? stored };
}
