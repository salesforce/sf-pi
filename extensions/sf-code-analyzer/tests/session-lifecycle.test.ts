/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/common/sf-pi-extension-state.ts", () => ({
  isSfPiExtensionEnabled: vi.fn(() => true),
}));

vi.mock("../lib/readiness.ts", async () => {
  const actual = await vi.importActual<typeof import("../lib/readiness.ts")>("../lib/readiness.ts");
  return {
    ...actual,
    refreshCodeAnalyzerReadiness: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("../lib/apexguru-readiness.ts", async () => {
  const actual = await vi.importActual<typeof import("../lib/apexguru-readiness.ts")>(
    "../lib/apexguru-readiness.ts",
  );
  return {
    ...actual,
    refreshApexGuruReadiness: vi.fn(() => Promise.resolve()),
  };
});

type Listener = (...args: unknown[]) => void;

function eventBus() {
  const listeners = new Map<string, Listener[]>();
  return {
    on(eventName: string, listener: Listener) {
      listeners.set(eventName, [...(listeners.get(eventName) ?? []), listener]);
    },
    emit(eventName: string, ...args: unknown[]) {
      for (const listener of listeners.get(eventName) ?? []) listener(...args);
    },
  };
}

function fakePi(lifecycle: ReturnType<typeof eventBus>) {
  return {
    events: eventBus(),
    on: lifecycle.on,
    registerCommand: vi.fn(),
    registerEntryRenderer: vi.fn(),
    registerTool: vi.fn(),
  };
}

function sessionContext(cwd: string) {
  let active = true;
  return {
    hasUI: true,
    get cwd() {
      if (!active) throw new Error("session context is no longer active");
      return cwd;
    },
    invalidate() {
      active = false;
    },
  };
}

describe("sf-code-analyzer session lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels readiness work when the session shuts down", async () => {
    const mod = await import("../index.ts");
    const readiness = await import("../lib/apexguru-readiness.ts");
    const lifecycle = eventBus();
    const pi = fakePi(lifecycle);
    const context = sessionContext("/old-session");

    mod.default(pi as never);
    lifecycle.emit("session_start", { reason: "startup" }, context);
    context.invalidate();
    lifecycle.emit("session_shutdown");

    expect(() => vi.advanceTimersByTime(6_000)).not.toThrow();
    expect(readiness.refreshApexGuruReadiness).not.toHaveBeenCalled();
  });

  it("cancels the previous readiness timer when a session reloads", async () => {
    const mod = await import("../index.ts");
    const readiness = await import("../lib/apexguru-readiness.ts");
    const lifecycle = eventBus();
    const pi = fakePi(lifecycle);
    const oldContext = sessionContext("/old-session");
    const currentContext = sessionContext("/current-session");

    mod.default(pi as never);
    lifecycle.emit("session_start", { reason: "startup" }, oldContext);
    oldContext.invalidate();
    lifecycle.emit("session_start", { reason: "reload" }, currentContext);

    expect(() => vi.advanceTimersByTime(6_000)).not.toThrow();
    expect(readiness.refreshApexGuruReadiness).toHaveBeenCalledTimes(1);
    expect(readiness.refreshApexGuruReadiness).toHaveBeenCalledWith(undefined, "/current-session");
  });

  it("passes a startup cwd snapshot to readiness work for a live session", async () => {
    const mod = await import("../index.ts");
    const readiness = await import("../lib/apexguru-readiness.ts");
    const lifecycle = eventBus();
    const pi = fakePi(lifecycle);
    const context = sessionContext("/stable-session");

    mod.default(pi as never);
    lifecycle.emit("session_start", { reason: "startup" }, context);
    vi.advanceTimersByTime(6_000);
    await vi.runAllTimersAsync();

    expect(readiness.refreshApexGuruReadiness).toHaveBeenCalledWith(undefined, "/stable-session");
  });
});
