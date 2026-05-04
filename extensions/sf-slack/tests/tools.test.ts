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

describe("tool argument compatibility", () => {
  it("slack_send prepares legacy recipient/message arguments into to/text", async () => {
    const captured: Array<{ name: string; prepareArguments?: (args: unknown) => unknown }> = [];
    const { registerSendTool } = await import("../lib/send-tool.ts");

    registerSendTool({
      registerTool(definition: { name: string; prepareArguments?: (args: unknown) => unknown }) {
        captured.push(definition);
      },
    } as never);

    const tool = captured.find((entry) => entry.name === "slack_send");
    expect(tool?.prepareArguments).toBeTypeOf("function");
    expect(tool?.prepareArguments?.({ action: "dm", recipient: "Jane", message: "hello" })).toEqual(
      {
        action: "dm",
        recipient: "Jane",
        message: "hello",
        to: "Jane",
        text: "hello",
      },
    );
  });

  it("slack_time_range prepares legacy text/range fields into expression", async () => {
    const captured: Array<{
      name: string;
      prepareArguments?: (args: unknown) => unknown;
      execute?: (...args: never[]) => Promise<unknown>;
    }> = [];
    const { registerTimeRangeTool } = await import("../lib/time-range-tool.ts");

    registerTimeRangeTool({
      registerTool(definition: { name: string; prepareArguments?: (args: unknown) => unknown }) {
        captured.push(definition);
      },
    } as never);

    const tool = captured.find((entry) => entry.name === "slack_time_range");
    expect(tool?.prepareArguments).toBeTypeOf("function");
    expect(tool?.prepareArguments?.({ range: "last week" })).toEqual({
      range: "last week",
      expression: "last week",
    });
    expect(tool?.prepareArguments?.({ text: "yesterday" })).toEqual({
      text: "yesterday",
      expression: "yesterday",
    });
  });

  it("slack_time_range throws on invalid expressions so Pi marks the tool result as an error", async () => {
    const captured: Array<{ name: string; execute?: (...args: never[]) => Promise<unknown> }> = [];
    const { registerTimeRangeTool } = await import("../lib/time-range-tool.ts");

    registerTimeRangeTool({
      registerTool(definition: { name: string; execute?: (...args: never[]) => Promise<unknown> }) {
        captured.push(definition);
      },
    } as never);

    const tool = captured.find((entry) => entry.name === "slack_time_range");
    await expect(
      tool?.execute?.("id" as never, { expression: "" } as never, undefined as never),
    ).rejects.toThrow(/Could not resolve Slack time range: expression is required/);
  });
});
