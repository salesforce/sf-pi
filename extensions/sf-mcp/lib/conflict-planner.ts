/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic semantic overlap planning between MCP presets and enabled SF Pi owners. */
import type { McpPreset, McpPresetId, McpPresetOverlap, McpResolution } from "./presets.ts";

export interface CapabilityConflict extends McpPresetOverlap {
  presetId: McpPresetId;
}

export interface ConflictRecommendation {
  resolution: McpResolution;
  alternatePresetId?: McpPresetId;
  summary: string;
}

export interface ConflictPlan {
  presetId: McpPresetId;
  conflicts: CapabilityConflict[];
  recommendation: ConflictRecommendation;
}

export function planPresetConflicts(
  preset: McpPreset,
  enabledNativeExtensions: ReadonlySet<string>,
): ConflictPlan {
  const conflicts = preset.overlaps
    .filter((overlap) => enabledNativeExtensions.has(overlap.nativeExtensionId))
    .map((overlap) => ({ ...overlap, presetId: preset.id }));

  if (conflicts.length === 0) {
    return {
      presetId: preset.id,
      conflicts,
      recommendation: {
        resolution: "enable",
        summary: "No enabled SF Pi capability owner directly overlaps this preset.",
      },
    };
  }

  if (
    preset.id === "data360" &&
    conflicts.some((item) => item.nativeExtensionId === "sf-data360")
  ) {
    return {
      presetId: preset.id,
      conflicts,
      recommendation: {
        resolution: "native-only",
        summary:
          "Keep the typed SF Data 360 families. Enable the hosted MCP only for an explicit comparison or missing capability.",
      },
    };
  }

  if (preset.id === "agentforce-sales") {
    return {
      presetId: preset.id,
      conflicts,
      recommendation: {
        resolution: "native-only",
        summary:
          "Keep the native SF Pi owner. Enable Agentforce Sales only for explicit sandbox interoperability testing because its exact tools are not published.",
      },
    };
  }

  if (preset.id === "headless-360") {
    return {
      presetId: preset.id,
      conflicts,
      recommendation: {
        resolution: "native-only",
        summary:
          "Keep the specialized SF Pi lifecycle owners. Enable Headless 360 side-by-side only for an operation they do not provide.",
      },
    };
  }

  return {
    presetId: preset.id,
    conflicts,
    recommendation: {
      resolution: "complement-native",
      summary:
        "Keep the specialized SF Pi owner and expose only MCP capabilities that add something new.",
    },
  };
}

export function formatConflictPlan(plan: ConflictPlan): string[] {
  if (plan.conflicts.length === 0) return ["No active SF Pi capability overlaps detected."];
  return [
    ...plan.conflicts.map(
      (conflict) =>
        `${conflict.relationship === "direct" ? "Direct" : "Partial"} overlap with ${conflict.nativeExtensionId}: ${conflict.reason}`,
    ),
    `Recommended: ${plan.recommendation.summary}`,
  ];
}
