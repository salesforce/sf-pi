/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  mergeSfPiDiagnosticsDetails,
  renderDiagnosticsForProfile,
  severityFromLsp,
  type SfPiDiagnosticsMetadata,
} from "../diagnostics.ts";

function metadata(count: number): SfPiDiagnosticsMetadata {
  return {
    source: "sf-lsp",
    status: "error",
    filePath: "/project/classes/Example.cls",
    fileName: "Example.cls",
    language: "apex",
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: `Example.cls: ${count} diagnostics`,
    renderedText: "LSP feedback: Example.cls",
    diagnostics: Array.from({ length: count }, (_, index) => ({
      severity: "error",
      message: `Problem ${index + 1}`,
      line: index + 1,
      character: 0,
      range: {
        start: { line: index, character: 0 },
        end: { line: index, character: 5 },
      },
    })),
  };
}

describe("sf-pi diagnostics metadata", () => {
  it("maps LSP severities to public labels", () => {
    expect(severityFromLsp(1)).toBe("error");
    expect(severityFromLsp(2)).toBe("warning");
    expect(severityFromLsp(3)).toBe("info");
    expect(severityFromLsp(4)).toBe("hint");
  });

  it("merges diagnostics into existing tool details", () => {
    const merged = mergeSfPiDiagnosticsDetails({ diff: "---" }, metadata(1));
    expect(merged.diff).toBe("---");
    expect(merged.sfPiDiagnostics?.fileName).toBe("Example.cls");
  });

  it("renders compact diagnostics with an omitted count", () => {
    const rendered = renderDiagnosticsForProfile(metadata(5), "compact");
    expect(rendered).toContain("[sf-lsp] Example.cls: 5 diagnostics");
    expect(rendered).toContain("Problem 1");
    expect(rendered).toContain("(+2 more)");
  });
});
