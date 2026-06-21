/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Planner trace client — GET /einstein/ai-agent/v1.1/preview/sessions/{sid}/plans/{pid}.
 *
 * Returns the full per-turn planner trace: every UserInputStep,
 * UpdateTopicStep, LLMExecutionStep (with promptContent + promptResponse +
 * executionLatency), FunctionCallStep, ValidationPromptStep, and EventStep.
 *
 * This is the deepest layer of debug data the eval stack exposes — strictly
 * more detailed than `lastExecution.llmEvents`, which the eval API embeds
 * inline. The cost is one extra GET per (session, plan).
 *
 * Concurrency: trace fetches are idempotent so we fan out a small thread
 * pool. A trace failure is logged but never fails the run — the trace is a
 * debugging aid, not a correctness signal.
 *
 * Transport: `sfapRequest` reuses @salesforce/core auth and bounded native fetch.
 */

import type { Connection } from "@salesforce/core";
import { sfapRequest } from "./sfap.ts";
import type { EvalApiResponse } from "./types.ts";

export const TRACE_URL_TPL =
  "https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions/{sid}/plans/{pid}";

export interface PlanKey {
  testId: string;
  sessionId: string;
  planId: string;
}

export interface FetchTraceOpts {
  concurrency?: number;
  timeoutMs?: number;
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

export async function fetchTrace(
  conn: Connection,
  sessionId: string,
  planId: string,
  opts?: {
    timeoutMs?: number;
    /**
     * Pin to the SFAP host that served the session's `start` call. When
     * omitted, falls back to the full host walk (legacy sessions written
     * before sticky-host pinning).
     */
    pinnedEndpoint?: "" | "test." | "dev.";
    signal?: AbortSignal;
  },
): Promise<unknown | null> {
  const url = TRACE_URL_TPL.replace("{sid}", sessionId).replace("{pid}", planId);
  const res = await sfapRequest<unknown>(conn, {
    url,
    method: "GET",
    headers: { "x-client-name": "afdx" },
    timeoutMs: opts?.timeoutMs ?? 60_000,
    maxRetries: 2,
    fallback: true,
    ...(opts?.pinnedEndpoint !== undefined ? { pinnedEndpoint: opts.pinnedEndpoint } : {}),
    signal: opts?.signal,
  });
  if (res.status >= 200 && res.status < 300 && res.body && typeof res.body === "object") {
    return res.body;
  }
  return null;
}

/**
 * Fetch many traces in parallel. Returns a Map keyed by `${sid}::${pid}` so
 * the caller can correlate back to the requesting test.
 */
export async function fetchTracesConcurrent(
  conn: Connection,
  keys: PlanKey[],
  opts?: FetchTraceOpts,
): Promise<Map<string, unknown | null>> {
  const concurrency = Math.max(1, opts?.concurrency ?? 8);
  const out = new Map<string, unknown | null>();
  if (keys.length === 0) return out;

  // Dedupe — a single (session, plan) pair never needs two GETs
  const unique = new Map<string, PlanKey>();
  for (const k of keys) unique.set(`${k.sessionId}::${k.planId}`, k);
  const queue = Array.from(unique.values());

  const log = opts?.log ?? (() => {});
  const workers: Array<Promise<void>> = [];
  let cursor = 0;
  const next = (): PlanKey | undefined => (cursor < queue.length ? queue[cursor++] : undefined);

  const worker = async (): Promise<void> => {
    let job: PlanKey | undefined;
    while ((job = next()) !== undefined) {
      const key = `${job.sessionId}::${job.planId}`;
      try {
        const trace = await fetchTrace(conn, job.sessionId, job.planId, {
          timeoutMs: opts?.timeoutMs,
          signal: opts?.signal,
        });
        out.set(key, trace);
        if (trace === null) log(`  trace ${job.planId.slice(0, 8)}…: empty`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  trace ${job.planId.slice(0, 8)}…: ${msg}`);
        out.set(key, null);
      }
    }
  };

  for (let i = 0; i < Math.min(concurrency, queue.length); i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

/**
 * Walk a merged eval response → extract (test_id, session_id, plan_id) for
 * every turn we'd want a trace for. `onlyFailed` is the default policy:
 * skip tests where every evaluator passed and there are no step errors.
 */
export function collectPlanKeys(
  merged: EvalApiResponse,
  opts?: { onlyFailed?: boolean },
): PlanKey[] {
  const onlyFailed = opts?.onlyFailed !== false;
  const out: PlanKey[] = [];
  for (const test of merged.results ?? []) {
    const evals = test.evaluation_results ?? [];
    const errs = test.errors ?? [];
    const anyFail = evals.some((e) => e.is_pass === false) || errs.length > 0;
    if (onlyFailed && !anyFail) continue;

    const outputs = test.outputs ?? [];
    let sid: string | undefined;
    for (const o of outputs) {
      if (typeof o.session_id === "string" && o.session_id) {
        sid = o.session_id;
        break;
      }
    }
    if (!sid) continue;

    for (const o of outputs) {
      if (o.type !== "agent.get_state") continue;
      const resp = (o.response ?? {}) as {
        planner_response?: {
          sessionProperties?: { planId?: string };
          lastExecution?: { message?: { planId?: string } };
        };
      };
      // The planId lives on `sessionProperties.planId` for the eval API's
      // current response shape (verified against a live fixture against the
      // platform's 2026-05 build). The `lastExecution.message.planId` path
      // is empty for `InformResponseMessage` types (the common case) —
      // earlier versions of this code (and the upstream Python harness) read
      // there first and silently produced 0 trace fetches per run.
      const pid =
        resp.planner_response?.sessionProperties?.planId ??
        resp.planner_response?.lastExecution?.message?.planId;
      if (typeof pid === "string" && pid) {
        out.push({ testId: String(test.id ?? "?"), sessionId: sid, planId: pid });
      }
    }
  }
  return out;
}
