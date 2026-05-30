/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { applyReportFilters, parseSeverityThreshold } from "../lib/report-filter.ts";
import type { CodeAnalyzerReportSummary, CodeAnalyzerViolation } from "../lib/types.ts";

function violation(input: {
  engine: string;
  rule: string;
  severity: number;
  file: string;
}): CodeAnalyzerViolation {
  return {
    engine: input.engine,
    rule: input.rule,
    severity: input.severity,
    primaryLocationIndex: 0,
    locations: [{ file: input.file, startLine: 1, startColumn: 1 }],
    message: input.rule,
  };
}

function summary(): CodeAnalyzerReportSummary {
  return {
    kind: "run",
    ok: true,
    source: "code-analyzer-cli",
    command: "report",
    durationMs: 0,
    exitCode: 0,
    run: {
      violations: [
        violation({
          engine: "pmd",
          rule: "ApexCRUDViolation",
          severity: 2,
          file: "classes/Foo.cls",
        }),
        violation({ engine: "eslint", rule: "no-var", severity: 3, file: "lwc/foo/foo.js" }),
        violation({ engine: "pmd", rule: "ApexDoc", severity: 4, file: "classes/Bar.cls" }),
      ],
    },
  };
}

describe("Code Analyzer report filters", () => {
  it("parses named severity thresholds", () => {
    expect(parseSeverityThreshold("high")).toBe(2);
    expect(parseSeverityThreshold("moderate")).toBe(3);
    expect(parseSeverityThreshold("5")).toBe(5);
    expect(parseSeverityThreshold("nope")).toBeUndefined();
  });

  it("filters by engine, severity, rule, and file", () => {
    const filtered = applyReportFilters(summary(), {
      engine: "pmd",
      severity_threshold: "3",
      rule: "ApexCRUDViolation",
      file: "Foo.cls",
    });

    expect(filtered.run?.violationCounts?.total).toBe(1);
    expect(filtered.run?.violations?.[0]?.rule).toBe("ApexCRUDViolation");
  });
});
