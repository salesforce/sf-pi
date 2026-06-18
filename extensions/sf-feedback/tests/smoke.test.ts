/* SPDX-License-Identifier: Apache-2.0 */
/** Smoke tests for sf-feedback command registration and Manager Surface routing. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  SF_PI_MANAGER_OPEN_EVENT,
  type SfPiManagerOpenRequest,
} from "../../../lib/common/manager-deep-link.ts";
import {
  collectManagerDetailActions,
  type ManagerDetailAction,
} from "../../../lib/common/manager-actions.ts";

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

describe("sf-feedback", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("does not statically import feedback-flow modules before command registration", () => {
    expect(source).not.toContain('from "./lib/diagnostics.ts"');
    expect(source).not.toContain('from "./lib/github.ts"');
    expect(source).not.toContain('from "./lib/issue-template.ts"');
    expect(source).toContain('import("./lib/diagnostics.ts")');
    expect(source).toContain('import("./lib/github.ts")');
    expect(source).toContain('import("./lib/issue-template.ts")');
  });

  it("registers the slash command before Manager action wiring", async () => {
    const mod = await import("../index.ts");
    const pi = {
      events: {
        on: vi.fn(() => {
          throw new Error("manager action registration failed");
        }),
      },
      registerCommand: vi.fn(),
    };

    expect(() => mod.default(pi as never)).toThrow("manager action registration failed");
    expect(pi.registerCommand).toHaveBeenCalledWith("sf-feedback", expect.any(Object));
  });

  it("uses Manager drill-down pages for feedback actions that collect input", async () => {
    const mod = await import("../index.ts");
    const events = eventBus();
    const pi = {
      events,
      registerCommand: vi.fn(),
    };

    mod.default(pi as never);
    const actions = collectManagerDetailActions(pi as never, "sf-feedback");
    const issueActions = actions.filter((action: ManagerDetailAction) =>
      ["bug", "feature", "setup", "feedback"].includes(action.id),
    );

    expect(issueActions.map((action) => action.id)).toEqual([
      "bug",
      "feature",
      "setup",
      "feedback",
    ]);
    expect(issueActions.every((action) => typeof action.createPanel === "function")).toBe(true);
  });

  it("routes the no-args UI command to the SF Pi Manager detail page", async () => {
    const mod = await import("../index.ts");
    const events = eventBus();
    const pi = {
      events,
      registerCommand: vi.fn(),
    };
    let request: SfPiManagerOpenRequest | undefined;
    events.on(SF_PI_MANAGER_OPEN_EVENT, (payload) => {
      request = payload as SfPiManagerOpenRequest;
      request.accept?.();
      request.resolve?.();
    });

    mod.default(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-feedback")?.[1];
    expect(command).toBeDefined();

    await command.handler("", fakeCommandContext());

    expect(request?.route?.extensionId).toBe("sf-feedback");
    expect(request?.route?.view).toBe("detail");
    expect(request?.route?.actions?.map((action) => action.id)).toEqual([
      "bug",
      "feature",
      "setup",
      "feedback",
      "diagnostics",
      "help",
    ]);
  });
});
