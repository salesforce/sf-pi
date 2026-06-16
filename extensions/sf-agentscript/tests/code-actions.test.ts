/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for quick fix generation — official LSP fixes plus SF Pi-specific
 * hardening fixes take a source string and diagnostics and emit TextEdits.
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
  it("returns no fixes when diagnostics lack codes", async () => {
    const source = "config:\n  agent_name: hi\n";
    const fixes = await buildQuickFixes(source, [makeDiagnostic({ code: undefined })]);
    expect(fixes).toEqual([]);
  });

  describe("invalid-modifier / unknown-type", () => {
    it("produces a typo replacement when the found string is on the line", async () => {
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

      const [fix] = await buildQuickFixes(source, [diagnostic]);
      expect(fix.title).toBe("Change to 'mutable'");
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

    it("skips when no close match exists", async () => {
      const source = "foo: xyz\n";
      const diagnostic = makeDiagnostic({
        code: "invalid-modifier",
        range: {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 8 },
        },
        data: { found: "xyz", expected: ["mutable"] },
      });

      await expect(buildQuickFixes(source, [diagnostic])).resolves.toEqual([]);
    });
  });

  describe("unknown-dialect", () => {
    it("produces one fix per available dialect", async () => {
      const source = "# @dialect: agentfrce 2.5\n";
      const diagnostic = makeDiagnostic({
        code: "unknown-dialect",
        range: {
          start: { line: 0, character: 12 },
          end: { line: 0, character: 20 },
        },
        data: { availableNames: ["agentforce", "agentscript"] },
      });

      const fixes = await buildQuickFixes(source, [diagnostic]);
      expect(fixes).toHaveLength(2);
      expect(fixes[0].title).toBe("Change to 'agentforce'");
      expect(fixes[0].preferred).toBe(false);
      expect(fixes[1].preferred).toBe(false);
      expect(fixes[0].edits[0].newText).toBe("agentforce");
    });
  });

  describe("deprecated-field", () => {
    it("replaces the diagnostic range with data.replacement", async () => {
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

      const [fix] = await buildQuickFixes(source, [diagnostic]);
      expect(fix.title).toBe("Convert to subagent");
      expect(fix.edits[0].newText).toBe("subagent");
    });

    it("skips when replacement is missing", async () => {
      const source = "foo\n";
      const diagnostic = makeDiagnostic({
        code: "deprecated-field",
        data: {},
      });
      await expect(buildQuickFixes(source, [diagnostic])).resolves.toEqual([]);
    });
  });

  describe("unused-variable", () => {
    it("deletes from column 0 to the next line's start", async () => {
      const source = 'variables:\n  case_id: mutable string = ""\nsystem:\n  instructions: hi\n';
      const diagnostic = makeDiagnostic({
        code: "unused-variable",
        severity: 3,
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

      const [fix] = await buildQuickFixes(source, [diagnostic]);
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
    it("produces one fix per suggested version", async () => {
      const source = "# @dialect: agentforce 99.9\n";
      const diagnostic = makeDiagnostic({
        code: "invalid-version",
        range: {
          start: { line: 0, character: 23 },
          end: { line: 0, character: 27 },
        },
        data: { suggestedVersions: ["2.5", "2"] },
      });

      const fixes = await buildQuickFixes(source, [diagnostic]);
      expect(fixes.map((fix) => fix.edits[0].newText)).toEqual(["2.5", "2"]);
      expect(fixes[0].preferred).toBe(true);
      expect(fixes[1].preferred).toBe(false);
    });
  });

  describe('missing-token (transition ... when "...")', () => {
    // Issue 2: the natural-looking but unsupported guarded-transition
    // syntax. Compile reports `missing-token`; the fix strips the
    // `when ...` clause.

    it("strips the when-clause from a deterministic transition line", async () => {
      const source =
        "topic greeting:\n" +
        '    description: "hi"\n' +
        '    transition to @topic.faq when "the user asks about Agentforce"\n';
      const diagnostic = makeDiagnostic({
        code: "missing-token",
        severity: 1,
        range: {
          start: { line: 2, character: 33 },
          end: { line: 2, character: 33 },
        },
      });
      const [fix] = await buildQuickFixes(source, [diagnostic]);
      expect(fix).toBeDefined();
      expect(fix.title).toMatch(/transitions don't support guards/i);
      expect(fix.preferred).toBe(true);
      expect(fix.edits).toHaveLength(1);
      expect(fix.edits[0].newText).toBe("    transition to @topic.faq");
      // The edit covers the whole line so the leftover quote/text is gone.
      expect(fix.edits[0].range.start).toEqual({ line: 2, character: 0 });
    });

    it("handles deeper @-paths and unquoted condition text", async () => {
      const source = "    transition to @topic.foo.bar when something\n";
      const diagnostic = makeDiagnostic({
        code: "missing-token",
        range: { start: { line: 0, character: 30 }, end: { line: 0, character: 30 } },
      });
      const [fix] = await buildQuickFixes(source, [diagnostic]);
      expect(fix).toBeDefined();
      expect(fix.edits[0].newText).toBe("    transition to @topic.foo.bar");
    });

    it("does NOT trigger on plain transition lines (no when keyword)", async () => {
      const source = "    transition to @topic.faq\n";
      const diagnostic = makeDiagnostic({
        code: "missing-token",
        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } },
      });
      await expect(buildQuickFixes(source, [diagnostic])).resolves.toEqual([]);
    });

    it("does NOT trigger on a missing-token error elsewhere in the file", async () => {
      const source = 'config:\n    agent_name "X"\n'; // colon missing
      const diagnostic = makeDiagnostic({
        code: "missing-token",
        range: { start: { line: 1, character: 14 }, end: { line: 1, character: 14 } },
      });
      await expect(buildQuickFixes(source, [diagnostic])).resolves.toEqual([]);
    });

    it("does NOT match a comment containing the word 'when'", async () => {
      // The line starts with whitespace + a `#` comment; the regex anchors on
      // "transition\s+to\s+@" so it cannot match here. Belt + suspenders.
      const source = "    # transition to @topic.x when comment\n";
      const diagnostic = makeDiagnostic({
        code: "missing-token",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      });
      await expect(buildQuickFixes(source, [diagnostic])).resolves.toEqual([]);
    });
  });
});
