/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { renderCardCollapsed, renderCardExpanded, renderCardForLlm } from "../lib/display/card.ts";
import { probeResultToCard } from "../lib/display/probe-card.ts";

describe("d360_probe result card", () => {
  it("summarizes readiness counts and keeps artifact visible", () => {
    const card = probeResultToCard(sampleProbe(), "/tmp/pi-d360-probe/output.json");
    const rendered = renderCardCollapsed(card, { collapsedMaxLines: 8 });

    expect(card.status).toBe("warning");
    expect(rendered).toContain("📊 Data 360 readiness ⚠️");
    expect(rendered).toContain("AgentforceSTDM · API v66.0 · partial");
    expect(rendered).toContain("agent_platform_tracing_dlo");
    expect(rendered).toContain("📄 Full JSON: /tmp/pi-d360-probe/output.json");
    expect(rendered.split("\n").length).toBeLessThanOrEqual(12);
  });

  it("renders expanded surface details", () => {
    const rendered = renderCardExpanded(probeResultToCard(sampleProbe()));

    expect(rendered).toContain("Facts");
    expect(rendered).toContain("• Ready/populated: 2");
    expect(rendered).toContain("• Empty: 1");
    expect(rendered).toContain("☁️ Surfaces");
    expect(rendered).toContain("✅ data_spaces: enabled_populated");
    expect(rendered).toContain("⚪ segments: enabled_empty");
  });

  it("renders blocked probes as error cards", () => {
    const card = probeResultToCard({
      targetOrg: "ExampleOrg",
      apiVersion: "66.0",
      state: "blocked",
      guidance: "No sampled Data 360 surfaces were reachable.",
      probes: [{ name: "data_spaces", path: "/ssot/data-spaces", state: "tenant_missing" }],
    });

    expect(card.status).toBe("error");
    expect(renderCardForLlm(card)).toContain("❌");
  });
});

function sampleProbe() {
  return {
    targetOrg: "AgentforceSTDM",
    apiVersion: "66.0",
    state: "partial" as const,
    guidance: "Some Data 360 surfaces are reachable.",
    probes: [
      {
        name: "data_spaces",
        path: "/ssot/data-spaces",
        state: "enabled_populated" as const,
        count: 1,
        countKind: "total" as const,
      },
      {
        name: "data_streams",
        path: "/ssot/data-streams?limit=1",
        state: "enabled_populated" as const,
        count: 24,
        countKind: "total" as const,
      },
      {
        name: "segments",
        path: "/ssot/segments?limit=1",
        state: "enabled_empty" as const,
        count: 0,
        countKind: "total" as const,
      },
      {
        name: "agent_platform_tracing_dlo",
        path: "/ssot/data-lake-objects/ObservabilitySpans__dll",
        state: "cli_error" as const,
        message: "Please provide a valid recordId of type DataLakeObjectInstance.",
      },
    ],
  };
}
