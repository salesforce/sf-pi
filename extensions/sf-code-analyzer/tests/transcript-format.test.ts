/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  formatApexGuruSkippedTranscript,
  formatApexGuruTranscript,
  formatLocalScanTranscript,
} from "../lib/auto-scan-transcript.ts";

describe("sf-code-analyzer auto-scan transcript", () => {
  it("renders friendly local CLI scan rows", () => {
    const text = formatLocalScanTranscript("clean", {
      selectors: ["eslint:Recommended"],
      targetCount: 2,
      durationMs: 1200,
    });
    expect(text).toContain("✅ 🧪 Code Analyzer auto-scan clean");
    expect(text).toContain("Tool: Local Salesforce Code Analyzer CLI");
    expect(text).toContain("Engines:");
    expect(text).toContain("Targets:");
    expect(text).toContain("Duration:");
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
