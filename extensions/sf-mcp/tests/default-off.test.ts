/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";

import sfMcp from "../index.ts";

describe("SF MCP default-off contract", () => {
  it("registers the catalog and read-only verifier but no MCP server at extension load", () => {
    const pi = {
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
      registerMcpServer: vi.fn(),
      on: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };

    sfMcp(pi as never);

    expect(pi.registerCommand).toHaveBeenCalledWith("sf-mcp", expect.anything());
    expect(pi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "sf_mcp_verify_target" }),
    );
    expect(pi.registerMcpServer).not.toHaveBeenCalled();
  });
});
