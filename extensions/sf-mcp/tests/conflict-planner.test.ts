/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { SF_PI_REGISTRY } from "../../../catalog/registry.ts";
import { planPresetConflicts } from "../lib/conflict-planner.ts";
import {
  SALESFORCE_MCP_PRESETS,
  buildServerConfig,
  getPreset,
  isPresetConfigCompatible,
} from "../lib/presets.ts";

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
    expect(config.description).toBe(getPreset("sobject-mutations").description);
    expect(config.toolExposure).toEqual({
      createSobjectRecord: "codemode",
      updateSobjectRecord: "codemode",
      updateRelatedRecord: "codemode",
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

  it("limits Salesforce DX conflict claims to toolsets the preset actually enables", () => {
    const preset = getPreset("salesforce-dx");
    expect(preset.overlaps.map((overlap) => overlap.nativeExtensionId)).toEqual([
      "sf-soql",
      "sf-apex",
    ]);
  });

  it("allows a non-overlapping Marketing Cloud preset normally", () => {
    const plan = planPresetConflicts(getPreset("marketing-cloud"), new Set(["sf-soql"]));

    expect(plan.conflicts).toEqual([]);
    expect(plan.recommendation.resolution).toBe("enable");
  });

  it("builds governed configurations for every documented hosted preset", () => {
    const expectedPaths = {
      "backup-recover": "sandbox/platform/backup-and-recover",
      "content-readonly": "sandbox/platform/content-readonly",
      "content-write": "sandbox/platform/content-write",
      "headless-360": "sandbox/platform/headless-360",
      "tableau-next": "sandbox/analytics/tableau-next",
      "crm-analytics": "sandbox/analytics/crma-beta",
    } as const;

    for (const [presetId, suffix] of Object.entries(expectedPaths)) {
      const config = buildServerConfig(getPreset(presetId), "enable", {
        environment: "sandbox",
        oauthClientId: "consumer-key",
      });
      expect("url" in config ? config.url : undefined).toBe(
        `https://api.salesforce.com/platform/mcp/v1/${suffix}`,
      );
      expect(config.exposure).toBe("hidden");
      expect(Object.keys(config.toolExposure ?? {}).length).toBeGreaterThan(0);
      expect(Object.values(config.toolExposure ?? {})).toEqual(
        expect.arrayContaining(["codemode"]),
      );
    }
  });

  it("refuses to adopt an ungoverned full-exposure hosted entry", () => {
    expect(
      isPresetConfigCompatible(getPreset("sobject-reads"), {
        url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-reads",
        oauth: { clientId: "consumer-key" },
        exposure: "codemode",
      }),
    ).toMatchObject({ compatible: false });
  });

  it("marks Content presets as alpha while their documented client support is limited", () => {
    expect(getPreset("content-readonly")).toMatchObject({ support: "alpha" });
    expect(getPreset("content-write")).toMatchObject({ support: "alpha" });
  });

  it("builds the documented Data 360 sandbox endpoint", () => {
    const config = buildServerConfig(getPreset("data360"), "side-by-side", {
      environment: "sandbox",
      oauthClientId: "consumer-key",
    });

    expect("url" in config ? config.url : undefined).toBe(
      "https://api.salesforce.com/platform/mcp/v1/data/sandbox/data360",
    );
    expect(config.description).toBe(getPreset("data360").description);
    expect(config.exposure).toBe("hidden");
    expect(config.toolExposure).toEqual({
      search: "codemode",
      payload_examples: "codemode",
      execute: "codemode",
    });
  });

  it("keeps custom remote MCP presets on HTTPS", () => {
    expect(() =>
      buildServerConfig(getPreset("custom-salesforce"), "enable", {
        customUrl: "http://example.test/mcp",
      }),
    ).toThrow("must use HTTPS");
  });
});
