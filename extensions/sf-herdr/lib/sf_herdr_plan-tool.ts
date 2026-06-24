/* SPDX-License-Identifier: Apache-2.0 */
/** Non-mutating Herdr lane planner tool. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import {
  HERDR_PLAN_INTENTS,
  WORKFLOW_KEYS,
  buildHerdrLanePlan,
  readSfHerdrPreferences,
  type HerdrExpectedDuration,
  type HerdrPlanIntent,
  type HerdrWorkflowKey,
} from "../../../lib/common/herdr-profile/store.ts";
import type { HerdrSignalState } from "./signal-state.ts";
import { getHerdrRuntimeStatus } from "./status.ts";

export const SF_HERDR_PLAN_TOOL_NAME = "sf_herdr_plan";

const WorkflowEnum = StringEnum(WORKFLOW_KEYS, {
  description:
    "Optional primary workflow. Omit to let sf-herdr infer from recent tool calls/results.",
});
const IntentEnum = StringEnum(HERDR_PLAN_INTENTS, {
  description: "Workflow intent to plan a Herdr lane for.",
});
const DurationEnum = StringEnum(["short", "long", "unknown"] as const, {
  description: "Expected duration of the lane work. Default unknown.",
});

export const SfHerdrPlanParams = Type.Object({
  intent: IntentEnum,
  primaryWorkflow: Type.Optional(WorkflowEnum),
  relatedWorkflows: Type.Optional(Type.Array(WorkflowEnum)),
  expectedDuration: Type.Optional(DurationEnum),
});

export interface SfHerdrPlanInput {
  intent: HerdrPlanIntent;
  primaryWorkflow?: HerdrWorkflowKey;
  relatedWorkflows?: HerdrWorkflowKey[];
  expectedDuration?: HerdrExpectedDuration;
}

export function registerSfHerdrPlanTool(pi: ExtensionAPI, signalState: HerdrSignalState): void {
  pi.registerTool({
    name: SF_HERDR_PLAN_TOOL_NAME,
    label: "SF Herdr Plan",
    description:
      "Plan a dynamic Herdr lane for Salesforce workflows. Non-mutating: returns discover/create/run/observe/cleanup guidance only.",
    promptSnippet:
      "Plan dynamic Herdr lanes without mutating panes; actual pane actions remain explicit herdr tool calls.",
    promptGuidelines: [
      "Use sf_herdr_plan before creating dynamic Herdr lanes for Salesforce workflow work.",
      "Do not treat the plan as execution: call herdr.list, pane_split, run, watch/read, and stop explicitly.",
      "Create fresh ephemeral split panes just in time for command-scoped jobs; never reuse old ephemeral panes.",
      "Use herdr.list for live alias collision detection and choose a short-id suffixed alias that has not already been used in the session.",
      "Avoid shrinking the main orchestrator pane below roughly half the tab; do not stack multiple splits directly off the orchestrator pane.",
      "The planner never generates shell commands; choose commands through the owning SF Pi extension or Salesforce workflow guidance.",
      "Stop/close fresh ephemeral lanes only after the Workflow Success Condition; preserve failures and timeouts for inspection and ask before cleanup.",
    ],
    parameters: SfHerdrPlanParams,
    async execute(_toolCallId, params) {
      const input = params as SfHerdrPlanInput;
      const inferred = signalState.infer();
      const primaryWorkflow = input.primaryWorkflow ?? inferred.primaryWorkflow;
      const relatedWorkflows = input.relatedWorkflows ?? inferred.relatedWorkflows;
      const plan = buildHerdrLanePlan(readSfHerdrPreferences(), {
        intent: input.intent,
        primaryWorkflow,
        relatedWorkflows,
        expectedDuration: input.expectedDuration,
        confidence: input.primaryWorkflow ? 1 : inferred.confidence,
        reason: input.primaryWorkflow
          ? `Workflow supplied by caller: ${input.primaryWorkflow}.`
          : inferred.reason,
      });
      const runtime = getHerdrRuntimeStatus();

      return {
        content: [{ type: "text", text: renderPlan(plan, runtime.inHerdrPane) }],
        details: { plan, herdrRuntime: runtime },
      };
    },
  });
}

type Plan = ReturnType<typeof buildHerdrLanePlan>;

function renderPlan(plan: Plan, inHerdrPane: boolean): string {
  return [
    "SF Herdr lane plan (non-mutating)",
    inHerdrPane
      ? undefined
      : "Advisory: Herdr pane environment not detected; use this plan only when the upstream herdr tool is active.",
    `Workflow: ${plan.workflow.primary} (${Math.round(plan.workflow.confidence * 100)}%)`,
    plan.workflow.related.length > 0 ? `Related: ${plan.workflow.related.join(", ")}` : undefined,
    `Reason: ${plan.workflow.reason}`,
    `Intent: ${plan.intent}`,
    `Lane: ${plan.lane.id} → base alias '${plan.lane.baseAlias}' (${plan.lane.lifecycle})`,
    `Alias: ${plan.alias.targetAliasHint}; ${plan.alias.selection}`,
    `Placement: split ${plan.placement.splitDirection}; focus=${plan.placement.focus}`,
    `Success condition: ${plan.successCondition}`,
    "",
    "Phases:",
    `1. Discover: ${plan.phases.discover}`,
    `2. Create: ${plan.phases.create}`,
    `3. Run: ${plan.phases.run}`,
    `4. Observe: ${plan.phases.observe}`,
    `5. Cleanup: ${plan.phases.cleanup}`,
    "",
    "Recommended Herdr actions:",
    ...plan.recommendedActions.map((action) => {
      const target = action.targetAlias ? ` → ${action.targetAlias}` : "";
      const condition = action.condition ? ` (${action.condition})` : "";
      return `- ${action.phase}: herdr.${action.action}${target} — ${action.purpose}${condition}`;
    }),
    "",
    "Advanced actions:",
    ...plan.advancedActions.map((action) => `- herdr.${action.action}: ${action.useWhen}`),
    "",
    "Cleanup policy:",
    `- Success: ${formatSuccessCleanup(plan)}`,
    `- Failure/timeout: ${plan.cleanupPolicy.onFailureOrTimeout.action}; read source=${plan.cleanupPolicy.onFailureOrTimeout.readSource}`,
    "",
    "Notes:",
    ...plan.notes.map((note) => `- ${note}`),
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

function formatSuccessCleanup(plan: Plan): string {
  if (plan.cleanupPolicy.onSuccess.action === "none") {
    return "no automatic cleanup; explicit user cleanup required";
  }
  return `${plan.cleanupPolicy.onSuccess.action} after ${plan.cleanupPolicy.onSuccess.requires}`;
}
