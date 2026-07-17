/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import { SF_LWC_TOOL_NAME } from "../lib/sf-lwc-tool.ts";

describe("sf-lwc smoke", () => {
  it("exports the expected family tool name", () => {
    expect(SF_LWC_TOOL_NAME).toBe("sf_lwc");
  });

  it("registers flat slash-command completions", async () => {
    const mod = await import("../index.ts");
    const pi = { on: vi.fn(), registerCommand: vi.fn() };

    mod.default(pi as never);

    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-lwc")?.[1];
    expect(command?.getArgumentCompletions?.("st")?.map((item) => item.value)).toEqual(["status"]);
    expect(command?.getArgumentCompletions?.("status he")).toBeNull();
  });
});
