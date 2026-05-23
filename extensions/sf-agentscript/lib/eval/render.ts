/* SPDX-License-Identifier: Apache-2.0 */
/**
 * LLM-shaped failure record builder.
 *
 * Every failed test produces a self-contained `FailureRecord` carrying enough
 * structured context for an LLM agent to attribute the failure to a prompt
 * issue, a routing issue, a tool-call issue, or a state-seeding issue:
 *   - utterance + agent response (HTML-decoded)
 *   - topic + invokedActions + per-turn latency
 *   - llmEvents (the topic-router prompt + literal LLM response)
 *   - sessionContext.executionHistory (last 5 — what topics were considered)
 *   - sessionContext.plugins (what plugins were in scope)
 *   - filtered stateVariables (interesting keys only)
 *   - per-turn errors from `lastExecution.errors`
 *   - pointer to the full planner trace file
 */

import type {
  EvalOutput,
  EvalResult,
  FailureRecord,
  LastExecution,
  LatencySummary,
  LlmEvent,
  RunTotals,
  SessionContext,
  TestResult,
  TurnSummary,
} from "./types.ts";
import { groupEvaluators } from "./threshold.ts";
import { summarizeLastExecution } from "../preview/trace-digest.ts";

/**
 * State variable keys that carry signal for the Vivint AVA V2 agent. Add to
 * this list when a new flag matters; everything else is omitted from failure
 * records to keep them small enough to fit comfortably in an LLM context
 * window. Customers downstream of this plugin can override via the
 * `interestingStateKeys` option.
 */
export const DEFAULT_INTERESTING_STATE_KEYS = [
  "verified_check",
  "billing_link_mode",
  "billing_link_url",
  "billing_link_attempted",
  "at_home",
  "appointment_intent",
] as const;

export interface BuildOptions {
  /** Max chars of llmEvents.prompt_content shown per turn. Default 600. */
  promptChars?: number;
  /** Optional override for which state-variable keys get surfaced. */
  interestingStateKeys?: readonly string[];
  /** Pointer base directory where trace files live. Used to fill `trace_files`. */
  tracesDir?: string;
  /**
   * Optional `${test_id}::${turn_id}` → utterance map sourced from the spec.
   * The eval API doesn't echo the user's input back in EvalOutput.utterance,
   * so without this the failure record's `utterance` field is empty.
   */
  utteranceIndex?: Map<string, string>;
}

function truncate(s: string | undefined | null, n: number): string {
  if (s == null) return "";
  const str = typeof s === "string" ? s : String(s);
  return str.length <= n ? str : str.slice(0, n - 1) + "…";
}

/**
 * `llmEvents` arrives as list-of-list-or-dict. Flatten to a flat list of
 * dicts so the renderer doesn't need to special-case shapes.
 */
function flattenLlmEvents(events: unknown): LlmEvent[] {
  if (!Array.isArray(events)) return [];
  const out: LlmEvent[] = [];
  for (const grp of events) {
    if (Array.isArray(grp)) {
      for (const ev of grp) if (ev && typeof ev === "object") out.push(ev as LlmEvent);
    } else if (grp && typeof grp === "object") {
      out.push(grp as LlmEvent);
    }
  }
  return out;
}

function pickStateVariables(
  sc: SessionContext | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const sv = sc?.stateVariables ?? {};
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = sv[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

function pluginNames(sc: SessionContext | undefined): string[] {
  const plugins = sc?.plugins;
  if (!Array.isArray(plugins)) return [];
  return plugins
    .map((p) => (typeof p === "string" ? p : (p?.name ?? "")))
    .filter((n) => n) as string[];
}

function executionHistoryLast5(
  sc: SessionContext | undefined,
): TurnSummary["execution_history_last5"] {
  const hist = sc?.executionHistory;
  if (!Array.isArray(hist)) return [];
  return hist.slice(-5).map((h) => ({
    topic: h?.topic,
    invokedActions: h?.invokedActions,
    latency: h?.latency,
  }));
}

export function buildTurnSummary(
  turnId: string,
  sendOut: EvalOutput,
  stateOut: EvalOutput | undefined,
  opts: BuildOptions = {},
  utteranceFromSpec?: string,
): TurnSummary {
  const promptChars = opts.promptChars ?? 600;
  const stateKeys = opts.interestingStateKeys ?? DEFAULT_INTERESTING_STATE_KEYS;

  const stateResp = (stateOut?.response ?? {}) as { planner_response?: Record<string, unknown> };
  const pr = stateResp.planner_response ?? {};
  const le = (pr.lastExecution ?? {}) as LastExecution;
  const sc = (pr.sessionContext ?? {}) as SessionContext;
  // planId lives on planner_response.sessionProperties for the current
  // eval-API shape; fall back to lastExecution.message.planId for the
  // older shape. See trace-client.ts:collectPlanKeys for the same lookup.
  const planIdForTurn =
    (pr.sessionProperties as { planId?: string } | undefined)?.planId ?? le.message?.planId;

  const reply = sendOut.response;
  let agentResponse: string;
  if (typeof reply === "string") {
    agentResponse = reply;
  } else if (reply && typeof reply === "object" && "messages" in reply) {
    const msgs = (reply as { messages?: Array<{ message?: string }> }).messages ?? [];
    agentResponse = msgs[0]?.message ?? JSON.stringify(reply);
  } else {
    agentResponse = reply == null ? "" : JSON.stringify(reply);
  }

  const flat = flattenLlmEvents(le.llmEvents);
  const llm_events = flat.slice(0, 3).map((ev) => ({
    agent_name: ev.agent_name,
    prompt_name: ev.prompt_name,
    prompt_content: truncate(ev.prompt_content, promptChars),
    prompt_response: truncate(ev.prompt_response, 1200),
    execution_latency_ms: ev.executionLatency,
  }));

  const digestUtterance =
    typeof sendOut.utterance === "string" && sendOut.utterance.length > 0
      ? sendOut.utterance
      : utteranceFromSpec;
  // Re-shape the per-turn snapshot into the same digest format we use for
  // `agentscript_preview send`. The eval API doesn't expose a fine-grained
  // step timeline, so the digest's timeline is reconstructed from
  // lastExecution.llmEvents + invokedActions + agentResponse.
  const digest = summarizeLastExecution(le, {
    userInput: digestUtterance,
    planId: planIdForTurn,
    stateVariables: sc.stateVariables,
  });

  return {
    turn_id: turnId,
    utterance: digestUtterance,
    agent_response: agentResponse,
    topic: le.topic,
    invoked_actions: le.invokedActions,
    latency_ms: le.latency,
    plan_id: planIdForTurn,
    turn_errors: Array.isArray(le.errors) ? le.errors : [],
    state_variables: pickStateVariables(sc, stateKeys),
    execution_history_last5: executionHistoryLast5(sc),
    plugins: pluginNames(sc),
    llm_events,
    digest,
  };
}

export function buildFailureRecord(
  test: TestResult,
  groupedEvals: EvalResult[],
  opts: BuildOptions = {},
): FailureRecord {
  const outputs = test.outputs ?? [];

  // Pair each agent.send_message with the *next* agent.get_state by execution
  // order. The previous implementation keyed on the `turn<n>` ↔ `state<n>`
  // naming convention, which silently produced empty turn summaries for specs
  // that used a different scheme (e.g. `t1` ↔ `s1`).
  const stateAfter = new Map<number, number>();
  {
    let lastSendIndex = -1;
    for (let i = 0; i < outputs.length; i++) {
      const out = outputs[i];
      if (out.type === "agent.send_message") {
        lastSendIndex = i;
      } else if (
        out.type === "agent.get_state" &&
        lastSendIndex !== -1 &&
        !stateAfter.has(lastSendIndex)
      ) {
        stateAfter.set(lastSendIndex, i);
      }
    }
  }

  const tid = String(test.id ?? "?");
  const turns: TurnSummary[] = [];
  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i];
    if (o.type !== "agent.send_message") continue;
    const turnId = o.id ?? "";
    const stateIndex = stateAfter.get(i);
    const stateOut = stateIndex !== undefined ? outputs[stateIndex] : undefined;
    const utteranceFromSpec = opts.utteranceIndex?.get(`${tid}::${turnId}`);
    turns.push(buildTurnSummary(turnId, o, stateOut, opts, utteranceFromSpec));
  }

  const failed_evaluators = groupedEvals
    .filter((e) => e.is_pass === false)
    .map((e) => ({
      id: e.id,
      score: e.score,
      expected_value: e.expected_value,
      actual_value: e.actual_value,
      explainability: e.explainability,
    }));

  const step_errors = (test.errors ?? []).map((e) => ({
    id: e.id,
    error_message: e.error_message,
  }));

  const trace_files = opts.tracesDir
    ? turns
        .map((t) => t.plan_id)
        .filter((p): p is string => !!p)
        .map((pid) => `${opts.tracesDir}/${pid}.json`)
    : [];

  return {
    test_id: String(test.id ?? "?"),
    failed_evaluators,
    step_errors,
    turns,
    trace_files,
  };
}

/**
 * Walk a merged response and produce: (a) the totals counter, and (b) the
 * list of failure records, applying threshold + OR-group post-processing.
 */
export function summarize(
  merged: { results?: TestResult[] },
  opts: BuildOptions = {},
): { totals: RunTotals; failures: FailureRecord[]; groupedByTest: Map<string, EvalResult[]> } {
  const totals: RunTotals = {
    tests: 0,
    test_pass: 0,
    test_fail: 0,
    evals: 0,
    ev_pass: 0,
    ev_fail: 0,
    errors: 0,
    latencies: [],
  };
  const failures: FailureRecord[] = [];
  const groupedByTest = new Map<string, EvalResult[]>();

  for (const test of merged.results ?? []) {
    totals.tests++;
    const tid = String(test.id ?? "?");
    const errs = test.errors ?? [];
    const grouped = groupEvaluators(test.evaluation_results ?? []);
    groupedByTest.set(tid, grouped);

    let evPass = 0;
    let evFail = 0;
    for (const e of grouped) {
      if (e.is_pass === true) evPass++;
      else if (e.is_pass === false) evFail++;
    }
    totals.evals += grouped.length;
    totals.ev_pass += evPass;
    totals.ev_fail += evFail;
    totals.errors += errs.length;

    for (const o of test.outputs ?? []) {
      if (o.type !== "agent.get_state") continue;
      const resp = (o.response ?? {}) as { planner_response?: { lastExecution?: LastExecution } };
      const lat = resp.planner_response?.lastExecution?.latency;
      if (typeof lat === "number") totals.latencies.push(Math.round(lat));
    }

    const passed = errs.length === 0 && evFail === 0;
    if (passed) totals.test_pass++;
    else {
      totals.test_fail++;
      failures.push(buildFailureRecord(test, grouped, opts));
    }
  }

  return { totals, failures, groupedByTest };
}

export function latencySummary(latencies: number[]): LatencySummary {
  if (latencies.length === 0) return { count: 0 };
  const s = [...latencies].sort((a, b) => a - b);
  const pct = (p: number): number =>
    s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))];
  return {
    count: s.length,
    min_ms: s[0],
    p50_ms: pct(50),
    p95_ms: pct(95),
    p99_ms: pct(99),
    max_ms: s[s.length - 1],
    mean_ms: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

/**
 * Render a compact human/agent-readable string report. Same data as
 * failures.jsonl but flowing prose. Used for slash commands.
 */
export function renderReport(
  merged: { results?: TestResult[] },
  opts: BuildOptions & { verbose?: boolean } = {},
): { report: string; totals: RunTotals; failures: FailureRecord[] } {
  const lines: string[] = [];
  const { totals, failures, groupedByTest } = summarize(merged, opts);

  for (const test of merged.results ?? []) {
    const tid = String(test.id ?? "?");
    const errs = test.errors ?? [];
    const grouped = groupedByTest.get(tid) ?? [];
    const evFail = grouped.filter((e) => e.is_pass === false).length;
    const evPass = grouped.filter((e) => e.is_pass === true).length;
    const passed = errs.length === 0 && evFail === 0;
    const marker = passed ? "✅" : "❌";

    const headerExtras = errs.length > 0 ? `, ${errs.length} step error(s)` : "";
    lines.push(
      `\n${marker} ${tid}  (${evPass}/${grouped.length} evaluators passed${headerExtras})`,
    );

    if (!passed || opts.verbose) {
      const rec =
        failures.find((f) => f.test_id === tid) ?? buildFailureRecord(test, grouped, opts);
      for (const f of rec.failed_evaluators) {
        lines.push(`    ❌ ${f.id}  score=${f.score}  ${truncate(f.explainability, 220)}`);
      }
      for (const e of rec.step_errors) {
        lines.push(`    step-err [${e.id}] ${truncate(e.error_message, 220)}`);
      }
      for (const t of rec.turns) {
        const planTag = t.plan_id ? `${t.plan_id.slice(0, 8)}…` : "?";
        lines.push(
          `  • ${t.turn_id}  topic=${t.topic ?? "(none)"}  latency=${t.latency_ms}ms  plan=${planTag}`,
        );
        lines.push(`    user  : ${truncate(t.utterance, 220)}`);
        lines.push(`    agent : ${truncate(t.agent_response, 280)}`);
        if (t.invoked_actions?.length)
          lines.push(`    actions: ${JSON.stringify(t.invoked_actions)}`);
        if (t.turn_errors.length) {
          for (const err of t.turn_errors) {
            lines.push(`    ⚠ turn-error: ${truncate(JSON.stringify(err), 200)}`);
          }
        }
        if (Object.keys(t.state_variables).length) {
          lines.push(`    state : ${JSON.stringify(t.state_variables)}`);
        }
        if (t.execution_history_last5.length) {
          lines.push(
            `    history(last5): ${truncate(JSON.stringify(t.execution_history_last5), 320)}`,
          );
        }
        if (t.plugins.length) lines.push(`    plugins: ${JSON.stringify(t.plugins)}`);
        for (const ev of t.llm_events) {
          lines.push(
            `    llm[${ev.agent_name}/${ev.prompt_name}] latency=${ev.execution_latency_ms}ms:`,
          );
          lines.push(`      prompt  : ${truncate(ev.prompt_content, opts.promptChars ?? 600)}`);
          lines.push(`      response: ${truncate(ev.prompt_response, 400)}`);
        }
      }
      if (rec.trace_files.length) {
        lines.push(`    full traces: ${rec.trace_files.join(", ")}`);
      }
    }

    for (const ev of grouped) {
      const mark = ev.is_pass === true ? "✅" : ev.is_pass === false ? "❌" : "⚪";
      const expl = ev.explainability ?? ev.error_message ?? "";
      lines.push(`    ${mark} ${ev.id ?? "?"}  score=${ev.score}  ${truncate(expl, 220)}`);
    }
  }

  lines.push("");
  lines.push("=".repeat(72));
  lines.push(
    `Tests: ${totals.test_pass}/${totals.tests} passed  |  ` +
      `Evaluators: ${totals.ev_pass}/${totals.evals} passed  |  ` +
      `Step errors: ${totals.errors}`,
  );
  const lat = latencySummary(totals.latencies);
  if (lat.count > 0) {
    lines.push(
      `Latency (per turn, ms): n=${lat.count}  ` +
        `p50=${lat.p50_ms}  p95=${lat.p95_ms}  p99=${lat.p99_ms}  max=${lat.max_ms}`,
    );
  }
  lines.push("=".repeat(72));

  return { report: lines.join("\n"), totals, failures };
}
