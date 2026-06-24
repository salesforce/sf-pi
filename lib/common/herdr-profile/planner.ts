/* SPDX-License-Identifier: Apache-2.0 */
/** Build non-mutating Herdr lane plans from normalized workflow preferences. */
import { DEFAULT_LANES, cloneEffectiveLanes, normalizePreferences } from "./defaults.ts";
import {
  LANE_IDS,
  type EffectiveHerdrLane,
  type EffectiveHerdrProfile,
  type HerdrActionHint,
  type HerdrAdvancedActionHint,
  type HerdrLaneId,
  type HerdrLanePlan,
  type HerdrLanePlanInput,
  type HerdrLanePreference,
  type HerdrPlanIntent,
  type HerdrWorkflowKey,
  type SfHerdrPreferences,
} from "./types.ts";

export function resolveHerdrProfile(
  preferences: SfHerdrPreferences,
  workflow: HerdrWorkflowKey = "generic",
  relatedWorkflows: readonly HerdrWorkflowKey[] = [],
): EffectiveHerdrProfile {
  const normalized = normalizePreferences(preferences);
  const lanes = cloneEffectiveLanes(DEFAULT_LANES);
  applyLanePreferences(lanes, normalized.defaults.lanes);
  applyLanePreferences(lanes, normalized.workflows.generic?.lanes);
  if (workflow !== "generic") applyLanePreferences(lanes, normalized.workflows[workflow]?.lanes);
  for (const related of relatedWorkflows) {
    if (related === workflow) continue;
    applyLanePreferences(lanes, normalized.workflows[related]?.lanes);
  }

  return {
    workflow,
    relatedWorkflows: relatedWorkflows.filter((item) => item !== workflow),
    splitDirection: normalized.defaults.splitDirection ?? "right",
    lanes,
  };
}

export function buildHerdrLanePlan(
  preferences: SfHerdrPreferences,
  input: HerdrLanePlanInput,
): HerdrLanePlan {
  const primary = input.primaryWorkflow ?? "generic";
  const related = input.relatedWorkflows ?? [];
  const profile = resolveHerdrProfile(preferences, primary, related);
  const laneId = laneForIntent(input.intent);
  const lane = profile.lanes[laneId];
  const alias = buildAliasPlan(lane);
  const placement = {
    prefer: "split",
    splitDirection: profile.splitDirection,
    focus: false,
  } satisfies HerdrLanePlan["placement"];
  const successCondition = successConditionForIntent(input.intent);
  const cleanupPolicy = cleanupPolicyForLane(lane);

  return {
    workflow: {
      primary,
      related,
      confidence: clampConfidence(input.confidence),
      reason: input.reason ?? "Workflow supplied by caller or defaulted to generic.",
    },
    intent: input.intent,
    lane,
    alias,
    placement,
    phases: buildPhases(lane, alias, placement, input.intent, successCondition),
    successCondition,
    cleanupPolicy,
    recommendedActions: buildRecommendedActions(
      lane,
      alias,
      placement,
      input.intent,
      successCondition,
    ),
    advancedActions: buildAdvancedActions(),
    notes: buildPlanNotes(lane, input),
  };
}

export function laneForIntent(intent: HerdrPlanIntent): HerdrLaneId {
  switch (intent) {
    case "tail-logs":
      return "logs";
    case "deploy-validate":
    case "verify":
      return "deploy";
    case "preview":
      return "preview";
    case "eval":
      return "eval";
    case "server":
      return "server";
    case "review":
      return "reviewer";
    case "run-tests":
    default:
      return "tests";
  }
}

export function successConditionForIntent(intent: HerdrPlanIntent): string {
  switch (intent) {
    case "tail-logs":
      return "Expected log marker observed.";
    case "deploy-validate":
      return "Deploy validation reports success.";
    case "verify":
      return "Verification command reports success.";
    case "preview":
      return "Preview or health check succeeds.";
    case "eval":
      return "Eval completes successfully.";
    case "server":
      return "Readiness marker observed; sticky lanes are not auto-closed.";
    case "review":
      return "Manual reviewer completion; manual lanes are not auto-closed.";
    case "run-tests":
    default:
      return "Test command reports success and passing tests.";
  }
}

function applyLanePreferences(
  lanes: Record<HerdrLaneId, EffectiveHerdrLane>,
  preferences?: Partial<Record<HerdrLaneId, HerdrLanePreference>>,
): void {
  if (!preferences) return;
  for (const laneId of LANE_IDS) {
    const pref = preferences[laneId];
    if (!pref) continue;
    lanes[laneId] = {
      ...lanes[laneId],
      baseAlias: pref.alias ?? lanes[laneId].baseAlias,
      label: pref.label ?? lanes[laneId].label,
      lifecycle: pref.lifecycle ?? lanes[laneId].lifecycle,
    };
  }
}

function buildAliasPlan(lane: EffectiveHerdrLane): HerdrLanePlan["alias"] {
  if (lane.lifecycle === "ephemeral") {
    return {
      baseAlias: lane.baseAlias,
      targetAliasHint: `${lane.baseAlias}_<shortid>`,
      pattern: `${lane.baseAlias}_<shortid>`,
      selection:
        "Call herdr.list to avoid live collisions, then choose a fresh short-id suffix that has not already been used in this session.",
    };
  }
  return {
    baseAlias: lane.baseAlias,
    targetAliasHint: lane.baseAlias,
    selection: "Use the base alias for this sticky/manual lane unless the user asks otherwise.",
  };
}

function cleanupPolicyForLane(lane: EffectiveHerdrLane): HerdrLanePlan["cleanupPolicy"] {
  if (lane.lifecycle === "ephemeral") {
    return {
      onSuccess: { action: "stop", requires: "workflow-success-condition" },
      onFailureOrTimeout: { action: "read-summarize-ask", readSource: "recent-unwrapped" },
    };
  }
  return {
    onSuccess: { action: "none", requires: "explicit-user-cleanup" },
    onFailureOrTimeout: { action: "read-summarize-ask", readSource: "recent-unwrapped" },
  };
}

function buildPhases(
  lane: EffectiveHerdrLane,
  alias: HerdrLanePlan["alias"],
  placement: HerdrLanePlan["placement"],
  intent: HerdrPlanIntent,
  successCondition: string,
): HerdrLanePlan["phases"] {
  const createAction = `Create ${lane.lifecycle === "ephemeral" ? "a fresh" : "the"} split-pane alias '${alias.targetAliasHint}' just in time with herdr.pane_split; use focus=false and direction='${placement.splitDirection}'. Avoid stacking multiple splits off the orchestrator pane.`;
  const cleanup =
    lane.lifecycle === "ephemeral"
      ? `After the Workflow Success Condition is observed (${successCondition}), call herdr.stop for '${alias.targetAliasHint}' to stop/close it. On failure, timeout, or ambiguity, read recent-unwrapped output, summarize, leave the lane open, and ask before cleanup.`
      : `Do not auto-close '${alias.targetAliasHint}' because lifecycle is ${lane.lifecycle}; stop/close only on explicit user cleanup.`;
  const run =
    intent === "tail-logs"
      ? `Start the tail/log command only after the just-in-time lane exists; do not pre-open this lane from session or workflow inference alone.`
      : `Caller supplies the shell command; call herdr.run with pane '${alias.targetAliasHint}' after lane creation.`;
  const observe =
    intent === "tail-logs"
      ? `Use herdr.watch/read for the expected log marker, then stop/close the ephemeral lane on success.`
      : `Use herdr.watch for readiness/completion and herdr.read with source='recent-unwrapped' when inspection is needed.`;
  return {
    discover: `Call herdr.list first to detect live alias collisions; do not reuse existing or previously closed ephemeral pane aliases. ${alias.selection}`,
    create: createAction,
    run,
    observe,
    cleanup,
  };
}

function buildRecommendedActions(
  lane: EffectiveHerdrLane,
  alias: HerdrLanePlan["alias"],
  placement: HerdrLanePlan["placement"],
  intent: HerdrPlanIntent,
  successCondition: string,
): HerdrActionHint[] {
  const targetAlias = alias.targetAliasHint;
  const actions: HerdrActionHint[] = [
    {
      phase: "discover",
      action: "list",
      purpose:
        "Detect live alias collisions; do not reuse existing or previously closed ephemeral pane aliases.",
    },
    {
      phase: "create",
      action: "pane_split",
      targetAlias,
      purpose: `Create ${lane.lifecycle === "ephemeral" ? "a fresh" : "the"} split pane just in time.`,
      paramsHint: {
        newPane: targetAlias,
        direction: placement.splitDirection,
        focus: false,
      },
    },
    {
      phase: "run",
      action: "run",
      targetAlias,
      purpose: "Submit the caller-owned command atomically.",
      paramsHint: { pane: targetAlias, command: "<caller supplies>" },
    },
    {
      phase: "observe",
      action: "watch",
      targetAlias,
      purpose:
        intent === "server" ? "Wait for readiness." : "Wait for completion or success marker.",
      paramsHint: {
        pane: targetAlias,
        match: "<workflow success marker>",
        timeout: "<caller chooses>",
      },
    },
    {
      phase: "observe",
      action: "read",
      targetAlias,
      purpose: "Inspect output when needed, especially on failure, timeout, or ambiguity.",
      paramsHint: { pane: targetAlias, source: "recent-unwrapped" },
    },
  ];
  if (lane.lifecycle === "ephemeral") {
    actions.push({
      phase: "cleanup",
      action: "stop",
      targetAlias,
      purpose: "Stop/close the fresh lane after successful completion.",
      condition: `Only after Workflow Success Condition: ${successCondition}`,
      paramsHint: { pane: targetAlias },
    });
  }
  return actions;
}

function buildAdvancedActions(): HerdrAdvancedActionHint[] {
  return [
    {
      action: "send",
      useWhen:
        "Advanced interactive text/key input is required in an existing lane; do not use for command submission.",
    },
    {
      action: "wait_agent",
      useWhen: "The lane is running a recognized agent process and agent status is the signal.",
    },
  ];
}

function buildPlanNotes(lane: EffectiveHerdrLane, input: HerdrLanePlanInput): string[] {
  const notes = [
    "Plan is non-mutating; perform each Herdr action explicitly.",
    "SF Guardrail mediates the eventual herdr.run command when safety rules match.",
  ];
  if (lane.lifecycle === "ephemeral") {
    notes.push(
      "Fresh Ephemeral Lanes are command-scoped split panes: create with a fresh short-id alias, stop/close after success, and avoid stacking splits off the orchestrator pane.",
    );
  }
  if (input.expectedDuration === "long" && lane.lifecycle === "ephemeral") {
    notes.push(
      "Expected duration is long; use watch/read for progress, but cleanup still depends on the Workflow Success Condition.",
    );
  }
  if (lane.lifecycle === "sticky") {
    notes.push("Sticky lanes stay open for reuse; do not auto-close on readiness.");
  }
  if (lane.lifecycle === "manual") {
    notes.push("Manual lanes stay open until explicit user cleanup.");
  }
  return notes;
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}
