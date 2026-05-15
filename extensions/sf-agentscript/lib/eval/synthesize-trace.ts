/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Synthesize a per-turn planner-trace document from the eval API's inline
 * response data.
 *
 * Why this exists
 * ----------------
 * The eval API runs every test as an ephemeral session and closes it as
 * part of the same request. By the time the response returns, the live
 * `/v1.1/preview/sessions/{sid}/plans/{pid}` endpoint already 404s with
 * `Session not found` (verified against the platform's 2026-05 build).
 *
 * That sounds catastrophic for trace capture, but it isn't: the eval
 * response **already contains** the data the trace endpoint would have
 * returned, just shaped differently. Per-turn we have:
 *
 *   - `lastExecution.llmEvents[][]` — every LLM call with full prompt,
 *     literal response, latency, timestamps
 *   - `lastExecution.invokedActions[]` — every action invocation
 *   - `lastExecution.errors[]` — planner errors
 *   - `lastExecution.{topic, agentResponse, message}` — final state
 *   - `sessionContext.executionHistory[]` — turn-by-turn topics + actions
 *   - `sessionContext.stateVariables{}` — full variable map at end of turn
 *   - `sessionProperties.{planId, sessionId}` — the id pair
 *
 * That covers ~80–90% of what the live trace gives you. The only loss is
 * the explicit step-type timeline (`UpdateTopicStep`, `FunctionStep`,
 * `VariableUpdateStep`), which we reconstruct deterministically below.
 *
 * Output shape
 * ------------
 * We emit a JSON document keyed roughly the same way `summarizeTrace` in
 * `lib/preview/trace-digest.ts` consumes a live trace, so the same render
 * + failure-record code path keeps working. The top-level shape:
 *
 *   {
 *     source: "synthesized-from-eval-api",
 *     planId, sessionId,
 *     plan: [
 *       UserInputStep, LLMExecutionStep[], FunctionStep[],
 *       VariableUpdateStep[], ErrorStep[], PlannerResponseStep
 *     ],
 *     // top-level mirrors of the eval data so consumers don't have to
 *     // walk the synthesized timeline if they just want the surface info
 *     topic, agentResponse, latency, executionHistory, stateVariables
 *   }
 *
 * Variable diffs
 * --------------
 * `VariableUpdateStep` rows need a *change* record, not just the final
 * value. The orchestrator passes the previous turn's stateVariables as
 * `prevStateVariables`; the synthesizer diffs and only emits an entry
 * for keys that changed. For the first turn of a test, the diff is
 * against an empty map.
 */

import type {
  EvalApiResponse,
  ExecutionHistoryEntry,
  LastExecution,
  PlannerResponse,
  SessionContext,
  TestResult,
} from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export interface SynthesizedTraceKey {
  testId: string;
  sessionId: string;
  planId: string;
}

export interface SynthesizedTrace {
  /** Stable marker so consumers know this is reconstructed, not live. */
  source: "synthesized-from-eval-api";
  planId: string;
  sessionId: string;
  /** Reconstructed step timeline. Every step has a stable `type` discriminator. */
  plan: SynthesizedStep[];
  /** Surface mirrors of the eval data — same fields the live trace exposes. */
  topic?: string;
  userUtterance?: string;
  agentResponse?: string;
  latency?: number;
  invokedActions?: unknown[];
  errors?: unknown[];
  llmEvents?: unknown[];
  executionHistory?: ExecutionHistoryEntry[];
  stateVariables?: Record<string, unknown>;
  message?: Record<string, unknown>;
  /** Free-text notes for the LLM: caveats, retention info, etc. */
  notes: string[];
}

export type SynthesizedStep =
  | { type: "UserInputStep"; data: { utterance: string } }
  | {
      type: "LLMExecutionStep";
      data: {
        agent_name?: string;
        prompt_name?: string;
        prompt_content?: string;
        prompt_response?: string;
        execution_latency?: number;
        startExecutionTime?: number;
        endExecutionTime?: number;
      };
    }
  | { type: "FunctionStep"; data: { action: unknown } }
  | {
      type: "VariableUpdateStep";
      data: {
        variable_name: string;
        variable_past_value: unknown;
        variable_new_value: unknown;
        variable_change_reason: "set" | "changed" | "unset";
      };
    }
  | { type: "ErrorStep"; data: { error: unknown } }
  | {
      type: "PlannerResponseStep";
      data: {
        message: string;
        topic?: string;
        message_id?: string;
        feedback_id?: string;
      };
    };

export interface SynthesizeFromResponseOptions {
  /**
   * Optional spec utterance index keyed `${test_id}::${turn_id}`. The eval
   * API doesn't echo back the user input on send_message outputs, so without
   * this we end up with empty `UserInputStep`s. The orchestrator already
   * builds this index for the failure renderer; we reuse it here.
   */
  utteranceIndex?: Map<string, string>;
}

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

/**
 * Walk a merged eval response and synthesize one trace per turn. Returns a
 * Map keyed `${sessionId}::${planId}` so callers can merge with live-fetched
 * traces under the same key convention.
 *
 * Within a single test, `stateVariables` diffs are computed across turns:
 * turn N's `prev` is turn N-1's stateVariables snapshot.
 */
export function synthesizeTracesFromMerged(
  merged: EvalApiResponse,
  opts: SynthesizeFromResponseOptions = {},
): Map<string, SynthesizedTrace> {
  const out = new Map<string, SynthesizedTrace>();
  for (const test of merged.results ?? []) {
    const synthesizedForTest = synthesizeTracesForTest(test, opts);
    for (const trace of synthesizedForTest) {
      out.set(`${trace.sessionId}::${trace.planId}`, trace);
    }
  }
  return out;
}

/**
 * Single-test version. Walks each `agent.send_message` + paired
 * `agent.get_state` and emits one synthesized trace per turn.
 *
 * Pairing rule: a `get_state` belongs to the most recent preceding
 * `send_message` (matches `lib/eval/persist.ts:writeRun`).
 */
export function synthesizeTracesForTest(
  test: TestResult,
  opts: SynthesizeFromResponseOptions = {},
): SynthesizedTrace[] {
  const tid = String(test.id ?? "?");
  const outputs = test.outputs ?? [];

  // Establish session id (one per test, comes from create_session).
  let sessionId: string | undefined;
  for (const o of outputs) {
    if (typeof o.session_id === "string" && o.session_id) {
      sessionId = o.session_id;
      break;
    }
  }
  if (!sessionId) return [];

  // Pair send_message → next get_state.
  const stateAfter = new Map<number, number>();
  let lastSendIndex = -1;
  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i];
    if (o.type === "agent.send_message") {
      lastSendIndex = i;
    } else if (
      o.type === "agent.get_state" &&
      lastSendIndex !== -1 &&
      !stateAfter.has(lastSendIndex)
    ) {
      stateAfter.set(lastSendIndex, i);
    }
  }

  const traces: SynthesizedTrace[] = [];
  let prevStateVariables: Record<string, unknown> = {};
  for (let i = 0; i < outputs.length; i++) {
    const send = outputs[i];
    if (send.type !== "agent.send_message") continue;
    const stateIdx = stateAfter.get(i);
    if (stateIdx === undefined) continue;
    const stateOut = outputs[stateIdx];
    const pr = (stateOut.response as { planner_response?: PlannerResponse } | undefined)
      ?.planner_response;
    if (!pr) continue;

    const planId = (pr.sessionProperties as { planId?: string } | undefined)?.planId;
    if (typeof planId !== "string" || !planId) continue;

    const utterance =
      (typeof send.utterance === "string" ? send.utterance : undefined) ??
      opts.utteranceIndex?.get(`${tid}::${send.id ?? ""}`);

    traces.push(
      buildSynthesizedTrace({
        planId,
        sessionId,
        utterance,
        lastExecution: pr.lastExecution,
        sessionContext: pr.sessionContext,
        prevStateVariables,
      }),
    );

    // Advance the variable diff baseline to this turn's snapshot.
    prevStateVariables = pr.sessionContext?.stateVariables ?? prevStateVariables;
  }
  return traces;
}

// -------------------------------------------------------------------------------------------------
// Internals
// -------------------------------------------------------------------------------------------------

interface BuildOptions {
  planId: string;
  sessionId: string;
  utterance?: string;
  lastExecution?: LastExecution;
  sessionContext?: SessionContext;
  prevStateVariables: Record<string, unknown>;
}

function buildSynthesizedTrace(opts: BuildOptions): SynthesizedTrace {
  const le = opts.lastExecution ?? {};
  const sc = opts.sessionContext ?? {};
  const plan: SynthesizedStep[] = [];

  // 1. UserInputStep — the original utterance that triggered this turn.
  if (typeof opts.utterance === "string") {
    plan.push({ type: "UserInputStep", data: { utterance: opts.utterance } });
  }

  // 2. LLMExecutionStep[] — one per llmEvent. The eval API nests events
  //    one level deeper than other surfaces (`llmEvents[i][j]`), so flatten.
  for (const ev of flattenLlmEvents(le.llmEvents)) {
    plan.push({
      type: "LLMExecutionStep",
      data: {
        agent_name: ev.agent_name,
        prompt_name: ev.prompt_name,
        prompt_content: typeof ev.prompt_content === "string" ? ev.prompt_content : undefined,
        prompt_response: typeof ev.prompt_response === "string" ? ev.prompt_response : undefined,
        execution_latency:
          typeof ev.execution_latency === "number" ? ev.execution_latency : undefined,
        startExecutionTime:
          typeof ev.startExecutionTime === "number" ? ev.startExecutionTime : undefined,
        endExecutionTime: typeof ev.endExecutionTime === "number" ? ev.endExecutionTime : undefined,
      },
    });
  }

  // 3. FunctionStep[] — one per invokedAction.
  for (const action of le.invokedActions ?? []) {
    plan.push({ type: "FunctionStep", data: { action } });
  }

  // 4. VariableUpdateStep[] — diff against prev.
  for (const step of diffVariables(opts.prevStateVariables, sc.stateVariables ?? {})) {
    plan.push(step);
  }

  // 5. ErrorStep[] — one per planner error.
  for (const err of le.errors ?? []) {
    plan.push({ type: "ErrorStep", data: { error: err } });
  }

  // 6. PlannerResponseStep — final agent message + topic.
  const msg = le.message ?? {};
  plan.push({
    type: "PlannerResponseStep",
    data: {
      message: typeof le.agentResponse === "string" ? le.agentResponse : "",
      topic: le.topic,
      message_id: typeof msg.id === "string" ? msg.id : undefined,
      feedback_id:
        typeof (msg as { feedbackId?: string }).feedbackId === "string"
          ? (msg as { feedbackId?: string }).feedbackId
          : undefined,
    },
  });

  return {
    source: "synthesized-from-eval-api",
    planId: opts.planId,
    sessionId: opts.sessionId,
    plan,
    topic: le.topic,
    userUtterance: opts.utterance ?? le.userUtterance,
    agentResponse: le.agentResponse,
    latency: le.latency,
    invokedActions: le.invokedActions,
    errors: le.errors,
    llmEvents: le.llmEvents,
    executionHistory: sc.executionHistory,
    stateVariables: sc.stateVariables,
    message: msg as Record<string, unknown>,
    notes: [
      "source=synthesized-from-eval-api — reconstructed from the eval response's lastExecution + sessionContext + sessionProperties. The eval API closes its sessions immediately, so the live /v1.1 trace endpoint cannot be reached after the response returns. This document carries every field the live trace would have exposed except the explicit step-type ordering of UpdateTopicStep / NodeEntryStateStep, which the eval API does not surface.",
    ],
  };
}

interface LlmEventLike {
  agent_name?: string;
  prompt_name?: string;
  prompt_content?: string;
  prompt_response?: string;
  execution_latency?: number;
  startExecutionTime?: number;
  endExecutionTime?: number;
}

function flattenLlmEvents(raw: unknown): LlmEventLike[] {
  if (!Array.isArray(raw)) return [];
  const out: LlmEventLike[] = [];
  for (const item of raw) {
    // The eval API emits llmEvents as `[[ev1, ev2], [ev3]]` — one inner array
    // per planner reasoning batch. Most other consumers expect a flat list.
    if (Array.isArray(item)) {
      for (const inner of item) {
        if (inner && typeof inner === "object") out.push(inner as LlmEventLike);
      }
    } else if (item && typeof item === "object") {
      out.push(item as LlmEventLike);
    }
  }
  return out;
}

/**
 * Diff two stateVariables maps and emit a VariableUpdateStep for every key
 * that changed. Strict equality on primitives, JSON.stringify equality on
 * structured values (cheap, deterministic; acceptable for diff reporting).
 *
 * Internal session-tracking keys (prefixed `__` or `AgentScriptInternal_`)
 * are filtered out — they're noisy and rarely interesting to humans.
 */
function diffVariables(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Array<{
  type: "VariableUpdateStep";
  data: {
    variable_name: string;
    variable_past_value: unknown;
    variable_new_value: unknown;
    variable_change_reason: "set" | "changed" | "unset";
  };
}> {
  const out: Array<{
    type: "VariableUpdateStep";
    data: {
      variable_name: string;
      variable_past_value: unknown;
      variable_new_value: unknown;
      variable_change_reason: "set" | "changed" | "unset";
    };
  }> = [];
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of allKeys) {
    if (k.startsWith("__") || k.startsWith("AgentScriptInternal_")) continue;
    const a = prev[k];
    const b = next[k];
    if (deepEqual(a, b)) continue;
    let reason: "set" | "changed" | "unset";
    if (!(k in prev)) reason = "set";
    else if (!(k in next)) reason = "unset";
    else reason = "changed";
    out.push({
      type: "VariableUpdateStep",
      data: {
        variable_name: k,
        variable_past_value: a,
        variable_new_value: b,
        variable_change_reason: reason,
      },
    });
  }
  // Stable order — alphabetical by key — so re-runs produce diffable output.
  out.sort((x, y) => x.data.variable_name.localeCompare(y.data.variable_name));
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
