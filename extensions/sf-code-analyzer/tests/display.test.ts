/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { renderToolSummary, selectFindings } from "../lib/display.ts";
import type { CodeAnalyzerReportSummary, CodeAnalyzerViolation } from "../lib/types.ts";

function violation(rule: string, severity: number): CodeAnalyzerViolation {
  return {
    rule,
    engine: "pmd",
    severity,
    primaryLocationIndex: 0,
    locations: [{ file: `force-app/${rule}.cls`, startLine: severity, startColumn: 1 }],
    message: `Message for ${rule}`,
    resources: [`https://example.com/${rule}`],
  };
}

describe("sf-code-analyzer display", () => {
  it("keeps all severity 1-2 findings and bounds lower severity findings", () => {
    const findings = [
      ...Array.from({ length: 3 }, (_, i) => violation(`critical${i}`, 1)),
      ...Array.from({ length: 2 }, (_, i) => violation(`high${i}`, 2)),
      ...Array.from({ length: 12 }, (_, i) => violation(`moderate${i}`, 3)),
      ...Array.from({ length: 8 }, (_, i) => violation(`low${i}`, 4)),
    ];

    const selected = selectFindings(findings);

    expect(selected.filter((v) => v.severity <= 2)).toHaveLength(5);
    expect(selected.filter((v) => v.severity === 3)).toHaveLength(10);
    expect(selected.filter((v) => v.severity >= 4)).toHaveLength(5);
  });

  it("renders report path and actionable findings", () => {
    const summary: CodeAnalyzerReportSummary = {
      kind: "run",
      ok: true,
      source: "code-analyzer-cli",
      command: "sf code-analyzer run",
      durationMs: 1234,
      reportFile: "/tmp/report.json",
      outputFiles: ["/tmp/report.json"],
      exitCode: 0,
      run: {
        violationCounts: { total: 1, sev1: 0, sev2: 1, sev3: 0, sev4: 0, sev5: 0 },
        violations: [violation("ApexCRUDViolation", 2)],
      },
    };

    const rendered = renderToolSummary(summary);

    expect(rendered).toContain("Salesforce Code Analyzer CLI scan completed");
    expect(rendered).toContain("Tool: sf code-analyzer run");
    expect(rendered).toContain("Violations: 1");
    expect(rendered).toContain("JSON report: /tmp/report.json");
    expect(rendered).toContain("pmd/ApexCRUDViolation");
  });
});
