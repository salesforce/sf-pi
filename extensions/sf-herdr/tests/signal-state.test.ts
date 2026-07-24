/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Herdr workflow signal inference through Pi's real result shape. */
import { describe, expect, it } from "vitest";
import {
  SessionManager,
  type ExtensionContext,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

import { createHerdrSignalState } from "../lib/signal-state.ts";

function assistantToolCall(toolCallId: string, toolName: string, input: Record<string, unknown>) {
  return {
    role: "assistant" as const,
    content: [{ type: "toolCall" as const, id: toolCallId, name: toolName, arguments: input }],
    api: "openai-completions" as const,
    provider: "test",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse" as const,
    timestamp: Date.now(),
  };
}

function storedToolResult(toolCallId: string, toolName: string, isError = false) {
  return {
    role: "toolResult" as const,
    toolCallId,
    toolName,
    content: [{ type: "text" as const, text: isError ? "failed" : "ok" }],
    details: {},
    isError,
    timestamp: Date.now(),
  };
}

function reconstructedState(toolName: string, input: Record<string, unknown>, isError = false) {
  const session = SessionManager.inMemory("/workspace");
  const toolCallId = `stored-${toolName}`;
  session.appendMessage(assistantToolCall(toolCallId, toolName, input));
  session.appendMessage(storedToolResult(toolCallId, toolName, isError));
  const state = createHerdrSignalState();
  state.reconstruct({
    sessionManager: session,
    cwd: "/workspace",
  } as unknown as ExtensionContext);
  return state;
}

function toolResult(
  toolName: string,
  input: Record<string, unknown> = {},
  isError = false,
): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: `call-${toolName}`,
    toolName,
    input,
    content: [{ type: "text", text: isError ? "failed" : "ok" }],
    details: {},
    isError,
  } satisfies ToolResultEvent;
}

describe("createHerdrSignalState", () => {
  it.each([
    ["Agent Script", "agentscript_preview", { action: "start" }, "agentscript"],
    ["Data 360", "data360_query", { action: "sql.run" }, "data360"],
    ["Apex", "sf_apex", { action: "test.run" }, "apex"],
    ["LWC", "sf_lwc", { action: "test.run" }, "uiBundle"],
    ["Browser", "sf_browser_snapshot", { interactive: true }, "browser"],
  ] as const)(
    "infers %s from one successful ToolResultEvent",
    (_label, toolName, input, workflow) => {
      const state = createHerdrSignalState();

      state.observeToolResult(toolResult(toolName, input), "/workspace");

      expect(state.infer().primaryWorkflow).toBe(workflow);
      expect(state.recent()).toHaveLength(1);
    },
  );

  it("infers a workflow from a successful Herdr run command", () => {
    const state = createHerdrSignalState();

    state.observeToolResult(
      toolResult("herdr", {
        action: "run",
        command: "sf apex run test --tests ExampleTest",
      }),
      "/workspace",
    );

    expect(state.infer().primaryWorkflow).toBe("apex");
    expect(state.recent(1)[0]?.source).toBe("command");
  });

  it("infers related workflows from mixed successful activity", () => {
    const state = createHerdrSignalState();
    state.observeToolResult(toolResult("agentscript_preview", { action: "start" }), "/project");
    state.observeToolResult(
      toolResult("write", { path: "force-app/main/default/classes/MyAction.cls" }),
      "/project",
    );

    const inferred = state.infer();
    expect(inferred.primaryWorkflow).toBe("agentscript");
    expect(inferred.relatedWorkflows).toContain("apex");
  });

  it("reconstructs Herdr command input from the matching persisted assistant tool call", () => {
    const state = reconstructedState("herdr", {
      action: "run",
      command: "sf apex run test --tests ExampleTest",
    });

    expect(state.infer().primaryWorkflow).toBe("apex");
    expect(state.recent()).toHaveLength(1);
  });

  it.each(["write", "edit"])("reconstructs %s paths from persisted tool-call input", (toolName) => {
    const state = reconstructedState(toolName, {
      path: "force-app/main/default/classes/MyAction.cls",
    });

    expect(state.infer().primaryWorkflow).toBe("apex");
    expect(state.recent()).toHaveLength(1);
  });

  it("ignores failed persisted tool results during reconstruction", () => {
    const state = reconstructedState("sf_apex", { action: "test.run" }, true);

    expect(state.infer().primaryWorkflow).toBe("generic");
    expect(state.recent()).toEqual([]);
  });

  it("ignores failed tool results", () => {
    const state = createHerdrSignalState();

    state.observeToolResult(toolResult("sf_apex", { action: "test.run" }, true), "/workspace");

    expect(state.infer().primaryWorkflow).toBe("generic");
    expect(state.recent()).toEqual([]);
  });

  it("ignores Herdr actions that do not run a command", () => {
    const state = createHerdrSignalState();

    state.observeToolResult(toolResult("herdr", { action: "list" }), "/workspace");

    expect(state.infer().primaryWorkflow).toBe("generic");
  });

  it("falls back to generic with low confidence when no signals exist", () => {
    const inferred = createHerdrSignalState().infer();
    expect(inferred.primaryWorkflow).toBe("generic");
    expect(inferred.confidence).toBeLessThan(0.5);
  });
});
