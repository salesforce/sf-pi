/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Eval-spec normalization — six passes, composed via `normalizeSpec`.
 *
 * Hand-written specs (and MCP-shorthand specs from upstream tooling) drift
 * to camelCase, older planner field names, or evaluator shorthand the API
 * doesn't accept. Rather than 400ing on every drift case, we normalize the
 * spec to the canonical wire shape immediately before POST.
 *
 * Ideas absorbed from `@salesforce/agents/src/evalNormalizer.ts`; we own the
 * implementation. Two deliberate departures from upstream:
 *
 *   1. We DO NOT call `stripUnrecognizedFields`. The a regression suite
 *      seeds mutable state via `context_variables` on `agent.send_message`
 *      (workaround for the 2026-04 platform regression that drops
 *      session-level state seeds). The upstream whitelist would strip it.
 *
 *   2. `convertShorthandRefs` builds the step-id → output-index map only
 *      from non-evaluator steps (matches today's behavior). Evaluators are
 *      not part of the `outputs` array.
 *
 * Pass order matters:
 *   mcp-shorthand → auto-correct → camelCase → evaluator-fields →
 *   shorthand-refs → defaults
 *
 * Each pass is exported individually so tests can pin behavior at the pass
 * level. `normalizeSpec` is the composition the orchestrator calls.
 */

import type { EvalSpec, EvalStep } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Evaluator classification + canonical fields
// -------------------------------------------------------------------------------------------------

/** Evaluators that score (return a `score`, optionally with a `threshold`). */
const SCORING_EVALUATORS = new Set([
  "evaluator.text_alignment",
  "evaluator.hallucination_detection",
  "evaluator.citation_recall",
  "evaluator.answer_faithfulness",
]);

/** Evaluators that assert (return is_pass). */
const ASSERTION_EVALUATORS = new Set(["evaluator.string_assertion", "evaluator.json_assertion"]);

/** Default metric_name for scoring evaluators when caller omits it. */
const DEFAULT_METRIC_NAMES: Record<string, string> = {
  "evaluator.text_alignment": "base.cosine_similarity",
  "evaluator.hallucination_detection": "hallucination_detection",
  "evaluator.citation_recall": "citation_recall",
  "evaluator.answer_faithfulness": "answer_faithfulness",
};

// -------------------------------------------------------------------------------------------------
// Alias maps
// -------------------------------------------------------------------------------------------------

/** Common typos / camelCase on agent.* steps. Wrong → canonical. */
const AGENT_CORRECTIONS: Record<string, string> = {
  agentId: "agent_id",
  agentVersionId: "agent_version_id",
  sessionId: "session_id",
  text: "utterance",
  message: "utterance",
  input: "utterance",
  prompt: "utterance",
  user_message: "utterance",
  userMessage: "utterance",
};

/** Common evaluator-step typos. Wrong → canonical. */
const EVALUATOR_CORRECTIONS: Record<string, string> = {
  subject: "actual",
  expectedValue: "expected",
  expected_value: "expected",
  actualValue: "actual",
  actual_value: "actual",
  assertionType: "operator",
  assertion_type: "operator",
  comparator: "operator",
};

/** camelCase → snake_case + planner aliases on agent.create_session. */
const AGENT_FIELD_ALIASES: Record<string, string> = {
  useAgentApi: "use_agent_api",
  plannerId: "planner_id",
  plannerDefinitionId: "planner_id",
  planner_definition_id: "planner_id",
  plannerVersionId: "planner_id",
  planner_version_id: "planner_id",
};

/** Field aliases for scoring evaluators (e.g. text_alignment). */
const SCORING_FIELD_ALIASES: Record<string, string> = {
  actual: "generated_output",
  expected: "reference_answer",
  actual_value: "generated_output",
  expected_value: "reference_answer",
  actual_output: "generated_output",
  expected_output: "reference_answer",
  response: "generated_output",
  ground_truth: "reference_answer",
};

/** Field aliases for assertion evaluators (e.g. string_assertion). */
const ASSERTION_FIELD_ALIASES: Record<string, string> = {
  actual_value: "actual",
  expected_value: "expected",
  generated_output: "actual",
  reference_answer: "expected",
  actual_output: "actual",
  expected_output: "expected",
  response: "actual",
  ground_truth: "expected",
};

/**
 * MCP-shorthand `field:"stepId.path"` to canonical JSONPath.
 * `field: "gs.planner_state.topic"` →
 * `actual: "{gs.response.planner_response.lastExecution.topic}"`.
 */
const MCP_FIELD_MAP: Record<string, string> = {
  "planner_state.topic": "response.planner_response.lastExecution.topic",
  "planner_state.invokedActions": "response.planner_response.lastExecution.invokedActions",
  "planner_state.actionsSequence": "response.planner_response.lastExecution.invokedActions",
  response: "response",
  "response.messages": "response",
};

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

/** Apply a `wrong → canonical` map; do not overwrite an existing canonical field. */
function applyAliases(step: EvalStep, aliases: Record<string, string>): EvalStep {
  const out: Record<string, unknown> = { ...step };
  for (const [src, dst] of Object.entries(aliases)) {
    if (src in out) {
      if (!(dst in out)) out[dst] = out[src];
      delete out[src];
    }
  }
  return out as EvalStep;
}

// -------------------------------------------------------------------------------------------------
// Pass 1 — MCP shorthand
// -------------------------------------------------------------------------------------------------

/**
 * Convert MCP shorthand to raw API form.
 *
 *   { type: "evaluator", evaluator_type: "string_assertion", field: "sm.response", ... }
 * → { type: "evaluator.string_assertion", actual: "{sm.response}", id: "eval_0", ... }
 */
export function normalizeMcpShorthand(steps: EvalStep[]): EvalStep[] {
  let evalCounter = 0;
  return steps.map((step) => {
    const evaluatorType = step["evaluator_type"] as string | undefined;
    if (step.type !== "evaluator" || !evaluatorType) return step;

    const out: Record<string, unknown> = { ...step };
    out.type = `evaluator.${evaluatorType}`;
    delete out.evaluator_type;

    if ("field" in out && !("actual" in out)) {
      const fieldValue = out.field as string;
      const dotIdx = fieldValue.indexOf(".");
      if (dotIdx > 0) {
        const stepId = fieldValue.substring(0, dotIdx);
        const fieldPath = fieldValue.substring(dotIdx + 1);
        const mappedPath = MCP_FIELD_MAP[fieldPath] ?? fieldPath;
        out.actual = `{${stepId}.${mappedPath}}`;
      } else {
        out.actual = fieldValue;
      }
    }
    if ("field" in out) delete out.field;

    if (!out.id || out.id === "") {
      out.id = `eval_${evalCounter++}`;
    }

    return out as EvalStep;
  });
}

// -------------------------------------------------------------------------------------------------
// Pass 2 — Auto-correct typo'd field names
// -------------------------------------------------------------------------------------------------

/**
 * Map known wrong field names to canonical ones on agent.* and evaluator.*
 * steps. Idempotent — safe to call twice.
 */
export function autoCorrectFields(steps: EvalStep[]): EvalStep[] {
  return steps.map((step) => {
    const stepType = step.type ?? "";
    if (stepType.startsWith("agent.")) return applyAliases(step, AGENT_CORRECTIONS);
    if (stepType.startsWith("evaluator.")) return applyAliases(step, EVALUATOR_CORRECTIONS);
    return step;
  });
}

// -------------------------------------------------------------------------------------------------
// Pass 3 — camelCase / planner aliases on agent.create_session
// -------------------------------------------------------------------------------------------------

export function normalizeCamelCase(steps: EvalStep[]): EvalStep[] {
  return steps.map((step) => {
    if (step.type !== "agent.create_session") return step;
    return applyAliases(step, AGENT_FIELD_ALIASES);
  });
}

// -------------------------------------------------------------------------------------------------
// Pass 4 — Evaluator field aliases + operator lowercase + metric_name inject
// -------------------------------------------------------------------------------------------------

function normalizeScoringEvaluator(out: Record<string, unknown>, evalType: string): void {
  for (const [src, dst] of Object.entries(SCORING_FIELD_ALIASES)) {
    if (src in out) {
      if (!(dst in out)) out[dst] = out[src];
      delete out[src];
    }
  }
  // Inject default metric_name if missing, or upgrade short form to canonical.
  const defaultMetric = DEFAULT_METRIC_NAMES[evalType];
  if (!("metric_name" in out)) {
    if (defaultMetric) out.metric_name = defaultMetric;
  } else if (out.metric_name === evalType.split(".")[1] && defaultMetric) {
    out.metric_name = defaultMetric;
  }
}

function normalizeAssertionEvaluator(out: Record<string, unknown>, evalType: string): void {
  for (const [src, dst] of Object.entries(ASSERTION_FIELD_ALIASES)) {
    if (src in out) {
      if (!(dst in out)) out[dst] = out[src];
      delete out[src];
    }
  }
  if (typeof out.operator === "string") out.operator = out.operator.toLowerCase();
  if (!("metric_name" in out)) out.metric_name = evalType.split(".")[1];
}

export function normalizeEvaluatorFields(steps: EvalStep[]): EvalStep[] {
  return steps.map((step) => {
    const evalType = step.type ?? "";
    if (!evalType.startsWith("evaluator.")) return step;

    const out: Record<string, unknown> = { ...step };
    if (SCORING_EVALUATORS.has(evalType)) {
      normalizeScoringEvaluator(out, evalType);
    } else if (ASSERTION_EVALUATORS.has(evalType)) {
      normalizeAssertionEvaluator(out, evalType);
    }
    // Unknown evaluator types: leave alone. Don't inject metric_name —
    // bot_response_rating, planner_topic_assertion, etc. don't take one.
    return out as EvalStep;
  });
}

// -------------------------------------------------------------------------------------------------
// Pass 5 — `{stepId.field}` → `$.outputs[N].field`
// -------------------------------------------------------------------------------------------------

/**
 * Build a step-id → output-index map from non-evaluator steps, then rewrite
 * any `{stepId.field}` occurrence in string values (flat or in objects /
 * arrays) to JSONPath. Unknown step-ids are left as-is so the API surfaces
 * a clear error.
 */
export function convertShorthandRefs(steps: EvalStep[]): EvalStep[] {
  const stepIdToIdx: Record<string, number> = {};
  let outputIdx = 0;
  for (const step of steps) {
    if (step.id && !(step.type ?? "").startsWith("evaluator.")) {
      stepIdToIdx[step.id] = outputIdx++;
    }
  }

  const refPattern = /\{([^}]+)\}/g;
  const replaceValue = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    return value.replace(refPattern, (match, ref: string) => {
      const dotIdx = ref.indexOf(".");
      if (dotIdx < 0) return match;
      const sid = ref.substring(0, dotIdx);
      let field = ref.substring(dotIdx + 1);
      if (!(sid in stepIdToIdx)) return match;
      const idx = stepIdToIdx[sid];
      // Normalize legacy `response.messages` → flat `response`.
      if (field.startsWith("response.messages")) field = "response";
      return `$.outputs[${idx}].${field}`;
    });
  };

  return steps.map((step) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(step)) {
      if (typeof v === "string") {
        out[k] = replaceValue(v);
      } else if (Array.isArray(v)) {
        out[k] = v.map((item) => (typeof item === "string" ? replaceValue(item) : item));
      } else if (v !== null && typeof v === "object") {
        const nested: Record<string, unknown> = {};
        for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
          nested[nk] = typeof nv === "string" ? replaceValue(nv) : nv;
        }
        out[k] = nested;
      } else {
        out[k] = v;
      }
    }
    return out as EvalStep;
  });
}

// -------------------------------------------------------------------------------------------------
// Pass 6 — Inject defaults
// -------------------------------------------------------------------------------------------------

/**
 * Set `use_agent_api: true` on `agent.create_session` when neither
 * `use_agent_api` nor `planner_id` is specified. Mirrors the upstream
 * default — without it the API uses a different (slower) execution path.
 */
export function injectDefaults(steps: EvalStep[]): EvalStep[] {
  return steps.map((step) => {
    if (step.type !== "agent.create_session") return step;
    if ("use_agent_api" in step || "planner_id" in step) return step;
    return { ...step, use_agent_api: true };
  });
}

// -------------------------------------------------------------------------------------------------
// Composition — what the orchestrator calls
// -------------------------------------------------------------------------------------------------

export function normalizeSpec(spec: EvalSpec): EvalSpec {
  return {
    ...spec,
    tests: (spec.tests ?? []).map((test) => {
      let steps = test.steps ?? [];
      steps = normalizeMcpShorthand(steps);
      steps = autoCorrectFields(steps);
      steps = normalizeCamelCase(steps);
      steps = normalizeEvaluatorFields(steps);
      steps = convertShorthandRefs(steps);
      steps = injectDefaults(steps);
      // Note: NO stripUnrecognizedFields — preserves context_variables on
      // agent.send_message (mutable-seed workaround).
      return { ...test, steps };
    }),
  };
}
