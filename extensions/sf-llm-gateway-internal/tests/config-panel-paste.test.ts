/* SPDX-License-Identifier: Apache-2.0 */
/** Regression tests for setup-overlay text paste handling. */
import { describe, expect, it } from "vitest";
import { normalizePastedTextFieldInput } from "../lib/config-panel.ts";

describe("normalizePastedTextFieldInput", () => {
  it("keeps normal typed characters", () => {
    expect(normalizePastedTextFieldInput("sk-test_123")).toBe("sk-test_123");
  });

  it("accepts bracketed terminal paste chunks", () => {
    expect(normalizePastedTextFieldInput("\x1b[200~sk-pasted-key\x1b[201~")).toBe("sk-pasted-key");
  });

  it("strips newlines from pasted keys", () => {
    expect(normalizePastedTextFieldInput("sk-line-1\nsk-line-2\r\n")).toBe("sk-line-1sk-line-2");
  });

  it("does not turn arrow-key escape sequences into literal text", () => {
    expect(normalizePastedTextFieldInput("\x1b[1;1B")).toBe("");
    expect(normalizePastedTextFieldInput("\x1b[A")).toBe("");
    expect(normalizePastedTextFieldInput("\x1bOB")).toBe("");
    // Some terminals / handlers can deliver the CSI payload after the ESC byte
    // was stripped. That still must not become `[1;1B` in the input field.
    expect(normalizePastedTextFieldInput("[1;1B")).toBe("");
  });
});
