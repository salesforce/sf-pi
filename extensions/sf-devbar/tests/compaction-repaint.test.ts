/* SPDX-License-Identifier: Apache-2.0 */
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

let cachedEnvironment: SfEnvironment | null = null;
const detectConfigMock = vi.fn();
const getEnvironmentMock = vi.fn();
vi.mock("../../../lib/common/sf-environment/detect.ts", () => ({
  detectConfig: (...args: unknown[]) => detectConfigMock(...args),
}));
vi.mock("../../../lib/common/sf-environment/shared-runtime.ts", () => ({
  bindPiForSessionPersistence: vi.fn(),
  restoreFromSessionEntries: vi.fn(),
  getCachedSfEnvironment: () => cachedEnvironment,
  getSharedSfEnvironment: (...args: unknown[]) => getEnvironmentMock(...args),
  refreshSharedSfEnvironment: vi.fn(),
}));
vi.mock("../../../lib/common/sf-environment/persisted-cache.ts", () => ({
  readPersistedSfEnvironment: () => null,
}));

beforeEach(() => {
  cachedEnvironment = null;
  detectConfigMock.mockReset();
  getEnvironmentMock.mockReset();
});

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
  let footer: { render(width: number): string[] } | undefined;
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
      footer = value(tui, theme, {
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
    const results = [];
    for (const handler of handlers.get(event) ?? []) {
      results.push(await handler(payload, ctx));
    }
    return results;
  };

  return {
    pi,
    ctx,
    tui,
    emit,
    getWidget: () => widget,
    getFooter: () => footer,
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

describe("sf-devbar default targeting", () => {
  it("refreshes footer and injected context when external CLI configuration changes", async () => {
    vi.useFakeTimers();
    cachedEnvironment = {
      cli: { installed: true },
      project: { detected: false },
      config: { hasTargetOrg: true, targetOrg: "Example-Old", location: "Global" },
      org: { detected: true, orgType: "sandbox", alias: "Example-Old" },
      detectedAt: Date.now(),
    };
    const fresh: SfEnvironment = {
      ...cachedEnvironment,
      config: { hasTargetOrg: true, targetOrg: "Example-New", location: "Environment" },
      org: {
        detected: true,
        orgType: "developer",
        alias: "Example-New",
        authenticationStatus: "saved",
      },
    };
    detectConfigMock.mockResolvedValue(fresh.config);
    getEnvironmentMock.mockResolvedValue(fresh);
    const harness = createHarness();
    try {
      sfDevBar(harness.pi);
      await harness.emit("session_start");
      expect(harness.getFooter()?.render(240).join("\n")).toContain("Example-Old");
      expect(detectConfigMock).not.toHaveBeenCalled();
      const results = await harness.emit("before_agent_start");
      expect(detectConfigMock).toHaveBeenCalledWith(harness.ctx.cwd, { fresh: true });
      expect(getEnvironmentMock).toHaveBeenCalledWith(expect.any(Function), harness.ctx.cwd, {
        force: true,
      });
      const rendered = harness.getFooter()?.render(240).join("\n");
      expect(rendered).toContain("Default →");
      expect(rendered).toContain("Example-New");
      expect(rendered).toContain("env override");
      expect(rendered).not.toContain("Example-Old");
      expect(results).toEqual([
        expect.objectContaining({
          message: expect.objectContaining({
            content: expect.stringContaining("Default org: Example-New (developer)"),
          }),
        }),
      ]);
    } finally {
      await harness.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
      vi.useRealTimers();
    }
  });
});
