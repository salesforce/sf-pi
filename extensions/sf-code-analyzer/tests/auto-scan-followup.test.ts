/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { buildAutoScanFollowUp } from "../lib/auto-scan-followup.ts";
import type { CodeAnalyzerViolation } from "../lib/types.ts";

function violation(): CodeAnalyzerViolation {
  return {
    engine: "pmd",
    rule: "ApexCRUDViolation",
    severity: 2,
    primaryLocationIndex: 0,
    locations: [{ file: "force-app/classes/Foo.cls", startLine: 12, startColumn: 5 }],
    message: "Validate CRUD permission before SOQL/DML operation or enforce user mode",
    resources: ["https://example.com/apexcrud"],
  };
}

describe("Auto Scan Follow-up", () => {
  it("aggregates group summaries, report paths, findings, and broader validation guidance", () => {
    const message = buildAutoScanFollowUp({
      groups: [
        {
          selector: "pmd:Recommended",
          targetCount: 1,
          reportFile: "/tmp/pmd.json",
          violations: [violation()],
        },
        {
          selector: "eslint:Recommended",
          targetCount: 2,
          reportFile: "/tmp/eslint.json",
          violations: [],
        },
      ],
      broaderValidation: "💡 Broader scan suggestions (not run automatically):\n- security",
    });

    expect(message).toContain("<sf_code_analyzer>");
    expect(message).toContain("pmd:Recommended (1 target, 1 finding)");
    expect(message).toContain("eslint:Recommended (2 targets, 0 findings)");
    expect(message).toContain("/tmp/pmd.json");
    expect(message).toContain("/tmp/eslint.json");
    expect(message).toContain("ApexCRUDViolation");
    expect(message).toContain("Optional broader validation");
    expect(message).toContain("Please fix the actionable findings");
    expect(message).toContain("</sf_code_analyzer>");
  });
});
