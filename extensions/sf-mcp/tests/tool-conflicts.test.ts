/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { planPresetConflicts } from "../lib/conflict-planner.ts";
import { buildToolExposurePolicy } from "../lib/tool-policy.ts";
import {
  buildConflictAwareToolPolicy,
  declaredToolConflictOwners,
  exposedToolConflictOwners,
  inspectActiveToolConflicts,
} from "../lib/tool-conflicts.ts";
import { SALESFORCE_MCP_PRESETS, getPreset } from "../lib/presets.ts";

describe("SF MCP tool conflict planning", () => {
  it("keeps every exact claim tied to a reviewed tool and declared preset owner", () => {
    for (const preset of SALESFORCE_MCP_PRESETS) {
      const overlapOwners = new Set(preset.overlaps.map((overlap) => overlap.nativeExtensionId));
      for (const owner of declaredToolConflictOwners(preset)) {
        expect(overlapOwners.has(owner), `${preset.id}:${owner}`).toBe(true);
      }
      const plan = planPresetConflicts(preset, overlapOwners);
      const approved = new Set(preset.approvedTools ?? []);
      for (const conflict of inspectActiveToolConflicts(preset, plan)) {
        expect(approved.has(conflict.toolName), `${preset.id}:${conflict.toolName}`).toBe(true);
      }
    }
  });

  it("maps Headless 360 meta-tools to exact active SF Pi owners", () => {
    const preset = getPreset("headless-360");
    const plan = planPresetConflicts(preset, new Set(["sf-soql", "sf-apex", "sf-flow"]));
    const conflicts = inspectActiveToolConflicts(preset, plan);

    expect(conflicts.map((item) => item.toolName)).toEqual(["dispatch", "dispatch_readonly"]);
    expect(conflicts.find((item) => item.toolName === "dispatch")).toMatchObject({
      broad: true,
      relationship: "direct",
      owners: ["sf-soql", "sf-apex", "sf-flow"],
      recommendedExposure: "hidden",
    });
    expect(conflicts.find((item) => item.toolName === "dispatch_readonly")).toMatchObject({
      relationship: "partial",
      owners: ["sf-soql"],
      recommendedExposure: "deferred",
    });
  });

  it("builds one deterministic conflict-aware Headless 360 policy", () => {
    const preset = getPreset("headless-360");
    const plan = planPresetConflicts(preset, new Set(["sf-soql", "sf-apex", "sf-flow"]));

    expect(buildConflictAwareToolPolicy(preset, plan).exposures).toEqual({
      discover: "codemode",
      describe: "codemode",
      dispatch: "hidden",
      dispatch_readonly: "deferred",
    });
  });

  it("keeps Data 360 discovery complementary while hiding broad execution", () => {
    const preset = getPreset("data360");
    const plan = planPresetConflicts(preset, new Set(["sf-data360"]));

    expect(buildConflictAwareToolPolicy(preset, plan).exposures).toEqual({
      search: "codemode",
      payload_examples: "codemode",
      execute: "hidden",
    });
  });

  it("reports routing owners only for conflicting tools that remain exposed", () => {
    const preset = getPreset("headless-360");
    const plan = planPresetConflicts(preset, new Set(["sf-soql", "sf-apex", "sf-flow"]));
    const policy = buildConflictAwareToolPolicy(preset, plan);

    expect(exposedToolConflictOwners(preset, plan, policy.exposures)).toEqual(["sf-soql"]);
    expect(
      exposedToolConflictOwners(
        preset,
        plan,
        buildToolExposurePolicy(preset, "all-approved").exposures,
      ),
    ).toEqual(["sf-apex", "sf-flow", "sf-soql"]);
  });
});
