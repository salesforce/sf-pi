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

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Connection } from "@salesforce/core";
import { callEval, type EvalApiHeaders, splitIntoBatches } from "./eval-client.ts";
import { collectPlanKeys, fetchTracesConcurrent, type PlanKey } from "./trace-client.ts";
import { synthesizeTracesFromMerged } from "./synthesize-trace.ts";
import {
  summarizeEvalResponseIntegrity,
  validateEvalResponseIntegrityPolicy,
  type EvalResponseIntegritySummary,
} from "./response-integrity.ts";
import { deepDecode } from "./decode.ts";
import { latencySummary, summarize, type BuildOptions } from "./render.ts";
import {
  buildUtteranceIndex,
  defaultRunBase,
  newRunId,
  resolveRunDir,
  writeRun,
  writeRunStartArtifacts,
  writeRunStatus,
  type EvalRunScope,
  type EvalRunStatus,
} from "./persist.ts";
import { normalizeSpec } from "./normalize.ts";
import {
  redactResolvedSeedValues,
  resolveEvalSeedProfiles,
  type EvalSeedProvenance,
} from "./seeds.ts";
import { deriveEvalVerdict, type ResponseIntegrityEvidence } from "./verdict.ts";
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
import { resolveOrgIdentity } from "../../../../lib/common/sf-conn/index.ts";
import { boundedSoqlQuery } from "../bounded-salesforce-transport.ts";
import type {
  EvalApiResponse,
  EvalBatchFailure,
  EvalSpec,
  EvalTest,
  FailureRecord,
  LatencySummary,
  RunMetadata,
  RunTotals,
  TracesMode,
} from "./types.ts";
import type { TimingCollector } from "../timings.ts";
import { hashEvalSpec } from "../release-contract.ts";

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
  /** Full authored Suite snapshot when spec is an executed Scenario subset. */
  sourceSpec?: EvalSpec;
  /** For $active_* placeholder resolution and default create-session id injection. */
  agentApiName?: string;
  /** Exact target already reviewed and pinned by a higher-level Studio flow. */
  resolvedTarget?: ResolvedAgentIds;
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
  /** Per Evaluation API batch POST timeout. Default 300_000. */
  batchTimeoutMs?: number;
  /** Whether to attempt live trace fetch after synthesizing inline traces. Default false. */
  liveTraceFetch?: boolean;
  /** Max chars of llmEvents.prompt_content shown per turn. Default 600. */
  promptChars?: number;
  /** Optional explicit run id. Default: auto-generated timestamped id. */
  runId?: string;
  /** Optional spec source path, recorded in metadata. */
  specPath?: string;
  /** Persisted execution scope. Defaults to suite when specPath exists, otherwise ad_hoc. */
  runScope?: EvalRunScope;
  /** Immutable release-contract identity known before execution begins. */
  releaseContract?: RunMetadata["release_contract"];
  /** One-run acknowledgement; it never promotes capability or release eligibility. */
  unverifiedEvaluatorAcknowledged?: boolean;
  /** Exact Studio owner identity for orphan recovery; omitted on direct runs. */
  coordinator?: { kind: "studio"; owner_token: string };
  /** Selected Scenario for runScope='scenario'. */
  scenarioId?: string;
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
  batch_failures: EvalBatchFailure[];
  /** Advisory only in this release; does not alter Evaluation API verdicts. */
  response_integrity: EvalResponseIntegritySummary;
  response_integrity_evidence?: ResponseIntegrityEvidence;
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

export class EvalRunInterruptedError extends Error {
  constructor(message = "Eval run interrupted because its owner session ended.") {
    super(message);
    this.name = "EvalRunInterruptedError";
  }
}

export class EvalRunCancelledError extends Error {
  constructor(message = "Eval run cancelled.") {
    super(message);
    this.name = "EvalRunCancelledError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason === "interrupted") throw new EvalRunInterruptedError();
  throw new EvalRunCancelledError();
}

async function queryEvalSeed(
  conn: Connection,
  soql: string,
  signal?: AbortSignal,
): Promise<{ records: Array<Record<string, unknown>> }> {
  const response = await boundedSoqlQuery<Record<string, unknown>>(conn, soql, {
    timeoutMs: 30_000,
    signal,
  });
  if (response.ok === false) {
    throw new Error(
      `Eval seed SOQL failed${response.status ? ` with HTTP ${response.status}` : ""}: ${response.detail}`,
    );
  }
  return { records: response.records };
}

function errorPayload(err: unknown): { name?: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

interface RunEvalBatchesOptions {
  conn: Connection;
  batches: EvalTest[][];
  headers: EvalApiHeaders;
  concurrency: number;
  batchTimeoutMs?: number;
  signal?: AbortSignal;
  log: (message: string) => void;
  timings?: TimingCollector;
  recordProgress: (returnedTests: number) => Promise<void>;
}

interface RunEvalBatchesResult {
  results: Array<EvalApiResponse["results"]>;
  batchFailures: EvalBatchFailure[];
}

async function runEvalBatches(options: RunEvalBatchesOptions): Promise<RunEvalBatchesResult> {
  const { batches, log, timings } = options;
  const results: Array<EvalApiResponse["results"]> = new Array(batches.length).fill(null);
  const batchFailures: EvalBatchFailure[] = [];
  const sema = makeSemaphore(options.concurrency);
  let stopped = false;
  let firstError: unknown;
  const execute = async (): Promise<void> => {
    await Promise.all(
      batches.map((batch, index) =>
        sema(async () => {
          if (stopped) throw firstError;
          try {
            log(`  batch ${index + 1}/${batches.length}: started (${batch.length} test(s))`);
            throwIfAborted(options.signal);
            const response = await callEval(options.conn, batch, options.headers, {
              timeoutMs: options.batchTimeoutMs,
              signal: options.signal,
            });
            // Another concurrent batch may already have failed while this
            // request was in flight. Do not emit timings, logs, results, or
            // progress after the Run has started terminalization.
            if (stopped) throw firstError;
            if (response.status === 499) {
              throwIfAborted(options.signal);
              throw new EvalRunCancelledError();
            }
            if (timings) {
              timings.add("sfap_endpoint_cache", 0, {
                cache: response.endpoint_cache,
                endpoint: response.endpoint,
              });
            }
            if (response.status >= 200 && response.status < 300) {
              results[index] = response.body.results ?? [];
              if (batches.length > 1) {
                log(
                  `  batch ${index + 1}/${batches.length}: ${(results[index] ?? []).length} tests complete`,
                );
              }
            } else {
              batchFailures.push({
                batch_index: index,
                status: response.status,
                test_ids: batch.map((test) => test.id),
                body: response.body,
              });
              const snippet = JSON.stringify(response.body).slice(0, 1500);
              log(`  batch ${index + 1}/${batches.length}: HTTP ${response.status}  ${snippet}`);
              results[index] = [];
            }
            await options.recordProgress((results[index] ?? []).length);
          } catch (error) {
            if (!stopped) {
              stopped = true;
              firstError = error;
            }
            throw error;
          }
        }),
      ),
    );
  };

  if (timings) await timings.time("eval_batches", execute);
  else await execute();
  return { results, batchFailures };
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
  const runDir = !opts.noPersist ? resolveRunDir(opts.cwd, runId, opts.runBase) : undefined;
  let statusPhase = "preflight";
  let runBegun = false;
  let terminalStatusWritten = false;
  let statusQueue = Promise.resolve();
  const writeStatus = async (
    status: EvalRunStatus,
    phase: string,
    extras: {
      testsCount?: number;
      batches?: number;
      error?: unknown;
      completed?: Date;
      progress?: {
        completed_batches: number;
        total_batches: number;
        returned_tests: number;
      };
    } = {},
  ): Promise<void> => {
    if (!runDir || !runBegun) return;
    statusPhase = phase;
    await writeRunStatus(runDir, {
      schema_version: 1,
      run_id: runId,
      status,
      phase,
      started: startedAt.toISOString(),
      updated: new Date().toISOString(),
      ...(extras.completed ? { completed: extras.completed.toISOString() } : {}),
      spec_path: opts.specPath,
      org: opts.targetOrg,
      agent_api_name: opts.agentApiName,
      tests_count: extras.testsCount,
      batches: extras.batches,
      concurrency,
      traces_mode: tracesMode,
      batch_timeout_ms: opts.batchTimeoutMs ?? 300_000,
      progress: extras.progress,
      ...(extras.error ? { error: errorPayload(extras.error) } : {}),
    });
  };
  try {
    throwIfAborted(opts.signal);
    validateEvalResponseIntegrityPolicy(opts.spec);

    // 1. Resolve $active_* / $latest_* placeholders + apply spec normalization
    let spec = opts.spec;
    let resolvedIds: ResolvedAgentIds | null = opts.resolvedTarget ?? null;
    let latestIds: ResolvedAgentIds | null = null;
    let injectedIds: ResolvedAgentIds | null = null;
    let injectionStats: AgentIdInjectionStats | undefined;
    const usage = detectPlaceholderUsage(spec);
    if (usage.active || usage.latest) {
      await writeStatus("running", "resolving_agent_ids", {
        testsCount: spec.tests?.length ?? 0,
      });
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

    let seedProvenance: EvalSeedProvenance[] = [];

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

    throwIfAborted(opts.signal);
    const resolvedSeeds = opts.timings
      ? await opts.timings.time("resolve_eval_seeds", () =>
          resolveEvalSeedProfiles(spec, {
            query: async (soql) => await queryEvalSeed(opts.conn, soql, opts.signal),
          }),
        )
      : await resolveEvalSeedProfiles(spec, {
          query: async (soql) => await queryEvalSeed(opts.conn, soql, opts.signal),
        });
    spec = resolvedSeeds.spec;
    seedProvenance = resolvedSeeds.provenance;

    throwIfAborted(opts.signal);
    spec = opts.timings
      ? await opts.timings.time("normalize_eval_spec", () => normalizeSpec(spec))
      : normalizeSpec(spec);

    // 2. Resolve org identity for SFAP headers
    await writeStatus("running", "resolving_org_identity", {
      testsCount: spec.tests?.length ?? 0,
    });
    const ident = opts.timings
      ? await opts.timings.time("org_identity", () =>
          resolveOrgIdentity(opts.conn, { signal: opts.signal }),
        )
      : await resolveOrgIdentity(opts.conn, { signal: opts.signal });
    const headers: EvalApiHeaders = {
      orgId: ident.org_id,
      userId: ident.user_id,
      instanceUrl: ident.instance_url,
    };
    throwIfAborted(opts.signal);

    // 3. Batch + fan out
    const tests = spec.tests ?? [];
    if (tests.length === 0) {
      throw new Error("Spec contains no tests; nothing to do.");
    }
    const batches = splitIntoBatches(tests);
    const utteranceIndex = buildUtteranceIndex(spec);
    if (runDir) {
      const now = new Date().toISOString();
      const scope: EvalRunScope = opts.runScope ?? (opts.specPath ? "suite" : "ad_hoc");
      try {
        await writeRunStartArtifacts({
          runDir,
          sourceSpec: opts.sourceSpec ?? opts.spec,
          executedSpec: spec,
          manifest: {
            schema_version: 2,
            run_id: runId,
            created: startedAt.toISOString(),
            scope,
            ...(scope === "scenario" && opts.scenarioId ? { scenario_id: opts.scenarioId } : {}),
            spec_path: opts.specPath,
            org: opts.targetOrg,
            org_id: ident.org_id,
            agent_api_name: opts.agentApiName,
            bot_version_id:
              resolvedIds?.bot_version_id ??
              latestIds?.bot_version_id ??
              injectedIds?.bot_version_id,
            planner_id:
              resolvedIds?.planner_id ?? latestIds?.planner_id ?? injectedIds?.planner_id ?? null,
            source_digest: hashEvalSpec(opts.sourceSpec ?? opts.spec),
            executed_digest: hashEvalSpec(spec),
            source_snapshot: "spec.source.snapshot.json",
            executed_snapshot: "spec.executed.snapshot.json",
            expected: {
              scenarios: tests.map((test) => ({
                id: test.id,
                evaluator_ids: test.steps
                  .filter((step) => step.type.startsWith("evaluator."))
                  .map((step) => step.id),
              })),
            },
            release_contract: opts.releaseContract,
            unverified_evaluator_acknowledged: opts.unverifiedEvaluatorAcknowledged,
            coordinator: opts.coordinator,
            seed_provenance:
              seedProvenance.length > 0
                ? seedProvenance.flatMap((profile) =>
                    profile.scenario_ids.map((scenarioId) => ({
                      scenario_id: scenarioId,
                      names: profile.variable_names,
                      profile: profile.profile,
                      sensitive_names: profile.sensitive_variable_names,
                      query_digest: profile.query_digest,
                    })),
                  )
                : tests
                    .map((test) => ({
                      scenario_id: test.id,
                      names: [
                        ...new Set(
                          test.steps.flatMap((step) =>
                            Array.isArray(step.context_variables)
                              ? step.context_variables
                                  .map((row) =>
                                    row && typeof row === "object" && typeof row.name === "string"
                                      ? row.name
                                      : undefined,
                                  )
                                  .filter((name): name is string => !!name)
                              : [],
                          ),
                        ),
                      ],
                    }))
                    .filter((row) => row.names.length > 0),
          },
          status: {
            schema_version: 1,
            run_id: runId,
            status: "running",
            phase: "running_batches",
            started: startedAt.toISOString(),
            updated: now,
            spec_path: opts.specPath,
            org: opts.targetOrg,
            agent_api_name: opts.agentApiName,
            tests_count: tests.length,
            batches: batches.length,
            concurrency,
            traces_mode: tracesMode,
            batch_timeout_ms: opts.batchTimeoutMs ?? 300_000,
            progress: {
              completed_batches: 0,
              total_batches: batches.length,
              returned_tests: 0,
            },
          },
        });
        runBegun = true;
        statusPhase = "running_batches";
      } catch (error) {
        await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    }
    log(
      `Running ${tests.length} tests across ${batches.length} batch(es) ` +
        `(concurrency=${Math.min(batches.length, concurrency)}, batch_timeout_ms=${opts.batchTimeoutMs ?? 300_000})`,
    );

    let completedBatches = 0;
    let returnedTests = 0;
    const recordBatchProgress = (returned: number): Promise<void> => {
      completedBatches++;
      returnedTests += returned;
      const progress = {
        completed_batches: completedBatches,
        total_batches: batches.length,
        returned_tests: returnedTests,
      };
      statusQueue = statusQueue.then(() =>
        writeStatus("running", "running_batches", {
          testsCount: tests.length,
          batches: batches.length,
          progress,
        }),
      );
      return statusQueue;
    };
    const { results, batchFailures } = await runEvalBatches({
      conn: opts.conn,
      batches,
      headers,
      concurrency,
      batchTimeoutMs: opts.batchTimeoutMs,
      signal: opts.signal,
      log,
      timings: opts.timings,
      recordProgress: recordBatchProgress,
    });
    const failedBatches = batchFailures.length;

    // 4. Merge + HTML-decode
    const mergedRaw: EvalApiResponse = { results: results.flatMap((r) => r ?? []) };
    const merged = opts.timings
      ? await opts.timings.time("decode_eval_response", () => deepDecode(mergedRaw))
      : deepDecode(mergedRaw);
    const returnedTestIds = new Set(
      (merged.results ?? []).map((test) => test.id).filter((id): id is string => !!id),
    );
    const missingTestIds = tests.map((test) => test.id).filter((id) => !returnedTestIds.has(id));
    const strictVerdict = deriveEvalVerdict(spec, merged, { failedBatches });

    // 5. Trace surface — synthesize-then-merge.
    //
    // The eval API closes its sessions immediately, so the live
    // `/v1.1/preview/sessions/{sid}/plans/{pid}` endpoint 404s with
    // `Session not found` for every (sid, pid) the eval API spawns.
    // BUT: the eval response already contains the trace data inline
    // (llmEvents + invokedActions + errors + sessionContext +
    // sessionProperties). We synthesize per-turn trace docs from that
    // inline data unconditionally. Live trace fetch remains opt-in because
    // eval-created sessions usually disappear before the planner endpoint can
    // read them, and waiting on those 404s delays artifact persistence.
    const traces = new Map<string, unknown | null>();
    let liveFetchedCount = 0;
    let synthesizedCount = 0;
    if (tracesMode !== "off") {
      // Synthesize for every test in scope, applying the same
      // failed-only filter as the live fetch when traces_mode='failed'.
      const inScopeIds = new Set<string>();
      for (const test of merged.results ?? []) {
        if (tracesMode === "failed") {
          const scenarioVerdict = strictVerdict.scenarios.find(
            (scenario) => scenario.id === String(test.id ?? ""),
          );
          if (scenarioVerdict?.verdict === "passed") continue;
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

      // Live trace fetch is opt-in for eval runs. The eval API usually closes
      // sessions before the planner trace endpoint can read them, while the
      // inline eval response already contains enough data to synthesize useful
      // trace docs. Keep the explicit trace action for live drill-downs.
      if (opts.liveTraceFetch) {
        const planKeys: PlanKey[] = collectPlanKeys(merged, {
          onlyFailed: tracesMode === "failed",
        });
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
            log(
              `  live fetch: ${liveFetchedCount}/${unique} succeeded; merged with synthesized data.`,
            );
          }
        }
      }
    }

    // 6. Build summary + failure records
    // Cross-reference user utterances from the one shared spec index, so
    // synthesized traces, transcripts, and FailureRecords agree even when the
    // Evaluation API omits EvalOutput.utterance.
    const buildOpts: BuildOptions = {
      promptChars: opts.promptChars,
      interestingStateKeys: opts.interestingStateKeys,
      tracesDir:
        runDir && tracesMode !== "off" && traces.size > 0 ? path.join(runDir, "traces") : undefined,
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
      execution_state: failedBatches > 0 ? "infrastructure_failed" : "completed",
      evidence_verdict: strictVerdict.verdict,
      verdict_semantics_version: strictVerdict.semantics_version,
      spec_path: opts.specPath,
      org: opts.targetOrg,
      org_id: ident.org_id,
      agent_api_name: opts.agentApiName,
      // When both $active_* and $latest_* resolve to the same version, the
      // active record is the canonical source. When only $latest_* is in use
      // (e.g. testing a freshly-published-but-Inactive version), we record
      // the latest record so the run is auditable against the actual
      // BotVersion that was exercised.
      bot_id: injectedIds?.bot_id ?? resolvedIds?.bot_id ?? latestIds?.bot_id,
      bot_version_id:
        resolvedIds?.bot_version_id ?? latestIds?.bot_version_id ?? injectedIds?.bot_version_id,
      planner_id:
        resolvedIds?.planner_id ?? latestIds?.planner_id ?? injectedIds?.planner_id ?? null,
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
      returned_tests_count: merged.results?.length ?? 0,
      missing_test_ids: missingTestIds,
      failed_batches: failedBatches,
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
      release_contract: opts.releaseContract,
    };

    // 8. Persist (unless disabled)
    if (runDir) {
      await (opts.timings
        ? opts.timings.time("persist_eval_run", () =>
            writeRun({
              runDir,
              merged,
              traces,
              metadata,
              failures,
              batchFailures,
              verdict: strictVerdict,
              spec,
              utteranceIndex,
            }),
          )
        : writeRun({
            runDir,
            merged,
            traces,
            metadata,
            failures,
            batchFailures,
            verdict: strictVerdict,
            spec,
            utteranceIndex,
          }));
      await statusQueue;
      await writeStatus(
        failedBatches > 0 ? "infrastructure_failed" : "completed",
        failedBatches > 0 ? "batch_failure" : "completed",
        {
          testsCount: tests.length,
          batches: batches.length,
          completed: completedAt,
          progress: {
            completed_batches: batches.length,
            total_batches: batches.length,
            returned_tests: merged.results?.length ?? 0,
          },
        },
      );
      terminalStatusWritten = true;
      log(`Artifacts: ${runDir}/`);
    }

    const publicFailures = redactResolvedSeedValues(failures, spec, seedProvenance);
    const publicBatchFailures = redactResolvedSeedValues(batchFailures, spec, seedProvenance);
    return {
      run_id: runId,
      run_dir: runDir,
      totals,
      latency: lat,
      failures: publicFailures,
      merged,
      metadata,
      failed_batches: failedBatches,
      batch_failures: publicBatchFailures,
      response_integrity: summarizeEvalResponseIntegrity(merged, {
        maxNonEmptyContents: spec.sf_pi?.turn_response_integrity?.max_nonempty_llm_contents,
      }),
      ...(strictVerdict.response_integrity
        ? { response_integrity_evidence: strictVerdict.response_integrity }
        : {}),
    };
  } catch (err) {
    if (!terminalStatusWritten) {
      const interrupted =
        err instanceof EvalRunInterruptedError || opts.signal?.reason === "interrupted";
      const cancelled =
        !interrupted && (err instanceof EvalRunCancelledError || opts.signal?.aborted);
      try {
        await statusQueue;
      } catch (statusError) {
        log(
          `Failed to drain eval progress status writes: ${
            statusError instanceof Error ? statusError.message : String(statusError)
          }`,
        );
      }
      try {
        await writeStatus(
          interrupted ? "interrupted" : cancelled ? "cancelled" : "infrastructure_failed",
          statusPhase,
          {
            testsCount: opts.spec.tests?.length ?? 0,
            error: err,
            completed: new Date(),
          },
        );
      } catch (statusError) {
        log(
          `Failed to persist terminal eval status: ${
            statusError instanceof Error ? statusError.message : String(statusError)
          }`,
        );
      }
    }
    throw err;
  }
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
    if (await readMetadata(cwd, runId, runBase)) return [];
    throw new Error(
      `No failures.jsonl for run '${runId}'. Suggested fix: confirm the run id. Path tried: ${file}`,
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
  const dir = runBase ?? defaultRunBase(cwd);
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
  const tempPath = `${idxPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  await writeFile(tempPath, `${JSON.stringify(entries, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tempPath, idxPath);
}
