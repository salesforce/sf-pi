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
  bot_version_id?: string;
  planner_id?: string | null;
  started: string;
  completed: string;
  duration_ms: number;
  tests_count: number;
  batches: number;
  concurrency: number;
  traces_mode: TracesMode;
  traces_fetched: number;
  totals: Omit<RunTotals, "latencies">;
  latency_summary: LatencySummary;
}

export type TracesMode = "failed" | "all" | "off";
