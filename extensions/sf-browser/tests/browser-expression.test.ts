/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { buildBrowserHelperExpression } from "../lib/browser-expression.ts";
import { buildEditorExpression } from "../lib/editor-surfaces.ts";

describe("browser eval expression construction", () => {
  it("serializes payload as JSON instead of executable code", () => {
    const expression = buildEditorExpression({
      action: "write",
      editorIndex: 0,
      value: "</script>${window.evil}//'\\",
      maxChars: 4000,
    });

    expect(expression).toContain("__sfPiEditorOperation");
    expect(expression).toContain("\\u003c/script>");
    expect(expression).toContain("\\\\");
    expect(expression).not.toContain("</script>");
  });

  it("rejects non-helper function names", () => {
    expect(() =>
      buildBrowserHelperExpression({
        helpers: "",
        functionName: "alert(1)",
        payload: {},
      }),
    ).toThrow("Invalid browser helper name");
  });
});
