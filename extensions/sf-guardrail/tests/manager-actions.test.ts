/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Guardrail Manager detail actions. */
import { describe, expect, it, vi } from "vitest";
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

describe("sf-guardrail manager actions", () => {
  it("uses Manager action pages for input and destructive detail actions", async () => {
    const mod = await import("../index.ts");
    const pi = {
      events: eventBus(),
      on: vi.fn(),
      registerCommand: vi.fn(),
    };

    mod.default(pi as never);
    const actions = collectManagerDetailActions(pi as never, "sf-guardrail");

    expect(typeof actions.find((action) => action.id === "aliases")?.createPanel).toBe("function");
    expect(typeof actions.find((action) => action.id === "forget")?.createPanel).toBe("function");
    expect(actions.find((action) => action.id === "help")?.createPanel).toBeUndefined();
  });
});
