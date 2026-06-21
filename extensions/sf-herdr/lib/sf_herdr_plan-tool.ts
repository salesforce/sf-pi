/* SPDX-License-Identifier: Apache-2.0 */
/** Non-mutating Herdr lane planner tool. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai/base";
import { Type } from "typebox";

import {
  HERDR_PLAN_INTENTS,
  WORKFLOW_KEYS,
  buildHerdrLanePlan,
  readSfHerdrPreferences,
  type HerdrPlanIntent,
  type HerdrWorkflowKey,
} from "../../../lib/common/herdr-profile/store.ts";
import type { HerdrSignalState } from "./signal-state.ts";

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
  expectedDuration?: "short" | "long" | "unknown";
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
      "Do not treat the plan as execution: call herdr.list, pane_split/tab_create, run, watch/read, and stop explicitly.",
      "Create lanes just in time for the command/tool being run; never pre-open panes from session or workflow inference alone.",
      "Avoid shrinking the main orchestrator pane below roughly half the tab; do not stack multiple splits directly off the orchestrator pane.",
      "The planner never generates shell commands; choose commands through the owning SF Pi extension or Salesforce workflow guidance.",
      "Close ephemeral lanes only on successful watched completion; preserve failures and timeouts for inspection.",
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

      return {
        content: [{ type: "text", text: renderPlan(plan) }],
        details: { plan },
      };
    },
  });
}

type Plan = ReturnType<typeof buildHerdrLanePlan>;

function renderPlan(plan: Plan): string {
  return [
    "SF Herdr lane plan (non-mutating)",
    `Workflow: ${plan.workflow.primary} (${Math.round(plan.workflow.confidence * 100)}%)`,
    plan.workflow.related.length > 0 ? `Related: ${plan.workflow.related.join(", ")}` : undefined,
    `Reason: ${plan.workflow.reason}`,
    `Intent: ${plan.intent}`,
    `Lane: ${plan.lane.id} → alias '${plan.lane.alias}' (${plan.lane.lifecycle})`,
    `Placement: ${plan.placement.prefer}${plan.placement.splitDirection ? ` ${plan.placement.splitDirection}` : ""}; preserveFocus=${plan.placement.preserveFocus}`,
    "",
    "Phases:",
    `1. Discover/reuse: ${plan.phases.discover}`,
    `2. Create: ${plan.phases.create}`,
    `3. Run: ${plan.phases.run}`,
    `4. Observe: ${plan.phases.observe}`,
    `5. Cleanup: ${plan.phases.cleanup}`,
    "",
    "Notes:",
    ...plan.notes.map((note) => `- ${note}`),
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}
