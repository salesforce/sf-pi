/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared Herdr workflow-profile store and lane planner.
 *
 * This module is intentionally under lib/common because SF Herdr owns editing
 * the managed preferences while SF Brain may read effective profile summaries
 * for conditional guidance. The persisted file is SF Pi-managed state, not a
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

export type HerdrWorkflowMode = "auto" | "off";
export type HerdrLaneStyle = "split" | "tab";
export type HerdrSplitDirection = "right" | "down";
export type HerdrLaneLifecycle = "ephemeral" | "sticky" | "manual";

export interface HerdrLanePreference {
  enabled?: boolean;
  alias?: string;
  label?: string;
  lifecycle?: HerdrLaneLifecycle;
}

export interface HerdrWorkflowProfile {
  laneStyle?: HerdrLaneStyle;
  splitDirection?: HerdrSplitDirection;
  preserveFocus?: boolean;
  lanes?: Partial<Record<HerdrLaneId, HerdrLanePreference>>;
}

export interface SfHerdrPreferences {
  workflowMode: HerdrWorkflowMode;
  defaults: HerdrWorkflowProfile;
  workflows: Partial<Record<HerdrWorkflowKey, HerdrWorkflowProfile>>;
}

export interface EffectiveHerdrLane {
  id: HerdrLaneId;
  enabled: boolean;
  alias: string;
  label: string;
  lifecycle: HerdrLaneLifecycle;
}

export interface EffectiveHerdrProfile {
  workflowMode: HerdrWorkflowMode;
  workflow: HerdrWorkflowKey;
  relatedWorkflows: HerdrWorkflowKey[];
  laneStyle: HerdrLaneStyle;
  splitDirection: HerdrSplitDirection;
  preserveFocus: boolean;
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
  expectedDuration?: "short" | "long" | "unknown";
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
  placement: {
    prefer: "reuse" | "split" | "tab";
    splitDirection?: HerdrSplitDirection;
    preserveFocus: boolean;
  };
  phases: {
    discover: string;
    create: string;
    run: string;
    observe: string;
    cleanup: string;
  };
  notes: string[];
}

const DEFAULT_LANES: Record<HerdrLaneId, EffectiveHerdrLane> = {
  tests: { id: "tests", enabled: true, alias: "tests", label: "Tests", lifecycle: "ephemeral" },
  logs: { id: "logs", enabled: false, alias: "logs", label: "Logs", lifecycle: "ephemeral" },
  server: { id: "server", enabled: false, alias: "server", label: "Server", lifecycle: "sticky" },
  preview: {
    id: "preview",
    enabled: false,
    alias: "preview",
    label: "Preview",
    lifecycle: "ephemeral",
  },
  eval: { id: "eval", enabled: false, alias: "eval", label: "Eval", lifecycle: "ephemeral" },
  deploy: {
    id: "deploy",
    enabled: false,
    alias: "deploy",
    label: "Deploy / verify",
    lifecycle: "ephemeral",
  },
  reviewer: {
    id: "reviewer",
    enabled: false,
    alias: "reviewer",
    label: "Reviewer",
    lifecycle: "manual",
  },
};

export const DEFAULT_SF_HERDR_PREFERENCES: SfHerdrPreferences = {
  workflowMode: "auto",
  defaults: {
    laneStyle: "split",
    splitDirection: "right",
    preserveFocus: true,
    lanes: fromEffectiveLanes(DEFAULT_LANES),
  },
  workflows: {
    generic: {
      lanes: {
        tests: { enabled: true, alias: "tests", lifecycle: "ephemeral" },
      },
    },
    apex: {
      lanes: {
        tests: { enabled: true, alias: "apex_tests", label: "Apex tests", lifecycle: "ephemeral" },
        logs: { enabled: true, alias: "apex_logs", label: "Apex logs", lifecycle: "ephemeral" },
      },
    },
    agentscript: {
      lanes: {
        preview: {
          enabled: true,
          alias: "agent_preview",
          label: "Agent preview",
          lifecycle: "ephemeral",
        },
        eval: { enabled: true, alias: "agent_eval", label: "Agent eval", lifecycle: "ephemeral" },
        logs: { enabled: true, alias: "agent_logs", label: "Agent logs", lifecycle: "ephemeral" },
      },
    },
    data360: {
      lanes: {
        eval: {
          enabled: true,
          alias: "d360_sweep",
          label: "Data 360 sweep",
          lifecycle: "ephemeral",
        },
      },
    },
    browser: {
      lanes: {
        logs: {
          enabled: true,
          alias: "browser_logs",
          label: "Browser-adjacent logs",
          lifecycle: "ephemeral",
        },
        deploy: { enabled: true, alias: "verify", label: "Verification", lifecycle: "ephemeral" },
      },
    },
    uiBundle: {
      lanes: {
        server: { enabled: true, alias: "server", label: "Dev server", lifecycle: "sticky" },
        tests: { enabled: true, alias: "ui_tests", label: "UI tests", lifecycle: "ephemeral" },
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
  const base = profileFromDefaults(normalized);
  applyProfile(base, normalized.workflows.generic);
  if (workflow !== "generic") applyProfile(base, normalized.workflows[workflow]);
  for (const related of relatedWorkflows) {
    if (related === workflow) continue;
    applyRelatedProfile(base, normalized.workflows[related]);
  }

  return {
    workflowMode: normalized.workflowMode,
    workflow,
    relatedWorkflows: relatedWorkflows.filter((item) => item !== workflow),
    laneStyle: base.laneStyle,
    splitDirection: base.splitDirection,
    preserveFocus: base.preserveFocus,
    lanes: base.lanes,
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
  const lane = ensureEnabledLane(profile.lanes[laneId], laneId);
  const prefer = lane.lifecycle === "ephemeral" ? "split" : profile.laneStyle;
  const placement = {
    prefer,
    ...(prefer === "split" ? { splitDirection: profile.splitDirection } : {}),
    preserveFocus: profile.preserveFocus,
  } satisfies HerdrLanePlan["placement"];

  return {
    workflow: {
      primary,
      related,
      confidence: clampConfidence(input.confidence),
      reason: input.reason ?? "Workflow supplied by caller or defaulted to generic.",
    },
    intent: input.intent,
    lane,
    placement,
    phases: buildPhases(lane, placement, input.intent),
    notes: buildPlanNotes(profile, lane, input),
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
        enabled: lane.enabled,
        alias: lane.alias,
        label: lane.label,
        lifecycle: lane.lifecycle,
      },
    ]),
  ) as Partial<Record<HerdrLaneId, HerdrLanePreference>>;
}

function normalizePreferences(raw: unknown): SfHerdrPreferences {
  const source = isObject(raw) ? raw : {};
  const defaults = isObject(source.defaults) ? normalizeProfile(source.defaults) : {};
  const workflows: Partial<Record<HerdrWorkflowKey, HerdrWorkflowProfile>> = {};
  const rawWorkflows = isObject(source.workflows) ? source.workflows : {};
  for (const workflow of WORKFLOW_KEYS) {
    const profile = rawWorkflows[workflow];
    if (isObject(profile)) workflows[workflow] = normalizeProfile(profile);
  }
  return {
    workflowMode: source.workflowMode === "off" ? "off" : "auto",
    defaults: mergeProfiles(DEFAULT_SF_HERDR_PREFERENCES.defaults, defaults),
    workflows: mergeWorkflowProfiles(DEFAULT_SF_HERDR_PREFERENCES.workflows, workflows),
  };
}

function normalizeProfile(raw: Record<string, unknown>): HerdrWorkflowProfile {
  const profile: HerdrWorkflowProfile = {};
  if (raw.laneStyle === "split" || raw.laneStyle === "tab") profile.laneStyle = raw.laneStyle;
  if (raw.splitDirection === "right" || raw.splitDirection === "down") {
    profile.splitDirection = raw.splitDirection;
  }
  if (typeof raw.preserveFocus === "boolean") profile.preserveFocus = raw.preserveFocus;
  if (isObject(raw.lanes)) {
    profile.lanes = {};
    for (const laneId of LANE_IDS) {
      const rawLane = raw.lanes[laneId];
      if (!isObject(rawLane)) continue;
      profile.lanes[laneId] = normalizeLane(rawLane);
    }
  }
  return profile;
}

function normalizeLane(raw: Record<string, unknown>): HerdrLanePreference {
  const lane: HerdrLanePreference = {};
  if (typeof raw.enabled === "boolean") lane.enabled = raw.enabled;
  if (typeof raw.alias === "string" && raw.alias.trim()) lane.alias = raw.alias.trim();
  if (typeof raw.label === "string" && raw.label.trim()) lane.label = raw.label.trim();
  if (raw.lifecycle === "ephemeral" || raw.lifecycle === "sticky" || raw.lifecycle === "manual") {
    lane.lifecycle = raw.lifecycle;
  }
  return lane;
}

function mergeWorkflowProfiles(
  base: SfHerdrPreferences["workflows"],
  overrides: SfHerdrPreferences["workflows"],
): SfHerdrPreferences["workflows"] {
  const result: SfHerdrPreferences["workflows"] = {};
  for (const workflow of WORKFLOW_KEYS) {
    result[workflow] = mergeProfiles(base[workflow], overrides[workflow]);
  }
  return result;
}

function mergeProfiles(
  base?: HerdrWorkflowProfile,
  override?: HerdrWorkflowProfile,
): HerdrWorkflowProfile {
  return {
    laneStyle: override?.laneStyle ?? base?.laneStyle,
    splitDirection: override?.splitDirection ?? base?.splitDirection,
    preserveFocus: override?.preserveFocus ?? base?.preserveFocus,
    lanes: mergeLanePreferences(base?.lanes, override?.lanes),
  };
}

function mergeLanePreferences(
  base?: HerdrWorkflowProfile["lanes"],
  override?: HerdrWorkflowProfile["lanes"],
): HerdrWorkflowProfile["lanes"] {
  const lanes: Partial<Record<HerdrLaneId, HerdrLanePreference>> = {};
  for (const laneId of LANE_IDS) {
    lanes[laneId] = { ...(base?.[laneId] ?? {}), ...(override?.[laneId] ?? {}) };
  }
  return lanes;
}

function profileFromDefaults(preferences: SfHerdrPreferences): {
  laneStyle: HerdrLaneStyle;
  splitDirection: HerdrSplitDirection;
  preserveFocus: boolean;
  lanes: Record<HerdrLaneId, EffectiveHerdrLane>;
} {
  const base = {
    laneStyle: preferences.defaults.laneStyle ?? "split",
    splitDirection: preferences.defaults.splitDirection ?? "right",
    preserveFocus: preferences.defaults.preserveFocus ?? true,
    lanes: cloneEffectiveLanes(DEFAULT_LANES),
  };
  applyProfile(base, preferences.defaults);
  return base;
}

function applyProfile(
  target: {
    laneStyle: HerdrLaneStyle;
    splitDirection: HerdrSplitDirection;
    preserveFocus: boolean;
    lanes: Record<HerdrLaneId, EffectiveHerdrLane>;
  },
  profile?: HerdrWorkflowProfile,
): void {
  if (!profile) return;
  if (profile.laneStyle) target.laneStyle = profile.laneStyle;
  if (profile.splitDirection) target.splitDirection = profile.splitDirection;
  if (typeof profile.preserveFocus === "boolean") target.preserveFocus = profile.preserveFocus;
  applyLanePreferences(target.lanes, profile.lanes);
}

function applyRelatedProfile(
  target: { lanes: Record<HerdrLaneId, EffectiveHerdrLane> },
  profile?: HerdrWorkflowProfile,
): void {
  if (!profile) return;
  applyLanePreferences(target.lanes, profile.lanes);
}

function applyLanePreferences(
  lanes: Record<HerdrLaneId, EffectiveHerdrLane>,
  preferences?: HerdrWorkflowProfile["lanes"],
): void {
  if (!preferences) return;
  for (const laneId of LANE_IDS) {
    const pref = preferences[laneId];
    if (!pref) continue;
    lanes[laneId] = {
      ...lanes[laneId],
      enabled: pref.enabled ?? lanes[laneId].enabled,
      alias: pref.alias ?? lanes[laneId].alias,
      label: pref.label ?? lanes[laneId].label,
      lifecycle: pref.lifecycle ?? lanes[laneId].lifecycle,
    };
  }
}

function ensureEnabledLane(lane: EffectiveHerdrLane, laneId: HerdrLaneId): EffectiveHerdrLane {
  if (lane.enabled) return lane;
  return { ...lane, enabled: true, label: lane.label || DEFAULT_LANES[laneId].label };
}

function buildPhases(
  lane: EffectiveHerdrLane,
  placement: HerdrLanePlan["placement"],
  intent: HerdrPlanIntent,
): HerdrLanePlan["phases"] {
  const createAction =
    placement.prefer === "tab"
      ? `Create alias '${lane.alias}' just in time with herdr.tab_create only when the command is ready to run.`
      : `Create alias '${lane.alias}' just in time with herdr.pane_split only when the command is ready to run; avoid splitting the orchestrator pane more than once or shrinking it below roughly half the tab, and prefer reusing an existing worker pane when one is available${placement.splitDirection ? `; requested split direction is '${placement.splitDirection}'` : ""}.`;
  const cleanup =
    lane.lifecycle === "ephemeral"
      ? `On successful watched completion, call herdr.stop for '${lane.alias}'. On failure or timeout, keep the lane open only long enough to read recent output, then ask before further cleanup.`
      : `Do not auto-close '${lane.alias}' because lifecycle is ${lane.lifecycle}; leave it for reuse or explicit cleanup.`;
  const run =
    intent === "tail-logs"
      ? `Start the tail/log command only after the just-in-time lane exists; do not pre-open this lane from session or workflow inference alone.`
      : `Caller supplies the shell command; call herdr.run with pane '${lane.alias}' after just-in-time lane creation or reuse.`;
  const observe =
    intent === "tail-logs"
      ? `Use herdr.watch/read for the expected log marker, then interrupt/stop the tail and close the ephemeral lane on success.`
      : `Use herdr.watch for readiness/completion and herdr.read with recent-unwrapped output when inspection is needed.`;
  return {
    discover: `Call herdr.list first and reuse live alias '${lane.alias}' if present; do not create lanes during session setup or because a workflow was merely inferred.`,
    create: createAction,
    run,
    observe,
    cleanup,
  };
}

function buildPlanNotes(
  profile: EffectiveHerdrProfile,
  lane: EffectiveHerdrLane,
  input: HerdrLanePlanInput,
): string[] {
  const notes = [
    "Plan is non-mutating; perform each Herdr action explicitly.",
    "SF Guardrail mediates the eventual herdr.run command when safety rules match.",
  ];
  if (profile.workflowMode === "off") {
    notes.push(
      "Herdr workflow mode is off in preferences; use this plan only if the user explicitly wants Herdr.",
    );
  }
  if (lane.lifecycle === "ephemeral") {
    notes.push(
      "Ephemeral lanes are command-scoped: create just in time, close after success, and avoid stacking multiple splits off the orchestrator pane.",
    );
  }
  if (input.expectedDuration === "long" && lane.lifecycle === "ephemeral") {
    notes.push(
      "Expected duration is long; consider preserving the lane if the user may want to monitor it.",
    );
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
