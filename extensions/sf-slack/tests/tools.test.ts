/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-slack tool modules — module export checks.
 */
import { describe, it, expect } from "vitest";

describe("tool modules", () => {
  it("time-range-tool exports registerTimeRangeTool", async () => {
    const mod = await import("../lib/time-range-tool.ts");
    expect(typeof mod.registerTimeRangeTool).toBe("function");
  });

  it("resolve-tool exports registerResolveTool", async () => {
    const mod = await import("../lib/resolve-tool.ts");
    expect(typeof mod.registerResolveTool).toBe("function");
  });

  it("research-tool exports registerResearchTool", async () => {
    const mod = await import("../lib/research-tool.ts");
    expect(typeof mod.registerResearchTool).toBe("function");
  });

  it("channel-tool exports registerChannelTool", async () => {
    const mod = await import("../lib/channel-tool.ts");
    expect(typeof mod.registerChannelTool).toBe("function");
  });

  it("user-tool exports registerUserTool", async () => {
    const mod = await import("../lib/user-tool.ts");
    expect(typeof mod.registerUserTool).toBe("function");
  });

  it("file-tool exports registerFileTool", async () => {
    const mod = await import("../lib/file-tool.ts");
    expect(typeof mod.registerFileTool).toBe("function");
  });

  it("canvas-tool exports registerCanvasTool", async () => {
    const mod = await import("../lib/canvas-tool.ts");
    expect(typeof mod.registerCanvasTool).toBe("function");
  });
});
