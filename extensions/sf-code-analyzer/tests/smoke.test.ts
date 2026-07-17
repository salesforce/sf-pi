/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { CODE_ANALYZER_TOOL_NAME } from "../lib/code_analyzer-tool.ts";
import {
  SF_PI_MANAGER_OPEN_EVENT,
  type SfPiManagerOpenRequest,
} from "../../../lib/common/manager-deep-link.ts";
import { collectManagerDetailActions } from "../../../lib/common/manager-actions.ts";

function eventBus() {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  return {
    on(eventName: string, listener: (payload: unknown) => void) {
      listeners.set(eventName, [...(listeners.get(eventName) ?? []), listener]);
    },
    emit(eventName: string, payload: unknown) {
      for (const listener of listeners.get(eventName) ?? []) listener(payload);
    },
  };
}

function fakeCommandContext(): ExtensionCommandContext {
  return {
    hasUI: true,
    cwd: "/tmp/sf-pi-test",
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
  } as unknown as ExtensionCommandContext;
}

describe("sf-code-analyzer smoke", () => {
  it("exports a default extension function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("declares the expected tool name", () => {
    expect(CODE_ANALYZER_TOOL_NAME).toBe("code_analyzer");
  });

  it("registers flat slash-command completions", async () => {
    const mod = await import("../index.ts");
    const pi = {
      events: eventBus(),
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerEntryRenderer: vi.fn(),
    };

    mod.default(pi as never);

    const command = pi.registerCommand.mock.calls.find(
      ([name]) => name === "sf-code-analyzer",
    )?.[1];
    expect(command?.getArgumentCompletions?.("doc")?.map((item) => item.value)).toEqual(["doctor"]);
    expect(command?.getArgumentCompletions?.("doctor he")).toBeNull();
  });

  it("routes the no-args UI command to the SF Pi Manager detail page", async () => {
    const mod = await import("../index.ts");
    const events = eventBus();
    const pi = {
      events,
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerEntryRenderer: vi.fn(),
    };
    let request: SfPiManagerOpenRequest | undefined;
    events.on(SF_PI_MANAGER_OPEN_EVENT, (payload) => {
      request = payload as SfPiManagerOpenRequest;
      request.accept?.();
      request.resolve?.();
    });

    mod.default(pi as never);
    const command = pi.registerCommand.mock.calls.find(
      ([name]) => name === "sf-code-analyzer",
    )?.[1];
    expect(command).toBeDefined();

    await command.handler("", fakeCommandContext());

    expect(request?.route?.extensionId).toBe("sf-code-analyzer");
    expect(request?.route?.view).toBe("detail");
  });

  it("preserves the existing panel actions as Manager detail actions", async () => {
    const mod = await import("../index.ts");
    const pi = {
      events: eventBus(),
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerEntryRenderer: vi.fn(),
    };

    mod.default(pi as never);
    const actions = collectManagerDetailActions(pi as never, "sf-code-analyzer");

    expect(actions.map((action) => action.id)).toEqual([
      "status",
      "doctor",
      "setup",
      "recipes",
      "auto-scan-on",
      "auto-scan-off",
      "auto-scan-reset",
      "apexguru-auto-on",
      "apexguru-auto-off",
      "apexguru-auto-reset",
      "apexguru-setup-help",
      "apexguru-setup-start",
      "help",
    ]);
    expect(actions.find((action) => action.id === "status")?.group).toBe("Diagnostics");
    expect(actions.find((action) => action.id === "auto-scan-on")?.group).toBe("Automation");
    expect(actions.find((action) => action.id === "auto-scan-on")?.acceptsScope).toBe(true);
    expect(actions.some((action) => action.id === "auto-scan-global-on")).toBe(false);
    expect(actions.find((action) => action.id === "apexguru-setup-start")?.group).toBe(
      "ApexGuru setup",
    );
    expect(typeof actions.find((action) => action.id === "setup")?.createPanel).toBe("function");
    expect(typeof actions.find((action) => action.id === "apexguru-setup-start")?.createPanel).toBe(
      "function",
    );
  });
});
