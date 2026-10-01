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
import { getPresetToolCatalog } from "../lib/tool-catalog.ts";
import { hasReviewedToolPolicy } from "../lib/tool-policy.ts";

describe("SF MCP capability conflict planning", () => {
  it("omits the legacy SObject server family from the catalog", () => {
    const ids = SALESFORCE_MCP_PRESETS.map((preset) => preset.id);

    expect(ids).not.toEqual(
      expect.arrayContaining([
        "sobject-reads",
        "sobject-mutations",
        "sobject-deletes",
        "sobject-all",
      ]),
    );
    expect(ids).toContain("headless-360");
  });

  it("keeps documented tool details aligned with every approved hosted contract", () => {
    for (const preset of SALESFORCE_MCP_PRESETS) {
      const catalog = getPresetToolCatalog(preset);
      expect(catalog.capabilities.length, preset.id).toBeGreaterThan(0);
      if (!preset.approvedTools) continue;
      expect(
        catalog.tools.map((tool) => tool.name),
        preset.id,
      ).toEqual([...preset.approvedTools]);
      for (const tool of catalog.tools) {
        expect(tool.description.length, `${preset.id}:${tool.name}`).toBeGreaterThan(10);
        expect(tool.capability.length, `${preset.id}:${tool.name}`).toBeGreaterThan(3);
      }
    }
  });

  it("catalogs the documented DX, Marketing Cloud, and MuleSoft tool surfaces", () => {
    const dx = getPresetToolCatalog(getPreset("salesforce-dx"));
    const marketing = getPresetToolCatalog(getPreset("marketing-cloud"));
    const mulesoft = getPresetToolCatalog(getPreset("mulesoft-dx"));

    expect(dx.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "get_username",
        "list_all_orgs",
        "run_soql_query",
        "deploy_metadata",
        "run_apex_test",
      ]),
    );
    expect(dx.tools.length).toBe(9);
    expect(marketing.tools.length).toBeGreaterThan(100);
    expect(marketing.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "sfmc_create_automation",
        "sfmc_delete_contacts",
        "sfmc_send_transactional_email",
        "sfmc_publish_journey",
      ]),
    );
    expect(mulesoft.tools.length).toBeGreaterThan(40);
    expect(mulesoft.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "generate_mule_flow",
        "search_asset",
        "deploy_mule_application",
        "manage_api_instance_policy",
      ]),
    );
    expect(hasReviewedToolPolicy(getPreset("salesforce-dx"))).toBe(true);
    expect(hasReviewedToolPolicy(getPreset("marketing-cloud"))).toBe(true);
    expect(hasReviewedToolPolicy(getPreset("mulesoft-dx"))).toBe(true);
  });

  it("builds an experimental Agentforce Sales sandbox preset without storing its secret", () => {
    const preset = getPreset("agentforce-sales");
    const config = buildServerConfig(preset, "enable", { oauthClientId: "public-client" });

    expect(config).toMatchObject({
      url: "https://api.salesforce.com/platform/mcp/v1-beta.2/sandbox/agentforce-sales",
      oauth: {
        clientId: "public-client",
        clientSecret: "${AGENTFORCE_SALES_CLIENT_SECRET}",
        callbackPort: 8765,
      },
      exposure: "codemode",
    });
    expect(preset).toMatchObject({ support: "alpha", risk: "mixed" });
    expect(getPresetToolCatalog(preset).capabilities.length).toBeGreaterThan(3);
  });

  it("generates exact hidden-by-default policies for the expanded catalogs", () => {
    const cases = [
      ["salesforce-dx", {}],
      ["marketing-cloud", { region: "US", tenantId: "tenant", marketingClientId: "client" }],
      ["mulesoft-dx", { region: "PROD_US" }],
    ] as const;
    for (const [presetId, setup] of cases) {
      const preset = getPreset(presetId);
      const config = buildServerConfig(preset, "side-by-side", setup);
      expect(config.exposure, presetId).toBe("hidden");
      expect(Object.keys(config.toolExposure ?? {}), presetId).toEqual([
        ...(preset.approvedTools ?? []),
      ]);
    }
  });

  it("keeps experimental Agentforce Sales native-only by default", () => {
    const plan = planPresetConflicts(getPreset("agentforce-sales"), new Set(["sf-soql"]));

    expect(plan.recommendation).toMatchObject({
      resolution: "native-only",
      summary: expect.stringContaining("explicit sandbox interoperability testing"),
    });
  });

  it("keeps every native overlap claim tied to a declared extension", () => {
    const extensionIds = new Set(SF_PI_REGISTRY.map((entry) => entry.id));
    for (const preset of SALESFORCE_MCP_PRESETS) {
      for (const overlap of preset.overlaps) {
        expect(extensionIds.has(overlap.nativeExtensionId), overlap.nativeExtensionId).toBe(true);
      }
    }
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

  it("accepts a governed hosted entry when reviewed tools use mixed exposure modes", () => {
    expect(
      isPresetConfigCompatible(getPreset("headless-360"), {
        url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/headless-360",
        oauth: { clientId: "consumer-key" },
        exposure: "hidden",
        toolExposure: {
          discover: "codemode",
          describe: "deferred",
          dispatch: "hidden",
          dispatch_readonly: "direct",
        },
      }),
    ).toEqual({ compatible: true });
  });

  it("refuses to adopt an ungoverned full-exposure hosted entry", () => {
    expect(
      isPresetConfigCompatible(getPreset("headless-360"), {
        url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/headless-360",
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
