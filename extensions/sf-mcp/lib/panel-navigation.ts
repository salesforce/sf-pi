/* SPDX-License-Identifier: Apache-2.0 */
/** Navigation choices and safe defaults for the SF MCP Manager workflow. */
import type { ConflictPlan } from "./conflict-planner.ts";
import type {
  ConflictOption,
  ConnectionOption,
  PresetOverviewOption,
  ReconcileOption,
} from "./panel-pages.ts";
import { isPresetConfigCompatible, type McpResolution } from "./presets.ts";
import type { PresetRuntimeState } from "./service.ts";
import { inspectActiveToolConflicts } from "./tool-conflicts.ts";
import {
  buildToolExposurePolicy,
  hasReviewedToolPolicy,
  type ToolExposurePolicy,
} from "./tool-policy.ts";

export type ReconcileAction =
  | { kind: "adopt" }
  | { kind: "reset" }
  | { kind: "keep-name"; keepName: string }
  | { kind: "cancel" };

export type ReconcileChoice = ReconcileOption & { action: ReconcileAction };
export type ConnectionAction = "configure" | "reconcile" | "back";
export type ConnectionChoice = ConnectionOption & { action: ConnectionAction };
export type OverviewAction =
  "connection" | "tools" | "policy" | "tool-conflicts" | "drift" | "back";
export type OverviewChoice = PresetOverviewOption & { action: OverviewAction };

export function overviewOptions(state: PresetRuntimeState): OverviewChoice[] {
  const options: OverviewChoice[] = [
    {
      label: "Connection & authentication",
      description:
        "Configure the URL or command, environment, and OAuth details without changing tool access.",
      action: "connection",
    },
    {
      label: "Tool access",
      description:
        "Choose a reviewed profile or set individual Hidden, Code Mode, Deferred, and Direct exposure.",
      action: "policy",
    },
  ];
  if (inspectActiveToolConflicts(state.preset, state.plan).length > 0) {
    options.push({
      label: "Review tool conflicts",
      description:
        "Inspect exact overlaps with enabled SF Pi owners and apply a compact recommended policy.",
      action: "tool-conflicts",
    });
  }
  options.push({
    label: "Browse tool details",
    description:
      "Inspect documented and session-observed schemas, annotations, and runtime metadata without changing configuration.",
    action: "tools",
  });
  if (state.drift.status === "review") {
    options.push({
      label: "Review contract drift",
      description:
        "Inspect added unapproved tools and removed documented tools before repair or a reviewed preset update.",
      action: "drift",
    });
  }
  options.push({
    label: "Back to catalog",
    description: "Return without changing native MCP configuration.",
    action: "back",
  });
  return options;
}

export function overviewActionIndex(state: PresetRuntimeState, action: OverviewAction): number {
  const index = overviewOptions(state).findIndex((option) => option.action === action);
  return Math.max(0, index);
}

export function connectionOptions(state: PresetRuntimeState): ConnectionChoice[] {
  const requiresReview = [
    "manual",
    "modified",
    "managed-outdated",
    "name-conflict",
    "project-override",
    "invalid-config",
  ].includes(state.managed.status);
  return [
    {
      label:
        state.managed.status === "missing"
          ? "Set up connection"
          : requiresReview
            ? "Review existing connection"
            : "Review & replace connection",
      description:
        state.managed.status === "missing"
          ? "Enter the transport and authentication fields. The new server is saved with every tool Hidden."
          : requiresReview
            ? "Inspect ownership or drift before adopting or replacing the current native entry."
            : "Re-enter connection fields and review the exact diff. Existing reviewed tool access is preserved.",
      action: requiresReview ? "reconcile" : "configure",
    },
    {
      label: "Back to overview",
      description: "Return without changing connection or authentication configuration.",
      action: "back",
    },
  ];
}

export function connectionResolution(state: PresetRuntimeState): McpResolution {
  const current = state.managed.record?.resolution;
  if (current && current !== "native-only") return current;
  if (state.plan.conflicts.length === 0) return "enable";
  return state.plan.recommendation.resolution === "complement-native"
    ? "complement-native"
    : "side-by-side";
}

export function connectionToolPolicy(state: PresetRuntimeState): ToolExposurePolicy | undefined {
  if (!hasReviewedToolPolicy(state.preset)) return undefined;
  return state.managed.config
    ? buildToolExposurePolicy(state.preset, "custom", state.managed.config)
    : buildToolExposurePolicy(state.preset, "quarantine");
}

export function reconcileOptions(state: PresetRuntimeState): ReconcileChoice[] {
  if (state.managed.status === "name-conflict") {
    return [
      ...(state.managed.conflictingNames ?? []).map((name) => ({
        label: `Keep ${name}`,
        description:
          "Remove the other canonically equivalent names. The kept entry remains user-owned until adopted.",
        action: { kind: "keep-name" as const, keepName: name },
      })),
      {
        label: "Cancel",
        description: "Leave every native MCP entry unchanged.",
        action: { kind: "cancel" as const },
      },
    ];
  }

  const options: ReconcileChoice[] = [];
  if (
    state.managed.config &&
    isPresetConfigCompatible(state.preset, state.managed.config).compatible
  ) {
    options.push({
      label: "Adopt existing entry  · Recommended",
      description:
        "Record the current compatible configuration as SF MCP-managed without changing mcp.json.",
      action: { kind: "adopt" },
    });
  }
  options.push(
    {
      label: "Reset to current preset",
      description:
        "Review a redacted field-level diff, then explicitly replace this one entry with the current preset revision.",
      action: { kind: "reset" },
    },
    {
      label: "Cancel",
      description: "Keep the existing entry user-owned and unchanged.",
      action: { kind: "cancel" },
    },
  );
  return options;
}

export function conflictOptions(plan: ConflictPlan): ConflictOption[] {
  if (plan.recommendation.resolution === "native-only") {
    return [
      {
        label: "Keep the native SF Pi owner  · Recommended",
        description: plan.recommendation.summary,
        resolution: "native-only",
      },
      {
        label: "Enable MCP side-by-side  · Advanced",
        description:
          "Keep both providers with explicit routing guidance and the preset's approved MCP tools.",
        resolution: "side-by-side",
      },
      { label: "Cancel", description: "Return to the Salesforce MCP catalog." },
    ];
  }
  return [
    {
      label: "Expose only complementary MCP tools  · Recommended",
      description: plan.recommendation.summary,
      resolution: "complement-native",
    },
    {
      label: "Enable full MCP side-by-side  · Advanced",
      description:
        "Expose the current approved MCP tool contract and keep newly discovered tools hidden.",
      resolution: "side-by-side",
    },
    { label: "Cancel", description: "Return to the Salesforce MCP catalog." },
  ];
}
