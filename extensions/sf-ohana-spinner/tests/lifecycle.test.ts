/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import sfOhanaSpinner from "../index.ts";
import { MAX_MESSAGE_LENGTH, messages } from "../lib/messages.ts";
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

describe("sf-ohana-spinner waiting-state outcome", () => {
  it("rotates Salesforce chrome through Pi's working message in Ohana mode", async () => {
    const cwd = tempCwd();
    writeScopedOhanaSpinnerSettings(cwd, "project", { mode: "ohana" });
    vi.spyOn(Math, "random").mockReturnValue(0);

    const handlers = registerExtension();
    const ctx = createCtx(cwd);
    await runSessionStart(handlers, ctx);

    expect(ctx.ui.setWorkingIndicator).toHaveBeenCalledWith();
    expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith(messages[0]);
    expect(messages[0]).toMatch(/opp|pipeline|SOQL|Apex|Flow|Agentforce|CSV/i);
  });

  it("restores Pi's default Working label in Calm mode", async () => {
    const cwd = tempCwd();
    writeScopedOhanaSpinnerSettings(cwd, "project", { mode: "calm" });

    const handlers = registerExtension();
    const ctx = createCtx(cwd);
    await runSessionStart(handlers, ctx);

    expect(ctx.ui.setWorkingIndicator).toHaveBeenCalledWith();
    expect(ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
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
      const staleMessageCalls = staleCtx.ui.setWorkingMessage.mock.calls.length;

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
      expect(staleCtx.ui.setWorkingMessage.mock.calls.length).toBe(staleMessageCalls);
      expect(activeCtx.ui.setWorkingMessage.mock.calls.length).toBeGreaterThan(1);
      expect(activeCtx.ui.setWorkingIndicator.mock.calls.length).toBe(1);
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

      ctx.ui.setWorkingMessage.mockImplementation(() => {
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
      expect(message.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
      expect(message).not.toMatch(personSpecificTerms);
    }
  });
});
