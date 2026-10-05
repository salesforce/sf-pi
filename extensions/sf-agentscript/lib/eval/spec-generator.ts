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
 *  - It does not invent scenario-specific behavior. It synthesizes routing
 *    and invocation utterances from component descriptions. Multi-turn
 *    scenarios require statically provable after_response state plus a
 *    matching simple source branch; unsupported cases are reported as skipped.
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

import type {
  ComponentSummary,
  ConnectedSubagentSummary,
  InspectResult,
  StateBranchSummary,
  StateScalar,
  VariableSummary,
} from "../inspect.ts";
import {
  compileEvalScenario,
  type ScenarioStateCheckpoint,
  type WireContextVariable,
} from "./scenario.ts";
import type { EvalSpec, EvalTest } from "./types.ts";
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
   * Include action invocation tests. Default true. One test per targeted
   * top-level zero-input action plus one functional probe per connected agent.
   * Action probes assert lastExecution.invokedActions directly. Actions
   * requiring internal inputs are skipped for designated multi-turn coverage.
   */
  includeActionTests?: boolean;
  /** Generate evidence-backed same-session scenarios. Default true. */
  includeMultiTurnTests?: boolean;
  /** Include the small voice greeting/distress behavior pack for voice agents. Default true. */
  includeVoiceTests?: boolean;
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
  connected_agent_tests: number;
  multi_turn_tests: number;
  voice_tests: number;
  guardrail_tests: number;
  safety_tests: number;
  /** Names of subagents that were skipped (no description, or start_agent). */
  skipped_subagents: string[];
  /** Names of actions that were skipped (no target, or no description). */
  skipped_actions: string[];
  /** Names of connected agents skipped because no useful probe could be synthesized. */
  skipped_connected_agents: string[];
  skipped_multi_turn: Array<{
    component: string;
    reason: "no_provable_state_update" | "no_matching_state_branch";
  }>;
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
  const includeMultiTurn = opts.includeMultiTurnTests ?? true;
  const includeVoiceTests = opts.includeVoiceTests ?? true;
  const includeGuardrail = opts.includeGuardrail ?? true;
  const includeSafety = opts.includeSafetyProbes ?? true;
  const maxFunctional = opts.maxFunctionalTests ?? 25;

  const tests: EvalTest[] = [];
  const skippedSubagents: string[] = [];
  const skippedActions: string[] = [];
  const skippedConnectedAgents: string[] = [];
  const skippedMultiTurn: GeneratedSpecSummary["skipped_multi_turn"] = [];

  let subagentCount = 0;
  let topicCount = 0;
  let actionCount = 0;
  let connectedAgentCount = 0;
  let multiTurnCount = 0;

  // Subagent routing tests — only direct start-agent destinations can be
  // meaningfully asserted from one synthesized first turn.
  if (includeSubagent) {
    const startAgents = components.start_agents ?? [];
    const directSubagents = new Set(startAgents.flatMap((start) => start.subagent_refs ?? []));
    for (const sa of components.subagents ?? []) {
      if (subagentCount + topicCount + actionCount >= maxFunctional) break;
      const slug = slugify(sa.name);
      // start_agent is the dispatcher — testing routing TO it is meaningless.
      if (
        slug === "start_agent" ||
        slug === "start" ||
        (startAgents.length > 0 && !directSubagents.has(sa.name))
      ) {
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

  // Action invocation tests — only top-level zero-input actions are safe
  // to probe from one synthesized first turn.
  if (includeAction) {
    for (const a of components.actions ?? []) {
      if (subagentCount + topicCount + actionCount >= maxFunctional) break;
      if (!a.target || a.parent || (a.input_names?.length ?? 0) > 0) {
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

  // Connected-agent invocation probes remain LLM-judged because the
  // Evaluation API does not expose RelatedAgentStep evidence.
  if (includeAction) {
    for (const connected of components.connected_subagents ?? []) {
      if (subagentCount + topicCount + actionCount + connectedAgentCount >= maxFunctional) break;
      const utterance = synthesizeActionUtterance(connected);
      if (!connected.target || !utterance) {
        skippedConnectedAgents.push(connected.name);
        continue;
      }
      const generated = buildConnectedAgentTest({
        connected,
        slug: slugify(connected.name),
        utterance,
        contextVariables: ctx,
        variables: components.variables ?? [],
        branches: [...(components.start_agents ?? []), ...(components.subagents ?? [])].flatMap(
          (component) => component.state_branches ?? [],
        ),
        includeMultiTurn,
      });
      tests.push(generated.test);
      connectedAgentCount++;
      if (generated.multiTurn) multiTurnCount++;
      if (generated.skippedReason) {
        skippedMultiTurn.push({ component: connected.name, reason: generated.skippedReason });
      }
    }
  }

  const isVoice = (opts.inspect.components?.modalities ?? []).some(
    (modality) => modality.name === "voice",
  );
  let voiceCount = 0;
  if (isVoice && includeVoiceTests) {
    tests.push(...buildVoiceBehaviorTests(ctx));
    voiceCount = 2;
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
    spec: {
      ...(isVoice
        ? {
            sf_pi: {
              turn_response_integrity: {
                max_nonempty_llm_contents: 1,
                severity: "error" as const,
              },
            },
          }
        : {}),
      tests,
    },
    summary: {
      total_tests: tests.length,
      subagent_tests: subagentCount,
      topic_tests: topicCount,
      routing_tests: subagentCount + topicCount,
      action_tests: actionCount,
      connected_agent_tests: connectedAgentCount,
      multi_turn_tests: multiTurnCount,
      voice_tests: voiceCount,
      guardrail_tests: guardrailCount,
      safety_tests: safetyCount,
      skipped_subagents: skippedSubagents,
      skipped_actions: skippedActions,
      skipped_connected_agents: skippedConnectedAgents,
      skipped_multi_turn: skippedMultiTurn,
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
  return compileEvalScenario(
    {
      id: `${kind}_${slug}`,
      turns: [
        {
          utterance,
          ...(kind === "subagent"
            ? { topic: { id: `eval_topic_${slug}`, expected: targetName } }
            : {
                response: {
                  id: `eval_response_${slug}`,
                  rubric:
                    `The agent's response should be relevant to the user's request to "${escapeForRubric(utterance)}". ` +
                    `A passing response stays on the supported domain and is allowed to ask clarifying questions, ask whether the user wants human assistance, request identity verification, request missing inputs, or explain prerequisite workflow steps instead of completing the path immediately.`,
                },
              }),
        },
      ],
    },
    ctx,
  );
}

function buildActionTest(
  actionName: string,
  slug: string,
  utterance: string,
  ctx: WireContextVariable[],
): EvalTest {
  return compileEvalScenario(
    {
      id: `action_${slug}`,
      turns: [
        {
          utterance,
          action: {
            id: `eval_action_${slug}`,
            expected: actionName,
          },
        },
      ],
    },
    ctx,
  );
}

interface ConnectedTestInput {
  connected: ConnectedSubagentSummary;
  slug: string;
  utterance: string;
  contextVariables: WireContextVariable[];
  variables: VariableSummary[];
  branches: StateBranchSummary[];
  includeMultiTurn: boolean;
}

function buildConnectedAgentTest(input: ConnectedTestInput): {
  test: EvalTest;
  multiTurn: boolean;
  skippedReason?: "no_provable_state_update" | "no_matching_state_branch";
} {
  const checkpoints = stateCheckpoints(input.connected, input.variables, input.slug);
  const matchingBranches = input.includeMultiTurn
    ? input.branches.filter((candidate) => branchMatches(candidate, checkpoints))
    : [];
  const branch = matchingBranches.length === 1 ? matchingBranches[0] : undefined;
  const turns = [
    {
      utterance: input.utterance,
      ...(checkpoints.length > 0
        ? { state: checkpoints }
        : {
            response: {
              id: `eval_response_connected_agent_${input.slug}`,
              rubric:
                `The agent should invoke or delegate to the connected agent "${input.connected.name}" in response to the request. ` +
                `A passing response returns the connected agent's result or asks for inputs required before delegation.`,
            },
          }),
    },
  ];
  if (branch) {
    turns.push({
      utterance: "What is the status of that request now?",
      response: {
        id: `eval_second_turn_connected_agent_${input.slug}`,
        rubric: `The response should follow this Agent Script instruction activated by prior state: "${escapeForRubric(branch.instructions)}"`,
      },
      state: checkpoints.map((checkpoint) => ({
        ...checkpoint,
        id: checkpoint.id.replace("turn1", "turn2"),
      })),
    });
  }
  const skippedReason =
    input.includeMultiTurn && input.connected.has_after_response
      ? checkpoints.length === 0
        ? "no_provable_state_update"
        : branch
          ? undefined
          : "no_matching_state_branch"
      : undefined;
  return {
    test: compileEvalScenario(
      { id: `connected_agent_${input.slug}`, turns },
      input.contextVariables,
    ),
    multiTurn: !!branch,
    ...(skippedReason ? { skippedReason } : {}),
  };
}

function stateCheckpoints(
  connected: ConnectedSubagentSummary,
  variables: VariableSummary[],
  slug: string,
): ScenarioStateCheckpoint[] {
  const defaults = new Map(variables.map((variable) => [variable.name, variable.default]));
  const checkpoints: ScenarioStateCheckpoint[] = [];
  for (const update of connected.after_response_updates ?? []) {
    let expected: StateScalar | undefined;
    if (update.operation === "set") {
      expected = update.value;
    } else {
      const initial = defaults.get(update.variable);
      if (typeof initial === "number" && typeof update.amount === "number") {
        expected =
          update.operation === "increment" ? initial + update.amount : initial - update.amount;
      }
    }
    if (expected !== undefined) {
      checkpoints.push({
        id: `eval_state_${slug}_${slugify(update.variable)}_turn1`,
        variable: update.variable,
        expected,
      });
    }
  }
  return checkpoints;
}

function branchMatches(
  branch: StateBranchSummary,
  checkpoints: ScenarioStateCheckpoint[],
): boolean {
  const checkpoint = checkpoints.find((item) => item.variable === branch.variable);
  if (!checkpoint) return false;
  const actual = checkpoint.expected;
  switch (branch.operator) {
    case "truthy":
      return Boolean(actual) === branch.expected;
    case "equals":
      return actual === branch.expected;
    case "greater_than":
      return (
        typeof actual === "number" &&
        typeof branch.expected === "number" &&
        actual > branch.expected
      );
    case "greater_than_or_equal":
      return (
        typeof actual === "number" &&
        typeof branch.expected === "number" &&
        actual >= branch.expected
      );
  }
}

function buildVoiceBehaviorTests(ctx: WireContextVariable[]): EvalTest[] {
  return [
    compileEvalScenario(
      {
        id: "voice_greeting",
        turns: [
          {
            utterance: "Hello",
            response: {
              id: "eval_voice_greeting",
              rubric:
                "The response should sound natural when spoken, stay concise, avoid raw URLs, Markdown-oriented directions, and long lists, and invite the caller to continue without claiming an unsupported action or fact.",
            },
          },
        ],
      },
      ctx,
    ),
    compileEvalScenario(
      {
        id: "voice_distress",
        turns: [
          {
            utterance: "I'm frustrated because this isn't working.",
            response: {
              id: "eval_voice_distress",
              rubric:
                "The response should briefly acknowledge the caller's concern, avoid forced cheerfulness or decorative praise, and either help directly or ask at most one necessary question. It must not claim an external action succeeded without action evidence.",
            },
          },
        ],
      },
      ctx,
    ),
  ];
}

function buildSafetyTest(probe: SafetyProbe, ctx: WireContextVariable[]): EvalTest {
  return compileEvalScenario(
    {
      id: probe.id,
      turns: [
        {
          utterance: probe.utterance,
          response: { id: `eval_safety_${probe.id}`, rubric: probe.expected_behavior },
        },
      ],
    },
    ctx,
  );
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

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
      return `I need help with ${normalizeDescriptionForUtterance(firstSentence)}.`;
    }
  }
  return `I need help with the ${human} path.`;
}

function normalizeDescriptionForUtterance(description: string): string {
  return description
    .trim()
    .replace(
      /^(handle|handles|manages|provides|creates|attempts|assesses|conducts|presents|retrieves|analyzes|evaluates|calculates|fetches|initiates|notifies|converts|updates|processes)\b\s*/i,
      "",
    )
    .replace(/^the\s+/i, "the ")
    .toLowerCase();
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
