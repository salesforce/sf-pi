/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Compact, LLM-friendly digest of a planner trace.
 *
 * The full planner trace JSON is rich (~16 step types observed live, single
 * turns up to ~55 KB of JSON). Dropping the whole thing into the LLM's
 * context every turn would be prohibitive. Dropping just `topic` and
 * `invoked_actions` (the previous behavior) hides the signal the LLM needs
 * for self-recovery: which prompts ran, what tools were enabled, which
 * variables changed, where the time went, where the safety filter scored
 * low.
 *
 * `summarizeTrace()` keeps every distinct step type in a one-line timeline
 * row plus a small per-type payload. Heavy fields (full prompts, full
 * variable maps, full tool call argument dumps) are clipped to character
 * counts; the on-disk trace file is the source of truth when the LLM needs
 * the raw bytes.
 *
 * Empirically: a 55 KB raw plan compresses to ~600–800 tokens of digest.
 *
 * Step types the runtime emits today, observed live:
 *   AfterReasoningStep, BeforeReasoningIterationStep, BeforeReasoningStep,
 *   EnabledToolsStep, FunctionStep, LLMStep / LLMExecutionStep,
 *   NodeEntryStateStep, OutputEvaluationStep, PlannerResponseStep,
 *   PlatformNotificationStep, ReasoningStep, SessionInitialStateStep,
 *   TransitionStep, UpdateTopicStep, UserInputStep, VariableUpdateStep.
 *
 * Unknown step types still get a row — `t` carries the raw type name and
 * we keep the first 200 chars of the data block as a hint. New runtime
 * types light up automatically.
 */

import type { LastExecution, PlannerResponse } from "../eval/types.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

/**
 * One row in the digest timeline. `t` is the step type name (verbatim from
 * the runtime — e.g. "LLMStep", "VariableUpdateStep", "TransitionStep").
 * The remaining keys are step-type specific; only the most signal-bearing
 * fields are kept.
 */
export interface DigestRow {
  i: number;
  t: string;
  ms?: number;
  [extra: string]: unknown;
}

export interface DigestStats {
  step_count: number;
  llm_calls: number;
  vars_updated: number;
  topic_changes: number;
  function_calls: number;
  errors: number;
}

export interface VariableChangeDigest {
  step: number;
  name: string;
  value_preview?: string;
  previous_value_preview?: string;
  reason?: string;
}

export interface TraceDigest {
  /**
   * "preview"        — built from a full v1.1 preview plan timeline (rich, every step type).
   * "eval"           — built from the Evaluation API's lastExecution snapshot (no timeline; LLM events reconstructed).
   * "production-v1"  — built from the production-agent v1 send response (surface-only; no timeline because v1 has no trace endpoint).
   */
  source: "preview" | "eval" | "production-v1";
  turn: {
    user_input?: string;
    agent_response?: string;
    topic?: string;
    topic_changed_from?: string;
    latency_ms?: number;
    plan_id?: string;
    /** Path to the full trace JSON on disk, if persisted. */
    trace_file?: string;
  };
  /** One row per planner step. Empty array for eval-source (no fine-grained timeline). */
  timeline: DigestRow[];
  /** User-authored/non-internal variable mutations observed during this turn. */
  variable_changes?: VariableChangeDigest[];
  /** Selected non-internal state/context variables observed during this turn. */
  state_variables?: Record<string, unknown>;
  /** Step-level errors aggregated across the timeline. */
  errors: Array<{ step?: number; type?: string; message: string }>;
  stats: DigestStats;
  /** One-line human-readable summary. */
  summary_line: string;
  /** Notes about what's missing or implicit. */
  notes?: string[];
}

// -------------------------------------------------------------------------------------------------
// Clipping helpers
// -------------------------------------------------------------------------------------------------

const MAX_USER_CHARS = 240;
const MAX_VAR_VALUE_CHARS = 80;
const MAX_HINT_CHARS = 200;
const MAX_TOOL_ARGS_CHARS = 120;

function clip(s: unknown, n: number): string | undefined {
  if (typeof s !== "string") return undefined;
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function ms(start: unknown, end: unknown): number | undefined {
  const s = asNumber(start);
  const e = asNumber(end);
  if (s === undefined || e === undefined) return undefined;
  const d = e - s;
  return d >= 0 ? d : undefined;
}

// -------------------------------------------------------------------------------------------------
// Per-step extractors
// -------------------------------------------------------------------------------------------------

interface StepLike {
  type?: string;
  startExecutionTime?: number;
  endExecutionTime?: number;
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

function extractLLMStep(step: StepLike): Partial<DigestRow> {
  const data = (step.data ?? {}) as Record<string, unknown>;
  const promptContent = asString(data.prompt_content) ?? "";
  let toolCalls: string[] | undefined;
  const responseRaw = asString(data.prompt_response) ?? "";
  try {
    const parsed = JSON.parse(responseRaw) as {
      tool_invocations?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
    if (Array.isArray(parsed.tool_invocations) && parsed.tool_invocations.length > 0) {
      toolCalls = parsed.tool_invocations
        .map((t) => t.function?.name)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
    }
  } catch {
    /* response wasn't JSON — ignore */
  }
  return {
    agent: asString(data.agent_name),
    prompt_name: asString(data.prompt_name),
    prompt_chars: promptContent.length || undefined,
    response_chars: responseRaw.length || undefined,
    ...(toolCalls && toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

function extractFunctionStep(step: StepLike): Partial<DigestRow> {
  const fn = step.function as { name?: string; input?: unknown; output?: unknown } | undefined;
  const argText = clip(JSON.stringify(fn?.input ?? {}), MAX_TOOL_ARGS_CHARS);
  return {
    fn: fn?.name,
    args_preview: argText && argText !== "{}" ? argText : undefined,
    has_output: fn?.output !== undefined && fn?.output !== null,
  };
}

function extractEnabledTools(step: StepLike): Partial<DigestRow> {
  const data = (step.data ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(data.enabled_tools)
    ? (data.enabled_tools as unknown[]).filter((t): t is string => typeof t === "string")
    : undefined;
  return {
    agent: asString(data.agent_name),
    tools: tools?.length ? tools : undefined,
  };
}

function isInternalVariable(name: string | undefined): boolean {
  return !!name && (name.startsWith("__") || name.startsWith("AgentScriptInternal_"));
}

function valuePreview(value: unknown): string | undefined {
  return typeof value === "string"
    ? clip(value, MAX_VAR_VALUE_CHARS)
    : clip(JSON.stringify(value ?? null), MAX_VAR_VALUE_CHARS);
}

function variableUpdates(step: StepLike): Record<string, unknown>[] {
  const data = (step.data ?? {}) as Record<string, unknown>;
  const updates = Array.isArray(data.variable_updates) ? data.variable_updates : [];
  return updates.filter((update): update is Record<string, unknown> => {
    return !!update && typeof update === "object";
  });
}

function extractVariableUpdate(step: StepLike): Partial<DigestRow> {
  const updates = variableUpdates(step);
  if (updates.length === 0) return {};
  // Keep the first update inline; the rest are summarized as `+N more`.
  const first = updates[0];
  const name = asString(first.variable_name);
  const preview = valuePreview(first.variable_new_value);
  // Skip internal scaffolding keys in the renderer by tagging them here.
  const isInternal = isInternalVariable(name);
  return {
    var: name,
    value_preview: preview,
    internal: isInternal || undefined,
    extra_updates: updates.length > 1 ? updates.length - 1 : undefined,
  };
}

function extractTransitionStep(step: StepLike): Partial<DigestRow> {
  const data = (step.data ?? {}) as Record<string, unknown>;
  return {
    from: asString(data.from_agent),
    to: asString(data.to_agent),
    transition_type: asString(data.transition_type),
    transition_mode: asString(data.transition_mode),
  };
}

function extractUpdateTopic(step: StepLike): Partial<DigestRow> {
  return { topic: asString(step.topic) };
}

function extractNodeEntry(step: StepLike): Partial<DigestRow> {
  const data = (step.data ?? {}) as Record<string, unknown>;
  return { node: asString(data.agent_name) };
}

function extractPlannerResponse(step: StepLike): Partial<DigestRow> {
  const safety = step.safetyScore as { safety_score?: number } | undefined;
  return {
    response_chars: asString(step.message)?.length,
    response_type: asString(step.responseType),
    is_content_safe: typeof step.isContentSafe === "boolean" ? step.isContentSafe : undefined,
    safety_score: asNumber(safety?.safety_score),
  };
}

function extractUserInput(step: StepLike): Partial<DigestRow> {
  return { user: clip(asString(step.message), MAX_USER_CHARS) };
}

function extractBeforeReasoningIter(step: StepLike): Partial<DigestRow> {
  const data = (step.data ?? {}) as Record<string, unknown>;
  return { agent: asString(data.agent_name) };
}

function extractSessionInitial(step: StepLike): Partial<DigestRow> {
  const data = (step.data ?? {}) as Record<string, unknown>;
  const vars = data.variable_values as Record<string, unknown> | undefined;
  return {
    directive_context: asString(data.directive_context),
    vars: vars ? Object.keys(vars).length : undefined,
  };
}

function stateVariablesFromStep(step: StepLike): Record<string, unknown> | undefined {
  const data = (step.data ?? {}) as Record<string, unknown>;
  const candidates = [data.variable_values, data.state_variables, step.state_variables];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return filterStateVariables(candidate as Record<string, unknown>);
    }
  }
  return undefined;
}

function filterStateVariables(vars: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key.startsWith("__") || key.startsWith("AgentScriptInternal_")) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const EXTRACTORS: Record<string, (step: StepLike) => Partial<DigestRow>> = {
  LLMStep: extractLLMStep,
  LLMExecutionStep: extractLLMStep,
  FunctionStep: extractFunctionStep,
  FunctionCallStep: extractFunctionStep,
  EnabledToolsStep: extractEnabledTools,
  VariableUpdateStep: extractVariableUpdate,
  TransitionStep: extractTransitionStep,
  UpdateTopicStep: extractUpdateTopic,
  NodeEntryStateStep: extractNodeEntry,
  PlannerResponseStep: extractPlannerResponse,
  UserInputStep: extractUserInput,
  BeforeReasoningIterationStep: extractBeforeReasoningIter,
  BeforeReasoningStep: extractBeforeReasoningIter,
  AfterReasoningStep: extractBeforeReasoningIter,
  SessionInitialStateStep: extractSessionInitial,
  // For unknown / less-frequent types we fall back to the catch-all below
  // and keep a 200-char hint of the raw `data` block so the LLM still has
  // signal without hand-coded extraction.
};

function fallbackExtractor(step: StepLike): Partial<DigestRow> {
  const data = step.data;
  if (data === undefined) return {};
  return { hint: clip(JSON.stringify(data), MAX_HINT_CHARS) };
}

// -------------------------------------------------------------------------------------------------
// Public: summarize a full preview trace
// -------------------------------------------------------------------------------------------------

export interface SummarizeOptions {
  planId?: string;
  traceFile?: string;
  /** Override the inferred user input (useful when the LLM passed a known utterance). */
  userInput?: string;
  /** Override the inferred agent response (useful when the caller already has it). */
  agentResponse?: string;
  /** Override the inferred latency (ms). */
  latencyMs?: number;
}

interface PreviewTraceLike {
  planId?: string;
  sessionId?: string;
  topic?: string;
  intent?: string;
  type?: string;
  plan?: StepLike[];
  /** Some traces use `steps` instead of `plan`; we tolerate both. */
  steps?: StepLike[];
}

/**
 * Build a digest from a full preview trace JSON. Pass options to override
 * fields that the trace doesn't carry directly (the preview client knows
 * the user input + agent response from its own send/receive cycle).
 */
export function summarizeTrace(trace: unknown, opts: SummarizeOptions = {}): TraceDigest {
  const t = (trace ?? {}) as PreviewTraceLike;
  const stepsRaw = (t.plan ?? t.steps ?? []) as StepLike[];

  const timeline: DigestRow[] = [];
  const errors: TraceDigest["errors"] = [];
  let llmCalls = 0;
  let varsUpdated = 0;
  let topicChanges = 0;
  let functionCalls = 0;
  let prevTopic: string | undefined;
  let lastTopic: string | undefined = t.topic;
  let stateVariables: Record<string, unknown> | undefined;
  const variableChanges: VariableChangeDigest[] = [];

  for (let i = 0; i < stepsRaw.length; i++) {
    const step = stepsRaw[i] ?? {};
    const type = step.type ?? "UnknownStep";
    const extractor = EXTRACTORS[type] ?? fallbackExtractor;
    const extracted = extractor(step);
    const row: DigestRow = {
      i,
      t: type,
      ms: ms(step.startExecutionTime, step.endExecutionTime),
      ...extracted,
    };
    if (row.ms === undefined) delete row.ms;
    timeline.push(row);
    const stateFromStep = stateVariablesFromStep(step);
    if (stateFromStep) stateVariables = { ...(stateVariables ?? {}), ...stateFromStep };

    // Stat collection — keep these per-type so the stats object is
    // accurate even when the runtime adds/renames step types.
    if (type === "LLMStep" || type === "LLMExecutionStep") llmCalls++;
    else if (type === "VariableUpdateStep") {
      varsUpdated++;
      for (const update of variableUpdates(step)) {
        const name = asString(update.variable_name);
        if (!name || isInternalVariable(name)) continue;
        variableChanges.push({
          step: i,
          name,
          value_preview: valuePreview(update.variable_new_value),
          previous_value_preview: valuePreview(update.variable_old_value),
          reason: asString(update.variable_change_reason),
        });
      }
    } else if (type === "UpdateTopicStep") {
      const newTopic = asString(step.topic);
      if (newTopic && newTopic !== prevTopic) {
        topicChanges++;
        prevTopic = newTopic;
        lastTopic = newTopic;
      }
    } else if (type === "FunctionStep" || type === "FunctionCallStep") {
      functionCalls++;
    }

    // Error harvesting — runtime steps surface errors in a few shapes.
    const errs = step.errors as unknown;
    if (Array.isArray(errs)) {
      for (const err of errs) {
        const m = typeof err === "string" ? err : asString((err as { message?: unknown })?.message);
        if (m) errors.push({ step: i, type, message: m });
      }
    }
  }

  const transitionFrom = timeline
    .filter((r) => r.t === "TransitionStep" && typeof r.from === "string")
    .map((r) => r.from as string)
    .filter((f) => f && f !== lastTopic)[0];
  const totalMs = timeline.reduce((acc, r) => acc + (typeof r.ms === "number" ? r.ms : 0), 0);

  const stats: DigestStats = {
    step_count: timeline.length,
    llm_calls: llmCalls,
    vars_updated: varsUpdated,
    topic_changes: topicChanges,
    function_calls: functionCalls,
    errors: errors.length,
  };

  const summary_line = formatSummaryLine({
    fromTopic: transitionFrom,
    toTopic: lastTopic,
    llmCalls,
    functionCalls,
    totalMs: opts.latencyMs ?? totalMs,
  });

  return {
    source: "preview",
    turn: {
      user_input: opts.userInput,
      agent_response: opts.agentResponse,
      topic: lastTopic,
      topic_changed_from: transitionFrom,
      latency_ms: opts.latencyMs ?? (totalMs > 0 ? totalMs : undefined),
      plan_id: opts.planId ?? t.planId,
      trace_file: opts.traceFile,
    },
    timeline,
    ...(variableChanges.length > 0 ? { variable_changes: variableChanges } : {}),
    ...(stateVariables ? { state_variables: stateVariables } : {}),
    errors,
    stats,
    summary_line,
    ...(timeline.length === 0
      ? { notes: ["Trace has no plan timeline; this is the eval API surface — see lastExecution."] }
      : {}),
  };
}

// -------------------------------------------------------------------------------------------------
// Public: summarize an eval lastExecution snapshot
// -------------------------------------------------------------------------------------------------

interface LastExecutionLLMEvent {
  agent_name?: string;
  prompt_name?: string;
  prompt_content?: string;
  prompt_response?: string;
  execution_latency?: number;
}

/**
 * Build a digest from the eval API's `lastExecution` snapshot. There is no
 * fine-grained step timeline here, but we can still surface every LLM
 * event as one synthesized `LLMStep` row, plus the final response.
 */
export function summarizeLastExecution(
  lastExec: LastExecution | undefined,
  ctx: {
    userInput?: string;
    planId?: string;
    traceFile?: string;
    stateVariables?: Record<string, unknown>;
  } = {},
): TraceDigest {
  const timeline: DigestRow[] = [];
  const errors: TraceDigest["errors"] = [];
  let llmCalls = 0;
  let i = 0;

  // userUtterance from the API often comes back blank; ctx.userInput
  // (sourced from the spec) wins.
  const userInput = ctx.userInput ?? lastExec?.userUtterance;
  if (userInput) {
    timeline.push({ i: i++, t: "UserInputStep", user: clip(userInput, MAX_USER_CHARS) });
  }

  // llmEvents is array-of-arrays; flatten and synthesize one LLMStep per event.
  const events = (lastExec?.llmEvents ?? []) as Array<
    LastExecutionLLMEvent[] | LastExecutionLLMEvent
  >;
  for (const group of events) {
    const rows = Array.isArray(group) ? group : [group];
    for (const ev of rows) {
      llmCalls++;
      let toolCalls: string[] | undefined;
      const responseStr = ev.prompt_response ?? "";
      try {
        const parsed = JSON.parse(responseStr) as {
          tool_invocations?: Array<{ function?: { name?: string } }>;
        };
        if (Array.isArray(parsed.tool_invocations) && parsed.tool_invocations.length > 0) {
          toolCalls = parsed.tool_invocations
            .map((t) => t.function?.name)
            .filter((s): s is string => typeof s === "string" && s.length > 0);
        }
      } catch {
        /* not JSON */
      }
      timeline.push({
        i: i++,
        t: "LLMStep",
        ms: typeof ev.execution_latency === "number" ? ev.execution_latency : undefined,
        agent: ev.agent_name,
        prompt_name: ev.prompt_name,
        prompt_chars: typeof ev.prompt_content === "string" ? ev.prompt_content.length : undefined,
        response_chars: responseStr.length || undefined,
        ...(toolCalls && toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    }
  }

  // Synthesize a PlannerResponseStep capping the timeline.
  if (lastExec?.agentResponse) {
    timeline.push({
      i: i++,
      t: "PlannerResponseStep",
      response_chars: lastExec.agentResponse.length,
    });
  }

  // Surface invokedActions as a synthesized FunctionStep row each.
  for (const fn of lastExec?.invokedActions ?? []) {
    if (typeof fn === "string") {
      timeline.push({ i: i++, t: "FunctionStep", fn });
    }
  }

  const lastExecErrors = (lastExec?.errors ?? []) as unknown[];
  for (const err of lastExecErrors) {
    const m = typeof err === "string" ? err : asString((err as { message?: unknown })?.message);
    if (m) errors.push({ message: m });
  }

  const stats: DigestStats = {
    step_count: timeline.length,
    llm_calls: llmCalls,
    vars_updated: 0,
    topic_changes: 0,
    function_calls: lastExec?.invokedActions?.length ?? 0,
    errors: errors.length,
  };

  const summary_line = formatSummaryLine({
    fromTopic: undefined,
    toTopic: lastExec?.topic,
    llmCalls,
    functionCalls: stats.function_calls,
    totalMs: typeof lastExec?.latency === "number" ? lastExec.latency : 0,
  });

  const stateVariables = filterStateVariables(ctx.stateVariables ?? {});

  return {
    source: "eval",
    turn: {
      user_input: userInput,
      agent_response: lastExec?.agentResponse,
      topic: lastExec?.topic,
      latency_ms: typeof lastExec?.latency === "number" ? lastExec.latency : undefined,
      plan_id: ctx.planId ?? (lastExec?.message as { planId?: string } | undefined)?.planId,
      trace_file: ctx.traceFile,
    },
    timeline,
    ...(stateVariables ? { state_variables: stateVariables } : {}),
    errors,
    stats,
    summary_line,
    notes: [
      "source=eval — the Evaluation API does not expose a fine-grained step timeline; LLM events are reconstructed from lastExecution.llmEvents.",
    ],
  };
}

// -------------------------------------------------------------------------------------------------
// Helpers shared by both surfaces
// -------------------------------------------------------------------------------------------------

function formatSummaryLine(p: {
  fromTopic?: string;
  toTopic?: string;
  llmCalls: number;
  functionCalls: number;
  totalMs: number;
}): string {
  const parts: string[] = [];
  if (p.fromTopic && p.toTopic && p.fromTopic !== p.toTopic) {
    parts.push(`${p.fromTopic} → ${p.toTopic}`);
  } else if (p.toTopic) {
    parts.push(p.toTopic);
  }
  parts.push(`${p.llmCalls} LLM call${p.llmCalls === 1 ? "" : "s"}`);
  if (p.totalMs > 0) parts.push(`${(p.totalMs / 1000).toFixed(1)}s`);
  parts.push(
    p.functionCalls > 0
      ? `${p.functionCalls} fn call${p.functionCalls === 1 ? "" : "s"}`
      : "no fn calls",
  );
  return parts.join(" · ");
}

// -------------------------------------------------------------------------------------------------
// Public: summarize a production-agent v1 send response
// -------------------------------------------------------------------------------------------------

/**
 * Production-agent send response shape (verified live against
 * api.salesforce.com/einstein/ai-agent/v1/sessions/{sid}/messages):
 *   messages: [{
 *     type: "Inform" | "Question" | "Escalate" | "EndConversation" | …,
 *     planId, isContentSafe, feedbackId,
 *     metrics: {},
 *     result: [],            // populated when actions fire
 *     citedReferences: [],   // populated when knowledge is invoked
 *     message: "..."         // the user-visible reply
 *   }]
 */
interface ProductionMessage {
  type?: string;
  planId?: string;
  isContentSafe?: boolean;
  feedbackId?: string;
  message?: string;
  result?: unknown[];
  citedReferences?: unknown[];
  metrics?: Record<string, unknown>;
}

export interface ProductionDigestContext {
  /** What the user just sent. Optional for the initial start turn (no user input yet). */
  userInput?: string;
  /** Client-measured latency for the round trip. */
  latencyMs?: number;
  /** Echoed back so failure-record consumers can correlate. */
  planId?: string;
}

/**
 * Build a digest from a production-agent v1 send response.
 *
 * Production v1 does NOT expose a per-step trace endpoint (verified via
 * eight URL probes against api.salesforce.com). The response itself still
 * carries useful surface signals — response type, safety flag, action
 * results, RAG citations — so we synthesize a small timeline:
 *
 *   UserInputStep         (when ctx.userInput is set)
 *   PlannerResponseStep   (always; carries response_type, is_content_safe, response_chars, plan_id, feedback_id)
 *   FunctionStep          (one per result[] entry)
 *   CitedReferenceStep    (one per citedReferences[] entry)
 *
 * `notes` always explains the limitation so the LLM doesn't expect richer
 * data and doesn't treat missing fields as a tool bug.
 */
export function summarizeProductionResponse(
  messages: ProductionMessage[] | undefined | null,
  ctx: ProductionDigestContext = {},
): TraceDigest {
  const msg = (messages ?? [])[0] ?? {};
  const timeline: DigestRow[] = [];
  const errors: TraceDigest["errors"] = [];
  let i = 0;
  let functionCalls = 0;

  if (typeof ctx.userInput === "string" && ctx.userInput.length > 0) {
    timeline.push({ i: i++, t: "UserInputStep", user: clip(ctx.userInput, MAX_USER_CHARS) });
  }

  const plannerRow: DigestRow = {
    i: i++,
    t: "PlannerResponseStep",
  };
  if (typeof msg.message === "string") plannerRow.response_chars = msg.message.length;
  if (typeof msg.type === "string") plannerRow.response_type = msg.type;
  if (typeof msg.isContentSafe === "boolean") plannerRow.is_content_safe = msg.isContentSafe;
  if (typeof msg.feedbackId === "string" && msg.feedbackId.length > 0)
    plannerRow.feedback_id = msg.feedbackId;
  if (typeof msg.planId === "string" && msg.planId.length > 0) plannerRow.plan_id = msg.planId;
  if (typeof ctx.latencyMs === "number") plannerRow.ms = ctx.latencyMs;
  timeline.push(plannerRow);

  // Each entry in result[] represents an action that fired. The shape
  // varies by action type; we surface the most common keys verbatim and
  // clip large outputs to keep the digest small.
  for (const r of msg.result ?? []) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    functionCalls++;
    const fn =
      asString(obj.name) ??
      asString(obj.functionName) ??
      asString((obj.function as { name?: string } | undefined)?.name);
    const outputPreview = clip(JSON.stringify(obj.output ?? obj.result ?? null), MAX_HINT_CHARS);
    const row: DigestRow = { i: i++, t: "FunctionStep" };
    if (fn) row.fn = fn;
    if (outputPreview && outputPreview !== "null" && outputPreview !== '"null"') {
      row.output_preview = outputPreview;
    }
    timeline.push(row);
  }

  // Citations are surfaced as their own synthetic step type. The runtime
  // taxonomy doesn't have one, but for the LLM "this answer cited X" is
  // a self-contained signal and naming it consistently keeps the schema
  // grep-friendly.
  for (const c of msg.citedReferences ?? []) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    const row: DigestRow = { i: i++, t: "CitedReferenceStep" };
    const title = asString(obj.title) ?? asString(obj.name);
    if (title) row.title = clip(title, 120);
    const url = asString(obj.url) ?? asString(obj.link);
    if (url) row.url = url;
    const score = asNumber(obj.relevanceScore) ?? asNumber(obj.score);
    if (score !== undefined) row.score = score;
    timeline.push(row);
  }

  if (msg.isContentSafe === false) {
    errors.push({
      type: "PlannerResponseStep",
      message: "is_content_safe=false on production-agent response",
    });
  }

  const stats: DigestStats = {
    step_count: timeline.length,
    llm_calls: 0, // production-v1 does not expose LLM call counts
    vars_updated: 0,
    topic_changes: 0,
    function_calls: functionCalls,
    errors: errors.length,
  };

  const summaryParts: string[] = [];
  if (typeof msg.type === "string") summaryParts.push(msg.type);
  if (typeof ctx.latencyMs === "number") summaryParts.push(`${(ctx.latencyMs / 1000).toFixed(1)}s`);
  if (msg.isContentSafe === false) summaryParts.push("⚠ unsafe");
  else if (msg.isContentSafe === true) summaryParts.push("safe");
  if (functionCalls > 0)
    summaryParts.push(`${functionCalls} action${functionCalls === 1 ? "" : "s"}`);
  const summary_line = summaryParts.length > 0 ? summaryParts.join(" · ") : "production-agent turn";

  return {
    source: "production-v1",
    turn: {
      user_input: ctx.userInput,
      agent_response: typeof msg.message === "string" ? msg.message : undefined,
      latency_ms: ctx.latencyMs,
      plan_id: ctx.planId ?? msg.planId,
      // No trace_file: production-v1 has no fetchable per-plan trace.
    },
    timeline,
    errors,
    stats,
    summary_line,
    notes: [
      "source=production-v1 — the production agent v1 endpoint does not expose a per-step plan timeline; this digest is a surface summary derived from the send response. For step-by-step traces (LLM events, transitions, variable updates, etc.), use the local `.agent` preview path.",
    ],
  };
}

// Re-export the types we touch so callers don't need to dig.
export type { LastExecution, PlannerResponse };
