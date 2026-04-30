/* SPDX-License-Identifier: Apache-2.0 */
/** Snapshot tests for the shared sf-pi diagnostic display contract. */
import { describe, expect, it } from "vitest";
import { renderDiagnosticsForProfile, type SfPiDiagnosticsMetadata } from "../diagnostics.ts";

const diagnostics: SfPiDiagnosticsMetadata = {
  source: "sf-agentscript-assist",
  status: "error",
  filePath: "/project/agent/billing.agent",
  fileName: "billing.agent",
  language: "agentscript",
  generatedAt: "2026-01-01T00:00:00.000Z",
  summary: "billing.agent: 4 diagnostics",
  renderedText: "LSP feedback: billing.agent",
  dialect: "Agent Script dialect: agentforce 2.5",
  diagnostics: [
    {
      severity: "error",
      message: "Topic is missing an instruction block.",
      line: 7,
      character: 2,
      code: "missing-instruction",
      range: { start: { line: 6, character: 2 }, end: { line: 6, character: 10 } },
    },
    {
      severity: "warning",
      message: "Field 'topic' is deprecated. Use 'subagent'.",
      line: 12,
      character: 0,
      code: "deprecated-field",
      range: { start: { line: 11, character: 0 }, end: { line: 11, character: 5 } },
      fixes: [{ title: "Replace with 'subagent'" }],
    },
    {
      severity: "error",
      message: "Unknown variable 'case_id'.",
      line: 18,
      character: 14,
      code: "unknown-variable",
      range: { start: { line: 17, character: 14 }, end: { line: 17, character: 21 } },
    },
    {
      severity: "warning",
      message: "Variable 'draft' is declared but never used.",
      line: 22,
      character: 4,
      code: "unused-variable",
      range: { start: { line: 21, character: 4 }, end: { line: 21, character: 9 } },
      fixes: [{ title: "Remove unused variable" }],
    },
  ],
};

describe("shared diagnostics renderer snapshots", () => {
  it("renders compact profile", () => {
    expect(renderDiagnosticsForProfile(diagnostics, "compact")).toMatchInlineSnapshot(`
      "[sf-agentscript-assist] billing.agent: 4 diagnostics
      - L7 [missing-instruction]: Topic is missing an instruction block.
      - L12 [deprecated-field]: Field 'topic' is deprecated. Use 'subagent'.
      - L18 [unknown-variable]: Unknown variable 'case_id'.
      (+1 more)"
    `);
  });

  it("renders balanced profile with fixes", () => {
    expect(renderDiagnosticsForProfile(diagnostics, "balanced")).toMatchInlineSnapshot(`
      "[sf-agentscript-assist] billing.agent: 4 diagnostics
      - L7 [missing-instruction]: Topic is missing an instruction block.
      - L12 [deprecated-field]: Field 'topic' is deprecated. Use 'subagent'.
          fix: Replace with 'subagent'
      - L18 [unknown-variable]: Unknown variable 'case_id'.
      - L22 [unused-variable]: Variable 'draft' is declared but never used.
          fix: Remove unused variable"
    `);
  });
});
