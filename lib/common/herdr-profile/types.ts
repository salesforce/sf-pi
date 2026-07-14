/* SPDX-License-Identifier: Apache-2.0 */
/** Shared Herdr lane-planning vocabulary and public types. */

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
    sourcePane: {
      default: "current_agent_pane";
      paneParam: "omit";
      note: string;
    };
  };
  /** Human-readable compatibility prose derived from recommendedActions and cleanupPolicy. */
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
  /** Source of truth for visible upstream Herdr calls the agent should execute. */
  recommendedActions: HerdrActionHint[];
  advancedActions: HerdrAdvancedActionHint[];
  /** Human-readable compatibility notes derived from recommendedActions and cleanupPolicy. */
  notes: string[];
}
