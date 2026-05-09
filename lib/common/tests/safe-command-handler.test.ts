/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the centralized command-handler wrapper.
 *
 * The wrapper's job is to make the failure surface obvious: any throw
 * inside the wrapped body must be visible to the user (info popup or
 * notify), and any setStatus pill it owns must clear deterministically.
 * The TUI itself isn't easy to mount in vitest, so these tests stub
 * `ctx.ui` with the minimum surface the wrapper actually touches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withSafeCommandHandler, setSafeStatus } from "../safe-command-handler.ts";

interface StubUi {
  notify: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  custom: ReturnType<typeof vi.fn>;
}

interface StubCtx {
  hasUI: boolean;
  cwd: string;
  ui: StubUi;
}

function makeStubCtx(hasUI: boolean): StubCtx {
  return {
    hasUI,
    cwd: "/tmp",
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      // openInfoPanel routes through ctx.ui.custom; the stub immediately
      // resolves so the wrapper's "show error popup" branch completes.
      custom: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("withSafeCommandHandler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the wrapped function's value on success", async () => {
    const ctx = makeStubCtx(true);
     
    const result = await withSafeCommandHandler(ctx as any, "sf-thing", async () => 42);
    expect(result).toBe(42);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("surfaces a throw via openInfoPanel (ctx.ui.custom) when ctx.hasUI", async () => {
    const ctx = makeStubCtx(true);
    const result = await withSafeCommandHandler(
       
      ctx as any,
      "sf-thing",
      async () => {
        throw new Error("boom");
      },
    );
    expect(result).toBeUndefined();
    // openInfoPanel routes through ctx.ui.custom — that's the visible
    // popup the user can't miss.
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("falls back to ctx.ui.notify when ctx.hasUI is false", async () => {
    const ctx = makeStubCtx(false);
    const result = await withSafeCommandHandler(
       
      ctx as any,
      "sf-thing",
      async () => {
        throw new Error("boom");
      },
    );
    expect(result).toBeUndefined();
    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0]?.[0]).toContain("sf-thing");
    expect(ctx.ui.notify.mock.calls[0]?.[0]).toContain("boom");
    expect(ctx.ui.notify.mock.calls[0]?.[1]).toBe("error");
  });

  it("surfaces non-Error throws (string, plain object) without crashing", async () => {
    const ctx = makeStubCtx(false);
    const result = await withSafeCommandHandler(
       
      ctx as any,
      "sf-thing",
      async () => {
         
        throw "oh no";
      },
    );
    expect(result).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0]?.[0]).toContain("oh no");
  });

  it("does not show the running pill for fast paths (<300ms)", async () => {
    const ctx = makeStubCtx(true);
     
    const promise = withSafeCommandHandler(ctx as any, "sf-thing", async () => "fast");
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    // No setStatus call expected at all.
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("shows AND clears the running pill for slow paths (>=300ms)", async () => {
    const ctx = makeStubCtx(true);
    let resolveBody: () => void = () => {};
    const promise = withSafeCommandHandler(
       
      ctx as any,
      "sf-thing",
      () =>
        new Promise<void>((resolve) => {
          resolveBody = resolve;
        }),
    );
    // Advance past the threshold — pill should appear with the running message.
    await vi.advanceTimersByTimeAsync(400);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("sf-thing"),
      expect.stringContaining("running"),
    );
    // Now finish the body; the pill must clear in finally.
    resolveBody();
    await promise;
    const calls = ctx.ui.setStatus.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[1]).toBeUndefined();
  });

  it("clears the running pill even when the body throws", async () => {
    const ctx = makeStubCtx(true);
    let rejectBody: (err: Error) => void = () => {};
    const promise = withSafeCommandHandler(
       
      ctx as any,
      "sf-thing",
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectBody = reject;
        }),
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(ctx.ui.setStatus).toHaveBeenCalled();
    rejectBody(new Error("boom"));
    await promise;
    // The last setStatus call must clear the pill.
    const calls = ctx.ui.setStatus.mock.calls;
    expect(calls[calls.length - 1]?.[1]).toBeUndefined();
    // Error popup also fired.
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
  });

  it("falls back to notify when the error popup itself fails to mount", async () => {
    const ctx = makeStubCtx(true);
    ctx.ui.custom.mockRejectedValueOnce(new Error("ctx is stale"));
    await withSafeCommandHandler(
       
      ctx as any,
      "sf-thing",
      async () => {
        throw new Error("primary failure");
      },
    );
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    // Fallback notify always carries the original error message.
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify.mock.calls[0]?.[0]).toContain("primary failure");
  });
});

describe("setSafeStatus", () => {
  it("clears the status indicator after success", async () => {
    const ctx = makeStubCtx(true);
     
    const result = await setSafeStatus(ctx as any, "k", "loading…", async () => "ok");
    expect(result).toBe("ok");
    expect(ctx.ui.setStatus).toHaveBeenNthCalledWith(1, "k", "loading…");
    expect(ctx.ui.setStatus).toHaveBeenNthCalledWith(2, "k", undefined);
  });

  it("clears the status indicator even when the body throws", async () => {
    const ctx = makeStubCtx(true);
    await expect(
       
      setSafeStatus(ctx as any, "k", "loading…", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // First call sets, second clears — even on the error path.
    expect(ctx.ui.setStatus).toHaveBeenNthCalledWith(2, "k", undefined);
  });

  it("is a no-op for status calls when ctx.hasUI is false", async () => {
    const ctx = makeStubCtx(false);
     
    await setSafeStatus(ctx as any, "k", "loading…", async () => "ok");
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });
});
