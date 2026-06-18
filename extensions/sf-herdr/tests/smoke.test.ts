/* SPDX-License-Identifier: Apache-2.0 */
/** Smoke tests for sf-herdr command registration and Manager Surface routing. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  SF_PI_MANAGER_OPEN_EVENT,
  type SfPiManagerOpenRequest,
} from "../../../lib/common/manager-deep-link.ts";

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

const source = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.ts"),
  "utf-8",
);

describe("sf-herdr", () => {
  it("exports a default extension factory", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("does not statically import the planner tool before command registration", () => {
    expect(source).not.toContain('from "./lib/sf_herdr_plan-tool.ts"');
    expect(source).toContain('import("./lib/sf_herdr_plan-tool.ts")');
  });

  it("registers the slash command before lifecycle wiring", async () => {
    const mod = await import("../index.ts");
    const pi = {
      events: eventBus(),
      on: vi.fn(() => {
        throw new Error("lifecycle registration failed");
      }),
      registerCommand: vi.fn(),
    };

    expect(() => mod.default(pi as never)).toThrow("lifecycle registration failed");
    expect(pi.registerCommand).toHaveBeenCalledWith("sf-herdr", expect.any(Object));
  });

  it("routes the no-args UI command to the SF Pi Manager detail page", async () => {
    const mod = await import("../index.ts");
    const events = eventBus();
    const pi = {
      events,
      on: vi.fn(),
      registerCommand: vi.fn(),
    };
    let request: SfPiManagerOpenRequest | undefined;
    events.on(SF_PI_MANAGER_OPEN_EVENT, (payload) => {
      request = payload as SfPiManagerOpenRequest;
      request.accept?.();
      request.resolve?.();
    });

    mod.default(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-herdr")?.[1];
    expect(command).toBeDefined();

    await command.handler("", fakeCommandContext());

    expect(request?.route?.extensionId).toBe("sf-herdr");
    expect(request?.route?.view).toBe("detail");
    expect(request?.route?.actions?.map((action) => action.id)).toEqual([
      "status",
      "doctor",
      "profiles",
      "reset",
      "help",
    ]);
  });

  it("routes the settings subcommand to the SF Pi Manager settings page", async () => {
    const mod = await import("../index.ts");
    const events = eventBus();
    const pi = {
      events,
      on: vi.fn(),
      registerCommand: vi.fn(),
    };
    let request: SfPiManagerOpenRequest | undefined;
    events.on(SF_PI_MANAGER_OPEN_EVENT, (payload) => {
      request = payload as SfPiManagerOpenRequest;
      request.accept?.();
      request.resolve?.();
    });

    mod.default(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-herdr")?.[1];
    expect(command).toBeDefined();

    await command.handler("settings", fakeCommandContext());

    expect(request?.route).toMatchObject({ extensionId: "sf-herdr", view: "settings" });
  });
});
