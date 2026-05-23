/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Item 4 hardening: `agentscript_authoring verb='compile' mode='check'` summary line now
 * includes per-issue sample bullets so the LLM can decide on next steps
 * without re-reading the full `diagnostics` array.
 *
 * Contract:
 *   - clean files emit a single `✓` line
 *   - dirty files emit `❌ <path> — N issue(s) (kE·mW), F fix(es) ready`
 *     followed by up to MAX_SAMPLE_LINES bullets, errors first
 *   - bullet shape is `  • [E|W] <code> @ L<1-based-line>`
 *   - excess diagnostics are summarized as `…and X more in details.diagnostics`
 */

import { describe, expect, test } from "vitest";
import { renderCheckSummary } from "../lib/authoring/actions/compile.ts";

function makeDiag(
  severity: 1 | 2,
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

  test("dirty file: header counts errors and warnings, and lists samples errors-first", () => {
    const diags = [
      makeDiag(2, "unused-variable", 11),
      makeDiag(1, "action-missing-input", 42),
      makeDiag(2, "unused-variable", 13),
      makeDiag(1, "invalid-action-target", 67),
    ];
    const out = renderCheckSummary("/tmp/X.agent", diags, 4, "agentforce");
    const lines = out.split("\n");
    expect(lines[0]).toBe("❌ /tmp/X.agent — 4 issue(s) (2E·2W), 4 fix(es) ready");
    expect(lines[1]).toBe("  • [E] action-missing-input @ L42");
    expect(lines[2]).toBe("  • [E] invalid-action-target @ L67");
    expect(lines[3]).toBe("  • [W] unused-variable @ L11");
    expect(lines[4]).toBe("  • [W] unused-variable @ L13");
  });

  test("more than MAX_SAMPLE_LINES diagnostics emits an overflow summary", () => {
    const diags = Array.from({ length: 8 }, (_v, i) => makeDiag(2, "unused-variable", i + 1));
    const out = renderCheckSummary("/tmp/X.agent", diags, 8);
    const lines = out.split("\n");
    expect(lines[0]).toContain("8 issue(s) (0E·8W)");
    expect(lines).toHaveLength(7); // header + 5 samples + overflow
    expect(lines[6]).toBe("  …and 3 more in details.diagnostics");
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
