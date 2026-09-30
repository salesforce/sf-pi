/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { SF_PI_REGISTRY } from "../../../catalog/registry.ts";
import { planPresetConflicts } from "../lib/conflict-planner.ts";
import { SALESFORCE_MCP_PRESETS, buildServerConfig, getPreset } from "../lib/presets.ts";

describe("SF MCP capability conflict planning", () => {
  it("keeps every native overlap claim tied to a declared extension", () => {
    const extensionIds = new Set(SF_PI_REGISTRY.map((entry) => entry.id));
    for (const preset of SALESFORCE_MCP_PRESETS) {
      for (const overlap of preset.overlaps) {
        expect(extensionIds.has(overlap.nativeExtensionId), overlap.nativeExtensionId).toBe(true);
      }
    }
  });

  it("recommends the scoped mutation server instead of SObject All when SF SOQL is enabled", () => {
    const plan = planPresetConflicts(getPreset("sobject-all"), new Set(["sf-soql"]));

    expect(plan.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nativeExtensionId: "sf-soql",
          relationship: "direct",
        }),
      ]),
    );
    expect(plan.recommendation).toMatchObject({
      resolution: "use-sobject-mutations",
      alternatePresetId: "sobject-mutations",
    });
  });

  it("keeps only complementary mutation tools when SF SOQL owns reads", () => {
    const config = buildServerConfig(getPreset("sobject-mutations"), "complement-native", {
      environment: "sandbox",
      oauthClientId: "consumer-key",
    });

    expect(config.exposure).toBe("hidden");
    expect(config.toolExposure).toEqual({
      createSobjectRecord: "codemode-deferred",
      updateSobjectRecord: "codemode-deferred",
      updateRelatedRecord: "codemode-deferred",
    });
    expect(config.toolExposure).not.toHaveProperty("soqlQuery");
    expect(config.toolExposure).not.toHaveProperty("getObjectSchema");
  });

  it("recommends the native Data 360 families when they are enabled", () => {
    const plan = planPresetConflicts(getPreset("data360"), new Set(["sf-data360"]));

    expect(plan.recommendation.resolution).toBe("native-only");
    expect(plan.conflicts[0]).toMatchObject({
      nativeExtensionId: "sf-data360",
      relationship: "direct",
    });
  });

  it("allows a non-overlapping Marketing Cloud preset normally", () => {
    const plan = planPresetConflicts(getPreset("marketing-cloud"), new Set(["sf-soql"]));

    expect(plan.conflicts).toEqual([]);
    expect(plan.recommendation.resolution).toBe("enable");
  });

  it("builds the documented Data 360 sandbox endpoint", () => {
    const config = buildServerConfig(getPreset("data360"), "side-by-side", {
      environment: "sandbox",
      oauthClientId: "consumer-key",
    });

    expect(config.url).toBe("https://api.salesforce.com/platform/mcp/v1/data/sandbox/data360");
  });

  it("keeps custom remote MCP presets on HTTPS", () => {
    expect(() =>
      buildServerConfig(getPreset("custom-salesforce"), "enable", {
        customUrl: "http://example.test/mcp",
      }),
    ).toThrow("must use HTTPS");
  });
});
