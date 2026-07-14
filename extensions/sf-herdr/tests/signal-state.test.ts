/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Herdr workflow signal inference. */
import { describe, expect, it } from "vitest";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";

import { createHerdrSignalState, type HerdrToolExecutionEndEvent } from "../lib/signal-state.ts";

describe("createHerdrSignalState", () => {
  it("infers Agent Script from agentscript tool calls", () => {
    const state = createHerdrSignalState();
    state.observeToolExecutionEnd({
      type: "tool_execution_end",
      toolCallId: "1",
      toolName: "agentscript_preview",
      args: {},
      result: {},
      isError: false,
    } satisfies HerdrToolExecutionEndEvent);

    const inferred = state.infer();
    expect(inferred.primaryWorkflow).toBe("agentscript");
    expect(inferred.confidence).toBeGreaterThan(0.7);
  });

  it("infers related workflows from mixed activity", () => {
    const state = createHerdrSignalState();
    state.observeToolExecutionEnd({
      type: "tool_execution_end",
      toolCallId: "1",
      toolName: "agentscript_preview",
      args: {},
      result: {},
      isError: false,
    } satisfies HerdrToolExecutionEndEvent);
    state.observeToolResult(
      {
        type: "tool_result",
        toolCallId: "2",
        toolName: "write",
        input: { path: "force-app/main/default/classes/MyAction.cls" },
        content: [],
        details: undefined,
        isError: false,
      } as ToolResultEvent,
      "/project",
    );

    const inferred = state.infer();
    expect(inferred.primaryWorkflow).toBe("agentscript");
    expect(inferred.relatedWorkflows).toContain("apex");
  });

  it("infers workflows from current SF Pi lifecycle tools", () => {
    const cases = [
      ["data360_query", "data360"],
      ["sf_apex", "apex"],
      ["sf_lwc", "uiBundle"],
    ] as const;

    for (const [toolName, workflow] of cases) {
      const state = createHerdrSignalState();
      state.observeToolExecutionEnd({
        type: "tool_execution_end",
        toolCallId: toolName,
        toolName,
        args: {},
        result: {},
        isError: false,
      } satisfies HerdrToolExecutionEndEvent);

      expect(state.infer().primaryWorkflow).toBe(workflow);
    }
  });

  it("observes Herdr pane commands without mutating panes", () => {
    const state = createHerdrSignalState();
    state.observeToolExecutionEnd({
      type: "tool_execution_end",
      toolCallId: "1",
      toolName: "herdr",
      args: { action: "run", command: "sf apex run test --tests MyTest -o Dev" },
      result: {},
      isError: false,
    } satisfies HerdrToolExecutionEndEvent);

    expect(state.infer().primaryWorkflow).toBe("apex");
    expect(state.recent(1)[0]?.source).toBe("command");
  });

  it("falls back to generic with low confidence when no signals exist", () => {
    const inferred = createHerdrSignalState().infer();
    expect(inferred.primaryWorkflow).toBe("generic");
    expect(inferred.confidence).toBeLessThan(0.5);
  });
});
