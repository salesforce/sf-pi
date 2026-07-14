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
  const effectiveRelatedWorkflows = uniqueRelatedWorkflows(workflow, relatedWorkflows);
  applyLanePreferences(lanes, normalized.defaults.lanes);
  applyLanePreferences(lanes, normalized.workflows.generic?.lanes);
  if (workflow !== "generic") applyLanePreferences(lanes, normalized.workflows[workflow]?.lanes);
  for (const related of effectiveRelatedWorkflows) {
    applyLanePreferences(lanes, normalized.workflows[related]?.lanes);
  }

  return {
    workflow,
    relatedWorkflows: effectiveRelatedWorkflows,
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
    sourcePane: {
      default: "current_agent_pane",
      paneParam: "omit",
      note: "Omit pane to split the current agent/orchestrator pane. Pass pane only when the user asks for a specific source or a simultaneous lane must split from a worker pane to protect layout.",
    },
  } satisfies HerdrLanePlan["placement"];
  const successCondition = successConditionForIntent(input.intent);
  const cleanupPolicy = cleanupPolicyForLane(lane);
  const recommendedActions = buildRecommendedActions(
    lane,
    alias,
    placement,
    input.intent,
    successCondition,
  );
  const advancedActions = buildAdvancedActions();

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
    phases: buildPhasesFromActions(recommendedActions, cleanupPolicy, successCondition),
    successCondition,
    cleanupPolicy,
    recommendedActions,
    advancedActions,
    notes: buildPlanNotesFromActions(recommendedActions, cleanupPolicy),
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

function uniqueRelatedWorkflows(
  workflow: HerdrWorkflowKey,
  relatedWorkflows: readonly HerdrWorkflowKey[],
): HerdrWorkflowKey[] {
  const seen = new Set<HerdrWorkflowKey>();
  const result: HerdrWorkflowKey[] = [];
  for (const related of relatedWorkflows) {
    if (related === "generic" || related === workflow || seen.has(related)) continue;
    seen.add(related);
    result.push(related);
  }
  return result;
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
        'Call herdr(action="list") to avoid live collisions, then choose a fresh short-id suffix that has not already been used in this session.',
    };
  }
  return {
    baseAlias: lane.baseAlias,
    targetAliasHint: lane.baseAlias,
    selection:
      'Call herdr(action="list") and reuse the base alias when present; create it only when absent.',
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

function buildPhasesFromActions(
  actions: readonly HerdrActionHint[],
  cleanupPolicy: HerdrLanePlan["cleanupPolicy"],
  successCondition: string,
): HerdrLanePlan["phases"] {
  const list = requiredAction(actions, "list");
  const create = requiredAction(actions, "pane_split");
  const run = requiredAction(actions, "run");
  const watch = requiredAction(actions, "watch");
  const read = requiredAction(actions, "read");
  const stop = actions.find((action) => action.action === "stop");

  return {
    discover: `Call ${formatHerdrActionCall(list)} first. ${list.purpose}`,
    create: create.condition
      ? `${create.condition} If needed, call ${formatHerdrActionCall(create)}. ${create.purpose}`
      : `Call ${formatHerdrActionCall(create)}. ${create.purpose}`,
    run: `After the lane exists, call ${formatHerdrActionCall(run)}. ${run.purpose}`,
    observe: `Use ${formatHerdrActionCall(watch)}. ${watch.purpose} Use ${formatHerdrActionCall(read)}. ${read.purpose}`,
    cleanup: buildCleanupPhase(cleanupPolicy, stop, successCondition),
  };
}

function buildCleanupPhase(
  cleanupPolicy: HerdrLanePlan["cleanupPolicy"],
  stop: HerdrActionHint | undefined,
  successCondition: string,
): string {
  const failure = cleanupPolicy.onFailureOrTimeout;
  const failureText = `On failure, timeout, or ambiguity, read ${failure.readSource} output, summarize, leave the lane open, and ask before cleanup.`;
  if (cleanupPolicy.onSuccess.action === "stop" && stop) {
    return `After the Workflow Success Condition is observed (${successCondition}), call ${formatHerdrActionCall(stop)}. ${failureText}`;
  }
  return `Do not auto-close; cleanup requires explicit user action. ${failureText}`;
}

function buildRecommendedActions(
  lane: EffectiveHerdrLane,
  alias: HerdrLanePlan["alias"],
  placement: HerdrLanePlan["placement"],
  intent: HerdrPlanIntent,
  successCondition: string,
): HerdrActionHint[] {
  const targetAlias = alias.targetAliasHint;
  const isEphemeral = lane.lifecycle === "ephemeral";
  const actions: HerdrActionHint[] = [
    {
      phase: "discover",
      action: "list",
      purpose: isEphemeral
        ? "Detect live alias collisions; do not reuse existing or previously closed ephemeral pane aliases."
        : "Find an existing sticky/manual base alias; reuse it when present and create it only when absent.",
    },
    {
      phase: "create",
      action: "pane_split",
      targetAlias,
      purpose: isEphemeral
        ? "Create a fresh split pane from the current agent/orchestrator pane just in time."
        : 'Create the split pane only when herdr(action="list") does not show the base alias.',
      condition: isEphemeral ? undefined : "Only when the sticky/manual base alias is absent.",
      paramsHint: {
        pane: "<omit for current agent/orchestrator pane>",
        newPane: targetAlias,
        direction: placement.splitDirection,
        focus: false,
      },
    },
    {
      phase: "run",
      action: "run",
      targetAlias,
      purpose:
        intent === "tail-logs"
          ? "Start the tail/log command only after the lane exists; do not pre-open this lane from session or workflow inference alone."
          : "Submit the caller-owned command atomically.",
      paramsHint: { pane: targetAlias, command: "<caller supplies>" },
    },
    {
      phase: "observe",
      action: "watch",
      targetAlias,
      purpose:
        intent === "tail-logs"
          ? "Wait for expected log marker."
          : intent === "server"
            ? "Wait for readiness."
            : "Wait for completion or success marker.",
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
  if (isEphemeral) {
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

export function formatHerdrActionCall(action: HerdrActionHint): string {
  const params = action.paramsHint ?? {};
  const args = [`action="${action.action}"`];
  for (const key of [
    "newPane",
    "pane",
    "direction",
    "focus",
    "command",
    "match",
    "timeout",
    "source",
  ]) {
    const value = params[key];
    if (typeof value !== "string" && typeof value !== "boolean") continue;
    if (key === "pane" && value === "<omit for current agent/orchestrator pane>") continue;
    args.push(`${key}=${formatHerdrArgument(value)}`);
  }
  return `herdr(${args.join(", ")})`;
}

function formatHerdrArgument(value: string | boolean): string {
  if (typeof value === "boolean") return String(value);
  return `"${value}"`;
}

function buildPlanNotesFromActions(
  actions: readonly HerdrActionHint[],
  cleanupPolicy: HerdrLanePlan["cleanupPolicy"],
): string[] {
  const notes = [
    "Plan is non-mutating; perform each Herdr action explicitly.",
    'SF Guardrail mediates the eventual herdr(action="run") command when safety rules match.',
  ];
  if (cleanupPolicy.onSuccess.action === "stop") {
    notes.push(
      "Fresh Ephemeral Lanes are command-scoped split panes: create with a fresh short-id alias, stop/close after success, and avoid stacking splits off the orchestrator pane.",
    );
  } else {
    const create = actions.find((action) => action.action === "pane_split");
    notes.push(
      `Sticky/manual lanes reuse an existing base alias when present; ${create?.condition ?? "create only when absent"}.`,
    );
  }
  return notes;
}

function requiredAction(
  actions: readonly HerdrActionHint[],
  actionName: HerdrActionHint["action"],
): HerdrActionHint {
  const action = actions.find((candidate) => candidate.action === actionName);
  if (!action) throw new Error(`Missing Herdr action hint: ${actionName}`);
  return action;
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}
