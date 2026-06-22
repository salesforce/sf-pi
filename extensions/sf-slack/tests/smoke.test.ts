/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for sf-slack.
 *
 * Verifies the extension module can be imported and exports a default function.
 */
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
    ui: { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() },
  } as unknown as ExtensionCommandContext;
}

describe("sf-slack", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("routes the no-args UI command to the SF Pi Manager detail page", async () => {
    const mod = await import("../index.ts");
    const events = eventBus();
    const pi = {
      events,
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerProvider: vi.fn(),
      appendEntry: vi.fn(),
    };
    let request: SfPiManagerOpenRequest | undefined;
    events.on(SF_PI_MANAGER_OPEN_EVENT, (payload) => {
      request = payload as SfPiManagerOpenRequest;
      request.accept?.();
      request.resolve?.();
    });

    mod.default(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-slack")?.[1];
    expect(command).toBeDefined();

    await command.handler("", fakeCommandContext());

    expect(request?.route?.extensionId).toBe("sf-slack");
    expect(request?.route?.view).toBe("detail");
  });

  it("preserves Slack panel actions as Manager detail actions", async () => {
    const mod = await import("../index.ts");
    const pi = {
      events: eventBus(),
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerProvider: vi.fn(),
      appendEntry: vi.fn(),
    };

    mod.default(pi as never);
    const actions = collectManagerDetailActions(pi as never, "sf-slack");

    expect(actions.map((action) => action.id)).toEqual([
      "connect",
      "disconnect",
      "status",
      "refresh",
      "sent",
      "help",
    ]);
    expect(actions.find((action) => action.id === "connect")?.group).toBe("Connect");
    expect(actions.find((action) => action.id === "refresh")?.group).toBe("Diagnostics");
    expect(actions.some((action) => action.id === "settings")).toBe(false);
    expect(actions.find((action) => action.id === "sent")?.group).toBe("Audit");
    expect(actions.find((action) => action.id === "help")?.group).toBe("Reference");
    expect(actions.find((action) => action.id === "connect")?.closeBeforeRun).toBeUndefined();
    expect(typeof actions.find((action) => action.id === "connect")?.createPanel).toBe("function");
    expect(typeof actions.find((action) => action.id === "disconnect")?.createPanel).toBe(
      "function",
    );
  });
});
