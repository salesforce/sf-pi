/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import sfOhanaSpinner from "../index.ts";
import { messages } from "../lib/messages.ts";
import { writeScopedOhanaSpinnerSettings } from "../lib/settings.ts";

const tempDirs = new Set<string>();

function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-ohana-spinner-lifecycle-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

type Handler = (event: unknown, ctx: ReturnType<typeof createCtx>) => unknown | Promise<unknown>;

function registerExtension(): Record<string, Handler[]> {
  const handlers: Record<string, Handler[]> = {};
  sfOhanaSpinner({
    on(event: string, handler: Handler) {
      handlers[event] ??= [];
      handlers[event].push(handler);
    },
  } as never);
  return handlers;
}

function createCtx(cwd: string, sessionId = "session-1") {
  return {
    cwd,
    hasUI: true,
    sessionManager: {
      getSessionId: () => sessionId,
    },
    ui: {
      setWorkingIndicator: vi.fn(),
      setWorkingMessage: vi.fn(),
    },
  };
}

async function runSessionStart(
  handlers: Record<string, Handler[]>,
  ctx: ReturnType<typeof createCtx>,
) {
  for (const handler of handlers.session_start ?? []) {
    await handler({}, ctx);
  }
}

async function runSessionShutdown(
  handlers: Record<string, Handler[]>,
  ctx: ReturnType<typeof createCtx>,
) {
  for (const handler of handlers.session_shutdown ?? []) {
    await handler({}, ctx);
  }
}

function latestIndicatorFrames(ctx: ReturnType<typeof createCtx>): string[] {
  const lastCall = ctx.ui.setWorkingIndicator.mock.calls.at(-1)?.[0] as
    { frames?: unknown } | undefined;
  expect(Array.isArray(lastCall?.frames)).toBe(true);
  return lastCall?.frames as string[];
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("sf-ohana-spinner waiting-state outcome", () => {
  it("shows a colorful Salesforce-themed waiting indicator in Ohana mode", async () => {
    const cwd = tempCwd();
    writeScopedOhanaSpinnerSettings(cwd, "project", { mode: "ohana" });
    vi.spyOn(Math, "random").mockReturnValue(0);

    const handlers = registerExtension();
    const ctx = createCtx(cwd);
    await runSessionStart(handlers, ctx);

    const frames = latestIndicatorFrames(ctx);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((frame) => frame.includes("Thinking…"))).toBe(true);
    expect(frames.some((frame) => /\x1b\[38;2;\d+;\d+;\d+m/.test(frame))).toBe(true);
    expect(
      frames.some((frame) => /opp|pipeline|SOQL|Apex|Flow|Agentforce/i.test(stripAnsi(frame))),
    ).toBe(true);
    expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith("");
  });

  it("shows a quiet waiting indicator in Calm mode", async () => {
    const cwd = tempCwd();
    writeScopedOhanaSpinnerSettings(cwd, "project", { mode: "calm" });

    const handlers = registerExtension();
    const ctx = createCtx(cwd);
    await runSessionStart(handlers, ctx);

    const frames = latestIndicatorFrames(ctx);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((frame) => frame.includes("Thinking…"))).toBe(true);
    expect(frames.every((frame) => !/\x1b\[38;2;\d+;\d+;\d+m/.test(frame))).toBe(true);
    expect(frames.every((frame) => !frame.includes(" · "))).toBe(true);
    expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith("");
  });

  it("restores Pi's default waiting indicator on shutdown", async () => {
    const cwd = tempCwd();
    writeScopedOhanaSpinnerSettings(cwd, "project", { mode: "calm" });

    const handlers = registerExtension();
    const ctx = createCtx(cwd);
    await runSessionStart(handlers, ctx);
    await runSessionShutdown(handlers, ctx);

    expect(ctx.ui.setWorkingIndicator).toHaveBeenLastCalledWith();
    expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
  });
});

describe("sf-ohana-spinner stale-ctx safety", () => {
  it("does not keep reading a replaced session ctx from the rotation timer", async () => {
    vi.useFakeTimers();
    try {
      const cwd = tempCwd();
      writeScopedOhanaSpinnerSettings(cwd, "project", { mode: "ohana" });

      const handlers = registerExtension();
      const staleCtx = createCtx(cwd, "session-1");
      await runSessionStart(handlers, staleCtx);
      const staleIndicatorCalls = staleCtx.ui.setWorkingIndicator.mock.calls.length;

      const activeCtx = createCtx(cwd, "session-2");
      await runSessionStart(handlers, activeCtx);

      const staleError = new Error(
        "This extension ctx is stale after session replacement or reload.",
      );
      Object.defineProperty(staleCtx, "hasUI", {
        get() {
          throw staleError;
        },
      });
      Object.defineProperty(staleCtx, "cwd", {
        get() {
          throw staleError;
        },
      });
      staleCtx.sessionManager.getSessionId = () => {
        throw staleError;
      };

      const rejections: unknown[] = [];
      const onRejection = (reason: unknown) => rejections.push(reason);
      process.on("unhandledRejection", onRejection);
      try {
        await vi.advanceTimersByTimeAsync(5_000);
        await Promise.resolve();
      } finally {
        process.off("unhandledRejection", onRejection);
      }

      expect(rejections).toEqual([]);
      expect(staleCtx.ui.setWorkingIndicator.mock.calls.length).toBe(staleIndicatorCalls);
      expect(activeCtx.ui.setWorkingIndicator.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("catches rotation failures so timer promises cannot crash the host", async () => {
    vi.useFakeTimers();
    try {
      const cwd = tempCwd();
      writeScopedOhanaSpinnerSettings(cwd, "project", { mode: "ohana" });

      const handlers = registerExtension();
      const ctx = createCtx(cwd);
      await runSessionStart(handlers, ctx);

      ctx.ui.setWorkingIndicator.mockImplementation(() => {
        throw new Error("simulated UI rotation failure");
      });

      const rejections: unknown[] = [];
      const onRejection = (reason: unknown) => rejections.push(reason);
      process.on("unhandledRejection", onRejection);
      try {
        await vi.advanceTimersByTimeAsync(5_000);
        await Promise.resolve();
      } finally {
        process.off("unhandledRejection", onRejection);
      }

      expect(rejections).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Ohana visible message outcomes", () => {
  it("keeps every possible visible message short and product/platform-oriented", () => {
    const personSpecificTerms = /\b(founder|co-founder|executive|CEO|CTO)\b/i;

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.trim()).toBe(message);
      expect(message.length).toBeLessThanOrEqual(96);
      expect(message).not.toMatch(personSpecificTerms);
    }
  });
});
