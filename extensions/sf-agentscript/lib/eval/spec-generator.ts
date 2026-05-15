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
  subagent_tests: number;
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
        "Run agentscript_compile first and fix severity-1 errors before generating.",
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
  let actionCount = 0;

  // Subagent routing tests — one per non-start subagent.
  if (includeSubagent) {
    for (const sa of components.subagents ?? []) {
      if (subagentCount + actionCount >= maxFunctional) break;
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
      tests.push(buildSubagentTest(sa.name, slug, utterance, ctx));
      subagentCount++;
    }
  }

  // Action invocation tests — one per top-level action with a target.
  if (includeAction) {
    for (const a of components.actions ?? []) {
      if (subagentCount + actionCount >= maxFunctional) break;
      // Skip inline actions (declared inside a topic/subagent body) — they
      // already get exercised through the subagent routing test.
      if (a.parent) continue;
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

function buildSubagentTest(
  subagentName: string,
  slug: string,
  utterance: string,
  ctx: WireContextVariable[],
): EvalTest {
  const expectedTopic = subagentName;
  return {
    id: `subagent_${slug}`,
    steps: [
      sessionStep(),
      sendMessageStep(`turn1`, utterance, ctx),
      getStateStep(`state1`),
      // Assert the planner routed to the expected subagent. The runtime
      // exposes the topic at lastExecution.topic on the state output.
      stringAssertionStep({
        id: `eval_topic_${slug}`,
        actualPath: `{state1.response.planner_response.lastExecution.topic}`,
        expected: expectedTopic,
        operator: "equals",
      }),
      botResponseRatingStep({
        id: `eval_response_${slug}`,
        rubric:
          `The agent's response should be relevant to the user's request to "${escapeForRubric(utterance)}". ` +
          `It should engage the topic, not refuse, and stay on the supported domain.`,
      }),
    ],
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
      // Action invocation is best-asserted via the planner's
      // invokedActions array. We use a string_assertion that the action
      // name appears in the comma-joined invokedActions value (the eval
      // API doesn't natively support array-contains on this path; we
      // assert against a substring of the raw JSON).
      stringAssertionStep({
        id: `eval_action_${slug}`,
        actualPath: `{state1.response.planner_response.lastExecution.invokedActions}`,
        expected: actionName,
        operator: "contains",
      }),
      botResponseRatingStep({
        id: `eval_response_action_${slug}`,
        rubric:
          `The agent should attempt the "${actionName}" action in response to the user's request. ` +
          `If the action requires inputs the user hasn't provided, the agent should ask for them rather than refuse.`,
      }),
    ],
  };
}

function buildSafetyTest(probe: SafetyProbe, ctx: WireContextVariable[]): EvalTest {
  return {
    id: probe.id,
    steps: [
      sessionStep(),
      sendMessageStep(`turn1`, probe.utterance, ctx),
      botResponseRatingStep({
        id: `eval_safety_${probe.id}`,
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

function botResponseRatingStep(o: { id: string; rubric: string }): EvalStep {
  return {
    type: "evaluator.bot_response_rating",
    id: o.id,
    expected: o.rubric,
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
 * Synthesize a user utterance from a subagent description. We use the
 * description verbatim as the user's intent — descriptions are typically
 * authored as "Handles billing inquiries: payment links, card updates,
 * financing." which reads cleanly as an utterance prefix.
 *
 * Falls back to the subagent name when no description is present.
 * Returns undefined when neither yields anything useful (signals to the
 * caller to skip this subagent).
 */
function synthesizeUtterance(sa: ComponentSummary): string | undefined {
  if (sa.description) {
    // Use the first sentence of the description so we don't dump three
    // paragraphs at the planner.
    const firstSentence = sa.description.split(/[.!?](\s|$)/)[0]?.trim();
    if (firstSentence) {
      return `I have a question about: ${firstSentence.toLowerCase()}`;
    }
  }
  // Fall back to a humanized subagent name.
  const human = humanize(sa.name);
  if (human) return `I need help with ${human.toLowerCase()}`;
  return undefined;
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
