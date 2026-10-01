/* SPDX-License-Identifier: Apache-2.0 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { renderIntegrationResult } from "../lib/render.ts";
import type { ToolResult } from "../lib/types.ts";

const theme = {
  fg: (color: string, text: string) => `[${color}]${text}[/]`,
  bold: (text: string) => `**${text}**`,
  bg: (color: string, text: string) => `{${color}}${text}{/}`,
} as unknown as Theme;

describe("SF Integrate Result Card", () => {
  it("renders plan scope, OAuth proof, artifact, and next step", () => {
    const result: ToolResult = {
      content: [{ type: "text", text: "compact plan" }],
      details: {
        ok: true,
        action: "design.plan",
        card: {
          tool: { id: "sf-integrate", label: "SF Integrate", icon: "🔗" },
          title: "Integration Plan · Headless 360 MCP",
          status: "warning",
          summary: "Create one public External Client App.",
          scope: [{ label: "org", value: "IntegrationDev", tone: "info" }],
          sections: [
            {
              icon: "🔐",
              title: "OAuth",
              rows: [
                { label: "Callback", value: "http://localhost:8765/callback" },
                { label: "Scopes", value: "mcp_api · refresh_token" },
              ],
            },
          ],
          artifacts: [{ label: "plan", path: "/tmp/plan.json", kind: "json" }],
          next: ["Review, then apply."],
        },
      },
    };

    const rendered = renderIntegrationResult(result, { expanded: true }, theme)
      .render(100)
      .join("\n");

    expect(rendered).toContain("Integration Plan");
    expect(rendered).toContain("http://localhost:8765/callback");
    expect(rendered).toContain("/tmp/plan.json");
    expect(rendered).toContain("Review, then apply.");
  });

  it("falls back to compact model text without a card", () => {
    const rendered = renderIntegrationResult(
      {
        content: [{ type: "text", text: "fallback" }],
        details: { ok: false, action: "setup.verify" },
      },
      {},
      theme,
    )
      .render(80)
      .join("\n");

    expect(rendered).toContain("fallback");
  });
});
