/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";

import sfMcp from "../index.ts";

describe("SF MCP default-off contract", () => {
  it("registers the plan-bound control surfaces without starting an MCP server", () => {
    const pi = {
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
      registerMcpServer: vi.fn(),
      on: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };

    sfMcp(pi as never);

    expect(pi.registerCommand).toHaveBeenCalledWith("sf-mcp", expect.anything());
    expect(pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "sf_mcp" }));
    expect(pi.registerMcpServer).not.toHaveBeenCalled();
  });
});
