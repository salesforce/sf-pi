/* SPDX-License-Identifier: Apache-2.0 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import sfDevBar from "../index.ts";

function createHarness() {
  const handlers = new Map<
    string,
    Array<(event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown>
  >();
  const tui = { requestRender: vi.fn() };
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  let widget:
    { render(width: number): string[]; invalidate(): void; dispose?: () => void } | undefined;

  const ui = {
    setWidget: vi.fn((_key: string, value: unknown) => {
      if (typeof value === "function") {
        widget = value(tui, theme);
      } else if (value === undefined) {
        widget = undefined;
      }
    }),
    setFooter: vi.fn((value: unknown) => {
      if (typeof value !== "function") return;
      value(tui, theme, {
        onBranchChange: () => () => undefined,
        getGitBranch: () => null,
        getExtensionStatuses: () => [],
      });
    }),
    setTitle: vi.fn(),
    notify: vi.fn(),
    setStatus: vi.fn(),
  };

  const sessionManager = SessionManager.inMemory("/workspace/sf-devbar-compaction");
  let contextUsage: ReturnType<ExtensionContext["getContextUsage"]> = {
    tokens: 900_000,
    contextWindow: 1_000_000,
    percent: 90,
  };
  const ctx = {
    cwd: "/workspace/sf-devbar-compaction",
    hasUI: true,
    mode: "tui",
    model: {
      provider: "sf-llm-gateway",
      id: "example-model",
      name: "Example Model",
    },
    sessionManager,
    ui,
    getContextUsage: () => contextUsage,
    isProjectTrusted: () => true,
  } as unknown as ExtensionContext;

  const pi = {
    events: new EventEmitter(),
    on(event: string, handler: (event: unknown, eventCtx: ExtensionContext) => unknown) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    getThinkingLevel: vi.fn(() => "high"),
    getSessionName: vi.fn(() => undefined),
    exec: vi.fn(async () => ({ stdout: "", stderr: "", code: 0, killed: false })),
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;

  const emit = async (event: string, payload: unknown = { type: event }) => {
    for (const handler of handlers.get(event) ?? []) {
      await handler(payload, ctx);
    }
  };

  return {
    pi,
    ctx,
    tui,
    emit,
    getWidget: () => widget,
    setContextUsage(value: typeof contextUsage) {
      contextUsage = value;
    },
  };
}

describe("sf-devbar compaction repaint", () => {
  it("repaints the context bar to Pi's unknown state after compaction", async () => {
    vi.useFakeTimers();
    const harness = createHarness();

    try {
      sfDevBar(harness.pi);
      await harness.emit("session_start");
      expect(harness.getWidget()?.render(160).join("\n")).toContain("90.0%");

      harness.tui.requestRender.mockClear();
      harness.setContextUsage({ tokens: null, contextWindow: 1_000_000, percent: null });
      await harness.emit("session_compact");

      expect(harness.tui.requestRender).toHaveBeenCalled();
      expect(harness.getWidget()?.render(160).join("\n")).toContain("Context Window unknown");
    } finally {
      await harness.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
      vi.useRealTimers();
    }
  });
});
