/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Reload-safety guard for sf-lsp.
 *
 * sf-lsp schedules deferred startup timers (doctor probe, install prompt) that
 * capture `ctx`. After ctx.reload() the ctx is stale and its `signal` getter
 * THROWS — so a timer firing post-reload crashed pi with an uncaughtException.
 * The fix: clear the timers on session_shutdown, and guard the signal access.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

function buildExtension() {
  const handlers = new Map<string, Handler[]>();
  // Permissive fake pi: any registration method is a no-op fn; `on` captures
  // handlers so we can fire lifecycle events.
  const base: Record<string, unknown> = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    getCommands: () => [],
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
  };
  const pi = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return () => undefined; // registerCommand / registerTool / registerMessageRenderer / …
    },
  });
  return { handlers, pi };
}

/**
 * A ctx that is valid at schedule time but can be flipped "stale" so its
 * getters throw — exactly how reload() invalidates a captured ctx.
 */
function togglableCtx() {
  let stale = false;
  const guard = <T>(value: T): T => {
    if (stale) throw new Error("stale ctx");
    return value;
  };
  const ui = { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn(), setFooter: vi.fn() };
  const sessionManager = { getSessionId: () => "s1", getBranch: () => [], getLeafId: () => null };
  return {
    goStale: () => {
      stale = true;
    },
    ctx: {
      get hasUI() {
        return guard(true);
      },
      get cwd() {
        return guard(process.cwd());
      },
      get signal() {
        return guard<{ aborted: boolean }>({ aborted: false });
      },
      get ui() {
        return guard(ui);
      },
      get sessionManager() {
        return guard(sessionManager);
      },
    },
  };
}

const liveCtx = () => togglableCtx().ctx;

async function fire(handlers: Map<string, Handler[]>, event: string, ctx: unknown) {
  for (const h of handlers.get(event) ?? []) await h({ reason: "startup" }, ctx);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("sf-lsp reload safety", () => {
  it("clears deferred startup timers on session_shutdown", async () => {
    const { handlers, pi } = buildExtension();
    (await import("../index.ts")).default(pi as never);

    await fire(handlers, "session_start", liveCtx());
    // The doctor + install timers are now pending.
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await fire(handlers, "session_shutdown", liveCtx());
    // Shutdown must cancel them so they never fire against a stale ctx.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not throw if a deferred timer fires against a stale ctx", async () => {
    const { handlers, pi } = buildExtension();
    (await import("../index.ts")).default(pi as never);

    // Schedule the timers with a valid ctx, then invalidate it (as reload does).
    const session = togglableCtx();
    await fire(handlers, "session_start", session.ctx);
    session.goStale();
    // Firing them must not throw (the guarded signal check swallows the
    // stale-ctx error instead of crashing the process).
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});
