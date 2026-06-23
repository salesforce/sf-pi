/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for sf-docs.
 *
 * Verifies the extension module can be imported and exports a default function.
 * This is the starting point for TDD — add specific tests as you build features.
 */
import { describe, it, expect, vi } from "vitest";
import { collectManagerDetailActions } from "../../../lib/common/manager-actions.ts";

describe("sf-docs", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("provides Manager action panels for credential input flows", async () => {
    const mod = await import("../index.ts");
    const listeners = new Map<string, Array<(payload: unknown) => void>>();
    const pi = {
      registerProvider: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      events: {
        on: (event: string, handler: (payload: unknown) => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), handler]);
          return () => undefined;
        },
        emit: (event: string, payload: unknown) => {
          for (const handler of listeners.get(event) ?? []) handler(payload);
        },
      },
    };
    mod.default(pi as never);
    const actions = collectManagerDetailActions(pi, "sf-docs");
    expect(typeof actions.find((action) => action.id === "connect")?.createPanel).toBe("function");
    expect(typeof actions.find((action) => action.id === "disconnect")?.createPanel).toBe(
      "function",
    );
  });
});
