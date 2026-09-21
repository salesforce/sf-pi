/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import { SF_FLOW_ACTIONS, SF_FLOW_TOOL_NAME } from "../lib/sf-flow-tool.ts";

describe("sf-flow smoke", () => {
  it("exports one family tool with the settled lifecycle actions", () => {
    expect(SF_FLOW_TOOL_NAME).toBe("sf_flow");
    expect(SF_FLOW_ACTIONS).toEqual([
      "status",
      "org.preflight",
      "project.scan",
      "flow.inspect",
      "author.plan",
      "diagnose.file",
      "quality.rules",
      "fix.apply",
      "validate.check",
      "lifecycle.status",
      "deploy.activate",
      "lifecycle.activate",
      "lifecycle.deactivate",
      "test.discover",
      "test.plan",
      "test.run",
      "test.result",
      "test.rerun",
    ]);
  });

  it("registers the tool at session start and a Manager-first command", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const pi = {
      on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
        handlers.set(event, handler);
      }),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };

    mod.default(pi as never);
    await handlers.get("session_start")?.({} as never, {} as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const toolDefinition = pi.registerTool.mock.calls[0]?.[0];
    expect(toolDefinition?.promptGuidelines).toEqual(
      expect.arrayContaining([
        expect.stringContaining("sf_flow deploy.activate"),
        expect.stringContaining("sf_flow lifecycle.deactivate"),
        expect.stringContaining("Do not invent `sf flow activate`"),
      ]),
    );
    expect(pi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-flow")?.[1];
    expect(
      command?.getArgumentCompletions?.("st")?.map((item: { value: string }) => item.value),
    ).toEqual(["status"]);
    expect(command?.getArgumentCompletions?.("status h")).toBeNull();
  });
});
