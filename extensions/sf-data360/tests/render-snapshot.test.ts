/* SPDX-License-Identifier: Apache-2.0 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  renderD360Call,
  renderD360MetadataCall,
  renderD360MetadataResult,
  renderD360ProbeCall,
  renderD360ProbeResult,
  renderD360Result,
} from "../lib/display/render.ts";
import type { D360ResultCard } from "../lib/display/card.ts";

const passthroughTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function renderToString(text: Text, width = 120): string {
  return text
    .render(width)
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n");
}

describe("d360 facade renderers", () => {
  it("renderCall summarizes action and subject", () => {
    const rendered = renderToString(
      renderD360Call(
        {
          action: "runbook",
          runbook: "agent_observability.stdm_session_timeline",
          target_org: "AgentforceSTDM",
        },
        passthroughTheme,
      ),
    );

    expect(rendered).toBe(
      "☁️ d360 runbook · agent_observability.stdm_session_timeline · AgentforceSTDM",
    );
  });

  it("renderResult uses collapsed card output by default", () => {
    const rendered = renderToString(
      renderD360Result(
        { details: { ok: true, card: stdmCard() } },
        { expanded: false },
        passthroughTheme,
      ),
    );

    expect(rendered).toContain("💬 STDM session timeline ✅");
    expect(rendered).toContain("AgentforceSTDM · default · 8 rows");
    expect(rendered).toContain("📄 Full JSON: /tmp/pi-d360/output.json");
    expect(rendered.split("\n").length).toBeLessThanOrEqual(8);
  });

  it("renderResult supports expanded card output", () => {
    const rendered = renderToString(
      renderD360Result(
        { details: { ok: true, sfPi: { data: { card: stdmCard() } } } },
        { expanded: true },
        passthroughTheme,
      ),
    );

    expect(rendered).toContain("Facts");
    expect(rendered).toContain("Messages");
    expect(rendered).toContain("→ Run join_interaction_trace next");
  });

  it("renderMetadataCall summarizes action and object", () => {
    const rendered = renderToString(
      renderD360MetadataCall(
        {
          action: "describe_dmo",
          api_name: "ssot__AiAgentInteraction__dlm",
          target_org: "AgentforceSTDM",
        },
        passthroughTheme,
      ),
    );

    expect(rendered).toBe(
      "🧭 d360 metadata describe_dmo · ssot__AiAgentInteraction__dlm · AgentforceSTDM",
    );
  });

  it("renderMetadataResult uses cards", () => {
    const rendered = renderToString(
      renderD360MetadataResult(
        { details: { ok: true, card: { ...stdmCard(), icon: "🧭", title: "Data 360 metadata" } } },
        {},
        passthroughTheme,
      ),
    );

    expect(rendered).toContain("🧭 Data 360 metadata ✅");
    expect(rendered).toContain("📄 Full JSON: /tmp/pi-d360/output.json");
  });

  it("renderProbeCall summarizes target org", () => {
    const rendered = renderToString(
      renderD360ProbeCall({ target_org: "AgentforceSTDM" }, passthroughTheme),
    );

    expect(rendered).toBe("🩺 d360 probe AgentforceSTDM");
  });

  it("renderProbeResult uses cards", () => {
    const rendered = renderToString(
      renderD360ProbeResult(
        { details: { ok: true, card: { ...stdmCard(), icon: "🩺", title: "Data 360 readiness" } } },
        {},
        passthroughTheme,
      ),
    );

    expect(rendered).toContain("🩺 Data 360 readiness ✅");
    expect(rendered).toContain("📄 Full JSON: /tmp/pi-d360/output.json");
  });

  it("renderResult falls back to summary when no card is present", () => {
    const rendered = renderToString(
      renderD360Result(
        { details: { ok: true, summary: "d360_data_spaces_list HTTP 200" } },
        {},
        passthroughTheme,
      ),
    );

    expect(rendered).toBe("✓ d360_data_spaces_list HTTP 200");
  });
});

function stdmCard(): D360ResultCard {
  return {
    status: "success",
    icon: "💬",
    title: "STDM session timeline",
    subtitle: "AgentforceSTDM · default · 8 rows",
    summary: "Fetched one Agentforce session timeline.",
    facts: [{ label: "Rows", value: "8" }],
    sections: [
      {
        title: "Messages",
        icon: "💬",
        lines: [
          "👤 Hi! What is Agent Script?",
          "🤖 Hi, I'm an AI assistant.",
          "👤 What is this demo?",
        ],
      },
    ],
    artifacts: [{ label: "Full JSON", path: "/tmp/pi-d360/output.json", kind: "json" }],
    nextSteps: ["Run join_interaction_trace next"],
  };
}
