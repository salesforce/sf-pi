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
        content: [
          { type: "text", text: renderHerdrLanePlan(plan, { inHerdrPane: runtime.inHerdrPane }) },
        ],
        details: { plan, herdrRuntime: runtime },
      };
    },
  });
}

type Plan = ReturnType<typeof buildHerdrLanePlan>;

export function renderHerdrLanePlan(plan: Plan, options: { inHerdrPane?: boolean } = {}): string {
  const lifecycleLabel = lifecycleName(plan.lane.lifecycle);
  const lines = [
    `🐑 SF Herdr plan  ${plan.lane.id} · ${plan.intent} · ${lifecycleLabel}`,
    options.inHerdrPane === false
      ? "  ⚠ Herdr pane environment not detected — advisory until upstream herdr is active."
      : undefined,
    `  Workflow  ${plan.workflow.primary} (${Math.round(plan.workflow.confidence * 100)}%)${formatRelated(plan)}`,
    `  Lane      ${plan.lane.id} · base ${plan.lane.baseAlias} · target ${plan.alias.targetAliasHint}`,
    `  Place     split ${plan.placement.splitDirection} · source=current agent pane · focus=${plan.placement.focus}`,
    `  Success   ${plan.successCondition}`,
    "",
    "  Action path",
    ...formatActionPath(plan),
    "",
    "  Cleanup",
    ...formatCleanup(plan),
    "",
    `  Advanced  herdr.send for interactive text/keys · herdr.wait_agent for recognized agent panes`,
    "",
    "  Notes",
    `  · Non-mutating plan — execute upstream herdr actions visibly.`,
    `  · Caller supplies the shell command; SF Guardrail mediates herdr.run when rules match.`,
    plan.workflow.reason ? `  · ${clip(plan.workflow.reason, 120)}` : undefined,
  ];
  return lines.filter((line): line is string => typeof line === "string").join("\n");
}

function lifecycleName(lifecycle: Plan["lane"]["lifecycle"]): string {
  if (lifecycle === "ephemeral") return "fresh ephemeral";
  return lifecycle;
}

function formatRelated(plan: Plan): string {
  return plan.workflow.related.length ? ` · related ${plan.workflow.related.join(", ")}` : "";
}

function formatActionPath(plan: Plan): string[] {
  const create = plan.recommendedActions.find((action) => action.action === "pane_split");
  const run = plan.recommendedActions.find((action) => action.action === "run");
  const hasStop = plan.recommendedActions.some((action) => action.action === "stop");
  const rows = [
    ["1", "herdr.list", "detect live alias collisions"],
    [
      "2",
      "herdr.pane_split",
      `create ${create?.targetAlias ?? plan.alias.targetAliasHint} from current agent pane`,
    ],
    ["3", "herdr.run", run?.purpose ?? "submit caller-owned command"],
    ["4", "herdr.watch/read", "observe success marker; inspect recent-unwrapped when needed"],
    ["5", hasStop ? "herdr.stop" : "manual cleanup", formatSuccessCleanup(plan)],
  ];
  return rows.map(([index, action, detail]) => `    ${index}. ${action.padEnd(16)} ${detail}`);
}

function formatCleanup(plan: Plan): string[] {
  const failure = plan.cleanupPolicy.onFailureOrTimeout;
  return [
    `    ✓ success   ${formatSuccessCleanup(plan)}`,
    `    ⚠ failure   ${failure.action}; read ${failure.readSource}; ask before cleanup`,
  ];
}

function formatSuccessCleanup(plan: Plan): string {
  if (plan.cleanupPolicy.onSuccess.action === "none") {
    return "no automatic cleanup; explicit user cleanup required";
  }
  return `stop/close after Workflow Success Condition`;
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean;
}
