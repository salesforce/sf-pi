/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";

const orgCreateMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  Org: { create: (opts: unknown) => orgCreateMock(opts) },
}));

import { registerData360V2Tools } from "../lib/v2/tools.ts";

type RegisteredTool = {
  execute: (...args: unknown[]) => Promise<{ details: Record<string, unknown> }>;
};

describe("Data 360 v2 tool registration", () => {
  it("runs local action descriptions without resolving the Salesforce environment", async () => {
    const registered: Record<string, RegisteredTool> = {};
    const exec = vi.fn();
    const pi = {
      exec,
      registerTool: vi.fn((tool: { name: string } & RegisteredTool) => {
        registered[tool.name] = tool;
      }),
    };

    registerData360V2Tools(pi as never);

    const result = await registered.data360_observe.execute(
      "tool-call-1",
      { action: "action.describe", params: { action: "trace.error_traces" } },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );

    expect(result.details).toMatchObject({
      ok: true,
      tool: "data360_observe",
      action: "action.describe",
      requestedAction: "trace.error_traces",
    });
    expect(exec).not.toHaveBeenCalled();
    expect(orgCreateMock).not.toHaveBeenCalled();
  });
});
