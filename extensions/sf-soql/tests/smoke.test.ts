/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import { SF_SOQL_TOOL_NAME } from "../lib/sf-soql-tool.ts";

describe("sf-soql smoke", () => {
  it("exports the expected family tool name", () => {
    expect(SF_SOQL_TOOL_NAME).toBe("sf_soql");
  });

  it("registers flat slash-command completions", async () => {
    const mod = await import("../index.ts");
    const pi = { on: vi.fn(), registerCommand: vi.fn() };

    mod.default(pi as never);

    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-soql")?.[1];
    expect(command?.getArgumentCompletions?.("he")?.map((item) => item.value)).toEqual(["help"]);
    expect(command?.getArgumentCompletions?.("help st")).toBeNull();
  });
});
