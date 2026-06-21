/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Item 4 hardening: `agentscript_authoring verb='compile' mode='check'` summary line now
 * includes per-issue sample bullets so the LLM can decide on next steps
 * without re-reading the full `diagnostics` array.
 *
 * Contract:
 *   - clean files emit a single `✓` line
 *   - files with errors emit `❌ <path> — N issue(s) (kE·mW[·nI]), F fix(es) ready`
 *     followed by up to MAX_SAMPLE_LINES bullets, errors first
 *   - files with only info diagnostics emit an overall ✅ plus a warning note
 *   - bullet shape is `  • [E|W|I] <code> @ L<1-based-line>`
 *   - excess diagnostics are summarized as `…and X more in details.diagnostics`
 */

import { describe, expect, test } from "vitest";
import { renderCheckSummary } from "../lib/authoring/actions/compile.ts";

function makeDiag(
  severity: 1 | 2 | 3,
  code: string,
  line: number,
): { severity: number; code: string; range: { start: { line: number } }; message: string } {
  return {
    severity,
    code,
    range: { start: { line: line - 1 } },
    message: `${code} at line ${line}`,
  };
}

describe("renderCheckSummary", () => {
  test("clean files emit a single confirmation line", () => {
    const out = renderCheckSummary("/tmp/X.agent", [], 0, "agentforce");
    expect(out).toBe("✓ /tmp/X.agent compiles clean (agentforce)");
  });

  test("dirty file: header counts errors, warnings, and info, and lists samples errors-first", () => {
    const diags = [
      makeDiag(3, "unused-variable", 11),
      makeDiag(1, "action-missing-input", 42),
      makeDiag(2, "empty-template", 13),
      makeDiag(1, "invalid-action-target", 67),
    ];
    const out = renderCheckSummary("/tmp/X.agent", diags, 4, "agentforce");
    const lines = out.split("\n");
    expect(lines[0]).toBe("❌ /tmp/X.agent — 4 issue(s) (2E·1W·1I), 4 fix(es) ready");
    expect(lines[1]).toBe("  • [E] action-missing-input @ L42");
    expect(lines[2]).toBe("  • [E] invalid-action-target @ L67");
    expect(lines[3]).toBe("  • [W] empty-template @ L13");
    expect(lines[4]).toBe("  • [I] unused-variable @ L11");
  });

  test("info-only diagnostics emit a valid compile outcome plus warning note", () => {
    const diags = Array.from({ length: 8 }, (_v, i) => makeDiag(3, "unused-variable", i + 1));
    const out = renderCheckSummary("/tmp/X.agent", diags, 8);
    const lines = out.split("\n");
    expect(lines[0]).toContain("✅ /tmp/X.agent compiles (0E·0W·8I)");
    expect(lines[1]).toBe("  ⚠ Informational diagnostics present; compile is valid.");
    expect(lines).toHaveLength(8); // header + warning note + 5 samples + overflow
    expect(lines[7]).toBe("  …and 3 more in details.diagnostics");
  });

  test("missing diagnostic code falls back to '(no-code)'", () => {
    const diags = [
      {
        severity: 1,
        code: undefined,
        range: { start: { line: 0 } },
        message: "anonymous",
      },
    ];
    const out = renderCheckSummary("/tmp/X.agent", diags, 0);
    expect(out).toContain("[E] (no-code) @ L1");
  });

  test("missing dialect name in clean summary falls back gracefully", () => {
    const out = renderCheckSummary("/tmp/X.agent", [], 0);
    expect(out).toBe("✓ /tmp/X.agent compiles clean (unknown dialect)");
  });
});
