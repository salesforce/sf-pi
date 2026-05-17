/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  renderCardCollapsed,
  renderCardExpanded,
  renderCardForLlm,
  type D360ResultCard,
} from "../lib/display/card.ts";

describe("D360ResultCard render helpers", () => {
  it("renders a compact STDM timeline card with artifact visibility", () => {
    const rendered = renderCardCollapsed(stdmCard(), { collapsedMaxLines: 8 });
    const lines = rendered.split("\n");

    expect(lines.length).toBeLessThanOrEqual(12);
    expect(rendered).toContain("💬 STDM session timeline ✅");
    expect(rendered).toContain("AgentforceSTDM · default · 8 rows");
    expect(rendered).toContain("👤 Hi! What is Agent Script?");
    expect(rendered).toContain("📄 Full JSON: /tmp/pi-d360-a/output.json");
  });

  it("renders expanded cards with facts, sections, artifacts, and next steps", () => {
    const rendered = renderCardExpanded(stdmCard());

    expect(rendered).toContain("Facts");
    expect(rendered).toContain("• Session: 019e2218-ca4c");
    expect(rendered).toContain("Messages");
    expect(rendered).toContain("Artifacts");
    expect(rendered).toContain("Next");
    expect(rendered).toContain("→ Run join_interaction_trace on a specific interaction_id");
  });

  it("renders warning cards for missing Platform Tracing without hiding the reason", () => {
    const rendered = renderCardForLlm({
      status: "warning",
      icon: "🔗",
      title: "STDM ↔ Platform Trace",
      subtitle: "AgentforceSTDM · partial result",
      summary: "STDM context found, but Platform Tracing spans are unavailable.",
      facts: [
        { label: "Interaction", value: "91ae49c3" },
        { label: "Trace ID", value: "609d6983" },
      ],
      sections: [
        {
          icon: "⚠️",
          title: "Reason",
          lines: ['table "ssot__TelemetryTraceSpan__dlm" does not exist'],
        },
      ],
      artifacts: [{ label: "Full JSON", path: "/tmp/pi-d360-b/output.json", kind: "json" }],
      nextSteps: ["Use stdm_session_timeline for this org."],
    });

    expect(rendered).toContain("⚠️");
    expect(rendered).toContain('table "ssot__TelemetryTraceSpan__dlm" does not exist');
    expect(rendered).toContain("📄 Full JSON: /tmp/pi-d360-b/output.json");
  });

  it("supports empty Data Cloud list results", () => {
    const rendered = renderCardCollapsed({
      status: "success",
      icon: "🎯",
      title: "Segments",
      subtitle: "AgentforceSTDM · default",
      summary: "No segments found.",
      facts: [{ label: "Segments", value: "0" }],
      sections: [{ title: "Segments", lines: ["No segment rows returned."] }],
      artifacts: [{ label: "Full JSON", path: "/tmp/pi-d360-c/output.json", kind: "json" }],
    });

    expect(rendered).toContain("🎯 Segments ✅");
    expect(rendered).toContain("No segments found.");
    expect(rendered).toContain("📄 Full JSON: /tmp/pi-d360-c/output.json");
  });

  it("clips long lines for CLI readability", () => {
    const rendered = renderCardCollapsed(
      {
        status: "success",
        icon: "🌊",
        title: "Data streams",
        summary: "x".repeat(200),
        sections: [{ title: "Streams", lines: ["y".repeat(200)] }],
      },
      { lineMaxChars: 60 },
    );

    for (const line of rendered.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});

function stdmCard(): D360ResultCard {
  return {
    status: "success",
    icon: "💬",
    title: "STDM session timeline",
    subtitle: "AgentforceSTDM · default · 8 rows",
    summary: "Fetched one Agentforce session timeline.",
    facts: [
      { label: "Session", value: "019e2218-ca4c" },
      { label: "Rows", value: "8" },
      { label: "Trace IDs", value: "4" },
    ],
    sections: [
      {
        icon: "💬",
        title: "Messages",
        lines: [
          "👤 Hi! What is Agent Script?",
          "🤖 Hi, I'm an AI assistant. How can I help you?",
          "🤖 I can help with questions related to my demo capabilities...",
          "👤 What is this demo?",
          "🤖 This demo showcases how an AI assistant can interact...",
        ],
      },
    ],
    artifacts: [{ label: "Full JSON", path: "/tmp/pi-d360-a/output.json", kind: "json" }],
    nextSteps: ["Run join_interaction_trace on a specific interaction_id"],
  };
}
