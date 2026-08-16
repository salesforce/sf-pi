/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proof for the Manager-hosted Gateway setup action. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExtensionCommandContext,
  ExtensionUIContext,
  ModelRegistry,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { buildGatewayManagerActions, refreshGatewayProvider } from "../index.ts";
import {
  PROVIDER_NAME,
  readGatewaySavedConfig,
  projectGatewayConfigPath,
  writeGatewaySavedConfig,
} from "../lib/config.ts";
import { GATEWAY_RESOLVED_ROOT_ENV } from "../lib/provider-auth.ts";
import { gatewayProviderRuntime } from "../lib/provider.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const tempDirs: string[] = [];

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = tempDir("sf-pi-gateway-manager-agent-");
});

afterEach(() => {
  gatewayProviderRuntime.clear();
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("Manager Gateway setup", () => {
  it("passes Pi 0.84 provider scope and cancellation to ModelRegistry refresh", async () => {
    const cwd = tempDir("sf-pi-gateway-refresh-options-");
    const refresh = vi.fn(async () => ({ aborted: false, errors: new Map() }));
    const ui = { setStatus: vi.fn() } as unknown as ExtensionUIContext;
    const ctx = {
      cwd,
      mode: "tui",
      modelRegistry: { refresh } as unknown as ModelRegistry,
      ui,
    } as unknown as ExtensionCommandContext;

    await refreshGatewayProvider(ctx);

    expect(refresh).toHaveBeenCalledWith({
      providers: [PROVIDER_NAME],
      force: true,
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    {
      label: "accepts the Pi 0.82/0.83 void result",
      result: undefined,
      expectedError: undefined,
    },
    {
      label: "classifies Pi 0.84 cancellation",
      result: { aborted: true, errors: new Map<string, Error>() },
      expectedError: "timed out",
    },
    {
      label: "classifies Pi 0.84 provider errors",
      result: {
        aborted: false,
        errors: new Map([[PROVIDER_NAME, new Error("private provider detail")]]),
      },
      expectedError: "refresh failed",
    },
  ])("$label", async ({ result, expectedError }) => {
    const cwd = tempDir("sf-pi-gateway-refresh-result-");
    const refresh = vi.fn(async () => result);
    const ui = { setStatus: vi.fn() } as unknown as ExtensionUIContext;
    const ctx = {
      cwd,
      mode: "tui",
      modelRegistry: { refresh } as unknown as ModelRegistry,
      ui,
    } as unknown as ExtensionCommandContext;

    const state = await refreshGatewayProvider(ctx);

    if (expectedError) expect(state.error).toContain(expectedError);
    else expect(state.error).toBeUndefined();
    expect(state.error ?? "").not.toContain("private provider detail");
  });

  it("restores the disabled state when re-enable auth resolution throws", async () => {
    const cwd = tempDir("sf-pi-gateway-manager-reenable-");
    const configPath = projectGatewayConfigPath(cwd);
    writeGatewaySavedConfig(configPath, { enabled: false });
    const modelRegistry = {
      getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
      getProviderAuth: vi.fn(async () => {
        throw new Error("credential store unavailable");
      }),
    } as unknown as ModelRegistry;
    const ui = {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setEditorText: vi.fn(),
    } as unknown as ExtensionUIContext;
    const ctx = {
      cwd,
      mode: "tui",
      hasUI: true,
      model: undefined,
      modelRegistry,
      ui,
    } as unknown as ExtensionCommandContext;
    gatewayProviderRuntime.bind(cwd, ui, "tui", modelRegistry);
    const enable = buildGatewayManagerActions({} as never).find((action) => action.id === "on");
    expect(enable).toBeDefined();
    if (!enable) return;

    await expect(Promise.resolve(enable.run(ctx, "project"))).rejects.toThrow(
      "credential store unavailable",
    );

    expect(readGatewaySavedConfig(configPath).enabled).toBe(false);
  });

  it("projects the authenticated Gateway catalog into the compaction model picker", () => {
    const cwd = tempDir("sf-pi-gateway-manager-compaction-");
    const getAvailable = vi.fn(() => [
      {
        provider: PROVIDER_NAME,
        id: "claude-sonnet-5",
        name: "[SF LLM Gateway] Claude Sonnet 5",
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
      {
        provider: "openai",
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        contextWindow: 400_000,
        maxTokens: 128_000,
      },
    ]);
    const ctx = {
      cwd,
      mode: "tui",
      hasUI: true,
      modelRegistry: { getAvailable },
      ui: { notify: vi.fn(), setStatus: vi.fn() },
    } as unknown as ExtensionCommandContext;
    const setup = buildGatewayManagerActions({} as never).find((action) => action.id === "setup");
    const panel = setup?.createPanel?.(theme, cwd, "project", vi.fn(), ctx, {
      requestRender: vi.fn(),
    } as unknown as TUI);
    expect(panel).toBeDefined();
    if (!panel) return;

    panel.handleInput?.("\x1b[B"); // base URL -> scoped model mode
    panel.handleInput?.("\x1b[B"); // scoped model mode -> compaction model
    panel.handleInput?.("\x1b[C"); // inherit -> active
    panel.handleInput?.("\x1b[C"); // active -> Claude Sonnet 5

    expect(getAvailable).toHaveBeenCalledOnce();
    expect(panel.renderContent?.(100).join("\n")).toContain("Claude Sonnet 5");
    expect(panel.renderContent?.(100).join("\n")).not.toContain("GPT-5 Mini");
  });

  it("persists settings without starting model or usage refresh work", async () => {
    const cwd = tempDir("sf-pi-gateway-manager-project-");
    const refresh = vi.fn(async () => undefined);
    const modelRegistry = {
      refresh,
      getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
      getProviderAuth: vi.fn(async () => ({
        auth: { apiKey: "pi-saved-test-key" },
        env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://gateway.example.test" },
        source: "Pi saved credential",
      })),
      getAll: () => [],
      getAvailable: () => [],
      find: () => undefined,
    } as unknown as ModelRegistry;
    const ui = {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setEditorText: vi.fn(),
    } as unknown as ExtensionUIContext;
    const ctx = {
      cwd,
      mode: "tui",
      hasUI: true,
      model: undefined,
      modelRegistry,
      ui,
      getContextUsage: () => undefined,
    } as unknown as ExtensionCommandContext;
    gatewayProviderRuntime.bind(cwd, ui, "tui", modelRegistry);

    const done = vi.fn();
    const requestRender = vi.fn();
    const setup = buildGatewayManagerActions({} as never).find((action) => action.id === "setup");
    const panel = setup?.createPanel?.(theme, cwd, "project", done, ctx, {
      requestRender,
    } as unknown as TUI);
    expect(panel).toBeDefined();
    if (!panel) return;

    panel.focused = true;
    panel.handleInput?.("https://gateway.example.test/v1");
    panel.handleInput?.("\r"); // base URL -> scoped model mode
    panel.handleInput?.("\x1b[B"); // scoped model mode -> compaction model
    panel.handleInput?.("\x1b[B"); // compaction model -> primary Save action
    panel.handleInput?.("\r");
    await Promise.resolve();
    await Promise.resolve();

    expect(readGatewaySavedConfig(projectGatewayConfigPath(cwd))).toMatchObject({
      baseUrl: "https://gateway.example.test",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });
});
