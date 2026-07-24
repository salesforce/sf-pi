/* SPDX-License-Identifier: Apache-2.0 */
/** Lifecycle tests for extension-owned session resources. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const monthlyUsageMock = vi.hoisted(() => {
  const unregisters: Array<ReturnType<typeof vi.fn>> = [];
  const registerGatewayMonthlyUsageRefresher = vi.fn(() => {
    const unregister = vi.fn();
    unregisters.push(unregister);
    return unregister;
  });

  return {
    unregisters,
    getMonthlyUsageState: vi.fn(() => ({
      monthlyUsage: null,
      monthlyUsageError: null,
      keyInfo: null,
      keyInfoError: null,
      health: null,
      healthError: null,
      connectionStatus: null,
      dailyActivity: null,
      dailyActivityError: null,
      keyList: null,
      keyListError: null,
    })),
    refreshMonthlyUsage: vi.fn(async () => undefined),
    refreshUsageDetails: vi.fn(async () => undefined),
    registerGatewayMonthlyUsageRefresher,
  };
});

vi.mock("../lib/monthly-usage.ts", () => monthlyUsageMock);

const providerRuntimeMock = vi.hoisted(() => ({
  provider: { id: "sf-llm-gateway-internal" },
  authController: {
    getActiveCwd: vi.fn(() => undefined),
    hasConfiguredCredential: vi.fn(async () => false),
    resolveRuntimeAuth: vi.fn(async () => undefined),
  },
  bind: vi.fn(),
  clear: vi.fn(),
  getLastDiscovery: vi.fn(() => ({ source: "static", modelIds: [] })),
  getLastModelGroupDrift: vi.fn(() => []),
}));

vi.mock("../lib/provider.ts", () => ({ gatewayProviderRuntime: providerRuntimeMock }));

const migrationMock = vi.hoisted(() => ({ migrateGatewaySettings: vi.fn(async () => undefined) }));
vi.mock("../lib/migrate-unify-provider.ts", () => migrationMock);

const piSettingsMock = vi.hoisted(() => ({
  applyGatewayModelScope: vi.fn(),
  getEffectiveDefaultModelSetting: vi.fn(() => ({ provider: "anthropic", modelId: "claude" })),
  globalSettingsPath: vi.fn(() => "global-settings.json"),
  normalizeLegacyGatewayEnabledModels: vi.fn((values: unknown) => values),
  projectSettingsPath: vi.fn(() => "project-settings.json"),
  readSettings: vi.fn(() => ({})),
  removeEnabledModelPattern: vi.fn(),
  restoreEnabledModelsSnapshot: vi.fn(),
  shouldCaptureExclusiveScopeSnapshot: vi.fn(() => false),
  snapshotEnabledModelsForExclusiveScope: vi.fn(),
  writeSettings: vi.fn(),
}));

vi.mock("../lib/pi-settings.ts", () => piSettingsMock);

const bootTimingMock = vi.hoisted(() => ({
  markBootStep: vi.fn(async (_name: string, fn: () => unknown) => fn()),
}));
vi.mock("../../../lib/common/boot-timing.ts", () => bootTimingMock);

const onboardMock = vi.hoisted(() => ({
  formatOnboardChainReport: vi.fn(() => ""),
  runOnboardChain: vi.fn(async () => ({})),
  shouldNotifyClaudeCodeFirstRun: vi.fn(() => ({ shouldNotify: false })),
}));
vi.mock("../lib/onboard-action.ts", () => onboardMock);

const retryTelemetryMock = vi.hoisted(() => ({
  clearRetryEventListener: vi.fn(),
  formatRetryEventNotification: vi.fn(() => "retry"),
  setRetryEventListener: vi.fn(),
}));
vi.mock("../lib/retry-telemetry.ts", () => retryTelemetryMock);

const providerTelemetryMock = vi.hoisted(() => ({
  clearProviderSignal: vi.fn(),
  recordProviderResponse: vi.fn(),
}));
vi.mock("../lib/provider-telemetry.ts", () => providerTelemetryMock);

const wireTraceMock = vi.hoisted(() => ({
  installWireTrace: vi.fn(),
  isWireTraceEnabled: vi.fn(() => false),
}));
vi.mock("../lib/wire-trace.ts", () => wireTraceMock);

interface FakePi {
  events: EventEmitter;
  handlers: Record<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>;
  on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void): void;
  registerCommand: ReturnType<typeof vi.fn>;
  registerEntryRenderer: ReturnType<typeof vi.fn>;
  registerMessageRenderer: ReturnType<typeof vi.fn>;
  registerProvider: ReturnType<typeof vi.fn>;
  unregisterProvider: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  getThinkingLevel: ReturnType<typeof vi.fn>;
  setThinkingLevel: ReturnType<typeof vi.fn>;
}

function makeFakePi(): FakePi {
  const pi: FakePi = {
    events: new EventEmitter(),
    handlers: {},
    on(event, handler) {
      pi.handlers[event] ??= [];
      pi.handlers[event].push(handler);
    },
    registerCommand: vi.fn(),
    registerEntryRenderer: vi.fn(),
    registerMessageRenderer: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    setModel: vi.fn(async () => undefined),
    getThinkingLevel: vi.fn(() => "off"),
    setThinkingLevel: vi.fn(),
  };
  return pi;
}

function makeCtx(cwd: string): ExtensionContext {
  return {
    cwd,
    mode: "tui",
    model: undefined,
    modelRegistry: { find: vi.fn(() => undefined), refresh: vi.fn(async () => undefined) },
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  } as unknown as ExtensionContext;
}

describe("gateway extension lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    monthlyUsageMock.unregisters.length = 0;
    monthlyUsageMock.registerGatewayMonthlyUsageRefresher.mockClear();
    providerRuntimeMock.bind.mockClear();
    providerRuntimeMock.clear.mockClear();
    piSettingsMock.getEffectiveDefaultModelSetting.mockReturnValue({
      provider: "anthropic",
      modelId: "claude",
    });
    piSettingsMock.readSettings.mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers one complete native Provider", async () => {
    const { default: extension } = await import("../index.ts");
    const pi = makeFakePi();

    extension(pi as never);

    expect(pi.registerProvider).toHaveBeenCalledTimes(1);
    expect(pi.registerProvider).toHaveBeenCalledWith(providerRuntimeMock.provider);
    expect(pi.unregisterProvider).not.toHaveBeenCalled();
  });

  it("registers human-only entry rendering instead of message rendering", async () => {
    const { default: extension } = await import("../index.ts");
    const pi = makeFakePi();

    extension(pi as never);

    expect(pi.registerEntryRenderer).toHaveBeenCalledWith(
      "sf-llm-gateway-internal",
      expect.any(Function),
    );
    expect(pi.registerMessageRenderer).not.toHaveBeenCalled();
  });

  it("does not register a Gateway-owned beta header hook", async () => {
    const { default: extension } = await import("../index.ts");
    const pi = makeFakePi();

    extension(pi as never);

    expect(pi.handlers.before_provider_headers).toBeUndefined();
  });

  it.each(["set", "cycle", "restore"] as const)(
    "does not mutate thinking when a Gateway model is selected via %s",
    async (source) => {
      const { default: extension } = await import("../index.ts");
      const pi = makeFakePi();
      extension(pi as never);
      const ctx = makeCtx(mkdtempSync(join(tmpdir(), "sf-pi-gateway-thinking-")));

      await pi.handlers.model_select?.[0]?.(
        {
          type: "model_select",
          model: { provider: "sf-llm-gateway-internal", id: "gpt-5.6-sol" },
          source,
        },
        ctx,
      );

      expect(pi.setThinkingLevel).not.toHaveBeenCalled();
    },
  );

  it.each(["low", undefined])(
    "preserves a %s Pi thinking default during Gateway startup repair",
    async (thinkingLevel) => {
      const settings: Record<string, unknown> = {
        defaultProvider: "sf-llm-gateway-internal",
        defaultModel: "gpt-5.6-sol-v1",
      };
      if (thinkingLevel !== undefined) settings.defaultThinkingLevel = thinkingLevel;
      piSettingsMock.readSettings.mockReturnValue(settings);
      piSettingsMock.getEffectiveDefaultModelSetting.mockReturnValue({
        provider: "sf-llm-gateway-internal",
        modelId: "gpt-5.6-sol",
      });

      const { default: extension } = await import("../index.ts");
      const pi = makeFakePi();
      extension(pi as never);
      const ctx = makeCtx(mkdtempSync(join(tmpdir(), "sf-pi-gateway-startup-thinking-")));
      (ctx as { model?: unknown }).model = {
        provider: "sf-llm-gateway-internal",
        id: "gpt-5.6-sol",
      };

      await pi.handlers.session_start?.[0]?.({ type: "session_start", reason: "startup" }, ctx);

      expect(pi.setThinkingLevel).not.toHaveBeenCalled();
      expect(settings.defaultModel).toBe("gpt-5.6-sol");
      if (thinkingLevel === undefined) {
        expect(settings).not.toHaveProperty("defaultThinkingLevel");
      } else {
        expect(settings.defaultThinkingLevel).toBe(thinkingLevel);
      }
    },
  );

  it("registers the monthly usage refresher for each session and unregisters it on shutdown", async () => {
    const { default: extension } = await import("../index.ts");
    const pi = makeFakePi();

    extension(pi as never);

    expect(monthlyUsageMock.registerGatewayMonthlyUsageRefresher).not.toHaveBeenCalled();

    const cwd = mkdtempSync(join(tmpdir(), "sf-pi-gateway-lifecycle-"));
    const ctx = makeCtx(cwd);
    const start = pi.handlers.session_start?.[0];
    const shutdown = pi.handlers.session_shutdown?.[0];
    expect(start).toBeDefined();
    expect(shutdown).toBeDefined();

    await start?.({ type: "session_start" }, ctx);
    expect(providerRuntimeMock.bind).toHaveBeenCalledWith(cwd, ctx.ui, "tui", ctx.modelRegistry);
    expect(monthlyUsageMock.registerGatewayMonthlyUsageRefresher).toHaveBeenCalledTimes(1);

    await shutdown?.({ type: "session_shutdown", reason: "resume" }, ctx);
    expect(providerRuntimeMock.clear).toHaveBeenCalledTimes(1);
    expect(monthlyUsageMock.unregisters[0]).toHaveBeenCalledTimes(1);

    await start?.({ type: "session_start" }, ctx);
    expect(providerRuntimeMock.bind).toHaveBeenCalledTimes(2);
    expect(monthlyUsageMock.registerGatewayMonthlyUsageRefresher).toHaveBeenCalledTimes(2);
  });
});
