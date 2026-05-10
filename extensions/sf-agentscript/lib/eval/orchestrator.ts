/* SPDX-License-Identifier: Apache-2.0 */
/**
 * The high-level run-eval orchestrator.
 *
 * Responsibilities:
 *   1. Resolve `$active_*` placeholders against the live org's Active BotVersion.
 *   2. Normalize the spec (alias remap on agent.* steps).
 *   3. Resolve org metadata once (instanceUrl, orgId, userId) for SFAP headers.
 *   4. Split tests into ≤5-test batches and fan out concurrent POSTs.
 *   5. HTML-decode the merged response.
 *   6. Optionally fan out planner-trace GETs (default: failed tests only).
 *   7. Persist the run to disk in the diff-friendly layout.
 *   8. Return a structured result for the caller (tool, command, or test).
 *
 * Concurrency model
 * -----------------
 * Eval batches: thread-pool fan-out at `concurrency` parallelism.
 * Trace fetches: separate fan-out at the same parallelism. Order independent.
 * Each `sf api request rest` invocation is its own subprocess, so this is
 * actually parallel (not just async).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExecFn } from "../../../../lib/common/sf-environment/detect.ts";
import { callEval, type EvalApiHeaders, splitIntoBatches } from "./eval-client.ts";
import { collectPlanKeys, fetchTracesConcurrent, type PlanKey } from "./trace-client.ts";
import { deepDecode } from "./decode.ts";
import { latencySummary, summarize, type BuildOptions } from "./render.ts";
import { httpCall } from "./http.ts";
import { newRunId, resolveRunDir, writeRun } from "./persist.ts";
import { normalizeSpec } from "./normalize.ts";
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
// Active-version resolution
// -------------------------------------------------------------------------------------------------

export interface ResolvedAgentIds {
  bot_id: string;
  bot_version_id: string;
  planner_id: string | null;
  version_number: number;
}

function soqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

async function sfDataQuery<T>(exec: ExecFn, soql: string, targetOrg: string): Promise<T[]> {
  const result = await exec("sf", ["data", "query", "-q", soql, "-o", targetOrg, "--json"], {
    timeout: 30_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `sf data query failed (exit ${result.code}). Suggested fix: verify ` +
        `the org alias '${targetOrg}' is reachable (\`sf org display -o ${targetOrg}\`).`,
    );
  }
  const parsed = JSON.parse(result.stdout) as { result?: { records?: T[] } };
  return parsed.result?.records ?? [];
}

export async function resolveActiveIds(
  exec: ExecFn,
  agentApiName: string,
  targetOrg: string,
): Promise<ResolvedAgentIds> {
  const escName = soqlEscape(agentApiName);

  const bots = await sfDataQuery<{ Id: string }>(
    exec,
    `SELECT Id FROM BotDefinition WHERE DeveloperName='${escName}'`,
    targetOrg,
  );
  if (bots.length === 0) {
    throw new Error(
      `Agent '${agentApiName}' not found in org '${targetOrg}'. ` +
        `Suggested fix: verify the DeveloperName via ` +
        `\`sf data query -q "SELECT Id, DeveloperName FROM BotDefinition" -o ${targetOrg}\`.`,
    );
  }
  const bot_id = bots[0].Id;

  const versions = await sfDataQuery<{ Id: string; VersionNumber: number }>(
    exec,
    `SELECT Id, VersionNumber FROM BotVersion ` +
      `WHERE BotDefinitionId='${bot_id}' AND Status='Active' ` +
      `ORDER BY VersionNumber DESC LIMIT 1`,
    targetOrg,
  );
  if (versions.length === 0) {
    throw new Error(
      `No Active BotVersion for '${agentApiName}' in '${targetOrg}'. ` +
        `Suggested fix: activate a version in Setup → Einstein → Agents → ${agentApiName}.`,
    );
  }
  const bot_version_id = versions[0].Id;
  const version_number = versions[0].VersionNumber;

  const planners = await sfDataQuery<{ Id: string }>(
    exec,
    `SELECT Id FROM GenAiPlannerDefinition ` +
      `WHERE DeveloperName='${escName}_v${version_number}' LIMIT 1`,
    targetOrg,
  );

  return {
    bot_id,
    bot_version_id,
    planner_id: planners[0]?.Id ?? null,
    version_number,
  };
}

export function substitutePlaceholders<T>(obj: T, ids: ResolvedAgentIds): T {
  if (typeof obj === "string") {
    if (obj === "$active_bot_id") return ids.bot_id as unknown as T;
    if (obj === "$active_bot_version_id") return ids.bot_version_id as unknown as T;
    if (obj === "$active_planner_id") return ids.planner_id as unknown as T;
    return obj;
  }
  if (Array.isArray(obj)) return obj.map((v) => substitutePlaceholders(v, ids)) as unknown as T;
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = substitutePlaceholders(v, ids);
    }
    return out as T;
  }
  return obj;
}

// -------------------------------------------------------------------------------------------------
// Org metadata + userId for SFAP headers
// -------------------------------------------------------------------------------------------------

export interface OrgIdentity {
  org_id: string;
  instance_url: string;
  user_id: string;
}

interface OrgDisplayResult {
  result?: { id?: string; instanceUrl?: string; username?: string };
}

interface UserInfoResponse {
  user_id?: string;
}

export async function resolveOrgIdentity(exec: ExecFn, targetOrg: string): Promise<OrgIdentity> {
  const display = await exec("sf", ["org", "display", "-o", targetOrg, "--json"], {
    timeout: 15_000,
  });
  if (display.code !== 0) {
    throw new Error(
      `sf org display failed for '${targetOrg}'. Suggested fix: re-auth with ` +
        `\`sf org login web -a ${targetOrg}\`.`,
    );
  }
  const parsed = JSON.parse(display.stdout) as OrgDisplayResult;
  const r = parsed.result ?? {};
  if (!r.id || !r.instanceUrl) {
    throw new Error(
      `sf org display returned no orgId/instanceUrl for '${targetOrg}'. ` +
        `Suggested fix: confirm the alias is connected (\`sf org list --all\`).`,
    );
  }

  // Fetch user_id via /services/oauth2/userinfo using the org's own auth context.
  // We hit the instance URL via `sf api request rest` so token handling stays in sf CLI.
  const userinfoUrl = `${r.instanceUrl}/services/oauth2/userinfo`;
  const ui = await httpCall<UserInfoResponse>(exec, {
    url: userinfoUrl,
    method: "GET",
    targetOrg,
    timeoutMs: 15_000,
    maxRetries: 1,
    fallback: false, // instance URL — not SFAP, no fallback
  });
  if (ui.status !== 200 || !ui.body?.user_id) {
    throw new Error(
      `oauth2/userinfo returned status ${ui.status} for '${targetOrg}'. ` +
        `Suggested fix: re-auth with \`sf org login web -a ${targetOrg}\`.`,
    );
  }

  return { org_id: r.id, instance_url: r.instanceUrl, user_id: ui.body.user_id };
}

// -------------------------------------------------------------------------------------------------
// Run options + result
// -------------------------------------------------------------------------------------------------

export interface RunEvalOptions {
  spec: EvalSpec;
  /** sf CLI alias / username. Required. */
  targetOrg: string;
  /** For $active_* placeholder resolution. Default: spec must not use placeholders. */
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

export async function runEval(exec: ExecFn, opts: RunEvalOptions): Promise<RunEvalResult> {
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
    resolvedIds = await resolveActiveIds(exec, opts.agentApiName, opts.targetOrg);
    log(
      `Active: ${opts.agentApiName}  ` +
        `botVersionId=${resolvedIds.bot_version_id}  plannerId=${resolvedIds.planner_id}`,
    );
    spec = substitutePlaceholders(spec, resolvedIds);
  }
  spec = normalizeSpec(spec);

  // 2. Resolve org identity for SFAP headers
  const ident = await resolveOrgIdentity(exec, opts.targetOrg);
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
        const res = await callEval(exec, b, opts.targetOrg, headers);
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
      traces = await fetchTracesConcurrent(exec, planKeys, opts.targetOrg, {
        concurrency,
        log,
      });
      const ok = Array.from(traces.values()).filter((v) => v != null).length;
      if (ok !== unique) {
        log(`  trace fetch: ${ok}/${unique} succeeded (missing planner data is non-fatal)`);
      }
    }
  }

  // 6. Build summary + failure records
  const buildOpts: BuildOptions = {
    promptChars: opts.promptChars,
    interestingStateKeys: opts.interestingStateKeys,
    tracesDir:
      !opts.noPersist && tracesMode !== "off" && traces.size > 0
        ? path.join(resolveRunDir(opts.cwd, runId, opts.runBase), "traces")
        : undefined,
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
    await writeRun({ runDir, merged, traces, metadata, failures });
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

function specHasActivePlaceholders(spec: EvalSpec): boolean {
  // Quick scan — JSON.stringify is fine for our payload sizes.
  const s = JSON.stringify(spec);
  return (
    s.includes("$active_bot_id") ||
    s.includes("$active_bot_version_id") ||
    s.includes("$active_planner_id")
  );
}

/**
 * Tiny semaphore for bounded concurrency. Avoids pulling in a dep just to run
 * `Promise.all` with a cap.
 */
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
