/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import { SF_INTEGRATE_TOOL_NAME } from "../lib/sf-integrate-tool.ts";

describe("sf-integrate smoke", () => {
  it("exports the expected family tool name", () => {
    expect(SF_INTEGRATE_TOOL_NAME).toBe("sf_integrate");
  });

  it("registers manager-first command completions", async () => {
    const mod = await import("../index.ts");
    const pi = { on: vi.fn(), registerCommand: vi.fn() };

    mod.default(pi as never);

    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-integrate")?.[1];
    expect(command?.getArgumentCompletions?.("st")?.map((item) => item.value)).toEqual(["status"]);
    expect(command?.getArgumentCompletions?.("status h")).toBeNull();
  });
});
