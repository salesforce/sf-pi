/* SPDX-License-Identifier: Apache-2.0 */
/** Exact reviewed mappings from MCP tools to active SF Pi capability owners. */
import type { ConflictPlan } from "./conflict-planner.ts";
import type { McpPreset, McpPresetId } from "./presets.ts";
import { inspectPresetTools } from "./tool-catalog.ts";
import {
  buildToolExposurePolicy,
  type ToolExposureMode,
  type ToolExposurePolicy,
} from "./tool-policy.ts";

export interface ActiveToolConflict {
  toolName: string;
  capability: string;
  relationship: "direct" | "partial";
  owners: string[];
  reason: string;
  broad: boolean;
  recommendedExposure: ToolExposureMode;
}

interface ToolConflictClaim {
  owners: readonly string[];
  relationship: "direct" | "partial";
  reason: string;
  broad?: boolean;
  recommendedExposure: ToolExposureMode;
}

const CLAIMS: Partial<Record<McpPresetId, Readonly<Record<string, ToolConflictClaim>>>> = {
  "salesforce-dx": {
    run_soql_query: {
      owners: ["sf-soql"],
      relationship: "direct",
      reason: "The native SF SOQL family owns bounded schema-grounded record query workflows.",
      recommendedExposure: "hidden",
    },
    run_apex_test: {
      owners: ["sf-apex"],
      relationship: "direct",
      reason:
        "The native SF Apex family owns targeted test execution, results, and coverage evidence.",
      recommendedExposure: "hidden",
    },
  },
  data360: {
    search: {
      owners: ["sf-data360"],
      relationship: "partial",
      reason:
        "The native sf_data360 SDK provides business action discovery, while MCP search can still reveal hosted Connect API families.",
      recommendedExposure: "codemode",
    },
    payload_examples: {
      owners: ["sf-data360"],
      relationship: "partial",
      reason:
        "The native sf_data360 action catalog grounds payloads and schemas; MCP examples remain complementary contract evidence.",
      recommendedExposure: "codemode",
    },
    execute: {
      owners: ["sf-data360"],
      relationship: "direct",
      reason:
        "Execute dispatches broad Data 360 operations already owned by the sf_data360 SDK action catalog.",
      broad: true,
      recommendedExposure: "hidden",
    },
  },
  "headless-360": {
    dispatch: {
      owners: ["sf-soql", "sf-apex", "sf-flow"],
      relationship: "direct",
      reason:
        "Dispatch is a broad meta-tool that can invoke record, Apex, Flow, and other platform mutations behind one MCP tool.",
      broad: true,
      recommendedExposure: "hidden",
    },
    dispatch_readonly: {
      owners: ["sf-soql"],
      relationship: "partial",
      reason:
        "Read-only dispatch overlaps bounded record and schema reads, but can reach additional read-only platform operations.",
      recommendedExposure: "deferred",
    },
  },
};

export function inspectActiveToolConflicts(
  preset: McpPreset,
  plan: ConflictPlan,
): ActiveToolConflict[] {
  const claims = CLAIMS[preset.id];
  if (!claims) return [];
  const activeOwners = new Set(plan.conflicts.map((conflict) => conflict.nativeExtensionId));
  const tools = new Map(inspectPresetTools(preset).map((tool) => [tool.name, tool]));
  return Object.entries(claims).flatMap(([toolName, claim]) => {
    const owners = claim.owners.filter((owner) => activeOwners.has(owner));
    if (owners.length === 0) return [];
    return [
      {
        toolName,
        capability: tools.get(toolName)?.capability ?? "Reviewed MCP capability",
        relationship: claim.relationship,
        owners: [...owners],
        reason: claim.reason,
        broad: claim.broad === true,
        recommendedExposure: claim.recommendedExposure,
      },
    ];
  });
}

export function buildConflictAwareToolPolicy(
  preset: McpPreset,
  plan: ConflictPlan,
): ToolExposurePolicy {
  const policy = buildToolExposurePolicy(preset, "recommended");
  const exposures = { ...policy.exposures };
  for (const conflict of inspectActiveToolConflicts(preset, plan)) {
    if (!policy.unavailable.includes(conflict.toolName)) {
      exposures[conflict.toolName] = conflict.recommendedExposure;
    }
  }
  return { ...policy, profile: "recommended", exposures };
}

export function exposedToolConflictOwners(
  preset: McpPreset,
  plan: ConflictPlan,
  exposures: Readonly<Record<string, ToolExposureMode>>,
): string[] {
  const owners = new Set<string>();
  for (const conflict of inspectActiveToolConflicts(preset, plan)) {
    if ((exposures[conflict.toolName] ?? "hidden") === "hidden") continue;
    for (const owner of conflict.owners) owners.add(owner);
  }
  return [...owners].sort();
}

export function hasActiveToolConflicts(preset: McpPreset, plan: ConflictPlan): boolean {
  return inspectActiveToolConflicts(preset, plan).length > 0;
}

export function declaredToolConflictOwners(preset: McpPreset): string[] {
  const claims = CLAIMS[preset.id];
  if (!claims) return [];
  return [...new Set(Object.values(claims).flatMap((claim) => [...claim.owners]))].sort();
}
