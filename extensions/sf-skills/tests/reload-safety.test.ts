/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Reload-safety guard.
 *
 * Pi 0.79.10 keeps reload input blocked until reload completes, so SF Skills
 * should not need a local next-tick HUD remount workaround. The HUD can mount
 * consistently for normal startup and reload; Pi owns the reload lifecycle.
 */
import { describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

function buildExtension() {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn(),
    getCommands: vi.fn(() => []),
  };
  return { handlers, pi };
}

function fakeUiCtx() {
  return {
    hasUI: true,
    mode: "tui",
    cwd: process.cwd(),
    sessionManager: { getBranch: () => [], getLeafId: () => null },
    ui: {
      custom: vi.fn(() => new Promise(() => {})), // never resolves (like a live overlay)
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
    },
  };
}

async function fire(
  handlers: Map<string, Handler[]>,
  event: string,
  payload: unknown,
  ctx: unknown,
) {
  for (const h of handlers.get(event) ?? []) await h(payload, ctx);
}

describe("sf-skills reload safety", () => {
  it("mounts the HUD overlay synchronously on a normal startup", async () => {
    const { handlers, pi } = buildExtension();
    (await import("../index.ts")).default(pi as never);
    const ctx = fakeUiCtx();
    await fire(handlers, "session_start", { reason: "startup" }, ctx);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
  });

  it("mounts the HUD overlay synchronously during a reload", async () => {
    const { handlers, pi } = buildExtension();
    (await import("../index.ts")).default(pi as never);
    const ctx = fakeUiCtx();
    await fire(handlers, "session_start", { reason: "reload" }, ctx);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
  });
});
