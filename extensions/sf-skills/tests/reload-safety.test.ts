/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Reload-safety guard.
 *
 * Applying funnel changes calls ctx.reload(), which re-emits session_start
 * with reason "reload" while the previous runtime is still unwinding. Mounting
 * the HUD overlay (ctx.ui.custom) synchronously there strands the overlay
 * promise and freezes all input until Ctrl+C. The HUD mount must be deferred
 * on reload, but stay synchronous on a normal startup.
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

  it("does NOT mount the HUD overlay synchronously during a reload", async () => {
    vi.useFakeTimers();
    try {
      const { handlers, pi } = buildExtension();
      (await import("../index.ts")).default(pi as never);
      const ctx = fakeUiCtx();
      await fire(handlers, "session_start", { reason: "reload" }, ctx);
      // The whole point: nothing mounted while reload() is still unwinding.
      expect(ctx.ui.custom).not.toHaveBeenCalled();
      // It lands on the next tick, once reload() has returned.
      vi.runAllTimers();
      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
