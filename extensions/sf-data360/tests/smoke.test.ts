/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
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
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  } as unknown as ExtensionCommandContext;
}

describe("sf-data360 extension smoke", () => {
  const manifest = JSON.parse(readFileSync("extensions/sf-data360/manifest.json", "utf8")) as {
    defaultEnabled?: boolean;
    configurable?: boolean;
    tools?: string[];
    events?: string[];
  };

  it("is enabled by default and exposes the expected runtime surfaces", () => {
    expect(manifest.defaultEnabled).toBe(true);
    expect(manifest.configurable).toBe(true);
    expect(manifest.tools).toEqual([
      "data360_discover",
      "data360_connect",
      "data360_prepare",
      "data360_harmonize",
      "data360_segment",
      "data360_activate",
      "data360_query",
      "data360_semantic",
      "data360_observe",
      "data360_orchestrate",
      "data360_api",
    ]);
    expect(manifest.events).toEqual(["session_start", "session_shutdown", "resources_discover"]);
  });

  it("registers flat slash-command completions", async () => {
    const mod = await import("../index.ts");
    const pi = { events: eventBus(), on: vi.fn(), registerCommand: vi.fn(), registerTool: vi.fn() };

    mod.default(pi as never);

    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-data360")?.[1];
    expect(command?.getArgumentCompletions?.("he")?.map((item) => item.value)).toEqual(["help"]);
    expect(command?.getArgumentCompletions?.("status he")).toBeNull();
  });

  it("routes the no-args UI command to the SF Pi Manager detail page", async () => {
    const mod = await import("../index.ts");
    const events = eventBus();
    const pi = { events, on: vi.fn(), registerCommand: vi.fn(), registerTool: vi.fn() };
    let request: SfPiManagerOpenRequest | undefined;
    events.on(SF_PI_MANAGER_OPEN_EVENT, (payload) => {
      request = payload as SfPiManagerOpenRequest;
      request.accept?.();
      request.resolve?.();
    });

    mod.default(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-data360")?.[1];
    expect(command).toBeDefined();

    await command.handler("", fakeCommandContext());

    expect(request?.route?.extensionId).toBe("sf-data360");
    expect(request?.route?.view).toBe("detail");
  });

  it("preserves status and help as Manager detail actions", async () => {
    const mod = await import("../index.ts");
    const pi = { events: eventBus(), on: vi.fn(), registerCommand: vi.fn(), registerTool: vi.fn() };

    mod.default(pi as never);
    const actions = collectManagerDetailActions(pi as never, "sf-data360");

    expect(actions.map((action) => action.id)).toEqual(["status", "help"]);
    expect(actions.find((action) => action.id === "status")?.group).toBe("Diagnostics");
    expect(actions.find((action) => action.id === "help")?.group).toBe("Reference");
  });

  it("keeps skill references on disk instead of package-level skill registration", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      pi?: { skills?: unknown };
    };
    expect(packageJson.pi?.skills).toBeUndefined();
  });
});
