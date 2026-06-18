/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the SF Feedback Manager form panel. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createFeedbackWizardPanel } from "../lib/feedback-wizard-panel.ts";

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const tui = {
  terminal: { rows: 40, cols: 120 },
  requestRender: vi.fn(),
} as never;

describe("FeedbackWizardPanel", () => {
  it("opens a native field editor from the form overview and saves the field", () => {
    const panel = createFeedbackWizardPanel(theme, tui, "bug", vi.fn(), vi.fn(), vi.fn());

    expect(panel.renderContent(120).join("\n")).toContain("Enter edit field");

    panel.handleInput("\r");
    const editing = panel.renderContent(120).join("\n");
    expect(editing).toContain("Enter save field");
    expect(editing).toContain("Title");

    for (const char of "Broken help") panel.handleInput(char);
    panel.handleInput("\r");

    const overview = panel.renderContent(120).join("\n");
    expect(overview).toContain("Broken help");
    expect(overview).toContain("✓");
  });

  it("saves multiline field edits with ctrl+s without closing the form", () => {
    const summaryPanel = createFeedbackWizardPanel(theme, tui, "bug", vi.fn(), vi.fn(), vi.fn());
    summaryPanel.handleInput("\u001b[B");
    summaryPanel.handleInput("\r");
    expect(summaryPanel.renderContent(120).join("\n")).toContain("Ctrl+S save field");

    for (const char of "Line one") summaryPanel.handleInput(char);
    summaryPanel.handleInput("\u001b[13;2u");
    for (const char of "Line two") summaryPanel.handleInput(char);
    summaryPanel.handleInput("\u0013");

    const rows = summaryPanel.renderContent(120);
    const overview = rows.join("\n");
    expect(overview).toContain("Line one ↵ Line two");
    expect(overview).toContain("✓");
    expect(rows.every((row) => !row.includes("\n"))).toBe(true);
  });

  it("previews from the overview after required title is filled", async () => {
    const prepare = vi.fn(async () => ({
      title: "[Bug] Broken help",
      labels: ["feedback"],
      body: "body",
    }));
    const panel = createFeedbackWizardPanel(theme, tui, "bug", prepare, vi.fn(), vi.fn());

    panel.handleInput("\r");
    for (const char of "Broken help") panel.handleInput(char);
    panel.handleInput("\r");
    panel.handleInput("p");
    await Promise.resolve();

    expect(prepare).toHaveBeenCalled();
    expect(panel.renderContent(120).join("\n")).toContain("Preview");
  });
});
