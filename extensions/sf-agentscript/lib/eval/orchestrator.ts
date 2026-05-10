/* SPDX-License-Identifier: Apache-2.0 */
/**
 * High-level run-eval orchestrator.
 *
 * Pipeline (8 phases):
 *   1. Resolve `$active_*` placeholders against the live org's Active BotVersion.
 *   2. Normalize the spec (six passes — see normalize.ts).
 *   3. Resolve org metadata once (instanceUrl, orgId, userId) for SFAP headers.
 *   4. Split tests into ≤ 5-test batches and fan out concurrent POSTs.
 *   5. HTML-decode the merged response.
 *   6. Optionally fan out planner-trace GETs (default: failed tests only).
 *   7. Persist the run to disk in the diff-friendly layout.
 *   8. Return a structured result for the caller.
 *
 * Transport: `@salesforce/core` `Connection.request` everywhere. No subprocess.
 *
 * Concurrency: bounded semaphore for batch POSTs and for trace GETs (same
 * default of 8). Each `conn.request` is a real HTTP call so this is actual
 * parallelism.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Connection } from "@salesforce/core";
import { callEval, type EvalApiHeaders, splitIntoBatches } from "./eval-client.ts";
import { collectPlanKeys, fetchTracesConcurrent, type PlanKey } from "./trace-client.ts";
import { deepDecode } from "./decode.ts";
import { latencySummary, summarize, type BuildOptions } from "./render.ts";
import { newRunId, resolveRunDir, writeRun } from "./persist.ts";
import { normalizeSpec } from "./normalize.ts";
import {
  resolveActiveIds,
  specHasActivePlaceholders,
  substitutePlaceholders,
  type ResolvedAgentIds,
} from "./active-ids.ts";
import { resolveOrgIdentity } from "../connection.ts";
import type {
  EvalApiResponse,
  EvalSpec,
  FailureRecord,
  LatencySummary,
  RunMetadata,
  RunTotals,
  TracesMode,
} from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Run options + result
// -------------------------------------------------------------------------------------------------

export interface RunEvalOptions {
  /** Caller-resolved Connection. Required. */
  conn: Connection;
  /** sf CLI alias / username. Recorded in metadata. Required. */
  targetOrg: string;
  spec: EvalSpec;
  /** For $active_* placeholder resolution. Required when the spec uses them. */
  agentApiName?: string;
  /** Trace-fetch policy. Default `failed` (fetch traces for failing tests only). */
  tracesMode?: TracesMode;
  /** Max parallel batch POSTs and trace GETs. Default 8. */
  concurrency?: number;
  /** Max chars of llmEvents.prompt_content shown per turn. Default 600. */
  promptChars?: number;
  /** Optional explicit run id. Default: auto-generated timestamped id. */
  runId?: string;
  /** Optional spec source path, recorded in metadata. */
  specPath?: string;
  /** cwd anchoring the run-output base. Required for persistence. */
  cwd: string;
  /** Skip writing artifacts to disk. Default false. */
  noPersist?: boolean;
  /** Override base directory for runs. Default `<cwd>/.pi/state/sf-agentscript/runs`. */
  runBase?: string;
  /** Opaque progress logger; called with status strings. */
  log?: (msg: string) => void;
  /** Optional override for which state-variable keys get surfaced. */
  interestingStateKeys?: readonly string[];
}

export interface RunEvalResult {
  run_id: string;
  run_dir?: string;
  totals: RunTotals;
  latency: LatencySummary;
  failures: FailureRecord[];
  merged: EvalApiResponse;
  metadata: RunMetadata;
  /** Number of batches that returned non-200. */
  failed_batches: number;
}

// -------------------------------------------------------------------------------------------------
// Main entry point
// -------------------------------------------------------------------------------------------------

export async function runEval(opts: RunEvalOptions): Promise<RunEvalResult> {
  const log = opts.log ?? (() => {});
  const startedAt = new Date();
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const tracesMode: TracesMode = opts.tracesMode ?? "failed";
  const runId = opts.runId ?? newRunId(startedAt);

  // 1. Resolve $active_* placeholders + apply spec normalization
  let spec = opts.spec;
  let resolvedIds: ResolvedAgentIds | null = null;
  if (specHasActivePlaceholders(spec)) {
    if (!opts.agentApiName) {
      throw new Error(
        `Spec uses $active_* placeholders but no agentApiName was provided. ` +
          `Suggested fix: pass agentApiName, or substitute the placeholders in the spec.`,
      );
    }
    resolvedIds = await resolveActiveIds(opts.conn, opts.agentApiName);
    log(
      `Active: ${opts.agentApiName}  ` +
        `botVersionId=${resolvedIds.bot_version_id}  plannerId=${resolvedIds.planner_id}`,
    );
    spec = substitutePlaceholders(spec, resolvedIds);
  }
  spec = normalizeSpec(spec);

  // 2. Resolve org identity for SFAP headers
  const ident = await resolveOrgIdentity(opts.conn);
  const headers: EvalApiHeaders = {
    orgId: ident.org_id,
    userId: ident.user_id,
    instanceUrl: ident.instance_url,
  };

  // 3. Batch + fan out
  const tests = spec.tests ?? [];
  if (tests.length === 0) {
    throw new Error("Spec contains no tests; nothing to do.");
  }
  const batches = splitIntoBatches(tests);
  log(
    `Running ${tests.length} tests across ${batches.length} batch(es) ` +
      `(concurrency=${Math.min(batches.length, concurrency)})`,
  );

  const results: Array<EvalApiResponse["results"]> = new Array(batches.length).fill(null);
  let failedBatches = 0;
  const sema = makeSemaphore(concurrency);
  await Promise.all(
    batches.map((b, idx) =>
      sema(async () => {
        const res = await callEval(opts.conn, b, headers);
        if (res.status >= 200 && res.status < 300) {
          results[idx] = res.body.results ?? [];
          if (batches.length > 1) {
            log(
              `  batch ${idx + 1}/${batches.length}: ${(results[idx] ?? []).length} tests complete`,
            );
          }
        } else {
          failedBatches++;
          const snippet = JSON.stringify(res.body).slice(0, 1500);
          log(`  batch ${idx + 1}/${batches.length}: HTTP ${res.status}  ${snippet}`);
          results[idx] = [];
        }
      }),
    ),
  );

  // 4. Merge + HTML-decode
  const mergedRaw: EvalApiResponse = { results: results.flatMap((r) => r ?? []) };
  const merged = deepDecode(mergedRaw);

  // 5. Trace fetch
  let traces = new Map<string, unknown | null>();
  if (tracesMode !== "off") {
    const planKeys: PlanKey[] = collectPlanKeys(merged, { onlyFailed: tracesMode === "failed" });
    const unique = new Set(planKeys.map((k) => `${k.sessionId}::${k.planId}`)).size;
    if (planKeys.length > 0) {
      log(
        `Fetching ${unique} planner trace(s) (mode=${tracesMode}, concurrency=${Math.min(unique, concurrency)})…`,
      );
      traces = await fetchTracesConcurrent(opts.conn, planKeys, { concurrency, log });
      const ok = Array.from(traces.values()).filter((v) => v != null).length;
      if (ok !== unique) {
        log(`  trace fetch: ${ok}/${unique} succeeded (missing planner data is non-fatal)`);
      }
    }
  }

  // 6. Build summary + failure records
  // Cross-reference user utterances from the spec, so transcript +
  // FailureRecord both carry the actual user input (the eval API doesn't
  // echo it back in EvalOutput.utterance).
  const utteranceIndex = new Map<string, string>();
  for (const test of spec.tests ?? []) {
    const tid = String(test.id ?? "?");
    for (const step of test.steps ?? []) {
      if (step.type === "agent.send_message" && typeof step.utterance === "string") {
        utteranceIndex.set(`${tid}::${step.id}`, step.utterance);
      }
    }
  }
  const buildOpts: BuildOptions = {
    promptChars: opts.promptChars,
    interestingStateKeys: opts.interestingStateKeys,
    tracesDir:
      !opts.noPersist && tracesMode !== "off" && traces.size > 0
        ? path.join(resolveRunDir(opts.cwd, runId, opts.runBase), "traces")
        : undefined,
    utteranceIndex,
  };
  const { totals, failures } = summarize(merged, buildOpts);
  const lat = latencySummary(totals.latencies);

  // 7. Build metadata
  const completedAt = new Date();
  const metadata: RunMetadata = {
    run_id: runId,
    spec_path: opts.specPath,
    org: opts.targetOrg,
    agent_api_name: opts.agentApiName,
    bot_version_id: resolvedIds?.bot_version_id,
    planner_id: resolvedIds?.planner_id ?? null,
    started: startedAt.toISOString(),
    completed: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - startedAt.getTime(),
    tests_count: tests.length,
    batches: batches.length,
    concurrency,
    traces_mode: tracesMode,
    traces_fetched: Array.from(traces.values()).filter((v) => v != null).length,
    totals: {
      tests: totals.tests,
      test_pass: totals.test_pass,
      test_fail: totals.test_fail,
      evals: totals.evals,
      ev_pass: totals.ev_pass,
      ev_fail: totals.ev_fail,
      errors: totals.errors,
    },
    latency_summary: lat,
  };

  // 8. Persist (unless disabled)
  let runDir: string | undefined;
  if (!opts.noPersist) {
    runDir = resolveRunDir(opts.cwd, runId, opts.runBase);
    await writeRun({ runDir, merged, traces, metadata, failures, spec });
    log(`Artifacts: ${runDir}/`);
  }

  return {
    run_id: runId,
    run_dir: runDir,
    totals,
    latency: lat,
    failures,
    merged,
    metadata,
    failed_batches: failedBatches,
  };
}

/** Tiny semaphore for bounded concurrency. */
function makeSemaphore(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let inFlight = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (inFlight >= max) await new Promise<void>((r) => queue.push(r));
    inFlight++;
    try {
      return await fn();
    } finally {
      inFlight--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

// -------------------------------------------------------------------------------------------------
// Run lookup helpers (used by agentscript_eval_get_failure)
// -------------------------------------------------------------------------------------------------

export async function readFailures(
  cwd: string,
  runId: string,
  runBase?: string,
): Promise<FailureRecord[]> {
  const file = path.join(resolveRunDir(cwd, runId, runBase), "failures.jsonl");
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    throw new Error(
      `No failures.jsonl for run '${runId}'. Suggested fix: confirm the run id and ` +
        `that the run actually had failed tests. Path tried: ${file}`,
      { cause: err },
    );
  }
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as FailureRecord);
}

export async function readMetadata(
  cwd: string,
  runId: string,
  runBase?: string,
): Promise<RunMetadata | null> {
  const file = path.join(resolveRunDir(cwd, runId, runBase), "metadata.json");
  try {
    return JSON.parse(await readFile(file, "utf-8")) as RunMetadata;
  } catch {
    return null;
  }
}

/** Save a run-id index entry so `agentscript_eval_get_failure` can look up failures. */
export async function ensureRunBase(cwd: string, runBase?: string): Promise<string> {
  const dir = runBase ?? path.join(cwd, ".pi", "state", "sf-agentscript", "runs");
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Append a run id to the rolling index (most-recent-first, capped at 50). */
export async function recordRunInIndex(
  cwd: string,
  runId: string,
  runBase?: string,
): Promise<void> {
  const dir = await ensureRunBase(cwd, runBase);
  const idxPath = path.join(dir, "_index.json");
  let entries: string[] = [];
  try {
    const parsed = JSON.parse(await readFile(idxPath, "utf-8"));
    if (Array.isArray(parsed)) entries = parsed.filter((e) => typeof e === "string");
  } catch {
    /* index doesn't exist yet — fine */
  }
  entries = [runId, ...entries.filter((e) => e !== runId)].slice(0, 50);
  await writeFile(idxPath, JSON.stringify(entries, null, 2), "utf-8");
}

// Re-export ResolvedAgentIds + resolveActiveIds for the eval-resolve tool.
export { resolveActiveIds } from "./active-ids.ts";
export type { ResolvedAgentIds } from "./active-ids.ts";
