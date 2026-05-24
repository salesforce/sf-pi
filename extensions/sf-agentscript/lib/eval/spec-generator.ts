/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate a starter eval-API JSON spec from a `.agent` file's structure.
 *
 * Replaces the hand-written `build_suite.py` workflow that was the entry
 * point for most regression suites. The spec generator is deliberately
 * conservative: it emits a small, runnable spec that exercises subagent
 * routing, headline actions, a guardrail, and a curated safety-probe
 * block, all wired to `$active_*` placeholders so the runner resolves
 * the live BotVersion at run time.
 *
 * What the generator does NOT do:
 *  - It does not invent scenario-specific utterances. It synthesizes one
 *    utterance per non-start subagent from the description, plus one
 *    headline action probe per subagent. Multi-turn scenarios are out of
 *    scope for v1 — those are the regression suite the dev grows by hand
 *    after running the generated spec a few times.
 *  - It does not invent context_variables. Callers pass a default seed
 *    block; if absent, no seeds are emitted.
 *
 * Layout per generated test:
 *   [ create_session,
 *     send_message,
 *     get_state,
 *     evaluator.string_assertion (topic),
 *     evaluator.bot_response_rating ]
 *
 * IDs are stable across re-runs so a re-generation diff stays small. The
 * convention is `<kind>_<slug>` (e.g. `subagent_billing`, `action_lookup`,
 * `safety_prompt_injection_ignore`).
 */

import type { ComponentSummary, InspectResult } from "../inspect.ts";
import type { EvalSpec, EvalStep, EvalTest } from "./types.ts";
import { GUARDRAIL_PROBE, SAFETY_PROBES, type SafetyProbe } from "./safety-probes.ts";

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

export interface ContextVariableSeed {
  name: string;
  /** SFAP variable type. Default 'Text'. */
  type?: string;
  value: string | number | boolean;
}

export interface GenerateSpecOptions {
  /** Inspect result (use lib/inspect.ts → inspectFile). Required. */
  inspect: InspectResult;
  /**
   * Default context_variables attached to every generated send_message.
   * Mirrors the shape used by `agentscript_eval` and `agentscript_preview`.
   * Empty/undefined → no seeds.
   */
  contextVariables?: ContextVariableSeed[];
  /**
   * Include subagent routing tests. Default true. One test per non-start
   * subagent, asserting the routing topic matches.
   */
  includeSubagentTests?: boolean;
  /**
   * Include action invocation tests. Default true. One test per top-level
   * action whose target looks like a real Flow/Apex (i.e. has a `target:`).
   * The probe is "use the {action description}" — the assertion is a
   * bot_response_rating only (action invocation requires a planner trace
   * which we don't get back from the eval API in flat form).
   */
  includeActionTests?: boolean;
  /**
   * Include the curated guardrail probe (one off-topic utterance).
   * Default true.
   */
  includeGuardrail?: boolean;
  /**
   * Include the curated safety/adversarial probe set. Default true.
   * Set false when generating a fast smoke spec for CI.
   */
  includeSafetyProbes?: boolean;
  /**
   * Cap the number of subagent + action tests to keep the generated
   * spec under the eval API's practical limits. Default 25 — leaves
   * headroom for the safety/guardrail rows.
   */
  maxFunctionalTests?: number;
}

export interface GenerateSpecResult {
  spec: EvalSpec;
  summary: GeneratedSpecSummary;
}

export interface GeneratedSpecSummary {
  total_tests: number;
  /** Backward-compatible count for explicit subagent blocks. */
  subagent_tests: number;
  /** Routing tests generated from deprecated/legacy topic blocks. */
  topic_tests: number;
  /** Total routing tests across topic + subagent blocks. */
  routing_tests: number;
  action_tests: number;
  guardrail_tests: number;
  safety_tests: number;
  /** Names of subagents that were skipped (no description, or start_agent). */
  skipped_subagents: string[];
  /** Names of actions that were skipped (no target, or no description). */
  skipped_actions: string[];
}

export function generateSpec(opts: GenerateSpecOptions): GenerateSpecResult {
  if (!opts.inspect.ok || !opts.inspect.components) {
    throw new Error(
      "Cannot generate spec: inspect result is not OK. " +
        "Run agentscript_authoring compile/check first and fix severity-1 errors before generating.",
    );
  }
  const components = opts.inspect.components;
  const ctx = normalizeSeeds(opts.contextVariables);

  const includeSubagent = opts.includeSubagentTests ?? true;
  const includeAction = opts.includeActionTests ?? true;
  const includeGuardrail = opts.includeGuardrail ?? true;
  const includeSafety = opts.includeSafetyProbes ?? true;
  const maxFunctional = opts.maxFunctionalTests ?? 25;

  const tests: EvalTest[] = [];
  const skippedSubagents: string[] = [];
  const skippedActions: string[] = [];

  let subagentCount = 0;
  let topicCount = 0;
  let actionCount = 0;

  // Subagent routing tests — one per non-start subagent.
  if (includeSubagent) {
    for (const sa of components.subagents ?? []) {
      if (subagentCount + topicCount + actionCount >= maxFunctional) break;
      const slug = slugify(sa.name);
      // start_agent is the dispatcher — testing routing TO it is meaningless.
      if (slug === "start_agent" || slug === "start") {
        skippedSubagents.push(sa.name);
        continue;
      }
      const utterance = synthesizeUtterance(sa);
      if (!utterance) {
        skippedSubagents.push(sa.name);
        continue;
      }
      tests.push(buildRoutingTest("subagent", sa.name, slug, utterance, ctx));
      subagentCount++;
    }
  }

  // Topic routing tests — legacy examples and old syntax still use topic
  // blocks. Treat them as routable units so generated specs contain
  // functional rows instead of only guardrail/safety tests.
  if (includeSubagent) {
    for (const topic of components.topics ?? []) {
      if (subagentCount + topicCount + actionCount >= maxFunctional) break;
      const slug = slugify(topic.name);
      const utterance = synthesizeUtterance(topic);
      if (!utterance) {
        skippedSubagents.push(topic.name);
        continue;
      }
      tests.push(buildRoutingTest("topic", topic.name, slug, utterance, ctx));
      topicCount++;
    }
  }

  // Action invocation tests — one per action with a target.
  if (includeAction) {
    for (const a of components.actions ?? []) {
      if (subagentCount + topicCount + actionCount >= maxFunctional) break;
      if (!a.target) {
        skippedActions.push(a.name);
        continue;
      }
      const utterance = synthesizeActionUtterance(a);
      if (!utterance) {
        skippedActions.push(a.name);
        continue;
      }
      tests.push(buildActionTest(a.name, slugify(a.name), utterance, ctx));
      actionCount++;
    }
  }

  // Guardrail probe.
  let guardrailCount = 0;
  if (includeGuardrail) {
    tests.push(buildSafetyTest(GUARDRAIL_PROBE, ctx));
    guardrailCount = 1;
  }

  // Safety probes.
  let safetyCount = 0;
  if (includeSafety) {
    for (const probe of SAFETY_PROBES) {
      tests.push(buildSafetyTest(probe, ctx));
      safetyCount++;
    }
  }

  return {
    spec: { tests },
    summary: {
      total_tests: tests.length,
      subagent_tests: subagentCount,
      topic_tests: topicCount,
      routing_tests: subagentCount + topicCount,
      action_tests: actionCount,
      guardrail_tests: guardrailCount,
      safety_tests: safetyCount,
      skipped_subagents: skippedSubagents,
      skipped_actions: skippedActions,
    },
  };
}

// -------------------------------------------------------------------------------------------------
// Test builders
// -------------------------------------------------------------------------------------------------

function buildRoutingTest(
  kind: "subagent" | "topic",
  targetName: string,
  slug: string,
  utterance: string,
  ctx: WireContextVariable[],
): EvalTest {
  const steps: EvalStep[] = [
    sessionStep(),
    sendMessageStep(`turn1`, utterance, ctx),
    getStateStep(`state1`),
  ];

  // Subagent routing is the modern shape and has a stable planner topic to
  // assert. Legacy topic blocks often sit behind authentication/start-router
  // gates; exact topic assertions make starter specs fail even when the
  // response correctly asks for prerequisite information. Keep topic probes
  // as LLM-judged smoke rows.
  if (kind === "subagent") {
    steps.push(
      stringAssertionStep({
        id: `eval_topic_${slug}`,
        actualPath: `{state1.response.planner_response.lastExecution.topic}`,
        expected: targetName,
        operator: "equals",
      }),
    );
  }

  steps.push(
    botResponseRatingStep({
      id: `eval_response_${slug}`,
      utterance,
      actualPath: `{state1.response.planner_response.lastExecution.message.message}`,
      rubric:
        `The agent's response should be relevant to the user's request to "${escapeForRubric(utterance)}". ` +
        `It should engage the ${kind}, ask for prerequisite information if needed, and stay on the supported domain.`,
    }),
  );

  return {
    id: `${kind}_${slug}`,
    steps,
  };
}

function buildActionTest(
  actionName: string,
  slug: string,
  utterance: string,
  ctx: WireContextVariable[],
): EvalTest {
  return {
    id: `action_${slug}`,
    steps: [
      sessionStep(),
      sendMessageStep(`turn1`, utterance, ctx),
      getStateStep(`state1`),
      // Starter action probes are intentionally LLM-judged only. Many actions
      // require slot-filled inputs; a good first-turn response asks for those
      // values rather than invoking the target immediately. Hand-written specs
      // can add exact invokedActions assertions once they provide all inputs.
      botResponseRatingStep({
        id: `eval_response_action_${slug}`,
        utterance,
        actualPath: `{state1.response.planner_response.lastExecution.message.message}`,
        rubric:
          `The agent should attempt the "${actionName}" action in response to the user's request. ` +
          `If the action requires inputs the user hasn't provided, the agent should ask for them rather than refuse.`,
      }),
    ],
  };
}

function buildSafetyTest(probe: SafetyProbe, ctx: WireContextVariable[]): EvalTest {
  // Safety probes need a get_state step so the bot_response_rating evaluator
  // has a path to read the agent reply from. Without it, the eval API
  // can't resolve `{state1.response...}` and scores 0 with "bot response
  // not provided".
  return {
    id: probe.id,
    steps: [
      sessionStep(),
      sendMessageStep(`turn1`, probe.utterance, ctx),
      getStateStep(`state1`),
      botResponseRatingStep({
        id: `eval_safety_${probe.id}`,
        utterance: probe.utterance,
        actualPath: `{state1.response.planner_response.lastExecution.message.message}`,
        rubric: probe.expected_behavior,
      }),
    ],
  };
}

// -------------------------------------------------------------------------------------------------
// Step builders (kept tiny — most fields are constant for our generator)
// -------------------------------------------------------------------------------------------------

function sessionStep(): EvalStep {
  return {
    type: "agent.create_session",
    id: "session",
    planner_id: "$active_planner_id",
    setupSessionContext: {
      tags: {
        botId: "$active_bot_id",
        botVersionId: "$active_bot_version_id",
      },
    },
  };
}

function sendMessageStep(id: string, utterance: string, ctx: WireContextVariable[]): EvalStep {
  const step: EvalStep = {
    type: "agent.send_message",
    id,
    session_id: "$.outputs[0].session_id",
    utterance,
  };
  if (ctx.length > 0) step.context_variables = ctx;
  return step;
}

function getStateStep(id: string): EvalStep {
  return {
    type: "agent.get_state",
    id,
    session_id: "$.outputs[0].session_id",
  };
}

function stringAssertionStep(o: {
  id: string;
  actualPath: string;
  expected: string;
  operator: "equals" | "contains";
}): EvalStep {
  return {
    type: "evaluator.string_assertion",
    id: o.id,
    actual: o.actualPath,
    expected: o.expected,
    operator: o.operator,
  };
}

/**
 * `evaluator.bot_response_rating` is the LLM-as-judge evaluator the eval
 * API uses for free-text quality assertions. The wire shape requires:
 *
 *   - `utterance` — the user's input the agent was responding to
 *   - `actual` — JSONPath (or our shorthand `{stateId.response.planner_response.lastExecution.message.message}`)
 *     pointing at the agent's reply text. The naive `{turnId.response}`
 *     path resolves to either an empty string or the wrong shape
 *     depending on the streaming-capabilities config; the LLM judge
 *     reports "bot response is not provided" and scores 0.
 *   - `expected` — the rubric describing what a good response looks like
 *   - `threshold` — the minimum score (1–5 scale; 3 = acceptable)
 *
 * `operator` is NOT required — the API defaults to greater_than_or_equal.
 *
 * History: earlier versions of this generator emitted only `id + expected`
 * (HTTP 422) and then `{turn1.response}` (HTTP 200 but always 0 score).
 * Verified end-to-end against Example_Service_Assistant: with the
 * lastExecution.message.message path the LLM judge returns a real score
 * (e.g. 5.0 "polite and offers transfer to a specialist").
 */
function botResponseRatingStep(o: {
  id: string;
  utterance: string;
  actualPath: string;
  rubric: string;
}): EvalStep {
  return {
    type: "evaluator.bot_response_rating",
    id: o.id,
    utterance: o.utterance,
    actual: o.actualPath,
    expected: o.rubric,
    threshold: 3,
  };
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

interface WireContextVariable {
  name: string;
  type: string;
  value: string;
}

function normalizeSeeds(vars: ContextVariableSeed[] | undefined): WireContextVariable[] {
  if (!vars || vars.length === 0) return [];
  return vars.map((v) => ({
    name: v.name,
    type: v.type ?? "Text",
    value: typeof v.value === "string" ? v.value : String(v.value),
  }));
}

/**
 * Synthesize a route-targeting user utterance from a subagent name +
 * description. Utility-transition agents need stronger prompts than
 * "I have a question about ..."; ask for the named path directly so the
 * planner has a clear routing intent.
 *
 * Falls back to the subagent name when no description is present.
 * Returns undefined when neither yields anything useful (signals to the
 * caller to skip this subagent).
 */
function synthesizeUtterance(sa: ComponentSummary): string | undefined {
  const human = humanize(sa.name);
  if (!human) return undefined;
  if (sa.description) {
    const firstSentence = sa.description.split(/[.!?](\s|$)/)[0]?.trim();
    if (firstSentence) {
      return `Please route me to the ${human} path now. I want to ${firstSentence.toLowerCase()}.`;
    }
  }
  return `Please route me to the ${human} path now.`;
}

function synthesizeActionUtterance(a: ComponentSummary): string | undefined {
  const human = humanize(a.name);
  if (a.description) {
    const firstSentence = a.description.split(/[.!?](\s|$)/)[0]?.trim();
    if (firstSentence) return `Please ${firstSentence.toLowerCase()}`;
  }
  if (human) return `Please ${human.toLowerCase()}`;
  return undefined;
}

/**
 * snake_case / camelCase → "human readable". Used so generated test ids
 * look reasonable in reports without forcing the agent author to write a
 * second description field.
 */
function humanize(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

function slugify(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/**
 * The bot_response_rating rubric is sent as a single quoted string in the
 * eval API payload; backslash + double-quote in the synthesized utterance
 * could land badly when we drop it back into the rubric. Normalize to
 * single quotes.
 */
function escapeForRubric(s: string): string {
  return s.replace(/"/g, "'").replace(/\\/g, "");
}
