/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  SF_PI_MANAGER_OPEN_EVENT,
  type SfPiManagerOpenRequest,
} from "../../../lib/common/manager-deep-link.ts";
import { collectManagerDetailActions } from "../../../lib/common/manager-actions.ts";
import sfDataExplorer from "../index.ts";

type SessionHandler = () => unknown | Promise<unknown>;

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

describe("sf-data-explorer boot path", () => {
  it("uses shared REST helpers instead of importing sf-data360 internals", () => {
    const source = readFileSync("extensions/sf-data-explorer/lib/transport.ts", "utf8");
    expect(source).toContain("lib/common/sf-rest/path.ts");
    expect(source).toContain("lib/common/sf-rest/target-org.ts");
    expect(source).not.toContain("extensions/sf-data360/lib/path.ts");
    expect(source).not.toContain("extensions/sf-data360/lib/target-org.ts");
  });

  it("does not initialize Salesforce transport during session lifecycle hooks", async () => {
    const handlers = new Map<string, SessionHandler[]>();
    const pi = {
      events: eventBus(),
      on: vi.fn((event: string, handler: SessionHandler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      }),
      registerCommand: vi.fn(),
      exec: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
    };

    sfDataExplorer(pi as never);

    for (const event of ["session_start", "session_shutdown"]) {
      for (const handler of handlers.get(event) ?? []) {
        await handler();
      }
    }

    expect(pi.exec).not.toHaveBeenCalled();
  });

  it("marks explorer launch actions to close the Manager before opening the explorer UI", () => {
    const pi = {
      events: eventBus(),
      on: vi.fn(),
      registerCommand: vi.fn(),
      exec: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
    };

    sfDataExplorer(pi as never);
    const actions = collectManagerDetailActions(pi as never, "sf-data-explorer");

    expect(actions.find((action) => action.id === "open.soql")?.closeBeforeRun).toBe(true);
    expect(actions.find((action) => action.id === "open.sosl")?.closeBeforeRun).toBe(true);
    expect(actions.find((action) => action.id === "open.sql")?.closeBeforeRun).toBe(true);
    expect(actions.find((action) => action.id === "help")?.closeBeforeRun).toBe(false);
    expect(actions.find((action) => action.id === "help")?.createPanel).toBeUndefined();
  });

  it("routes the no-args UI command to the SF Pi Manager detail page", async () => {
    const events = eventBus();
    const pi = {
      events,
      on: vi.fn(),
      registerCommand: vi.fn(),
      exec: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })),
    };
    let request: SfPiManagerOpenRequest | undefined;
    events.on(SF_PI_MANAGER_OPEN_EVENT, (payload) => {
      request = payload as SfPiManagerOpenRequest;
      request.accept?.();
      request.resolve?.();
    });

    sfDataExplorer(pi as never);
    const command = pi.registerCommand.mock.calls.find(
      ([name]) => name === "sf-data-explorer",
    )?.[1];
    expect(command).toBeDefined();

    await command.handler("", fakeCommandContext());

    expect(request?.route?.extensionId).toBe("sf-data-explorer");
    expect(request?.route?.view).toBe("detail");
    expect(request?.route?.actions?.map((action) => action.id)).toEqual([
      "open.soql",
      "open.sosl",
      "open.sql",
      "help",
    ]);
  });
});
