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

const discoveryMock = vi.hoisted(() => ({
  discoverAndRegister: vi.fn(async () => ({ source: "fallback", modelIds: [], error: null })),
  getLastDiscovery: vi.fn(() => null),
  registerCachedDiscoveryIfAvailable: vi.fn(() => false),
  registerProviderIfConfigured: vi.fn(() => false),
}));

vi.mock("../lib/discovery.ts", () => discoveryMock);

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
    model: undefined,
    modelRegistry: { find: vi.fn(() => undefined) },
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  } as unknown as ExtensionContext;
}

describe("gateway extension lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    monthlyUsageMock.unregisters.length = 0;
    monthlyUsageMock.registerGatewayMonthlyUsageRefresher.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not register a Gateway-owned beta header hook", async () => {
    const { default: extension } = await import("../index.ts");
    const pi = makeFakePi();

    extension(pi as never);

    expect(pi.handlers.before_provider_headers).toBeUndefined();
  });

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
    expect(monthlyUsageMock.registerGatewayMonthlyUsageRefresher).toHaveBeenCalledTimes(1);

    await shutdown?.({ type: "session_shutdown", reason: "resume" }, ctx);
    expect(monthlyUsageMock.unregisters[0]).toHaveBeenCalledTimes(1);

    await start?.({ type: "session_start" }, ctx);
    expect(monthlyUsageMock.registerGatewayMonthlyUsageRefresher).toHaveBeenCalledTimes(2);
  });
});
