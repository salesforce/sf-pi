/* SPDX-License-Identifier: Apache-2.0 */
/** Default Herdr lane preferences plus tolerant preference normalization. */
import {
  LANE_IDS,
  WORKFLOW_KEYS,
  type EffectiveHerdrLane,
  type HerdrLaneId,
  type HerdrLanePreference,
  type HerdrWorkflowKey,
  type HerdrWorkflowLanePreferences,
  type SfHerdrPreferences,
} from "./types.ts";

export const DEFAULT_LANES: Record<HerdrLaneId, EffectiveHerdrLane> = {
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

export function normalizePreferences(raw: unknown): SfHerdrPreferences {
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

export function cloneEffectiveLanes(
  lanes: Record<HerdrLaneId, EffectiveHerdrLane>,
): Record<HerdrLaneId, EffectiveHerdrLane> {
  return Object.fromEntries(
    Object.entries(lanes).map(([key, value]) => [key, { ...value }]),
  ) as Record<HerdrLaneId, EffectiveHerdrLane>;
}

export function clonePreferences(preferences: SfHerdrPreferences): SfHerdrPreferences {
  return JSON.parse(JSON.stringify(preferences)) as SfHerdrPreferences;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
