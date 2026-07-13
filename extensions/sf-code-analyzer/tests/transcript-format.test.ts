/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";

import {
  formatApexGuruSkippedTranscript,
  formatApexGuruTranscript,
  formatLocalScanTranscript,
} from "../lib/auto-scan-transcript.ts";
import {
  CODE_ANALYZER_TRANSCRIPT_TYPE,
  createCodeAnalyzerTranscriptRenderer,
  emitCodeAnalyzerTranscript,
  registerCodeAnalyzerTranscriptRenderer,
  renderCodeAnalyzerTranscript,
} from "../lib/transcript.ts";

const theme = {
  fg: (color: string, text: string) => `[${color}]${text}[/]`,
  bold: (text: string) => `**${text}**`,
} as never;

describe("sf-code-analyzer auto-scan transcript", () => {
  it("renders friendly local CLI scan rows", () => {
    const text = formatLocalScanTranscript("clean", {
      selectors: ["eslint:Recommended"],
      targetCount: 2,
      durationMs: 1200,
    });
    expect(text).toContain("🧪 Code Analyzer Auto-scan");
    expect(text).toContain("✓ Clean");
    expect(text).toContain("Tool     Local Salesforce Code Analyzer CLI");
    expect(text).toContain("Engines  eslint:Recommended");
    expect(text).toContain("Targets  2 changed files");
    expect(text).toContain("Duration 1.2s");
  });

  it("renders foreground-colored auto-scan transcript rows", () => {
    const text = formatLocalScanTranscript("clean", {
      selectors: ["eslint:Recommended"],
      targetCount: 6,
      durationMs: 8100,
      reportFile: "/tmp/report.json",
    });

    const rendered = renderCodeAnalyzerTranscript(text, { status: "clean" }, theme);

    expect(rendered).toContain("[toolTitle]**🧪 Code Analyzer Auto-scan**[/]");
    expect(rendered).toContain("[success]✓[/] [success]**Clean**[/]");
    expect(rendered).toContain("[accent]**Scope**[/]");
    expect(rendered).toContain("[muted]Engines    [/][accent]eslint:Recommended[/]");
    expect(rendered).toContain("[accent]**Reasoning**[/]");
    expect(rendered).toContain("JS/TS changed file → eslint:Recommended");
    expect(rendered).toContain("[accent]**Evidence**[/]");
    expect(rendered).toContain("[muted]/tmp/report.json[/]");
  });

  it("registers human-only entry rendering instead of message rendering", () => {
    const pi = {
      registerEntryRenderer: vi.fn(),
      registerMessageRenderer: vi.fn(),
    };

    registerCodeAnalyzerTranscriptRenderer(pi as never);

    expect(pi.registerEntryRenderer).toHaveBeenCalledWith(
      CODE_ANALYZER_TRANSCRIPT_TYPE,
      expect.any(Function),
    );
    expect(pi.registerMessageRenderer).not.toHaveBeenCalled();
  });

  it("emits human-only transcript entries without sendMessage", () => {
    const pi = { appendEntry: vi.fn(), sendMessage: vi.fn() };

    emitCodeAnalyzerTranscript(pi as never, "🧪 Code Analyzer Auto-scan\n✓ Clean", {
      status: "clean",
    });

    expect(pi.appendEntry).toHaveBeenCalledWith(CODE_ANALYZER_TRANSCRIPT_TYPE, {
      content: "🧪 Code Analyzer Auto-scan\n✓ Clean",
      details: { status: "clean" },
    });
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("entry renderer preserves the existing transcript rendering", () => {
    const text = formatLocalScanTranscript("clean", {
      selectors: ["eslint:Recommended"],
      targetCount: 1,
      reportFile: "/tmp/report.json",
    });
    const renderer = createCodeAnalyzerTranscriptRenderer();
    const rendered = renderer(
      { data: { content: text, details: { status: "clean" } } } as never,
      { expanded: true } as never,
      theme,
    );

    expect(rendered).toBeDefined();
  });

  it("renders friendly ApexGuru scan rows", () => {
    const text = [
      formatApexGuruTranscript("clean", {
        file: "Foo.cls",
        durationMs: 1200,
        violationCount: 0,
      }),
      formatApexGuruSkippedTranscript({
        access: "ineligible",
        reason: "not enabled",
        targetCount: 1,
      }),
    ].join("\n");
    expect(text).toContain("✨ ApexGuru auto insight");
    expect(text).toContain("Tool: ApexGuru Insights org service");
    expect(text).toContain("ApexGuru auto insight skipped");
    expect(text).toContain("SF Browser to check Scale Center / ApexGuru Insights");
  });
});
