/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { planPresetConflicts } from "../lib/conflict-planner.ts";
import {
  buildServerConfig,
  getPreset,
  intercomMcpUrl,
  isPresetConfigCompatible,
} from "../lib/presets.ts";
import { getPresetToolCatalog } from "../lib/tool-catalog.ts";
import { buildConflictAwareToolPolicy, inspectActiveToolConflicts } from "../lib/tool-conflicts.ts";
import { buildToolExposurePolicy, hasReviewedToolPolicy } from "../lib/tool-policy.ts";

const DATA_TOOLS = [
  "search",
  "fetch",
  "search_conversations",
  "get_conversation",
  "search_contacts",
  "get_contact",
  "list_companies",
  "get_company",
  "list_articles",
  "search_articles",
  "get_article",
  "create_article",
  "update_article",
  "add_internal_note",
];
const OPERATOR_TOOLS = [
  "send_operator_message",
  "get_operator_response",
  "get_proposal_details",
  "apply_proposals",
  "reject_proposals",
];

describe("Intercom MCP preset", () => {
  const preset = getPreset("intercom");

  it("reviews the published 14 data tools and 5 Fin Operator tools", () => {
    expect(preset).toMatchObject({
      serverName: "intercom",
      category: "Fin",
      transport: "http",
      setup: "intercom-oauth",
      support: "ga",
      risk: "mixed",
    });
    expect(preset.approvedTools).toEqual([...DATA_TOOLS, ...OPERATOR_TOOLS]);
    expect(hasReviewedToolPolicy(preset)).toBe(true);
    const risks = Object.fromEntries(
      getPresetToolCatalog(preset).tools.map((tool) => [tool.name, tool.risk]),
    );
    expect(risks.apply_proposals).toBe("destructive");
    expect(risks.send_operator_message).toBe("mixed");
    expect(risks.get_proposal_details).toBe("read");
    expect(["create_article", "update_article", "add_internal_note"].map((t) => risks[t])).toEqual([
      "write",
      "write",
      "write",
    ]);
  });

  it("builds a Pi-native DCR OAuth connection with mcp and operator scopes", () => {
    const config = buildServerConfig(preset, "enable");
    expect(config).toMatchObject({
      url: "https://mcp.intercom.com/mcp",
      oauth: { scope: "mcp operator" },
      description: preset.description,
      timeout: 120,
      exposure: "hidden",
    });
    if (!("url" in config)) throw new Error("expected an HTTP MCP config");
    expect(config.oauth).not.toHaveProperty("clientId");
    expect(config).not.toHaveProperty("headers");
    expect(Object.keys(config.toolExposure ?? {})).toEqual(preset.approvedTools);
    expect(isPresetConfigCompatible(preset, config)).toEqual({ compatible: true });
  });

  it("selects the EU endpoint and refuses unsupported regions", () => {
    expect(buildServerConfig(preset, "enable", { region: "EU" })).toMatchObject({
      url: "https://mcp.eu.intercom.com/mcp",
    });
    expect(intercomMcpUrl(undefined)).toBe("https://mcp.intercom.com/mcp");
    expect(() => buildServerConfig(preset, "enable", { region: "PROD_JP" })).toThrow(
      /only US and EU/,
    );
  });

  it("rejects bearer-header, fixed-client, legacy SSE, and unreviewed entries", () => {
    const good = buildServerConfig(preset, "enable");
    if (!("url" in good)) throw new Error("expected an HTTP MCP config");
    const bearer = { ...good, headers: { Authorization: "Bearer ${INTERCOM_TOKEN}" } };
    const fixedClient = { ...good, oauth: { clientId: "x", scope: "mcp operator" } };
    const sse = { ...good, url: "https://mcp.intercom.com/sse" };
    const unreviewed = { url: good.url, oauth: good.oauth, exposure: "codemode" as const };
    expect(isPresetConfigCompatible(preset, bearer).compatible).toBe(false);
    expect(isPresetConfigCompatible(preset, fixedClient).compatible).toBe(false);
    expect(isPresetConfigCompatible(preset, sse).compatible).toBe(false);
    expect(isPresetConfigCompatible(preset, unreviewed).compatible).toBe(false);
  });

  it("read-only profile exposes only reads; quarantine hides everything", () => {
    const readOnly = buildToolExposurePolicy(preset, "read-only");
    const exposed = Object.entries(readOnly.exposures)
      .filter(([, exposure]) => exposure !== "hidden")
      .map(([name]) => name);
    expect(exposed).toEqual([
      ...DATA_TOOLS.slice(0, 11),
      "get_operator_response",
      "get_proposal_details",
    ]);
    expect(Object.values(buildToolExposurePolicy(preset, "quarantine").exposures)).toEqual(
      Array(19).fill("hidden"),
    );
  });

  it("starts new connections with every reviewed tool available (ADR 0154)", () => {
    expect(preset.initialToolProfile).toBe("all-approved");
    const initial = buildToolExposurePolicy(preset, preset.initialToolProfile ?? "quarantine");
    expect(Object.values(initial.exposures)).toEqual(Array(19).fill("codemode"));
    // Other presets keep the Quarantine default.
    expect(getPreset("slack").initialToolProfile).toBeUndefined();
    expect(getPreset("tableau").initialToolProfile).toBeUndefined();
  });

  it("keeps Operator tools callable when SF Fin is enabled; Guardrail mediates them", () => {
    const plan = planPresetConflicts(preset, new Set(["sf-fin"]));
    expect(plan.conflicts[0]).toMatchObject({
      nativeExtensionId: "sf-fin",
      relationship: "partial",
    });
    expect(plan.recommendation.resolution).not.toBe("native-only");
    expect(
      inspectActiveToolConflicts(preset, plan)
        .map((c) => c.toolName)
        .sort(),
    ).toEqual(["apply_proposals", "send_operator_message"]);
    const policy = buildConflictAwareToolPolicy(preset, plan);
    expect(Object.values(policy.exposures)).toEqual(Array(19).fill("codemode"));
  });
});
