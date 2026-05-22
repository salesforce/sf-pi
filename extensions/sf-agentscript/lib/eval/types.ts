/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Type contracts for the eval module.
 *
 * These mirror the wire shapes returned by the Salesforce Evaluation API
 * (`/einstein/evaluation/v1/tests`) and the planner trace endpoint
 * (`/einstein/ai-agent/v1.1/preview/sessions/{sid}/plans/{pid}`). Fields are
 * intentionally permissive (`unknown`/optional) — the API surface drifts
 * between platform releases and we never want a missing field to blow up a
 * regression run.
 */

// -------------------------------------------------------------------------------------------------
// Spec (what we POST)
// -------------------------------------------------------------------------------------------------

export interface EvalSpec {
  tests: EvalTest[];
}

export interface EvalTest {
  id: string;
  steps: EvalStep[];
}

export interface EvalStep {
  type: string;
  id: string;
  [key: string]: unknown;
}

// -------------------------------------------------------------------------------------------------
// Response (what we get back from the eval API)
// -------------------------------------------------------------------------------------------------

export interface EvalApiResponse {
  results?: TestResult[];
}

export interface TestResult {
  id?: string;
  outputs?: EvalOutput[];
  evaluation_results?: EvalResult[];
  errors?: TestError[];
}

export interface TestError {
  id?: string;
  error_message?: string;
}

export interface EvalResult {
  id?: string;
  type?: string;
  score?: number | null;
  is_pass?: boolean | null;
  actual_value?: string;
  expected_value?: string;
  error_message?: string;
  explainability?: string;
}

export interface EvalOutput {
  type?: string;
  id?: string;
  session_id?: string;
  utterance?: string;
  response?: SendMessageResponse | GetStateResponse | string | null;
}

export type SendMessageResponse = string | { messages?: Array<{ message: string }> };

export interface GetStateResponse {
  planner_response?: PlannerResponse;
  response_latency?: number;
}

export interface PlannerResponse {
  lastExecution?: LastExecution;
  sessionContext?: SessionContext;
  conversationHistory?: unknown[];
  plannerType?: string;
  sessionProperties?: Record<string, unknown>;
}

export interface LastExecution {
  agentResponse?: string;
  errors?: unknown[];
  invokedActions?: string[];
  latency?: number;
  llmEvents?: unknown[];
  message?: { planId?: string; messageType?: string; [k: string]: unknown };
  topic?: string;
  userUtterance?: string;
}

export interface SessionContext {
  agent_description?: string;
  agent_label?: string;
  agent_name?: string;
  agent_type?: string;
  channel_capabilities?: unknown;
  config_type?: string;
  executionHistory?: ExecutionHistoryEntry[];
  plugins?: Array<{ name?: string } | string>;
  stateVariables?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  variables?: Record<string, unknown>;
}

export interface ExecutionHistoryEntry {
  topic?: string;
  invokedActions?: string[];
  latency?: number;
  [k: string]: unknown;
}

// -------------------------------------------------------------------------------------------------
// llmEvents — the prompt-router payload, useful for prompt-drift debugging
// -------------------------------------------------------------------------------------------------

export interface LlmEvent {
  agent_name?: string;
  prompt_name?: string;
  prompt_content?: string;
  prompt_response?: string;
  executionLatency?: number;
  startExecutionTime?: number;
  endExecutionTime?: number;
  [k: string]: unknown;
}

// -------------------------------------------------------------------------------------------------
// Render-side shapes (what the LLM consumer sees)
// -------------------------------------------------------------------------------------------------

export interface FailureRecord {
  test_id: string;
  failed_evaluators: Array<{
    id?: string;
    score?: number | null;
    expected_value?: string;
    actual_value?: string;
    explainability?: string;
  }>;
  step_errors: Array<{ id?: string; error_message?: string }>;
  turns: TurnSummary[];
  trace_files: string[];
}

export interface TurnSummary {
  turn_id: string;
  utterance?: string;
  agent_response?: string;
  topic?: string;
  invoked_actions?: string[];
  latency_ms?: number;
  plan_id?: string;
  turn_errors: unknown[];
  state_variables: Record<string, unknown>;
  execution_history_last5: Array<{
    topic?: string;
    invokedActions?: string[];
    latency?: number;
  }>;
  plugins: string[];
  llm_events: Array<{
    agent_name?: string;
    prompt_name?: string;
    prompt_content?: string;
    prompt_response?: string;
    execution_latency_ms?: number;
  }>;
  /**
   * Compact LLM-friendly digest of this turn synthesized from the eval
   * API's `lastExecution` (the eval API does not expose a step-level
   * timeline, so the digest's `timeline` is reconstructed from the LLM
   * events plus a synthesized PlannerResponseStep). See
   * lib/preview/trace-digest.ts for the schema and the same shape used
   * by `agentscript_preview send`.
   */
  digest?: import("../preview/trace-digest.ts").TraceDigest;
}

export interface RunTotals {
  tests: number;
  test_pass: number;
  test_fail: number;
  evals: number;
  ev_pass: number;
  ev_fail: number;
  errors: number;
  latencies: number[];
}

export interface LatencySummary {
  count: number;
  min_ms?: number;
  p50_ms?: number;
  p95_ms?: number;
  p99_ms?: number;
  max_ms?: number;
  mean_ms?: number;
}

// -------------------------------------------------------------------------------------------------
// Run metadata persisted to disk per run
// -------------------------------------------------------------------------------------------------

export interface RunMetadata {
  run_id: string;
  spec_path?: string;
  org?: string;
  agent_api_name?: string;
  bot_id?: string;
  bot_version_id?: string;
  planner_id?: string | null;
  /** VersionNumber of the BotVersion the run actually exercised. */
  bot_version_number?: number;
  /**
   * BotVersion.Status of the resolved version. 'Active' for the standard
   * regression loop; non-Active when the run was triggered via
   * `$latest_*` placeholders + `acknowledge_inactive_version=true` for
   * the ship-then-test-then-activate flow.
   */
  bot_version_status?: string;
  /**
   * Populated when `agent_api_name` was used to inject missing ids into
   * `agent.create_session` steps. The default mode is `active`, preserving
   * production-version safety while matching upstream's ergonomic `--api-name`
   * flow for JSON specs.
   */
  agent_id_resolution?: {
    mode: "active" | "latest" | "version";
    agent_api_name?: string;
    bot_id: string;
    bot_version_id: string;
    bot_version_number: number;
    bot_version_status: string;
    planner_id: string | null;
    create_session_steps: number;
    injected_create_session_steps: number;
    explicit_create_session_steps: number;
  };
  started: string;
  completed: string;
  duration_ms: number;
  tests_count: number;
  batches: number;
  concurrency: number;
  traces_mode: TracesMode;
  /** Total trace docs persisted (synthesized ∪ live, after dedupe). */
  traces_fetched: number;
  /**
   * Trace docs synthesized from inline eval-API data (llmEvents +
   * invokedActions + sessionContext + sessionProperties). Always populated
   * for eval-spawned sessions because the live trace endpoint 404s after
   * the eval API closes the session. See `lib/eval/synthesize-trace.ts`.
   */
  traces_synthesized?: number;
  /**
   * Trace docs fetched live from the `/v1.1/preview/sessions/{sid}/plans/{pid}`
   * endpoint. Almost always 0 for eval-spawned runs (sessions are
   * ephemeral); kept for forward compatibility and for runs that
   * preserve sessions long enough to be reachable.
   */
  traces_live_fetched?: number;
  totals: Omit<RunTotals, "latencies">;
  latency_summary: LatencySummary;
}

export type TracesMode = "failed" | "all" | "off";
