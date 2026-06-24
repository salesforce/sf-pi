/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Herdr workflow-profile store and lane planner.
 *
 * This module is intentionally under lib/common because SF Herdr owns editing
 * the managed preferences while other extensions may emit plan-focused handoffs
 * without importing sf-herdr. The persisted file is SF Pi-managed state, not a
 * hand-edited Pi setting:
 *   <globalAgentDir>/sf-pi/herdr/preferences.json
 */
import { canonicalStatePath, createStateStore } from "../state-store.ts";

export const HERDR_PROFILE_NAMESPACE = "herdr";
export const HERDR_PROFILE_FILENAME = "preferences.json";
export const HERDR_PROFILE_SCHEMA_VERSION = 1;

export const WORKFLOW_KEYS = [
  "generic",
  "apex",
  "agentscript",
  "data360",
  "browser",
  "uiBundle",
] as const;
export type HerdrWorkflowKey = (typeof WORKFLOW_KEYS)[number];

export const LANE_IDS = [
  "tests",
  "logs",
  "server",
  "preview",
  "eval",
  "deploy",
  "reviewer",
] as const;
export type HerdrLaneId = (typeof LANE_IDS)[number];

export const HERDR_PLAN_INTENTS = [
  "run-tests",
  "tail-logs",
  "deploy-validate",
  "preview",
  "eval",
  "server",
  "review",
  "verify",
] as const;
export type HerdrPlanIntent = (typeof HERDR_PLAN_INTENTS)[number];

export type HerdrSplitDirection = "right" | "down";
export type HerdrLaneLifecycle = "ephemeral" | "sticky" | "manual";
export type HerdrExpectedDuration = "short" | "long" | "unknown";

export interface HerdrLanePreference {
  alias?: string;
  label?: string;
  lifecycle?: HerdrLaneLifecycle;
}

export interface HerdrWorkflowLanePreferences {
  lanes?: Partial<Record<HerdrLaneId, HerdrLanePreference>>;
}

export interface SfHerdrPreferences {
  defaults: {
    splitDirection?: HerdrSplitDirection;
    lanes?: Partial<Record<HerdrLaneId, HerdrLanePreference>>;
  };
  workflows: Partial<Record<HerdrWorkflowKey, HerdrWorkflowLanePreferences>>;
}

export interface EffectiveHerdrLane {
  id: HerdrLaneId;
  baseAlias: string;
  label: string;
  lifecycle: HerdrLaneLifecycle;
}

export interface EffectiveHerdrProfile {
  workflow: HerdrWorkflowKey;
  relatedWorkflows: HerdrWorkflowKey[];
  splitDirection: HerdrSplitDirection;
  lanes: Record<HerdrLaneId, EffectiveHerdrLane>;
}

export interface HerdrPlanWorkflowContext {
  primaryWorkflow?: HerdrWorkflowKey;
  relatedWorkflows?: HerdrWorkflowKey[];
  confidence?: number;
  reason?: string;
}

export interface HerdrLanePlanInput extends HerdrPlanWorkflowContext {
  intent: HerdrPlanIntent;
  expectedDuration?: HerdrExpectedDuration;
}

export type HerdrRecommendedActionName = "list" | "pane_split" | "run" | "watch" | "read" | "stop";
export type HerdrAdvancedActionName = "send" | "wait_agent";

export interface HerdrActionHint {
  phase: "discover" | "create" | "run" | "observe" | "cleanup";
  action: HerdrRecommendedActionName;
  targetAlias?: string;
  purpose: string;
  paramsHint?: Record<string, unknown>;
  condition?: string;
}

export interface HerdrAdvancedActionHint {
  action: HerdrAdvancedActionName;
  useWhen: string;
}

export interface HerdrLanePlan {
  workflow: {
    primary: HerdrWorkflowKey;
    related: HerdrWorkflowKey[];
    confidence: number;
    reason: string;
  };
  intent: HerdrPlanIntent;
  lane: EffectiveHerdrLane;
  alias: {
    baseAlias: string;
    targetAliasHint: string;
    pattern?: string;
    selection: string;
  };
  placement: {
    prefer: "split";
    splitDirection: HerdrSplitDirection;
    focus: false;
  };
  phases: {
    discover: string;
    create: string;
    run: string;
    observe: string;
    cleanup: string;
  };
  successCondition: string;
  cleanupPolicy: {
    onSuccess: {
      action: "stop" | "none";
      requires: "workflow-success-condition" | "explicit-user-cleanup";
    };
    onFailureOrTimeout: {
      action: "read-summarize-ask";
      readSource: "recent-unwrapped";
    };
  };
  recommendedActions: HerdrActionHint[];
  advancedActions: HerdrAdvancedActionHint[];
  notes: string[];
}

const DEFAULT_LANES: Record<HerdrLaneId, EffectiveHerdrLane> = {
  tests: { id: "tests", baseAlias: "tests", label: "Tests", lifecycle: "ephemeral" },
  logs: { id: "logs", baseAlias: "logs", label: "Logs", lifecycle: "ephemeral" },
  server: { id: "server", baseAlias: "server", label: "Server", lifecycle: "sticky" },
  preview: { id: "preview", baseAlias: "preview", label: "Preview", lifecycle: "ephemeral" },
  eval: { id: "eval", baseAlias: "eval", label: "Eval", lifecycle: "ephemeral" },
  deploy: { id: "deploy", baseAlias: "deploy", label: "Deploy / verify", lifecycle: "ephemeral" },
  reviewer: { id: "reviewer", baseAlias: "reviewer", label: "Reviewer", lifecycle: "manual" },
};

export const DEFAULT_SF_HERDR_PREFERENCES: SfHerdrPreferences = {
  defaults: {
    splitDirection: "right",
    lanes: fromEffectiveLanes(DEFAULT_LANES),
  },
  workflows: {
    generic: {
      lanes: {
        tests: { alias: "tests", lifecycle: "ephemeral" },
      },
    },
    apex: {
      lanes: {
        tests: { alias: "apex_tests", label: "Apex tests", lifecycle: "ephemeral" },
        logs: { alias: "apex_logs", label: "Apex logs", lifecycle: "ephemeral" },
      },
    },
    agentscript: {
      lanes: {
        preview: { alias: "agent_preview", label: "Agent preview", lifecycle: "ephemeral" },
        eval: { alias: "agent_eval", label: "Agent eval", lifecycle: "ephemeral" },
        logs: { alias: "agent_logs", label: "Agent logs", lifecycle: "ephemeral" },
      },
    },
    data360: {
      lanes: {
        eval: { alias: "d360_sweep", label: "Data 360 sweep", lifecycle: "ephemeral" },
      },
    },
    browser: {
      lanes: {
        logs: { alias: "browser_logs", label: "Browser-adjacent logs", lifecycle: "ephemeral" },
        deploy: { alias: "verify", label: "Verification", lifecycle: "ephemeral" },
      },
    },
    uiBundle: {
      lanes: {
        server: { alias: "server", label: "Dev server", lifecycle: "sticky" },
        tests: { alias: "ui_tests", label: "UI tests", lifecycle: "ephemeral" },
      },
    },
  },
};

export function herdrPreferencesPath(): string {
  return canonicalStatePath(HERDR_PROFILE_NAMESPACE, HERDR_PROFILE_FILENAME);
}

export function readSfHerdrPreferences(): SfHerdrPreferences {
  return normalizePreferences(store().read());
}

export function writeSfHerdrPreferences(preferences: SfHerdrPreferences): void {
  store().write(normalizePreferences(preferences));
}

export function updateSfHerdrPreferences(
  update: (current: SfHerdrPreferences) => SfHerdrPreferences,
): SfHerdrPreferences {
  return store().update((current) => normalizePreferences(update(normalizePreferences(current))));
}

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

function store() {
  return createStateStore<SfHerdrPreferences>({
    namespace: HERDR_PROFILE_NAMESPACE,
    filename: HERDR_PROFILE_FILENAME,
    schemaVersion: HERDR_PROFILE_SCHEMA_VERSION,
    defaults: clonePreferences(DEFAULT_SF_HERDR_PREFERENCES),
    migrate: (raw) => normalizePreferences(raw),
  });
}

function fromEffectiveLanes(
  lanes: Record<HerdrLaneId, EffectiveHerdrLane>,
): Partial<Record<HerdrLaneId, HerdrLanePreference>> {
  return Object.fromEntries(
    Object.values(lanes).map((lane) => [
      lane.id,
      {
        alias: lane.baseAlias,
        label: lane.label,
        lifecycle: lane.lifecycle,
      },
    ]),
  ) as Partial<Record<HerdrLaneId, HerdrLanePreference>>;
}

function normalizePreferences(raw: unknown): SfHerdrPreferences {
  const source = isObject(raw) ? raw : {};
  const defaults = isObject(source.defaults) ? normalizeDefaults(source.defaults) : {};
  const workflows: Partial<Record<HerdrWorkflowKey, HerdrWorkflowLanePreferences>> = {};
  const rawWorkflows = isObject(source.workflows) ? source.workflows : {};
  for (const workflow of WORKFLOW_KEYS) {
    const preference = rawWorkflows[workflow];
    if (isObject(preference)) workflows[workflow] = normalizeWorkflowLanePreferences(preference);
  }
  return {
    defaults: mergeDefaults(DEFAULT_SF_HERDR_PREFERENCES.defaults, defaults),
    workflows: mergeWorkflowLanePreferences(DEFAULT_SF_HERDR_PREFERENCES.workflows, workflows),
  };
}

function normalizeDefaults(raw: Record<string, unknown>): SfHerdrPreferences["defaults"] {
  const defaults: SfHerdrPreferences["defaults"] = {};
  if (raw.splitDirection === "right" || raw.splitDirection === "down") {
    defaults.splitDirection = raw.splitDirection;
  }
  if (isObject(raw.lanes)) defaults.lanes = normalizeLanes(raw.lanes);
  return defaults;
}

function normalizeWorkflowLanePreferences(
  raw: Record<string, unknown>,
): HerdrWorkflowLanePreferences {
  const preferences: HerdrWorkflowLanePreferences = {};
  if (isObject(raw.lanes)) preferences.lanes = normalizeLanes(raw.lanes);
  return preferences;
}

function normalizeLanes(
  raw: Record<string, unknown>,
): Partial<Record<HerdrLaneId, HerdrLanePreference>> {
  const lanes: Partial<Record<HerdrLaneId, HerdrLanePreference>> = {};
  for (const laneId of LANE_IDS) {
    const rawLane = raw[laneId];
    if (!isObject(rawLane)) continue;
    lanes[laneId] = normalizeLane(rawLane);
  }
  return lanes;
}

function normalizeLane(raw: Record<string, unknown>): HerdrLanePreference {
  const lane: HerdrLanePreference = {};
  if (typeof raw.alias === "string" && raw.alias.trim()) lane.alias = raw.alias.trim();
  if (typeof raw.label === "string" && raw.label.trim()) lane.label = raw.label.trim();
  if (raw.lifecycle === "ephemeral" || raw.lifecycle === "sticky" || raw.lifecycle === "manual") {
    lane.lifecycle = raw.lifecycle;
  }
  return lane;
}

function mergeDefaults(
  base: SfHerdrPreferences["defaults"],
  override: SfHerdrPreferences["defaults"],
): SfHerdrPreferences["defaults"] {
  return {
    splitDirection: override.splitDirection ?? base.splitDirection,
    lanes: mergeLanePreferences(base.lanes, override.lanes),
  };
}

function mergeWorkflowLanePreferences(
  base: SfHerdrPreferences["workflows"],
  overrides: SfHerdrPreferences["workflows"],
): SfHerdrPreferences["workflows"] {
  const result: SfHerdrPreferences["workflows"] = {};
  for (const workflow of WORKFLOW_KEYS) {
    result[workflow] = {
      lanes: mergeLanePreferences(base[workflow]?.lanes, overrides[workflow]?.lanes),
    };
  }
  return result;
}

function mergeLanePreferences(
  base?: Partial<Record<HerdrLaneId, HerdrLanePreference>>,
  override?: Partial<Record<HerdrLaneId, HerdrLanePreference>>,
): Partial<Record<HerdrLaneId, HerdrLanePreference>> {
  const lanes: Partial<Record<HerdrLaneId, HerdrLanePreference>> = {};
  for (const laneId of LANE_IDS) {
    lanes[laneId] = { ...(base?.[laneId] ?? {}), ...(override?.[laneId] ?? {}) };
  }
  return lanes;
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
      targetAliasHint: `${lane.baseAlias}_<n>`,
      pattern: `${lane.baseAlias}_<n>`,
      selection: "Call herdr.list and choose the lowest unused numeric suffix for this fresh lane.",
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
    discover: `Call herdr.list first to detect alias collisions; do not reuse existing ephemeral panes. ${alias.selection}`,
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
      purpose: "Detect alias collisions; do not reuse existing ephemeral panes.",
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
      "Fresh Ephemeral Lanes are command-scoped split panes: create with a fresh suffixed alias, stop/close after success, and avoid stacking splits off the orchestrator pane.",
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

function cloneEffectiveLanes(
  lanes: Record<HerdrLaneId, EffectiveHerdrLane>,
): Record<HerdrLaneId, EffectiveHerdrLane> {
  return Object.fromEntries(
    Object.entries(lanes).map(([key, value]) => [key, { ...value }]),
  ) as Record<HerdrLaneId, EffectiveHerdrLane>;
}

function clonePreferences(preferences: SfHerdrPreferences): SfHerdrPreferences {
  return JSON.parse(JSON.stringify(preferences)) as SfHerdrPreferences;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
