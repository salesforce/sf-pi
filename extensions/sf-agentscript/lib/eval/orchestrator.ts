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
 * Transport: @salesforce/core provides auth; timeout-sensitive HTTP uses bounded transport. No subprocess.
 *
 * Concurrency: bounded semaphore for batch POSTs and for trace GETs (same
 * default of 8). Each bounded transport call is a real HTTP call so this is actual
 * parallelism.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Connection } from "@salesforce/core";
import { callEval, type EvalApiHeaders, splitIntoBatches } from "./eval-client.ts";
import { collectPlanKeys, fetchTracesConcurrent, type PlanKey } from "./trace-client.ts";
import { synthesizeTracesFromMerged } from "./synthesize-trace.ts";
import { deepDecode } from "./decode.ts";
import { latencySummary, summarize, type BuildOptions } from "./render.ts";
import { newRunId, resolveRunDir, writeRun } from "./persist.ts";
import { normalizeSpec } from "./normalize.ts";
import {
  detectPlaceholderUsage,
  injectResolvedAgentIds,
  resolveAgentIds,
  shouldInjectResolvedAgentIds,
  substitutePlaceholders,
  type AgentIdInjectionStats,
  type AgentVersionResolutionMode,
  type ResolvedAgentIds,
} from "./active-ids.ts";
import { resolveOrgIdentity } from "../../../../lib/common/sf-conn/connection.ts";
import type {
  EvalApiResponse,
  EvalSpec,
  FailureRecord,
  LatencySummary,
  RunMetadata,
  RunTotals,
  TracesMode,
} from "./types.ts";
import type { TimingCollector } from "../timings.ts";

// -------------------------------------------------------------------------------------------------
// Run options + result
// -------------------------------------------------------------------------------------------------

export interface RunEvalOptions {
  /** Caller-resolved Connection for Evaluation API + SOQL. Required. */
  conn: Connection;
  /** Optional named-user JWT connection for `/einstein/ai-agent/*` trace fetches. */
  traceConn?: Connection;
  /** sf CLI alias / username. Recorded in metadata. Required. */
  targetOrg: string;
  spec: EvalSpec;
  /** For $active_* placeholder resolution and default create-session id injection. */
  agentApiName?: string;
  /** Default create-session id injection mode when agentApiName is supplied. Default `active`. */
  versionResolution?: AgentVersionResolutionMode;
  /** Required when versionResolution='version'. Pins BotVersion.VersionNumber. */
  version?: number;
  /** Overwrite explicit agent_id / agent_version_id fields during id injection. Default false. */
  overwriteAgentIds?: boolean;
  /** Trace-fetch policy. Default `failed` (fetch traces for failing tests only). */
  tracesMode?: TracesMode;
  /**
   * Suppress the inactive-version preflight when `$latest_*` placeholders
   * resolve to a non-Active BotVersion. Set to `true` only when you've
   * deliberately chosen to regression-test an Inactive / InDevelopment
   * version (the "ship → eval → activate" loop). Default `false` — the
   * orchestrator throws a structured error when an inactive version is
   * resolved unintentionally so a typo can't silently produce green
   * results against the wrong version.
   */
  acknowledgeInactiveVersion?: boolean;
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
  /** Optional local operation timing collector owned by the tool wrapper. */
  timings?: TimingCollector;
  /** Optional caller cancellation signal from the Pi tool runtime. */
  signal?: AbortSignal;
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

function enforceLatestAcknowledgement(ids: ResolvedAgentIds, opts: RunEvalOptions): void {
  if (ids.status === "Active" || opts.acknowledgeInactiveVersion) return;
  throw new Error(
    `Spec uses latest-version resolution, but the latest BotVersion for ` +
      `'${opts.agentApiName}' is v${ids.version_number} with ` +
      `Status='${ids.status}' — not Active. Pass ` +
      `acknowledge_inactive_version=true to confirm you want to regression-test ` +
      `a non-production version, or activate the version first via ` +
      `\`agentscript_lifecycle action='activate' agent_api_name='${opts.agentApiName}' ` +
      `version=${ids.version_number}\`.`,
  );
}

async function resolveIdsForInjection(
  opts: RunEvalOptions,
  mode: AgentVersionResolutionMode,
  activeIds: ResolvedAgentIds | null,
  latestIds: ResolvedAgentIds | null,
): Promise<ResolvedAgentIds> {
  if (!opts.agentApiName) {
    throw new Error("agent_api_name is required for default create_session id injection.");
  }
  if (mode === "version") {
    if (typeof opts.version !== "number") {
      throw new Error("version_resolution='version' requires version=<BotVersion.VersionNumber>.");
    }
    return await resolveAgentIds(opts.conn, opts.agentApiName, {
      version: opts.version,
      signal: opts.signal,
    });
  }
  if (mode === "latest") {
    const ids =
      latestIds ??
      (await resolveAgentIds(opts.conn, opts.agentApiName, {
        status: "any",
        signal: opts.signal,
      }));
    enforceLatestAcknowledgement(ids, opts);
    return ids;
  }
  return (
    activeIds ??
    (await resolveAgentIds(opts.conn, opts.agentApiName, { status: "Active", signal: opts.signal }))
  );
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

  // 1. Resolve $active_* / $latest_* placeholders + apply spec normalization
  let spec = opts.spec;
  let resolvedIds: ResolvedAgentIds | null = null;
  let latestIds: ResolvedAgentIds | null = null;
  let injectedIds: ResolvedAgentIds | null = null;
  let injectionStats: AgentIdInjectionStats | undefined;
  const usage = detectPlaceholderUsage(spec);
  if (usage.active || usage.latest) {
    if (!opts.agentApiName) {
      throw new Error(
        `Spec uses $active_* / $latest_* placeholders but no agentApiName was provided. ` +
          `Suggested fix: pass agentApiName, or substitute the placeholders in the spec.`,
      );
    }
    if (usage.active) {
      resolvedIds = opts.timings
        ? await opts.timings.time("resolve_active_agent_ids", () =>
            resolveAgentIds(opts.conn, opts.agentApiName as string, {
              status: "Active",
              signal: opts.signal,
            }),
          )
        : await resolveAgentIds(opts.conn, opts.agentApiName, {
            status: "Active",
            signal: opts.signal,
          });
      log(
        `Active: ${opts.agentApiName} v${resolvedIds.version_number} ` +
          `(${resolvedIds.status})  botVersionId=${resolvedIds.bot_version_id}  ` +
          `plannerId=${resolvedIds.planner_id}`,
      );
    }
    if (usage.latest) {
      latestIds = opts.timings
        ? await opts.timings.time("resolve_latest_agent_ids", () =>
            resolveAgentIds(opts.conn, opts.agentApiName as string, {
              status: "any",
              signal: opts.signal,
            }),
          )
        : await resolveAgentIds(opts.conn, opts.agentApiName, {
            status: "any",
            signal: opts.signal,
          });
      log(
        `Latest: ${opts.agentApiName} v${latestIds.version_number} ` +
          `(${latestIds.status})  botVersionId=${latestIds.bot_version_id}  ` +
          `plannerId=${latestIds.planner_id}`,
      );
      enforceLatestAcknowledgement(latestIds, opts);
    }
    spec = substitutePlaceholders(spec, {
      active: resolvedIds ?? undefined,
      latest: latestIds ?? undefined,
    });
  }

  const wantsInjection =
    Boolean(opts.agentApiName) &&
    shouldInjectResolvedAgentIds(spec, opts.overwriteAgentIds ?? false);
  if (wantsInjection) {
    if (usage.active && usage.latest && !opts.versionResolution) {
      throw new Error(
        `Spec mixes $active_* and $latest_* placeholders and also has create_session steps ` +
          `missing agent ids. Pass version_resolution='active' or 'latest', or make every ` +
          `agent.create_session step explicit.`,
      );
    }
    const mode: AgentVersionResolutionMode =
      opts.versionResolution ?? (usage.latest && !usage.active ? "latest" : "active");
    injectedIds = opts.timings
      ? await opts.timings.time("resolve_injected_agent_ids", () =>
          resolveIdsForInjection(opts, mode, resolvedIds, latestIds),
        )
      : await resolveIdsForInjection(opts, mode, resolvedIds, latestIds);
    const injected = injectResolvedAgentIds(spec, injectedIds, {
      overwrite: opts.overwriteAgentIds ?? false,
    });
    spec = injected.spec;
    injectionStats = {
      create_session_steps: injected.create_session_steps,
      injected_create_session_steps: injected.injected_create_session_steps,
      explicit_create_session_steps: injected.explicit_create_session_steps,
    };
    log(
      `Injected ${injectionStats.injected_create_session_steps}/${injectionStats.create_session_steps} ` +
        `create_session step(s) from ${opts.agentApiName} v${injectedIds.version_number} ` +
        `(${injectedIds.status}).`,
    );
  }

  spec = opts.timings
    ? await opts.timings.time("normalize_eval_spec", () => normalizeSpec(spec))
    : normalizeSpec(spec);

  // 2. Resolve org identity for SFAP headers
  const ident = opts.timings
    ? await opts.timings.time("org_identity", () => resolveOrgIdentity(opts.conn))
    : await resolveOrgIdentity(opts.conn);
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
  await (opts.timings
    ? opts.timings.time("eval_batches", () =>
        Promise.all(
          batches.map((b, idx) =>
            sema(async () => {
              const res = await callEval(opts.conn, b, headers, { signal: opts.signal });
              if (opts.timings) {
                opts.timings.add("sfap_endpoint_cache", 0, {
                  cache: res.endpoint_cache,
                  endpoint: res.endpoint,
                });
              }
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
        ),
      )
    : Promise.all(
        batches.map((b, idx) =>
          sema(async () => {
            const res = await callEval(opts.conn, b, headers, { signal: opts.signal });
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
      ));

  // 4. Merge + HTML-decode
  const mergedRaw: EvalApiResponse = { results: results.flatMap((r) => r ?? []) };
  const merged = opts.timings
    ? await opts.timings.time("decode_eval_response", () => deepDecode(mergedRaw))
    : deepDecode(mergedRaw);

  // 5. Trace surface — synthesize-then-merge.
  //
  // The eval API closes its sessions immediately, so the live
  // `/v1.1/preview/sessions/{sid}/plans/{pid}` endpoint 404s with
  // `Session not found` for every (sid, pid) the eval API spawns.
  // BUT: the eval response already contains the trace data inline
  // (llmEvents + invokedActions + errors + sessionContext +
  // sessionProperties). We synthesize per-turn trace docs from that
  // inline data unconditionally, then attempt the live fetch on top —
  // when a live trace is reachable (rare in practice, but valuable
  // when sessions happen to outlive the request), it overwrites the
  // synthesized entry.
  const traces = new Map<string, unknown | null>();
  let liveFetchedCount = 0;
  let synthesizedCount = 0;
  if (tracesMode !== "off") {
    // Build the spec utterance index up-front so synthesized UserInputSteps
    // carry the user's actual input. The persistence step builds the same
    // index later for transcript.jsonl; we duplicate the cheap walk here
    // rather than restructure ordering.
    const utteranceIndex = new Map<string, string>();
    for (const test of spec.tests ?? []) {
      const tid = String(test.id ?? "?");
      for (const step of test.steps ?? []) {
        if (step.type === "agent.send_message" && typeof step.utterance === "string") {
          utteranceIndex.set(`${tid}::${step.id}`, step.utterance);
        }
      }
    }

    // Synthesize for every test in scope, applying the same
    // failed-only filter as the live fetch when traces_mode='failed'.
    const inScopeIds = new Set<string>();
    for (const test of merged.results ?? []) {
      if (tracesMode === "failed") {
        const evals = test.evaluation_results ?? [];
        const errs = test.errors ?? [];
        const anyFail = evals.some((e) => e.is_pass === false) || errs.length > 0;
        if (!anyFail) continue;
      }
      if (test.id !== undefined) inScopeIds.add(String(test.id));
    }
    if (inScopeIds.size > 0) {
      const filtered = {
        results: (merged.results ?? []).filter((t) => inScopeIds.has(String(t.id ?? ""))),
      };
      const synthesized = opts.timings
        ? await opts.timings.time("synthesize_eval_traces", () =>
            synthesizeTracesFromMerged(filtered, { utteranceIndex }),
          )
        : synthesizeTracesFromMerged(filtered, { utteranceIndex });
      synthesizedCount = synthesized.size;
      for (const [k, v] of synthesized.entries()) traces.set(k, v);
      log(`Synthesized ${synthesizedCount} trace(s) from inline eval data (mode=${tracesMode}).`);
    }

    // Best-effort live fetch — overwrites synthesized when the planner
    // actually returns data. Almost always 404s for eval-spawned sessions,
    // but harmless and cheap; preserves the original code path for users
    // running against orgs where sessions outlive the request.
    const planKeys: PlanKey[] = collectPlanKeys(merged, { onlyFailed: tracesMode === "failed" });
    const unique = new Set(planKeys.map((k) => `${k.sessionId}::${k.planId}`)).size;
    if (planKeys.length > 0) {
      log(
        `Attempting ${unique} live trace fetch(es) (best-effort — eval sessions are typically GC'd by the time we get here)…`,
      );
      const live = opts.timings
        ? await opts.timings.time("live_trace_fetch", () =>
            fetchTracesConcurrent(opts.traceConn ?? opts.conn, planKeys, {
              concurrency,
              log,
              signal: opts.signal,
            }),
          )
        : await fetchTracesConcurrent(opts.traceConn ?? opts.conn, planKeys, {
            concurrency,
            log,
            signal: opts.signal,
          });
      for (const [k, body] of live.entries()) {
        if (body != null) {
          traces.set(k, body);
          liveFetchedCount++;
        }
      }
      if (liveFetchedCount > 0) {
        log(`  live fetch: ${liveFetchedCount}/${unique} succeeded; merged with synthesized data.`);
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
  const { totals, failures } = opts.timings
    ? await opts.timings.time("summarize_eval_results", () => summarize(merged, buildOpts))
    : summarize(merged, buildOpts);
  const lat = latencySummary(totals.latencies);

  // 7. Build metadata
  const completedAt = new Date();
  const metadata: RunMetadata = {
    run_id: runId,
    spec_path: opts.specPath,
    org: opts.targetOrg,
    agent_api_name: opts.agentApiName,
    // When both $active_* and $latest_* resolve to the same version, the
    // active record is the canonical source. When only $latest_* is in use
    // (e.g. testing a freshly-published-but-Inactive version), we record
    // the latest record so the run is auditable against the actual
    // BotVersion that was exercised.
    bot_id: injectedIds?.bot_id ?? resolvedIds?.bot_id ?? latestIds?.bot_id,
    bot_version_id:
      resolvedIds?.bot_version_id ?? latestIds?.bot_version_id ?? injectedIds?.bot_version_id,
    planner_id: resolvedIds?.planner_id ?? latestIds?.planner_id ?? injectedIds?.planner_id ?? null,
    bot_version_number:
      resolvedIds?.version_number ?? latestIds?.version_number ?? injectedIds?.version_number,
    bot_version_status: resolvedIds?.status ?? latestIds?.status ?? injectedIds?.status,
    agent_id_resolution: injectedIds
      ? {
          mode: opts.versionResolution ?? (usage.latest && !usage.active ? "latest" : "active"),
          agent_api_name: opts.agentApiName,
          bot_id: injectedIds.bot_id,
          bot_version_id: injectedIds.bot_version_id,
          bot_version_number: injectedIds.version_number,
          bot_version_status: injectedIds.status,
          planner_id: injectedIds.planner_id,
          ...(injectionStats ?? {
            create_session_steps: 0,
            injected_create_session_steps: 0,
            explicit_create_session_steps: 0,
          }),
        }
      : undefined,
    started: startedAt.toISOString(),
    completed: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - startedAt.getTime(),
    tests_count: tests.length,
    batches: batches.length,
    concurrency,
    traces_mode: tracesMode,
    traces_fetched: Array.from(traces.values()).filter((v) => v != null).length,
    traces_synthesized: synthesizedCount,
    traces_live_fetched: liveFetchedCount,
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
    await (opts.timings
      ? opts.timings.time("persist_eval_run", () =>
          writeRun({ runDir, merged, traces, metadata, failures, spec }),
        )
      : writeRun({ runDir, merged, traces, metadata, failures, spec }));
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

// Re-export resolver primitives for the eval-resolve tool.
export { resolveActiveIds, resolveAgentIds } from "./active-ids.ts";
export type { ResolvedAgentIds, ResolveAgentIdsOptions, StatusFilter } from "./active-ids.ts";
