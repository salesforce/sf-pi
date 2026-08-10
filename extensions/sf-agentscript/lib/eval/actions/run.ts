/* SPDX-License-Identifier: Apache-2.0 */
/** Eval run actions: ordinary runs and exact-version release contracts. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "../../agent-api-auth.ts";
import { connFromAlias } from "../../../../../lib/common/sf-conn/index.ts";
import {
  EvalRunCancelledError,
  recordRunInIndex,
  runEval,
  type RunEvalResult,
} from "../orchestrator.ts";
import { evalProjectRoot } from "../persist.ts";
import { resolveAgentIds, substitutePlaceholders, type ResolvedAgentIds } from "../active-ids.ts";
import { applyGeneratedBaselineSeedConfig } from "../seeds.ts";
import {
  designatedVoiceReleaseIntegrityIssue,
  validateEvalResponseIntegrityPolicy,
} from "../response-integrity.ts";
import { buildEvalConversationSummaries } from "../conversation-summary.ts";
import {
  latestEvalSpec,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "../../branch-state.ts";
import { toolError, type ToolError } from "../../tool-types.ts";
import type { EvalSpec, RunMetadata } from "../types.ts";
import { readEffectiveAgentScriptSettings } from "../../settings.ts";
import type { TimingCollector } from "../../timings.ts";
import {
  AGENT_SCRIPT_RELEASE_BASELINE_ID,
  defaultReleaseSpecPath,
  hashEvalSpec,
  recordReleaseEvidence,
  rewriteReleaseSpecForLatest,
} from "../../release-contract.ts";
import { actionGenerateSpec, type GenerateEvalSpecActionInput } from "./generation.ts";

const EVAL_TOOL_NAME = "agentscript_eval";

export type EvalOnUpdateFn = (partial: {
  content: { type: "text"; text: string }[];
  details: never;
}) => void;
export interface RunEvalActionInput extends GenerateEvalSpecActionInput {
  release_version?: number;
  source_spec?: EvalSpec;
  prepared_spec?: EvalSpec;
  coordinator_token?: string;
  action?: string;
  target_org?: string;
  spec_path?: string;
  spec?: unknown;
  release_spec_path?: string;
  agent_api_name?: string;
  traces_mode?: "failed" | "all" | "off";
  concurrency?: number;
  prompt_chars?: number;
  batch_timeout_ms?: number;
  inline_threshold?: number;
  acknowledge_inactive_version?: boolean;
  version_resolution?: "active" | "latest" | "version";
  overwrite_agent_ids?: boolean;
  version?: number;
  agent_file?: string;
  release_contract_kind?: "generated_baseline" | "designated";
}

export async function actionRunRelease(
  ctx: ExtensionContext,
  input: RunEvalActionInput,
  onUpdate?: EvalOnUpdateFn,
  timings?: TimingCollector,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const agentApiName = input.agent_api_name as string;
  const projectRoot = evalProjectRoot(ctx.cwd);
  const designatedPath = input.release_spec_path
    ? path.resolve(projectRoot, input.release_spec_path)
    : defaultReleaseSpecPath(projectRoot, agentApiName);
  let designatedSource: EvalSpec | undefined;
  try {
    designatedSource = JSON.parse(await readFile(designatedPath, "utf8")) as EvalSpec;
  } catch (error) {
    const missing = (error as { code?: string }).code === "ENOENT";
    if (input.release_spec_path || !missing) {
      return toolError(
        missing
          ? `Designated release spec not found: ${designatedPath}`
          : `Failed to read designated release spec: ${
              error instanceof Error ? error.message : String(error)
            }`,
      );
    }
  }

  const safeName = agentApiName.replace(/[^A-Za-z0-9._-]/g, "_");
  const baselinePath = path.join(
    projectRoot,
    ".pi",
    "state",
    "sf-agentscript",
    "release-contracts",
    `${safeName}.generated.eval.json`,
  );
  const generated = await actionGenerateSpec(ctx, {
    ...input,
    action: "generate_spec",
    output_path: baselinePath,
  });
  if ((generated.details as { ok?: boolean }).ok !== true) return generated;
  const generatedSource = JSON.parse(await readFile(baselinePath, "utf8")) as EvalSpec;
  const voiceIntegrityIssue = designatedVoiceReleaseIntegrityIssue(
    generatedSource,
    designatedSource,
  );
  if (voiceIntegrityIssue) {
    return toolError(
      `${voiceIntegrityIssue} ${designatedPath}`,
      "Add sf_pi.turn_response_integrity with max_nonempty_llm_contents=1 and severity='error', then add exactly one agent.get_state after every agent.send_message.",
    );
  }
  if (designatedSource) {
    try {
      validateEvalResponseIntegrityPolicy(designatedSource);
    } catch (error) {
      return toolError(
        `Designated release spec response-integrity preflight failed: ${error instanceof Error ? error.message : String(error)}`,
        "Add exactly one agent.get_state after every agent.send_message before rerunning the release contract.",
      );
    }
  }
  const baselineSource = designatedSource
    ? applyGeneratedBaselineSeedConfig(generatedSource, designatedSource)
    : generatedSource;
  if (designatedSource?.generated_baseline) {
    await writeFile(baselinePath, `${JSON.stringify(baselineSource, null, 2)}\n`, "utf8");
  }

  const conn = await connFromAlias(input.target_org);
  const exactVersion = await resolveAgentIds(conn, agentApiName, {
    ...(typeof input.release_version === "number"
      ? { version: input.release_version }
      : { status: "any" as const }),
    signal,
  });
  if (exactVersion.status === "Active") {
    return toolError(
      `No pending non-Active BotVersion exists for '${agentApiName}'.`,
      "Publish an inactive version before running the release contract.",
    );
  }
  const common: RunEvalActionInput = {
    ...input,
    action: "run",
    agent_api_name: agentApiName,
    version_resolution: "version",
    version: exactVersion.version_number,
    acknowledge_inactive_version: true,
    overwrite_agent_ids: true,
  };
  const baseline = await actionRun(
    ctx,
    {
      ...common,
      spec_path: baselinePath,
      spec: undefined,
      release_contract_kind: "generated_baseline",
      source_spec: baselineSource,
      prepared_spec: pinReleaseSpec(baselineSource, exactVersion),
    },
    onUpdate,
    timings,
    signal,
  );
  if ((baseline.details as { ok?: boolean }).ok !== true) {
    return prependResult(baseline, "❌ generated release baseline failed");
  }

  if (!designatedSource) {
    return prependResult(baseline, "✅ Agent Script release contract passed (generated baseline)");
  }

  const designated = await actionRun(
    ctx,
    {
      ...common,
      spec_path: designatedPath,
      spec: undefined,
      release_contract_kind: "designated",
      source_spec: designatedSource,
      prepared_spec: pinReleaseSpec(designatedSource, exactVersion),
    },
    onUpdate,
    timings,
    signal,
  );
  return prependResult(
    designated,
    (designated.details as { ok?: boolean }).ok === true
      ? "✅ Agent Script release contract passed (generated baseline + designated suite)"
      : "❌ designated Agent Script release suite failed after the generated baseline passed",
  );
}

function pinReleaseSpec(spec: EvalSpec, exactVersion: ResolvedAgentIds): EvalSpec {
  return substitutePlaceholders(spec, {
    active: exactVersion,
    latest: exactVersion,
  });
}

function prependResult<T extends { content: { type: "text"; text: string }[] }>(
  result: T,
  heading: string,
): T {
  return {
    ...result,
    content: result.content.map((item, index) =>
      index === 0 ? { ...item, text: `${heading}\n\n${item.text}` } : item,
    ),
  };
}

export async function actionRun(
  ctx: ExtensionContext,
  input: RunEvalActionInput,
  onUpdate?: EvalOnUpdateFn,
  timings?: TimingCollector,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const log = (msg: string): void => {
    try {
      onUpdate?.({
        content: [{ type: "text", text: msg }],
        details: { progress: msg } as never,
      });
    } catch {
      /* best-effort */
    }
  };

  if (!input.spec_path && !input.spec) {
    const inferred = latestEvalSpec(ctx);
    if (inferred) input = { ...input, spec_path: inferred.spec_path };
  }
  const sourceSpec = input.source_spec
    ? input.source_spec
    : timings
      ? await timings.time("load_eval_spec", () => loadSpec(input, ctx.cwd))
      : await loadSpec(input, ctx.cwd);
  if (!sourceSpec) {
    return toolError(
      "Either spec_path or spec must be provided.",
      "Pass spec_path: '<file.json>' or first generate a spec with agentscript_eval action='generate_spec'.",
    );
  }

  const spec = input.prepared_spec
    ? (input.prepared_spec as EvalSpec)
    : input.release_contract_kind
      ? rewriteReleaseSpecForLatest(sourceSpec)
      : sourceSpec;
  const releaseContract = input.release_contract_kind
    ? {
        kind: input.release_contract_kind,
        baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
        spec_digest: hashEvalSpec(sourceSpec),
        ...(input.spec_path ? { spec_path: path.resolve(ctx.cwd, input.spec_path) } : {}),
      }
    : undefined;

  let result: RunEvalResult;
  try {
    const conn = timings
      ? await timings.time("org_connection", () => connFromAlias(input.target_org))
      : await connFromAlias(input.target_org);
    let traceConn;
    const settings = readEffectiveAgentScriptSettings(ctx.cwd);
    const tracesMode = input.traces_mode ?? settings.evalTracesMode;
    if (tracesMode !== "off") {
      try {
        const authPhase = timings?.phase("agent_api_auth");
        const auth = await connForAgentApi(input.target_org, { signal });
        authPhase?.end({ cache: auth.cache });
        traceConn = auth.conn;
      } catch {
        // Trace fetches are a debugging aid and already non-fatal; run eval even
        // when the named-user JWT bootstrap is unavailable.
      }
    }
    result = await runEval({
      conn,
      traceConn,
      targetOrg: input.target_org ?? conn.getUsername() ?? "<default>",
      spec,
      sourceSpec,
      agentApiName: input.agent_api_name,
      tracesMode,
      concurrency: input.concurrency ?? settings.evalConcurrency,
      promptChars: input.prompt_chars ?? 600,
      batchTimeoutMs: input.batch_timeout_ms,
      acknowledgeInactiveVersion: input.acknowledge_inactive_version,
      versionResolution: input.version_resolution,
      version: input.version,
      overwriteAgentIds: input.overwrite_agent_ids,
      releaseContract,
      coordinator: input.coordinator_token
        ? { kind: "studio", owner_token: input.coordinator_token }
        : undefined,
      cwd: ctx.cwd,
      specPath: input.spec_path,
      log,
      timings,
      signal,
    });
  } catch (err) {
    return classifyRunError(err, input);
  }

  await (timings
    ? timings.time("record_eval_run_index", () => recordRunInIndex(ctx.cwd, result.run_id))
    : recordRunInIndex(ctx.cwd, result.run_id));
  if (input.release_contract_kind) {
    try {
      await recordReleaseEvidence(ctx.cwd, result.run_id);
    } catch (error) {
      log(
        `Release-evidence index update deferred; activation can rebuild it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const conversations = buildEvalConversationSummaries(
    result.merged,
    spec,
    result.response_integrity,
  );
  const inlineThreshold = input.inline_threshold ?? 5;
  const passed = result.metadata.evidence_verdict === "passed";
  const head = headline(result, passed);

  const summary = {
    run_id: result.run_id,
    run_dir: result.run_dir,
    ok: passed,
    execution_state: result.metadata.execution_state,
    evidence_verdict: result.metadata.evidence_verdict,
    totals: result.metadata.totals,
    latency: result.latency,
    response_integrity: result.response_integrity,
    response_integrity_evidence: result.response_integrity_evidence,
    failed_batches: result.failed_batches,
    returned_tests: result.metadata.returned_tests_count,
    expected_tests: result.metadata.tests_count,
    missing_test_ids: result.metadata.missing_test_ids,
    ...(result.batch_failures.length > 0
      ? {
          batch_failures: result.batch_failures.slice(0, 3).map((failure) => ({
            batch_index: failure.batch_index,
            status: failure.status,
            test_ids: failure.test_ids,
            body_preview: JSON.stringify(failure.body).slice(0, 1200),
          })),
        }
      : {}),
  };

  const failureCount = result.failures.length;
  const inline = failureCount <= inlineThreshold;
  const failuresPayload = inline ? result.failures : result.failures.slice(0, 3);

  const text =
    head +
    "\n\n" +
    JSON.stringify(
      {
        ...summary,
        failures: failuresPayload,
        ...(inline
          ? {}
          : {
              failures_truncated: true,
              total_failures: failureCount,
              hint: `Showing 3/${failureCount}. Use agentscript_eval action='get_failure' run_id='${result.run_id}' test_id='<id>' to drill in.`,
            }),
      },
      null,
      2,
    );

  return {
    content: [{ type: "text", text }],
    details: withAgentScriptBranchState(
      {
        ok: passed,
        run_id: result.run_id,
        run_dir: result.run_dir,
        execution_state: result.metadata.execution_state,
        evidence_verdict: result.metadata.evidence_verdict,
        totals: result.metadata.totals,
        latency: result.latency,
        response_integrity: result.response_integrity,
        response_integrity_evidence: result.response_integrity_evidence,
        conversations,
        failed_test_ids: result.failures.map((f) => f.test_id),
      },
      evalRunEvents({
        runId: result.run_id,
        runDir: result.run_dir,
        ok: passed,
        failedTestIds: result.failures.map((f) => f.test_id),
        metadata: result.metadata,
      }),
    ),
  };
}

function classifyRunError(
  err: unknown,
  input: RunEvalActionInput,
): { content: { type: "text"; text: string }[]; details: ToolError } {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof EvalRunCancelledError) {
    return toolError(
      "Eval run cancelled.",
      "The partial run status is available on disk when persistence was enabled.",
    );
  }
  // If the error is "spec uses $active_* / $latest_* but no agent_api_name",
  // point the LLM at resolve_active so it can bake values directly.
  if ((msg.includes("$active_") || msg.includes("$latest_")) && !input.agent_api_name) {
    return toolError(msg, "Pass agent_api_name to resolve placeholders.", {
      tool: EVAL_TOOL_NAME,
      params: { action: "resolve_active", agent_api_name: "<name>" },
    });
  }
  // If $latest_* resolved to a non-Active version and the user didn't
  // acknowledge, surface the explicit recover_via with the flag set.
  if (msg.includes("acknowledge_inactive_version")) {
    return toolError(msg, "Pass acknowledge_inactive_version=true to confirm.", {
      tool: EVAL_TOOL_NAME,
      params: {
        action: "run",
        spec_path: input.spec_path ?? "<path>",
        agent_api_name: input.agent_api_name ?? "<name>",
        acknowledge_inactive_version: true,
      },
    });
  }
  // If the error mentions an Agent not found, suggest resolve_active to discover it.
  if (/Agent .* not found/i.test(msg)) {
    return toolError(msg, "Verify the DeveloperName.", {
      tool: EVAL_TOOL_NAME,
      params: { action: "resolve_active", agent_api_name: input.agent_api_name ?? "<name>" },
    });
  }
  return toolError(msg);
}

function evalRunEvents(input: {
  runId: string;
  runDir: string;
  ok: boolean;
  failedTestIds: string[];
  metadata: RunMetadata;
}): AgentScriptBranchStateEvent[] {
  return [
    {
      schema_version: 1,
      kind: "eval_run",
      run_id: input.runId,
      run_dir: input.runDir,
      ok: input.ok,
      failed_test_ids: input.failedTestIds,
      org_id: input.metadata.org_id,
      agent_api_name: input.metadata.agent_api_name,
      bot_version_id: input.metadata.bot_version_id,
      release_contract_kind: input.metadata.release_contract?.kind,
      release_spec_digest: input.metadata.release_contract?.spec_digest,
      source: "eval.run",
    },
  ];
}

function headline(result: RunEvalResult, passed: boolean): string {
  const t = result.metadata.totals;
  const lat = result.latency;
  const latPart = lat.count > 0 ? `  |  latency p50=${lat.p50_ms}ms p95=${lat.p95_ms}ms` : "";
  const marker = passed ? "✅" : "❌";
  return (
    `${marker} eval run ${result.run_id}\n` +
    `Tests: ${t.test_pass}/${t.tests} passed  |  ` +
    `Evaluators: ${t.ev_pass}/${t.evals} passed  |  ` +
    `Step errors: ${t.errors}${latPart}` +
    (result.failed_batches > 0
      ? `\n⚠ ${result.failed_batches} batch(es) returned non-200 (some tests may be missing)`
      : "")
  );
}

async function loadSpec(input: RunEvalActionInput, cwd: string): Promise<EvalSpec | null> {
  if (input.spec_path) {
    const path = await import("node:path");
    const abs = path.isAbsolute(input.spec_path)
      ? input.spec_path
      : path.resolve(cwd, input.spec_path);
    const raw = await readFile(abs, "utf-8");
    return JSON.parse(raw) as EvalSpec;
  }
  if (input.spec && typeof input.spec === "object") {
    return input.spec as EvalSpec;
  }
  return null;
}

// -------------------------------------------------------------------------------------------------
// action = get_failure
// -------------------------------------------------------------------------------------------------
