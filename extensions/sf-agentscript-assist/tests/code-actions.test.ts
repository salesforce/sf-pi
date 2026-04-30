/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for quick fix generation — pure functions that take a source string
 * plus synthetic diagnostics and emit TextEdits.
 */
import { describe, expect, it } from "vitest";
import { buildQuickFixes } from "../lib/code-actions.ts";
import type { AgentScriptDiagnostic } from "../lib/types.ts";

function makeDiagnostic(overrides: Partial<AgentScriptDiagnostic>): AgentScriptDiagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
    message: "",
    severity: 1,
    ...overrides,
  };
}

describe("buildQuickFixes", () => {
  it("returns no fixes when diagnostics lack codes", () => {
    const source = "config:\n  agent_name: hi\n";
    const fixes = buildQuickFixes(source, [makeDiagnostic({ code: undefined })]);
    expect(fixes).toEqual([]);
  });

  describe("invalid-modifier / unknown-type", () => {
    it("produces a typo replacement when the found string is on the line", () => {
      const source = [
        "# @dialect: agentforce 2.5",
        "variables:",
        '  case_id: mutabl string = ""',
        "",
      ].join("\n");

      const diagnostic = makeDiagnostic({
        code: "invalid-modifier",
        severity: 1,
        range: {
          start: { line: 2, character: 11 },
          end: { line: 2, character: 17 },
        },
        message: "Unknown modifier 'mutabl'",
        data: { found: "mutabl", expected: ["mutable", "linked"] },
      });

      const [fix] = buildQuickFixes(source, [diagnostic]);
      expect(fix.title).toBe("Change 'mutabl' to 'mutable'");
      expect(fix.preferred).toBe(true);
      expect(fix.edits).toEqual([
        {
          range: {
            start: { line: 2, character: 11 },
            end: { line: 2, character: 17 },
          },
          newText: "mutable",
        },
      ]);
    });

    it("skips when no close match exists", () => {
      const source = "foo: xyz\n";
      const diagnostic = makeDiagnostic({
        code: "invalid-modifier",
        range: {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 8 },
        },
        data: { found: "xyz", expected: ["mutable"] },
      });

      expect(buildQuickFixes(source, [diagnostic])).toEqual([]);
    });
  });

  describe("unknown-dialect", () => {
    it("produces one fix per available dialect, preferring the first", () => {
      const source = "# @dialect: agentfrce 2.5\n";
      const diagnostic = makeDiagnostic({
        code: "unknown-dialect",
        range: {
          start: { line: 0, character: 12 },
          end: { line: 0, character: 20 },
        },
        data: { availableNames: ["agentforce", "agentscript"] },
      });

      const fixes = buildQuickFixes(source, [diagnostic]);
      expect(fixes).toHaveLength(2);
      expect(fixes[0].title).toBe("Change to 'agentforce'");
      expect(fixes[0].preferred).toBe(true);
      expect(fixes[1].preferred).toBe(false);
      expect(fixes[0].edits[0].newText).toBe("agentforce");
    });
  });

  describe("deprecated-field", () => {
    it("replaces the diagnostic range with data.replacement", () => {
      const source = "topic billing:\n  description: hi\n";
      const diagnostic = makeDiagnostic({
        code: "deprecated-field",
        severity: 2,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        data: { replacement: "subagent" },
      });

      const [fix] = buildQuickFixes(source, [diagnostic]);
      expect(fix.title).toBe("Replace with 'subagent'");
      expect(fix.edits[0].newText).toBe("subagent");
    });

    it("skips when replacement is missing", () => {
      const source = "foo\n";
      const diagnostic = makeDiagnostic({
        code: "deprecated-field",
        data: {},
      });
      expect(buildQuickFixes(source, [diagnostic])).toEqual([]);
    });
  });

  describe("unused-variable", () => {
    it("deletes from column 0 to the next line's start", () => {
      const source = 'variables:\n  case_id: mutable string = ""\nsystem:\n  instructions: hi\n';
      const diagnostic = makeDiagnostic({
        code: "unused-variable",
        severity: 2,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 29 },
        },
        data: {
          removalRange: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 29 },
          },
        },
      });

      const [fix] = buildQuickFixes(source, [diagnostic]);
      expect(fix.edits[0]).toEqual({
        range: {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: "",
      });
    });
  });

  describe("invalid-version", () => {
    it("produces one fix per suggested version", () => {
      const source = "# @dialect: agentforce 99.9\n";
      const diagnostic = makeDiagnostic({
        code: "invalid-version",
        range: {
          start: { line: 0, character: 23 },
          end: { line: 0, character: 27 },
        },
        data: { suggestedVersions: ["2.5", "2"] },
      });

      const fixes = buildQuickFixes(source, [diagnostic]);
      expect(fixes.map((fix) => fix.edits[0].newText)).toEqual(["2.5", "2"]);
      expect(fixes[0].preferred).toBe(true);
      expect(fixes[1].preferred).toBe(false);
    });
  });
});
