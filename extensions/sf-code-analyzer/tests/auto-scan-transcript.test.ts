/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { formatLocalScanTranscript } from "../lib/auto-scan-transcript.ts";

describe("Auto Scan Transcript", () => {
  it("formats the friendly local clean transcript row", () => {
    expect(
      formatLocalScanTranscript("clean", {
        selectors: ["eslint:Recommended"],
        targetCount: 4,
        durationMs: 4700,
        reportFile: "/tmp/report.json",
      }),
    ).toBe(
      [
        "✅ 🧪 Code Analyzer auto-scan clean",
        "   Tool: Local Salesforce Code Analyzer CLI",
        "   Engines: eslint:Recommended",
        "   Targets: 4 changed files",
        "   Duration: 4.7s",
        "   Report: /tmp/report.json",
      ].join("\n"),
    );
  });
});
