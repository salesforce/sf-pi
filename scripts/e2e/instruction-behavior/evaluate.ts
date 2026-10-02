/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic observable-fact evaluator for opt-in Instruction Behavior runs. */
import {
  evaluateVisualResponseContract,
  type VisualResponseContract,
  type VisualResponseContractResult,
} from "../../../extensions/sf-brain/lib/visual-response.ts";
export interface InstructionBehaviorScenario {
  id: string;
  prompt: string;
  expected_first_tools: string[];
  forbidden_tools?: string[];
  response_contract?: VisualResponseContract;
}

export interface InstructionBehaviorObservation {
  calls: Array<{ tool: string; action?: string; context_only?: boolean }>;
  response_text?: string;
}

export interface InstructionBehaviorScenarioResult {
  id: string;
  status: "passed" | "failed";
  first_tool?: string;
  observed_tools: string[];
  expected_first_tools: string[];
  forbidden_tools_observed: string[];
  response_contract?: Omit<VisualResponseContractResult, "facts">;
  facts: string[];
}

export function evaluateInstructionBehaviorScenario(
  scenario: InstructionBehaviorScenario,
  observation: InstructionBehaviorObservation,
): InstructionBehaviorScenarioResult {
  const observedTools = observation.calls.map((call) => call.tool);
  const localContextTools = new Set(["read", "grep", "find", "ls", "bash"]);
  const hasFirstToolContract = scenario.expected_first_tools.length > 0;
  const expectedLocalTool = scenario.expected_first_tools.some((tool) =>
    localContextTools.has(tool),
  );
  let ignoredPrefixCount = 0;
  if (hasFirstToolContract && !expectedLocalTool) {
    while (ignoredPrefixCount < observation.calls.length) {
      const call = observation.calls[ignoredPrefixCount];
      if (!call || (!call.context_only && !localContextTools.has(call.tool))) break;
      ignoredPrefixCount += 1;
    }
  }
  const firstTool = observedTools[ignoredPrefixCount];
  const forbidden = new Set(scenario.forbidden_tools ?? []);
  const forbiddenObserved = [
    ...new Set(
      observation.calls
        .filter((call) => !call.context_only && forbidden.has(call.tool))
        .map((call) => call.tool),
    ),
  ];
  const firstMatched =
    !hasFirstToolContract || (!!firstTool && scenario.expected_first_tools.includes(firstTool));
  const facts: string[] = [];
  if (ignoredPrefixCount > 0) {
    facts.push(
      `Ignored ${ignoredPrefixCount} leading local context tool${ignoredPrefixCount === 1 ? "" : "s"} before capability routing.`,
    );
  }
  if (!hasFirstToolContract) facts.push("No first-tool contract was required.");
  else if (firstMatched) facts.push("First tool matched the expected capability owner.");
  else if (!firstTool) facts.push("No tool call was observed.");
  else facts.push(`First tool '${firstTool}' did not match the expected capability owner.`);
  if (forbiddenObserved.length > 0) {
    facts.push(`Forbidden tools were observed: ${forbiddenObserved.join(", ")}.`);
  }

  const responseContract = scenario.response_contract
    ? evaluateVisualResponseContract(scenario.response_contract, observation.response_text ?? "")
    : undefined;
  if (responseContract) facts.push(...responseContract.facts);

  return {
    id: scenario.id,
    status:
      firstMatched && forbiddenObserved.length === 0 && (responseContract?.passed ?? true)
        ? "passed"
        : "failed",
    ...(firstTool ? { first_tool: firstTool } : {}),
    observed_tools: observedTools,
    expected_first_tools: [...scenario.expected_first_tools],
    forbidden_tools_observed: forbiddenObserved,
    ...(responseContract
      ? {
          response_contract: {
            passed: responseContract.passed,
            diagram_count: responseContract.diagram_count,
            kinds: responseContract.kinds,
            renderable_count: responseContract.renderable_count,
          },
        }
      : {}),
    facts,
  };
}
