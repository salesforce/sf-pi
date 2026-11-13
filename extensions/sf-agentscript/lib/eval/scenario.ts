/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic, transport-independent eval scenarios compiled to Eval API steps. */

import type { EvalStep, EvalTest } from "./types.ts";

export interface WireContextVariable {
  name: string;
  type: string;
  value: string;
}

export type ScenarioStateValue = string | number | boolean;

export interface ScenarioStateCheckpoint {
  id: string;
  variable: string;
  expected: ScenarioStateValue;
}

export interface ScenarioResponseExpectation {
  id: string;
  rubric: string;
}

export interface ScenarioTopicExpectation {
  id: string;
  expected: string;
}

export interface ScenarioActionExpectation {
  id: string;
  expected: string;
}

export interface EvalScenarioTurn {
  utterance: string;
  topic?: ScenarioTopicExpectation;
  action?: ScenarioActionExpectation;
  response?: ScenarioResponseExpectation;
  state?: ScenarioStateCheckpoint[];
}

export interface EvalScenario {
  id: string;
  turns: EvalScenarioTurn[];
}

/** JSONPath suffix that projects action names out of `lastExecution.invokedActions`. */
export const INVOKED_ACTION_NAMES = "[*][*].function.name";

export function compileEvalScenario(
  scenario: EvalScenario,
  contextVariables: WireContextVariable[] = [],
): EvalTest {
  const steps: EvalStep[] = [sessionStep()];
  scenario.turns.forEach((turn, index) => {
    const number = index + 1;
    const turnId = `turn${number}`;
    const stateId = `state${number}`;
    steps.push(sendMessageStep(turnId, turn.utterance, contextVariables));
    steps.push(getStateStep(stateId));
    if (turn.topic) {
      steps.push(
        stringAssertionStep({
          id: turn.topic.id,
          actualPath: `{${stateId}.response.planner_response.lastExecution.topic}`,
          expected: turn.topic.expected,
        }),
      );
    }
    if (turn.action) {
      // invokedActions is a list of lists of action objects
      // ({ function: { name, input, output }, … }). Project the names with a
      // JSONPath wildcard so the assertion compares action names, not objects.
      // `includes_items` passes when every expected name was invoked.
      steps.push({
        type: "evaluator.list_assertion",
        id: turn.action.id,
        actual: `{${stateId}.response.planner_response.lastExecution.invokedActions}${INVOKED_ACTION_NAMES}`,
        expected: [turn.action.expected],
        operator: "includes_items",
      });
    }
    if (turn.response) {
      steps.push({
        type: "evaluator.bot_response_rating",
        id: turn.response.id,
        utterance: turn.utterance,
        actual: `{${turnId}.response}`,
        expected: turn.response.rubric,
        threshold: 3,
      });
    }
    for (const checkpoint of turn.state ?? []) {
      steps.push(stateCheckpointStep(stateId, checkpoint));
    }
  });
  return { id: scenario.id, steps };
}

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

function sendMessageStep(
  id: string,
  utterance: string,
  contextVariables: WireContextVariable[],
): EvalStep {
  return {
    type: "agent.send_message",
    id,
    session_id: "$.outputs[0].session_id",
    utterance,
    ...(contextVariables.length > 0 ? { context_variables: contextVariables } : {}),
  };
}

function getStateStep(id: string): EvalStep {
  return {
    type: "agent.get_state",
    id,
    session_id: "$.outputs[0].session_id",
  };
}

function stringAssertionStep(input: {
  id: string;
  actualPath: string;
  expected: string;
}): EvalStep {
  return {
    type: "evaluator.string_assertion",
    id: input.id,
    actual: input.actualPath,
    expected: input.expected,
    operator: "equals",
  };
}

function stateCheckpointStep(stateId: string, checkpoint: ScenarioStateCheckpoint): EvalStep {
  const actual = `{${stateId}.response.planner_response.sessionContext.stateVariables.${checkpoint.variable}}`;
  if (typeof checkpoint.expected === "string") {
    return stringAssertionStep({
      id: checkpoint.id,
      actualPath: actual,
      expected: checkpoint.expected,
    });
  }
  return {
    type: "evaluator.numeric_assertion",
    id: checkpoint.id,
    actual,
    // The live evaluator treats booleans numerically (False=0, True=1).
    expected:
      typeof checkpoint.expected === "boolean"
        ? checkpoint.expected
          ? 1
          : 0
        : checkpoint.expected,
    operator: "equals",
  };
}
