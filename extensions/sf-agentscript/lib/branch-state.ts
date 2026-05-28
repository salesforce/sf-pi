/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Branch-Durable Tool State for sf-agentscript.
 *
 * Tool results store pointer-sized events in
 * `details.sf_agentscript_branch_state`. Reconstructing from the current Pi
 * branch gives follow-on tool calls safe, branch-aware defaults without
 * replacing the heavy disk artifacts (traces, transcripts, reports, raw eval
 * responses).
 */

import { access, readFile } from "node:fs/promises";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isAgentScriptFile } from "./file-classify.ts";
import { toolError, type ToolEnvelope, type ToolError } from "./tool-types.ts";

export const AGENTSCRIPT_BRANCH_STATE_KEY = "sf_agentscript_branch_state";
export const AGENTSCRIPT_BRANCH_STATE_SCHEMA_VERSION = 1 as const;

interface BranchEventBase {
  schema_version: typeof AGENTSCRIPT_BRANCH_STATE_SCHEMA_VERSION;
  kind: string;
  source?: string;
}

export interface AgentFileBranchEvent extends BranchEventBase {
  kind: "agent_file";
  agent_file: string;
}

export interface CompileResultBranchEvent extends BranchEventBase {
  kind: "compile_result" | "format_result";
  agent_file: string;
  clean?: boolean;
  diagnostic_count?: number;
  quick_fix_count?: number;
  changed?: boolean;
}

export interface InspectResultBranchEvent extends BranchEventBase {
  kind: "inspect_result";
  agent_file: string;
  mode: string;
  has_parse_errors?: boolean;
  parse_error_count?: number;
}

export interface MutationResultBranchEvent extends BranchEventBase {
  kind: "mutation_result";
  agent_file: string;
  mode: string;
  diagnostics_after_errors?: number;
  diagnostics_after_warnings?: number;
}

export interface ReviewResultBranchEvent extends BranchEventBase {
  kind: "review_result";
  agent_file: string;
  readiness: "ready" | "ready_with_warnings" | "blocked" | "partial";
  blocking_count: number;
  warning_count: number;
  output_path?: string;
}

export interface PreviewSessionBranchEvent extends BranchEventBase {
  kind: "preview_session";
  status: "active" | "ended";
  agent_name: string;
  session_id: string;
  session_dir: string;
  target_org?: string;
  session_kind?: "agent_file" | "api_name";
}

export interface PreviewTurnBranchEvent extends BranchEventBase {
  kind: "preview_turn";
  agent_name: string;
  session_id: string;
  plan_id: string;
  trace_file?: string;
  report_file?: string;
}

export interface EvalSpecBranchEvent extends BranchEventBase {
  kind: "eval_spec";
  spec_path: string;
  agent_file?: string;
}

export interface EvalRunBranchEvent extends BranchEventBase {
  kind: "eval_run";
  run_id: string;
  run_dir: string;
  ok: boolean;
  failed_test_ids?: string[];
}

export interface EvalTraceBranchEvent extends BranchEventBase {
  kind: "eval_trace";
  session_id: string;
  plan_id: string;
  trace_file?: string;
}

export interface LifecycleVersionBranchEvent extends BranchEventBase {
  kind: "lifecycle_version";
  agent_api_name: string;
  agent_file?: string;
  bot_id?: string;
  bot_version_id?: string;
  version_number?: number;
  status?: string;
}

export type AgentScriptBranchStateEvent =
  | AgentFileBranchEvent
  | CompileResultBranchEvent
  | InspectResultBranchEvent
  | MutationResultBranchEvent
  | ReviewResultBranchEvent
  | PreviewSessionBranchEvent
  | PreviewTurnBranchEvent
  | EvalSpecBranchEvent
  | EvalRunBranchEvent
  | EvalTraceBranchEvent
  | LifecycleVersionBranchEvent;

export interface AgentScriptBranchState {
  events: AgentScriptBranchStateEvent[];
  agentFiles: AgentFileBranchEvent[];
  previewSessions: PreviewSessionBranchEvent[];
  previewTurns: PreviewTurnBranchEvent[];
  evalSpecs: EvalSpecBranchEvent[];
  evalRuns: EvalRunBranchEvent[];
  evalTraces: EvalTraceBranchEvent[];
  reviewResults: ReviewResultBranchEvent[];
}

export function withAgentScriptBranchState<T extends Record<string, unknown>>(
  details: T,
  events: readonly AgentScriptBranchStateEvent[],
): T & { sf_agentscript_branch_state: AgentScriptBranchStateEvent[] } {
  return {
    ...details,
    [AGENTSCRIPT_BRANCH_STATE_KEY]: [...events],
  } as T & { sf_agentscript_branch_state: AgentScriptBranchStateEvent[] };
}

export function agentFileEvent(agentFile: string, source: string): AgentFileBranchEvent {
  return {
    schema_version: AGENTSCRIPT_BRANCH_STATE_SCHEMA_VERSION,
    kind: "agent_file",
    agent_file: agentFile,
    source,
  };
}

export function reconstructAgentScriptBranchState(ctx: ExtensionContext): AgentScriptBranchState {
  const entries = ctx.sessionManager.getBranch();
  const events: AgentScriptBranchStateEvent[] = [];

  for (const entry of entries) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (!message || message.role !== "toolResult" || message.isError) continue;
    const details = message.details as Record<string, unknown> | undefined;
    const raw = details?.[AGENTSCRIPT_BRANCH_STATE_KEY];
    if (!Array.isArray(raw)) continue;
    for (const candidate of raw) {
      if (isAgentScriptBranchStateEvent(candidate)) events.push(candidate);
    }
  }

  return {
    events,
    agentFiles: events.filter((e): e is AgentFileBranchEvent => e.kind === "agent_file"),
    previewSessions: events.filter(
      (e): e is PreviewSessionBranchEvent => e.kind === "preview_session",
    ),
    previewTurns: events.filter((e): e is PreviewTurnBranchEvent => e.kind === "preview_turn"),
    evalSpecs: events.filter((e): e is EvalSpecBranchEvent => e.kind === "eval_spec"),
    evalRuns: events.filter((e): e is EvalRunBranchEvent => e.kind === "eval_run"),
    evalTraces: events.filter((e): e is EvalTraceBranchEvent => e.kind === "eval_trace"),
    reviewResults: events.filter((e): e is ReviewResultBranchEvent => e.kind === "review_result"),
  };
}

function isAgentScriptBranchStateEvent(value: unknown): value is AgentScriptBranchStateEvent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schema_version === AGENTSCRIPT_BRANCH_STATE_SCHEMA_VERSION &&
    typeof record.kind === "string"
  );
}

export async function resolveCurrentAgentFile(
  ctx: ExtensionContext,
  explicitAgentFile: string | undefined,
  resolveExplicit: (agentFile: string) => { ok: true; absPath: string } | ToolEnvelope<ToolError>,
): Promise<{ ok: true; agentFile: string; inferred: boolean } | ToolEnvelope<ToolError>> {
  if (explicitAgentFile) {
    const resolved = resolveExplicit(explicitAgentFile);
    if ("absPath" in resolved === false) return resolved;
    return { ok: true, agentFile: resolved.absPath, inferred: false };
  }

  const state = reconstructAgentScriptBranchState(ctx);
  const unique = uniqueByLast(state.agentFiles.map((e) => e.agent_file));
  if (unique.length === 0) {
    return toolError(
      "agent_file is required.",
      "Pass agent_file or first establish a current .agent file with agentscript_authoring compile/check, inspect/structure, create, or mutate.",
    );
  }
  if (unique.length > 1) {
    return toolError(
      "Multiple current .agent files exist on this branch; refusing to guess.",
      "Pass agent_file explicitly.",
      undefined,
      { candidates: unique.map((agent_file) => ({ agent_file })) },
    );
  }

  const agentFile = unique[0];
  if (!isAgentScriptFile(agentFile)) {
    return toolError(
      `Branch state pointed to a non-Agent Script file: ${agentFile}`,
      "Pass agent_file explicitly or run agentscript_authoring on the desired .agent file.",
    );
  }
  try {
    await access(agentFile);
  } catch {
    return toolError(
      `Branch state pointed to a missing .agent file: ${agentFile}`,
      "Pass agent_file explicitly or run agentscript_authoring on an existing .agent file.",
    );
  }
  return { ok: true, agentFile, inferred: true };
}

function uniqueByLast(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.unshift(value);
  }
  return out;
}

export async function resolveActivePreviewSession(
  ctx: ExtensionContext,
  explicitAgentName: string | undefined,
  explicitSessionId: string | undefined,
): Promise<
  | { ok: true; agentName: string; sessionId: string; targetOrg?: string; inferred: boolean }
  | ToolEnvelope<ToolError>
> {
  if (explicitAgentName && explicitSessionId) {
    return {
      ok: true,
      agentName: explicitAgentName,
      sessionId: explicitSessionId,
      inferred: false,
    };
  }
  if (explicitAgentName || explicitSessionId) {
    return toolError(
      "agent_name and session_id must be passed together.",
      "Pass both fields explicitly, or omit both to use the single active preview session on this branch.",
    );
  }

  const state = reconstructAgentScriptBranchState(ctx);
  const byKey = new Map<string, PreviewSessionBranchEvent>();
  for (const event of state.previewSessions) {
    byKey.set(`${event.agent_name}::${event.session_id}`, event);
  }
  const active = [...byKey.values()].filter((event) => event.status === "active");
  if (active.length === 0) {
    return toolError(
      "agent_name and session_id are required.",
      "Start a preview session first, or pass agent_name and session_id explicitly.",
    );
  }
  if (active.length > 1) {
    return toolError(
      "Multiple active preview sessions exist on this branch; refusing to guess.",
      "Pass agent_name and session_id explicitly.",
      undefined,
      {
        candidates: active.map((event) => ({
          agent_name: event.agent_name,
          session_id: event.session_id,
          target_org: event.target_org,
          session_dir: event.session_dir,
        })),
      },
    );
  }
  const candidate = active[0];
  if (!(await validateJsonFile(`${candidate.session_dir}/metadata.json`))) {
    return toolError(
      `Branch state pointed to a stale preview session: ${candidate.agent_name}/${candidate.session_id}`,
      "Start a new preview session, or pass agent_name and session_id explicitly if the session still exists elsewhere.",
    );
  }
  return {
    ok: true,
    agentName: candidate.agent_name,
    sessionId: candidate.session_id,
    targetOrg: candidate.target_org,
    inferred: true,
  };
}

export async function resolveLatestEvalRun(
  ctx: ExtensionContext,
  explicitRunId: string | undefined,
): Promise<{ ok: true; runId: string; inferred: boolean } | ToolEnvelope<ToolError>> {
  if (explicitRunId) return { ok: true, runId: explicitRunId, inferred: false };
  const state = reconstructAgentScriptBranchState(ctx);
  const failed = state.evalRuns.filter(
    (event) => !event.ok || (event.failed_test_ids?.length ?? 0) > 0,
  );
  const unique = uniqueByLast(failed.map((event) => event.run_id));
  if (unique.length === 0) {
    return toolError(
      "run_id is required.",
      "Run an eval with failures first, or pass run_id explicitly.",
    );
  }
  if (unique.length > 1) {
    return toolError(
      "Multiple failed eval runs exist on this branch; refusing to guess.",
      "Pass run_id explicitly.",
      undefined,
      { candidates: unique.map((run_id) => ({ run_id })) },
    );
  }
  return { ok: true, runId: unique[0], inferred: true };
}

export function latestEvalSpec(ctx: ExtensionContext): EvalSpecBranchEvent | undefined {
  const specs = reconstructAgentScriptBranchState(ctx).evalSpecs;
  return specs[specs.length - 1];
}

export async function validateJsonFile(path: string): Promise<boolean> {
  try {
    JSON.parse(await readFile(path, "utf8"));
    return true;
  } catch {
    return false;
  }
}
