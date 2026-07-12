/* SPDX-License-Identifier: Apache-2.0 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  renderSfPiNoticeCardText,
  renderSfPiNoticePanel,
  renderSfPiProgressText,
  renderSfPiResultCardText,
  type SfPiNoticeCard,
  type SfPiResultCard,
} from "../result-card.ts";

const theme = {
  fg: (color: string, text: string) => `[${color}]${text}[/]`,
  bold: (text: string) => `**${text}**`,
  bg: (color: string, text: string) => `{${color}}${text}{/}`,
} as unknown as Theme;

describe("sf-pi result card renderer", () => {
  it("renders compact status, scope, sections, artifacts, and next step", () => {
    const card: SfPiResultCard = {
      tool: { id: "sf-example", label: "Example", icon: "◇" },
      title: "Example Run",
      status: "warning",
      summary: "Completed with review items.",
      chips: [{ label: "2 findings", tone: "warning" }],
      scope: [{ label: "target", value: "force-app", tone: "info" }],
      sections: [
        {
          title: "Findings",
          icon: "🔥",
          rows: [
            { label: "high", value: "first" },
            { label: "low", value: "second" },
          ],
        },
      ],
      artifacts: [{ label: "report", path: "/tmp/report.json", kind: "json" }],
      next: ["fix high severity first"],
    };

    const rendered = renderSfPiResultCardText(card, {}, theme);

    expect(rendered).toContain("[toolTitle]**◇ Example Run**[/]");
    expect(rendered).toContain("[warning]⚠ review[/]");
    expect(rendered).toContain("[accent]force-app[/]");
    expect(rendered).toContain("[accent]**🔥 Findings**[/]");
    expect(rendered).toContain("/tmp/report.json");
    expect(rendered).toContain("fix high severity first");
  });

  it("renders grouped notice cards with breathing room", () => {
    const card: SfPiNoticeCard = {
      icon: "🧪",
      title: "Code Analyzer Auto-scan",
      status: "success",
      statusText: "Clean",
      duration: "8.2s",
      groups: [
        {
          title: "Scope",
          rows: [
            { label: "Tool", value: "Local Salesforce Code Analyzer CLI" },
            { label: "Engines", value: "eslint:Recommended", tone: "info" },
          ],
        },
        {
          title: "Evidence",
          rows: [{ label: "Report", value: "…/run.json", multiline: true }],
        },
      ],
      footer: "No action needed",
    };

    const rendered = renderSfPiNoticeCardText(card, theme);

    expect(rendered).toContain("[toolTitle]**🧪 Code Analyzer Auto-scan**[/]");
    expect(rendered).toContain("[success]✓[/] [success]**Clean**[/]");
    expect(rendered).toContain("[accent]**Scope**[/]");
    expect(rendered).toContain("[muted]Engines    [/][accent]eslint:Recommended[/]");
    expect(rendered).toContain("[success]No action needed[/]");
  });

  it("renders notice panels with full-width background", () => {
    const card: SfPiNoticeCard = {
      icon: "🧪",
      title: "Code Analyzer Auto-scan",
      status: "running",
      statusText: "Running",
      groups: [{ title: "Scope", rows: [{ label: "Targets", value: "1 changed file" }] }],
      footer: "Report will appear when complete",
    };

    const lines = renderSfPiNoticePanel(card, theme).render(80);

    expect(lines[0]).toContain("{customMessageBg}");
    expect(lines).toContainEqual(
      expect.stringContaining("[toolTitle]**🧪 Code Analyzer Auto-scan**[/]"),
    );
    expect(lines.every((line) => line.startsWith("{customMessageBg}"))).toBe(true);
  });

  it("renders measured and indeterminate progress", () => {
    expect(renderSfPiProgressText({ phase: "scanning", completed: 5, total: 10 }, theme)).toContain(
      "[accent][█████░░░░░][/]",
    );
    expect(renderSfPiProgressText({ phase: "running" }, theme)).toContain("[accent]⏳[/]");
  });
});
