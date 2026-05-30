/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { CODE_ANALYZER_TOOL_NAME } from "../lib/code_analyzer-tool.ts";

describe("sf-code-analyzer smoke", () => {
  it("exports a default extension function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("declares the expected tool name", () => {
    expect(CODE_ANALYZER_TOOL_NAME).toBe("code_analyzer");
  });
});
