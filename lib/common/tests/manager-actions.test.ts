/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for Manager Surface action discovery. */
import { describe, expect, it, vi } from "vitest";
import {
  collectManagerDetailActions,
  registerManagerDetailActions,
  runCollectedManagerDetailAction,
} from "../manager-actions.ts";

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

describe("manager detail actions", () => {
  it("discovers and runs extension-owned actions through the shared event bus", async () => {
    const run = vi.fn();
    const pi = { events: eventBus() };
    const ctx = {} as never;

    registerManagerDetailActions(pi, "test-extension", [
      { id: "audit", label: "Audit", description: "Show audit", run },
    ]);

    expect(collectManagerDetailActions(pi, "test-extension")).toMatchObject([
      { id: "audit", label: "Audit", description: "Show audit" },
    ]);
    await expect(runCollectedManagerDetailAction(pi, "test-extension", "audit", ctx)).resolves.toBe(
      true,
    );
    expect(run).toHaveBeenCalledWith(ctx, "global");
  });

  it("passes an explicit selected scope to scoped actions", async () => {
    const run = vi.fn();
    const pi = { events: eventBus() };
    const ctx = {} as never;

    registerManagerDetailActions(pi, "test-extension", [
      { id: "setup", label: "Setup", description: "Run setup", acceptsScope: true, run },
    ]);

    await expect(
      runCollectedManagerDetailAction(pi, "test-extension", "setup", ctx, "project"),
    ).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith(ctx, "project");
  });

  it("returns false for unknown actions", async () => {
    const pi = { events: eventBus() };

    await expect(
      runCollectedManagerDetailAction(pi, "missing-extension", "audit", {} as never),
    ).resolves.toBe(false);
  });
});
