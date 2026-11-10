/* SPDX-License-Identifier: Apache-2.0 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { formatLocalScanTranscript } from "../lib/auto-scan-transcript.ts";

/** The transcript normalizes paths with node:path, so expectations use the platform separator. */
const p = (posixPath: string): string => path.normalize(posixPath);

describe("Auto Scan Transcript", () => {
  it("formats the friendly local clean transcript row", () => {
    expect(
      formatLocalScanTranscript("clean", {
        selectors: ["eslint:Recommended"],
        targetCount: 4,
        durationMs: 4700,
        reportFile: "/tmp/report.json",
        targetFiles: [
          "extensions/sf-code-analyzer/lib/display.ts",
          "extensions/sf-code-analyzer/lib/transcript.ts",
        ],
      }),
    ).toBe(
      [
        "╭─ 🧪 Code Analyzer Auto-scan",
        "│",
        "│  ✓ Clean  4.7s",
        "│",
        "│  Scope",
        "│    Tool     Local Salesforce Code Analyzer CLI",
        "│    Engines  eslint:Recommended",
        "│    Targets  4 changed files",
        "│    Duration 4.7s",
        "│",
        "│  Reasoning",
        "│    Selected  JS/TS changed file → eslint:Recommended",
        "│    Others    PMD/Flow/SFGE skipped; no Apex or Flow file in this scan group",
        "│",
        "│  Files",
        `│    • ${p("extensions/sf-code-analyzer/lib/display.ts")}`,
        `│    • ${p("extensions/sf-code-analyzer/lib/transcript.ts")}`,
        "│",
        "│  Evidence",
        "│    Report",
        `│      ${p("/tmp/report.json")}`,
        "╰─ No action needed",
      ].join("\n"),
    );
  });
});
