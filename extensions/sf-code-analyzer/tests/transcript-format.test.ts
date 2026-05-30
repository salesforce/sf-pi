/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sf-code-analyzer auto-scan transcript", () => {
  const source = readFileSync(new URL("../lib/auto-scan.ts", import.meta.url), "utf8");

  it("renders friendly local CLI scan rows", () => {
    expect(source).toContain("✅ 🧪 Code Analyzer auto-scan clean");
    expect(source).toContain("Tool: Local Salesforce Code Analyzer CLI");
    expect(source).toContain("Engines:");
    expect(source).toContain("Targets:");
    expect(source).toContain("Duration:");
  });

  it("renders friendly ApexGuru scan rows", () => {
    expect(source).toContain("✨ ApexGuru auto insight");
    expect(source).toContain("Tool: ApexGuru Insights org service");
    expect(source).toContain("ApexGuru auto insight skipped");
    expect(source).toContain("SF Browser to check Scale Center / ApexGuru Insights");
  });
});
