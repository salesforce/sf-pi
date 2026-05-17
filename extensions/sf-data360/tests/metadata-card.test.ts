/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { renderCardCollapsed, renderCardExpanded, renderCardForLlm } from "../lib/display/card.ts";
import { metadataResultToCard } from "../lib/display/metadata-card.ts";

describe("d360_metadata result card", () => {
  it("summarizes DMO lists", () => {
    const card = metadataResultToCard(
      { action: "list_dmos" },
      [
        "Found 2 DMOs.",
        "Showing 2 of 2. Raw output: /tmp/raw.json",
        "Category counts: Engagement=1, Profile=1.",
        "",
        "| Category | Display Name | API Name |",
        "|---|---|---|",
        "| Engagement | AI Agent Interaction | `ssot__AiAgentInteraction__dlm` |",
        "| Profile | Account | `ssot__Account__dlm` |",
      ].join("\n"),
      {
        count: 2,
        shownCount: 2,
        unfilteredCount: 2,
        categoryCounts: { Engagement: 1, Profile: 1 },
      },
      { targetOrg: "AgentforceSTDM", rawOutputPath: "/tmp/pi-d360-meta/output.json" },
    );
    const rendered = renderCardCollapsed(card);

    expect(card.title).toBe("Data 360 DMOs");
    expect(rendered).toContain("🗂️ Data 360 DMOs ✅");
    expect(rendered).toContain("AI Agent Interaction — ssot__AiAgentInteraction__dlm");
    expect(rendered).toContain("📄 Full JSON: /tmp/pi-d360-meta/output.json");
  });

  it("summarizes DMO descriptions", () => {
    const card = metadataResultToCard(
      { action: "describe_dmo", api_name: "ssot__AiAgentInteraction__dlm" },
      [
        "AI Agent Interaction",
        "API name: `ssot__AiAgentInteraction__dlm`",
        "Category: ENGAGEMENT",
        "Data space: default",
        "Enabled: true",
        "Segmentable: false",
        "Editable: true",
        "Fields: 2",
        "Raw output: /tmp/raw.json",
        "",
        "| Field | Label | Type | Primary Key | Mapped | Usage |",
        "|---|---|---|---:|---:|---|",
        "| `ssot__Id__c` | AI Agent Interaction Id | Text | yes | yes | None |",
        "| `ssot__TelemetryTraceId__c` | Telemetry Trace | Text |  | yes | None |",
      ].join("\n"),
      {
        apiName: "ssot__AiAgentInteraction__dlm",
        fieldCount: 2,
        shownFieldCount: 2,
      },
      { targetOrg: "AgentforceSTDM", rawOutputPath: "/tmp/pi-d360-desc/output.json" },
    );
    const expanded = renderCardExpanded(card);

    expect(card.title).toBe("Data 360 metadata");
    expect(expanded).toContain("AI Agent Interaction schema.");
    expect(expanded).toContain("• API name: ssot__AiAgentInteraction__dlm");
    expect(expanded).toContain("ssot__TelemetryTraceId__c — Telemetry Trace · Text");
    expect(expanded).toContain("📄 Full JSON: /tmp/pi-d360-desc/output.json");
  });

  it("renders compact LLM output with next steps", () => {
    const card = metadataResultToCard(
      { action: "list_dlos", category: "Other" },
      "Found 0 DLOs in category Other.\nShowing 0 of 0. Raw output: /tmp/raw.json",
      { count: 0, shownCount: 0, unfilteredCount: 2, category: "Other" },
    );
    const rendered = renderCardForLlm(card);

    expect(rendered).toContain("🗂️ Data 360 DLOs ✅");
    expect(rendered).toContain("Category filter: Other");
    expect(rendered).toContain("Use d360_metadata describe_dlo");
  });
});
